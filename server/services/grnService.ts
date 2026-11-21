import crypto from 'node:crypto';
import type { DbInstance } from '../db/connection.ts';
import { runInTransaction } from '../db/connection.ts';
import { AppError, assertBranchWriteAccess, type AuthUser } from '../middleware/auth.ts';
import { checkAndNotifyStockLevel, createNotification, recordAuditLog } from './auditService.ts';
import { computeGrandTotal, computeLineTotal } from './inventoryMath.ts';

export interface GrnItemInput {
  product_id: number;
  quantity_received: number;
  unit_cost?: number;
}

export interface CreateGrnInput {
  branch_id: number;
  supplier_id: number;
  purchase_order_id?: number | null;
  delivery_note_number?: string;
  date_received: string;
  remarks?: string;
  idempotency_key?: string;
  allow_over_receipt?: boolean;
  items: GrnItemInput[];
}

function generateGrnNumber(db: DbInstance): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM stock_intakes').get() as { cnt: number };
  const seq = String(countRow.cnt + 1).padStart(4, '0');
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `GRN-${datePart}-${seq}-${suffix}`;
}

function generateLedgerRef(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export function createStockIntake(
  db: DbInstance,
  input: CreateGrnInput,
  actor: AuthUser,
  ipAddress = ''
) {
  assertBranchWriteAccess(db, actor, input.branch_id, undefined);

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new AppError(400, 'At least one product line item is required for a GRN');
  }

  if (input.idempotency_key) {
    const existing = db
      .prepare('SELECT id, grn_number FROM stock_intakes WHERE idempotency_key = ?')
      .get(input.idempotency_key) as { id: number; grn_number: string } | undefined;
    if (existing) {
      throw new AppError(
        409,
        `Duplicate GRN submission prevented. Already recorded as ${existing.grn_number}`
      );
    }
  }

  const supplier = db
    .prepare('SELECT id, name, status FROM suppliers WHERE id = ?')
    .get(input.supplier_id) as { id: number; name: string; status: string } | undefined;
  if (!supplier) {
    throw new AppError(404, 'Supplier not found');
  }
  if (supplier.status !== 'active') {
    throw new AppError(422, 'Cannot record GRN for an inactive supplier');
  }

  return runInTransaction(db, () => {
    let poRecord:
      | { id: number; po_number: string; supplier_id: number; branch_id: number; status: string }
      | undefined;

    if (input.purchase_order_id) {
      poRecord = db
        .prepare(
          'SELECT id, po_number, supplier_id, branch_id, status FROM purchase_orders WHERE id = ?'
        )
        .get(input.purchase_order_id) as typeof poRecord;
      if (!poRecord) {
        throw new AppError(404, 'Referenced Purchase Order not found');
      }
      if (!['sent', 'partially_received'].includes(poRecord.status)) {
        throw new AppError(
          422,
          `Purchase Order ${poRecord.po_number} cannot receive goods in status "${poRecord.status}"`
        );
      }
      if (poRecord.supplier_id !== input.supplier_id || poRecord.branch_id !== input.branch_id) {
        throw new AppError(
          422,
          'GRN supplier and branch must match the referenced Purchase Order'
        );
      }
    }

    const preparedLines: Array<{
      product_id: number;
      product_name: string;
      quantity_received: number;
      unit_cost: number;
      line_total: number;
    }> = [];

    const seenProducts = new Set<number>();

    for (const item of input.items) {
      if (!Number.isInteger(item.quantity_received) || item.quantity_received <= 0) {
        throw new AppError(400, 'Quantity received must be a positive whole number');
      }
      if (seenProducts.has(item.product_id)) {
        throw new AppError(400, 'Duplicate product rows in the same GRN are not allowed');
      }
      seenProducts.add(item.product_id);

      const product = db
        .prepare('SELECT id, name, unit_cost, status FROM products WHERE id = ?')
        .get(item.product_id) as
        | { id: number; name: string; unit_cost: number; status: string }
        | undefined;
      if (!product) {
        throw new AppError(404, `Product ID ${item.product_id} not found`);
      }

      const canAdjustCost = actor.role === 'admin' || actor.role === 'procurement_manager';
      const resolvedCost =
        item.unit_cost !== undefined && item.unit_cost !== null
          ? canAdjustCost || item.unit_cost === product.unit_cost
            ? Math.round(item.unit_cost)
            : product.unit_cost
          : product.unit_cost;

      if (resolvedCost < 0) {
        throw new AppError(400, 'Unit cost cannot be negative');
      }

      if (poRecord) {
        const poItem = db
          .prepare(
            `SELECT id, quantity_ordered, quantity_received
             FROM purchase_order_items
             WHERE purchase_order_id = ? AND product_id = ?`
          )
          .get(poRecord.id, item.product_id) as
          | { id: number; quantity_ordered: number; quantity_received: number }
          | undefined;
        if (!poItem) {
          throw new AppError(
            422,
            `Product "${product.name}" is not listed on Purchase Order ${poRecord.po_number}`
          );
        }
        const remaining = poItem.quantity_ordered - poItem.quantity_received;
        const allowOver =
          Boolean(input.allow_over_receipt) &&
          (actor.role === 'admin' || actor.role === 'procurement_manager');
        if (!allowOver && item.quantity_received > remaining) {
          throw new AppError(
            422,
            `Cannot receive ${item.quantity_received} of "${product.name}"; only ${remaining} remaining on ${poRecord.po_number}`
          );
        }
      }

      const lineTotal = computeLineTotal(item.quantity_received, resolvedCost);
      preparedLines.push({
        product_id: product.id,
        product_name: product.name,
        quantity_received: item.quantity_received,
        unit_cost: resolvedCost,
        line_total: lineTotal,
      });
    }

    const grandTotal = computeGrandTotal(preparedLines.map((l) => l.line_total));
    const grnNumber = generateGrnNumber(db);

    const intakeRes = db
      .prepare(
        `INSERT INTO stock_intakes (
          grn_number, idempotency_key, branch_id, supplier_id, purchase_order_id,
          delivery_note_number, date_received, received_by, grand_total, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        grnNumber,
        input.idempotency_key || null,
        input.branch_id,
        input.supplier_id,
        input.purchase_order_id || null,
        (input.delivery_note_number || '').trim(),
        input.date_received || new Date().toISOString().slice(0, 10),
        actor.id,
        grandTotal,
        (input.remarks || '').trim()
      );

    const intakeId = Number(intakeRes.lastInsertRowid);

    for (const line of preparedLines) {
      db.prepare(
        `INSERT INTO stock_intake_items (stock_intake_id, product_id, quantity_received, unit_cost, line_total)
         VALUES (?, ?, ?, ?, ?)`
      ).run(intakeId, line.product_id, line.quantity_received, line.unit_cost, line.line_total);

      // Ensure stock record exists & atomically increment
      db.prepare(
        `INSERT OR IGNORE INTO stocks (product_id, branch_id, quantity_on_hand) VALUES (?, ?, 0)`
      ).run(line.product_id, input.branch_id);

      db.prepare(
        `UPDATE stocks
         SET quantity_on_hand = quantity_on_hand + ?,
             last_movement_at = datetime('now'),
             updated_at = datetime('now')
         WHERE product_id = ? AND branch_id = ?`
      ).run(line.quantity_received, line.product_id, input.branch_id);

      const updatedStock = db
        .prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = ? AND branch_id = ?')
        .get(line.product_id, input.branch_id) as { quantity_on_hand: number };

      db.prepare(
        `INSERT INTO inventory_transactions (
          transaction_ref, product_id, branch_id, transaction_type,
          quantity_added, quantity_removed, balance_after, unit_cost,
          reference_number, source_entity, source_id, user_id, notes
        ) VALUES (?, ?, ?, 'grn', ?, 0, ?, ?, ?, 'stock_intake', ?, ?, ?)`
      ).run(
        generateLedgerRef('TX-GRN'),
        line.product_id,
        input.branch_id,
        line.quantity_received,
        updatedStock.quantity_on_hand,
        line.unit_cost,
        grnNumber,
        intakeId,
        actor.id,
        `GRN intake from ${supplier.name}`
      );

      if (poRecord) {
        db.prepare(
          `UPDATE purchase_order_items
           SET quantity_received = quantity_received + ?
           WHERE purchase_order_id = ? AND product_id = ?`
        ).run(line.quantity_received, poRecord.id, line.product_id);
      }

      checkAndNotifyStockLevel(db, line.product_id, input.branch_id);
    }

    if (poRecord) {
      const poItems = db
        .prepare(
          'SELECT quantity_ordered, quantity_received FROM purchase_order_items WHERE purchase_order_id = ?'
        )
        .all(poRecord.id) as Array<{ quantity_ordered: number; quantity_received: number }>;
      const allReceived = poItems.every((i) => i.quantity_received >= i.quantity_ordered);
      const nextStatus = allReceived ? 'received' : 'partially_received';
      db.prepare(
        `UPDATE purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(nextStatus, poRecord.id);

      createNotification(db, {
        targetRole: 'procurement_manager',
        branchId: input.branch_id,
        type: 'po_update',
        title: `PO ${poRecord.po_number} ${allReceived ? 'Fully Received' : 'Partially Received'}`,
        message: `Goods received under ${grnNumber}. PO status updated to ${nextStatus.replace('_', ' ')}.`,
        linkPath: '/purchase-orders',
      });
    }

    createNotification(db, {
      targetRole: 'branch_manager',
      branchId: input.branch_id,
      type: 'grn_completed',
      title: `GRN Recorded: ${grnNumber}`,
      message: `${preparedLines.length} item(s) received from ${supplier.name} totaling UGX ${grandTotal.toLocaleString('en-UG')}.`,
      linkPath: '/stock-intake',
    });

    recordAuditLog(db, {
      userId: actor.id,
      action: 'grn_created',
      entityType: 'stock_intake',
      entityId: intakeId,
      branchId: input.branch_id,
      metadata: {
        grn_number: grnNumber,
        supplier_id: input.supplier_id,
        purchase_order_id: input.purchase_order_id || null,
        grand_total: grandTotal,
        item_count: preparedLines.length,
      },
      ipAddress,
    });

    return getGrnById(db, intakeId);
  });
}

export function getGrnById(db: DbInstance, id: number) {
  const header = db
    .prepare(
      `SELECT gi.*, b.name AS branch_name, b.code AS branch_code,
              s.name AS supplier_name, s.supplier_code,
              u.full_name AS received_by_name,
              po.po_number
       FROM stock_intakes gi
       JOIN branches b ON b.id = gi.branch_id
       JOIN suppliers s ON s.id = gi.supplier_id
       JOIN users u ON u.id = gi.received_by
       LEFT JOIN purchase_orders po ON po.id = gi.purchase_order_id
       WHERE gi.id = ?`
    )
    .get(id);
  if (!header) return null;

  const items = db
    .prepare(
      `SELECT item.*, p.sku, p.name AS product_name, p.unit_of_measure
       FROM stock_intake_items item
       JOIN products p ON p.id = item.product_id
       WHERE item.stock_intake_id = ?`
    )
    .all(id);

  return { ...header, items };
}
