import crypto from 'node:crypto';
import type { DbInstance } from '../db/connection.ts';
import { runInTransaction } from '../db/connection.ts';
import { AppError, type AuthUser } from '../middleware/auth.ts';
import { createNotification, recordAuditLog } from './auditService.ts';
import { computeGrandTotal, computeLineTotal } from './inventoryMath.ts';

export interface PoItemInput {
  product_id: number;
  quantity_ordered: number;
  unit_cost?: number;
}

export interface CreatePoInput {
  supplier_id: number;
  branch_id: number;
  order_date: string;
  expected_delivery_date?: string;
  notes?: string;
  status?: 'draft' | 'sent';
  items: PoItemInput[];
}

function generatePoNumber(db: DbInstance): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM purchase_orders').get() as {
    cnt: number;
  };
  const seq = String(countRow.cnt + 1).padStart(4, '0');
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `PO-${datePart}-${seq}-${suffix}`;
}

export function createPurchaseOrder(
  db: DbInstance,
  input: CreatePoInput,
  actor: AuthUser,
  ipAddress = ''
) {
  if (!['admin', 'procurement_manager'].includes(actor.role)) {
    throw new AppError(403, 'Only Admin or Procurement Manager can create purchase orders');
  }

  const supplier = db
    .prepare('SELECT id, name, status FROM suppliers WHERE id = ?')
    .get(input.supplier_id) as { id: number; name: string; status: string } | undefined;
  if (!supplier) throw new AppError(404, 'Supplier not found');
  if (supplier.status !== 'active') throw new AppError(422, 'Supplier is inactive');

  const branch = db
    .prepare('SELECT id, name, status FROM branches WHERE id = ?')
    .get(input.branch_id) as { id: number; name: string; status: string } | undefined;
  if (!branch) throw new AppError(404, 'Receiving branch not found');
  if (branch.status !== 'active') throw new AppError(422, 'Receiving branch is inactive');

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new AppError(400, 'Purchase order must contain at least one product line item');
  }

  return runInTransaction(db, () => {
    const preparedLines: Array<{
      product_id: number;
      quantity_ordered: number;
      unit_cost: number;
      line_total: number;
    }> = [];
    const seen = new Set<number>();

    for (const item of input.items) {
      if (!Number.isInteger(item.quantity_ordered) || item.quantity_ordered <= 0) {
        throw new AppError(400, 'Ordered quantity must be a positive whole number');
      }
      if (seen.has(item.product_id)) {
        throw new AppError(400, 'Duplicate products are not allowed on the same Purchase Order');
      }
      seen.add(item.product_id);

      const product = db
        .prepare('SELECT id, unit_cost FROM products WHERE id = ?')
        .get(item.product_id) as { id: number; unit_cost: number } | undefined;
      if (!product) {
        throw new AppError(404, `Product ID ${item.product_id} not found`);
      }

      const unitCost =
        item.unit_cost !== undefined ? Math.round(item.unit_cost) : product.unit_cost;
      if (unitCost < 0) {
        throw new AppError(400, 'Unit cost cannot be negative');
      }

      const lineTotal = computeLineTotal(item.quantity_ordered, unitCost);
      preparedLines.push({
        product_id: item.product_id,
        quantity_ordered: item.quantity_ordered,
        unit_cost: unitCost,
        line_total: lineTotal,
      });
    }

    const grandTotal = computeGrandTotal(preparedLines.map((l) => l.line_total));
    const poNumber = generatePoNumber(db);
    const status = input.status === 'sent' ? 'sent' : 'draft';

    const res = db
      .prepare(
        `INSERT INTO purchase_orders (
          po_number, supplier_id, branch_id, order_date, expected_delivery_date,
          created_by, status, grand_total, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        poNumber,
        input.supplier_id,
        input.branch_id,
        input.order_date || new Date().toISOString().slice(0, 10),
        input.expected_delivery_date || null,
        actor.id,
        status,
        grandTotal,
        (input.notes || '').trim()
      );

    const poId = Number(res.lastInsertRowid);
    const insertItem = db.prepare(
      `INSERT INTO purchase_order_items (
        purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost, line_total
      ) VALUES (?, ?, ?, 0, ?, ?)`
    );

    for (const line of preparedLines) {
      insertItem.run(poId, line.product_id, line.quantity_ordered, line.unit_cost, line.line_total);
    }

    if (status === 'sent') {
      createNotification(db, {
        branchId: input.branch_id,
        type: 'po_sent',
        title: `New Purchase Order Sent: ${poNumber}`,
        message: `PO ${poNumber} from ${supplier.name} (${preparedLines.length} items) is awaiting delivery at ${branch.name}.`,
        linkPath: '/purchase-orders',
      });
    }

    recordAuditLog(db, {
      userId: actor.id,
      action: 'po_created',
      entityType: 'purchase_order',
      entityId: poId,
      branchId: input.branch_id,
      metadata: { po_number: poNumber, status, grand_total: grandTotal },
      ipAddress,
    });

    return getPurchaseOrderById(db, poId);
  });
}

export function updateDraftPurchaseOrder(
  db: DbInstance,
  poId: number,
  input: Partial<CreatePoInput>,
  actor: AuthUser,
  ipAddress = ''
) {
  if (!['admin', 'procurement_manager'].includes(actor.role)) {
    throw new AppError(403, 'Only Admin or Procurement Manager can edit purchase orders');
  }

  return runInTransaction(db, () => {
    const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId) as
      | {
          id: number;
          po_number: string;
          supplier_id: number;
          branch_id: number;
          order_date: string;
          expected_delivery_date: string | null;
          status: string;
          notes: string;
        }
      | undefined;

    if (!existing) throw new AppError(404, 'Purchase order not found');
    if (existing.status !== 'draft') {
      throw new AppError(422, 'Only Draft purchase orders can be edited');
    }

    const nextSupplierId = input.supplier_id ?? existing.supplier_id;
    const nextBranchId = input.branch_id ?? existing.branch_id;
    const nextItems = input.items;

    let grandTotal = 0;
    if (nextItems && nextItems.length > 0) {
      db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(poId);
      const seen = new Set<number>();
      for (const item of nextItems) {
        if (!Number.isInteger(item.quantity_ordered) || item.quantity_ordered <= 0) {
          throw new AppError(400, 'Ordered quantity must be positive');
        }
        if (seen.has(item.product_id)) {
          throw new AppError(400, 'Duplicate products are not allowed in a PO');
        }
        seen.add(item.product_id);
        const product = db
          .prepare('SELECT id, unit_cost FROM products WHERE id = ?')
          .get(item.product_id) as { id: number; unit_cost: number } | undefined;
        if (!product) throw new AppError(404, `Product ID ${item.product_id} not found`);
        const unitCost =
          item.unit_cost !== undefined ? Math.round(item.unit_cost) : product.unit_cost;
        const lineTotal = computeLineTotal(item.quantity_ordered, unitCost);
        grandTotal += lineTotal;
        db.prepare(
          `INSERT INTO purchase_order_items (
            purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost, line_total
          ) VALUES (?, ?, ?, 0, ?, ?)`
        ).run(poId, item.product_id, item.quantity_ordered, unitCost, lineTotal);
      }
    } else {
      const sumRow = db
        .prepare('SELECT COALESCE(SUM(line_total), 0) AS total FROM purchase_order_items WHERE purchase_order_id = ?')
        .get(poId) as { total: number };
      grandTotal = sumRow.total;
    }

    const nextStatus = input.status === 'sent' ? 'sent' : 'draft';

    db.prepare(
      `UPDATE purchase_orders
       SET supplier_id = ?, branch_id = ?, order_date = ?, expected_delivery_date = ?,
           status = ?, grand_total = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      nextSupplierId,
      nextBranchId,
      input.order_date ?? existing.order_date,
      input.expected_delivery_date !== undefined
        ? input.expected_delivery_date
        : existing.expected_delivery_date,
      nextStatus,
      grandTotal,
      input.notes !== undefined ? input.notes.trim() : existing.notes,
      poId
    );

    recordAuditLog(db, {
      userId: actor.id,
      action: 'po_updated',
      entityType: 'purchase_order',
      entityId: poId,
      branchId: nextBranchId,
      metadata: { po_number: existing.po_number, status: nextStatus, grand_total: grandTotal },
      ipAddress,
    });

    return getPurchaseOrderById(db, poId);
  });
}

export function updatePurchaseOrderStatus(
  db: DbInstance,
  poId: number,
  action: 'send' | 'cancel',
  actor: AuthUser,
  ipAddress = ''
) {
  if (!['admin', 'procurement_manager'].includes(actor.role)) {
    throw new AppError(403, 'Only Admin or Procurement Manager can update PO status');
  }

  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId) as
    | { id: number; po_number: string; branch_id: number; status: string; supplier_id: number }
    | undefined;
  if (!po) throw new AppError(404, 'Purchase order not found');

  if (action === 'send') {
    if (po.status !== 'draft') {
      throw new AppError(422, 'Only Draft purchase orders can be marked as Sent');
    }
    db.prepare(`UPDATE purchase_orders SET status = 'sent', updated_at = datetime('now') WHERE id = ?`).run(
      poId
    );
    createNotification(db, {
      branchId: po.branch_id,
      type: 'po_sent',
      title: `Purchase Order Sent: ${po.po_number}`,
      message: `Purchase Order ${po.po_number} has been sent to supplier and awaits delivery.`,
      linkPath: '/purchase-orders',
    });
  } else if (action === 'cancel') {
    if (!['draft', 'sent'].includes(po.status)) {
      throw new AppError(422, 'Cannot cancel a Purchase Order that already has received goods');
    }
    db.prepare(
      `UPDATE purchase_orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`
    ).run(poId);
  }

  recordAuditLog(db, {
    userId: actor.id,
    action: `po_${action}`,
    entityType: 'purchase_order',
    entityId: poId,
    branchId: po.branch_id,
    metadata: { po_number: po.po_number },
    ipAddress,
  });

  return getPurchaseOrderById(db, poId);
}

export function getPurchaseOrderById(db: DbInstance, id: number) {
  const header = db
    .prepare(
      `SELECT po.*, s.name AS supplier_name, s.supplier_code, s.phone AS supplier_phone,
              s.email AS supplier_email, s.address AS supplier_address,
              b.name AS branch_name, b.code AS branch_code, b.location AS branch_location,
              u.full_name AS created_by_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN branches b ON b.id = po.branch_id
       JOIN users u ON u.id = po.created_by
       WHERE po.id = ?`
    )
    .get(id);
  if (!header) return null;

  const items = db
    .prepare(
      `SELECT poi.*, p.sku, p.name AS product_name, p.unit_of_measure,
              (poi.quantity_ordered - poi.quantity_received) AS quantity_remaining
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
       WHERE poi.purchase_order_id = ?`
    )
    .all(id);

  const grns = db
    .prepare(
      `SELECT id, grn_number, date_received, grand_total, delivery_note_number
       FROM stock_intakes
       WHERE purchase_order_id = ?
       ORDER BY id DESC`
    )
    .all(id);

  return { ...header, items, grns };
}
