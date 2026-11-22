import type { DbInstance } from '../db/types.ts';
import { runInTransaction } from '../db/types.ts';
import { AppError, isGlobalRole, type AuthUser } from '../middleware/auth.ts';
import { checkAndNotifyStockLevel, createNotification, recordAuditLog } from './auditService.ts';
import { createStockIssue } from './issueService.ts';
import { randomHex } from '../utils/crypto.ts';

export type TransferStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'dispatched'
  | 'in_transit'
  | 'received'
  | 'rejected'
  | 'cancelled';

export interface TransferItemInput {
  product_id: number;
  quantity_requested: number;
}

export interface CreateTransferInput {
  source_branch_id: number;
  destination_branch_id: number;
  notes?: string;
  submit_immediately?: boolean;
  items: TransferItemInput[];
}

function generateTransferNumber(db: DbInstance): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM stock_transfers').get() as {
    cnt: number;
  };
  const seq = String(countRow.cnt + 1).padStart(4, '0');
  const suffix = randomHex(2).toUpperCase();
  return `TRF-${datePart}-${seq}-${suffix}`;
}

export function createTransfer(
  db: DbInstance,
  input: CreateTransferInput,
  actor: AuthUser,
  ipAddress = ''
) {
  if (actor.role === 'stock_controller') {
    throw new AppError(403, 'Stock Controllers cannot initiate inter-branch transfers');
  }

  if (!input.source_branch_id || !input.destination_branch_id) {
    throw new AppError(400, 'Source and destination branches are required');
  }
  if (input.source_branch_id === input.destination_branch_id) {
    throw new AppError(422, 'Source and destination branches must be different');
  }

  if (
    !isGlobalRole(actor.role) &&
    actor.branch_id !== input.source_branch_id &&
    actor.branch_id !== input.destination_branch_id
  ) {
    throw new AppError(
      403,
      'Branch access denied: transfer must involve your assigned branch'
    );
  }

  const sourceBranch = db
    .prepare('SELECT id, name, status FROM branches WHERE id = ?')
    .get(input.source_branch_id) as { id: number; name: string; status: string } | undefined;
  const destBranch = db
    .prepare('SELECT id, name, status FROM branches WHERE id = ?')
    .get(input.destination_branch_id) as { id: number; name: string; status: string } | undefined;

  if (!sourceBranch || !destBranch) {
    throw new AppError(404, 'Source or destination branch not found');
  }
  if (sourceBranch.status !== 'active' || destBranch.status !== 'active') {
    throw new AppError(422, 'Both source and destination branches must be active');
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new AppError(400, 'At least one product line item is required');
  }

  return runInTransaction(db, () => {
    const seen = new Set<number>();
    for (const item of input.items) {
      if (!Number.isInteger(item.quantity_requested) || item.quantity_requested <= 0) {
        throw new AppError(400, 'Requested transfer quantity must be a positive whole number');
      }
      if (seen.has(item.product_id)) {
        throw new AppError(400, 'Duplicate product rows are not allowed in a transfer');
      }
      seen.add(item.product_id);

      const product = db
        .prepare('SELECT id, name FROM products WHERE id = ?')
        .get(item.product_id) as { id: number; name: string } | undefined;
      if (!product) {
        throw new AppError(404, `Product ID ${item.product_id} not found`);
      }

      const sourceStock = db
        .prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = ? AND branch_id = ?')
        .get(item.product_id, input.source_branch_id) as { quantity_on_hand: number } | undefined;
      const available = sourceStock ? sourceStock.quantity_on_hand : 0;
      if (available < item.quantity_requested) {
        throw new AppError(
          422,
          `Insufficient stock at ${sourceBranch.name} for "${product.name}". Available: ${available}, requested: ${item.quantity_requested}`
        );
      }
    }

    const transferNumber = generateTransferNumber(db);
    const initialStatus: TransferStatus = input.submit_immediately ? 'pending_approval' : 'draft';

    const res = db
      .prepare(
        `INSERT INTO stock_transfers (
          transfer_number, source_branch_id, destination_branch_id,
          requested_by, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        transferNumber,
        input.source_branch_id,
        input.destination_branch_id,
        actor.id,
        initialStatus,
        (input.notes || '').trim()
      );

    const transferId = Number(res.lastInsertRowid);
    const insertItem = db.prepare(
      `INSERT INTO stock_transfer_items (stock_transfer_id, product_id, quantity_requested)
       VALUES (?, ?, ?)`
    );
    for (const item of input.items) {
      insertItem.run(transferId, item.product_id, item.quantity_requested);
    }

    if (initialStatus === 'pending_approval') {
      createNotification(db, {
        targetRole: 'branch_manager',
        branchId: input.source_branch_id,
        type: 'transfer_pending',
        title: `Transfer Approval Required: ${transferNumber}`,
        message: `${destBranch.name} requested ${input.items.length} product(s) from ${sourceBranch.name}.`,
        linkPath: '/stock-transfers',
      });
    }

    recordAuditLog(db, {
      userId: actor.id,
      action: 'transfer_created',
      entityType: 'stock_transfer',
      entityId: transferId,
      branchId: actor.branch_id ?? input.source_branch_id,
      metadata: {
        transfer_number: transferNumber,
        source_branch_id: input.source_branch_id,
        destination_branch_id: input.destination_branch_id,
        status: initialStatus,
      },
      ipAddress,
    });

    return getTransferById(db, transferId);
  });
}

export function transitionTransferStatus(
  db: DbInstance,
  transferId: number,
  action: 'submit' | 'approve' | 'reject' | 'cancel' | 'dispatch',
  actor: AuthUser,
  notes = '',
  ipAddress = ''
) {
  return runInTransaction(db, () => {
    const trf = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(transferId) as
      | {
          id: number;
          transfer_number: string;
          source_branch_id: number;
          destination_branch_id: number;
          status: TransferStatus;
        }
      | undefined;
    if (!trf) {
      throw new AppError(404, 'Stock transfer not found');
    }

    if (action === 'submit') {
      if (trf.status !== 'draft') {
        throw new AppError(422, `Cannot submit transfer in status "${trf.status}"`);
      }
      if (
        !isGlobalRole(actor.role) &&
        actor.branch_id !== trf.source_branch_id &&
        actor.branch_id !== trf.destination_branch_id
      ) {
        throw new AppError(403, 'Not authorized to submit this transfer');
      }
      db.prepare(
        `UPDATE stock_transfers SET status = 'pending_approval', updated_at = datetime('now') WHERE id = ?`
      ).run(transferId);

      createNotification(db, {
        targetRole: 'branch_manager',
        branchId: trf.source_branch_id,
        type: 'transfer_pending',
        title: `Transfer Approval Required: ${trf.transfer_number}`,
        message: `Inter-branch transfer ${trf.transfer_number} has been submitted for approval.`,
        linkPath: '/stock-transfers',
      });
    } else if (action === 'approve' || action === 'reject') {
      if (trf.status !== 'pending_approval') {
        throw new AppError(422, `Transfer must be Pending Approval to ${action}`);
      }
      if (
        actor.role === 'stock_controller' ||
        (!isGlobalRole(actor.role) && actor.branch_id !== trf.source_branch_id)
      ) {
        throw new AppError(
          403,
          'Only Admin, Procurement Manager, or Source Branch Manager can approve or reject transfers'
        );
      }

      const nextStatus: TransferStatus = action === 'approve' ? 'approved' : 'rejected';
      db.prepare(
        `UPDATE stock_transfers
         SET status = ?, approved_by = ?, notes = CASE WHEN ? != '' THEN notes || '\n[' || ? || '] ' || ? ELSE notes END, updated_at = datetime('now')
         WHERE id = ?`
      ).run(nextStatus, actor.id, notes.trim(), action.toUpperCase(), notes.trim(), transferId);

      createNotification(db, {
        targetRole: 'branch_manager',
        branchId: trf.destination_branch_id,
        type: action === 'approve' ? 'transfer_approved' : 'transfer_rejected',
        title: `Transfer ${trf.transfer_number} ${action === 'approve' ? 'Approved' : 'Rejected'}`,
        message: `Transfer ${trf.transfer_number} was ${nextStatus} by ${actor.full_name}.`,
        linkPath: '/stock-transfers',
      });
    } else if (action === 'cancel') {
      if (!['draft', 'pending_approval', 'approved'].includes(trf.status)) {
        throw new AppError(422, 'Cannot cancel a transfer that has already been dispatched or received');
      }
      if (
        actor.role === 'stock_controller' ||
        (!isGlobalRole(actor.role) &&
          actor.branch_id !== trf.source_branch_id &&
          actor.branch_id !== trf.destination_branch_id)
      ) {
        throw new AppError(403, 'Not authorized to cancel this transfer');
      }
      db.prepare(
        `UPDATE stock_transfers SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`
      ).run(transferId);
    } else if (action === 'dispatch') {
      if (trf.status !== 'approved') {
        throw new AppError(422, `Transfer must be Approved before dispatch (current: ${trf.status})`);
      }
      if (
        !isGlobalRole(actor.role) &&
        actor.branch_id !== trf.source_branch_id
      ) {
        throw new AppError(403, 'Only the Source Branch or Admin can dispatch this transfer');
      }

      const items = db
        .prepare('SELECT product_id, quantity_requested FROM stock_transfer_items WHERE stock_transfer_id = ?')
        .all(transferId) as Array<{ product_id: number; quantity_requested: number }>;

      // Deduct source branch stock via Stock Issue service inside the same atomic transaction
      createStockIssue(
        db,
        {
          branch_id: trf.source_branch_id,
          issue_type: 'transfer',
          reference_number: trf.transfer_number,
          reason: `Inter-branch dispatch for ${trf.transfer_number}`,
          issue_date: new Date().toISOString().slice(0, 10),
          notes: notes || `Dispatched to destination branch`,
          items: items.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity_requested,
          })),
        },
        actor,
        ipAddress,
        { allowTransferType: true, insideTransaction: true }
      );

      for (const item of items) {
        db.prepare(
          `UPDATE stock_transfer_items
           SET quantity_dispatched = ?
           WHERE stock_transfer_id = ? AND product_id = ?`
        ).run(item.quantity_requested, transferId, item.product_id);
      }

      db.prepare(
        `UPDATE stock_transfers
         SET status = 'in_transit', dispatched_by = ?, dispatch_date = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      ).run(actor.id, transferId);

      createNotification(db, {
        branchId: trf.destination_branch_id,
        type: 'transfer_dispatched',
        title: `Incoming Transfer Dispatched: ${trf.transfer_number}`,
        message: `Transfer ${trf.transfer_number} is now In Transit and ready for receipt confirmation.`,
        linkPath: '/stock-transfers',
      });
    }

    recordAuditLog(db, {
      userId: actor.id,
      action: `transfer_${action}`,
      entityType: 'stock_transfer',
      entityId: transferId,
      branchId: actor.branch_id ?? trf.source_branch_id,
      metadata: { transfer_number: trf.transfer_number, notes },
      ipAddress,
    });

    return getTransferById(db, transferId);
  });
}

export interface ReceiveTransferItemInput {
  product_id: number;
  quantity_received: number;
}

export function receiveTransfer(
  db: DbInstance,
  transferId: number,
  receivedItems: ReceiveTransferItemInput[],
  discrepancyNotes: string,
  actor: AuthUser,
  ipAddress = ''
) {
  return runInTransaction(db, () => {
    const trf = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(transferId) as
      | {
          id: number;
          transfer_number: string;
          source_branch_id: number;
          destination_branch_id: number;
          status: TransferStatus;
        }
      | undefined;

    if (!trf) {
      throw new AppError(404, 'Stock transfer not found');
    }

    if (!['dispatched', 'in_transit'].includes(trf.status)) {
      throw new AppError(
        422,
        `Transfer ${trf.transfer_number} cannot be received (current status: ${trf.status})`
      );
    }

    if (!isGlobalRole(actor.role) && actor.branch_id !== trf.destination_branch_id) {
      throw new AppError(
        403,
        'Only the Destination Branch (or Administrator) can confirm receipt of this transfer'
      );
    }

    const dbItems = db
      .prepare(
        `SELECT sti.product_id, sti.quantity_dispatched, p.name AS product_name, p.unit_cost
         FROM stock_transfer_items sti
         JOIN products p ON p.id = sti.product_id
         WHERE sti.stock_transfer_id = ?`
      )
      .all(transferId) as Array<{
      product_id: number;
      quantity_dispatched: number;
      product_name: string;
      unit_cost: number;
    }>;

    const recvMap = new Map<number, number>();
    for (const r of receivedItems) {
      if (!Number.isInteger(r.quantity_received) || r.quantity_received < 0) {
        throw new AppError(400, 'Received quantity must be a non-negative whole number');
      }
      recvMap.set(r.product_id, r.quantity_received);
    }

    let hasDiscrepancy = false;

    for (const dbItem of dbItems) {
      const qtyReceived = recvMap.has(dbItem.product_id)
        ? (recvMap.get(dbItem.product_id) as number)
        : dbItem.quantity_dispatched;

      if (qtyReceived > dbItem.quantity_dispatched) {
        throw new AppError(
          422,
          `Received quantity (${qtyReceived}) for "${dbItem.product_name}" cannot exceed dispatched quantity (${dbItem.quantity_dispatched})`
        );
      }

      const discrepancy = dbItem.quantity_dispatched - qtyReceived;
      if (discrepancy > 0) {
        hasDiscrepancy = true;
      }

      db.prepare(
        `UPDATE stock_transfer_items
         SET quantity_received = ?, discrepancy_quantity = ?
         WHERE stock_transfer_id = ? AND product_id = ?`
      ).run(qtyReceived, discrepancy, transferId, dbItem.product_id);

      if (qtyReceived > 0) {
        db.prepare(
          `INSERT OR IGNORE INTO stocks (product_id, branch_id, quantity_on_hand) VALUES (?, ?, 0)`
        ).run(dbItem.product_id, trf.destination_branch_id);

        db.prepare(
          `UPDATE stocks
           SET quantity_on_hand = quantity_on_hand + ?,
               last_movement_at = datetime('now'),
               updated_at = datetime('now')
           WHERE product_id = ? AND branch_id = ?`
        ).run(qtyReceived, dbItem.product_id, trf.destination_branch_id);

        const updatedStock = db
          .prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = ? AND branch_id = ?')
          .get(dbItem.product_id, trf.destination_branch_id) as { quantity_on_hand: number };

        const ledgerRef = `TX-TRI-${Date.now()}-${randomHex(3).toUpperCase()}`;
        db.prepare(
          `INSERT INTO inventory_transactions (
            transaction_ref, product_id, branch_id, transaction_type,
            quantity_added, quantity_removed, balance_after, unit_cost,
            reference_number, source_entity, source_id, user_id, notes
          ) VALUES (?, ?, ?, 'transfer_in', ?, 0, ?, ?, ?, 'stock_transfer', ?, ?, ?)`
        ).run(
          ledgerRef,
          dbItem.product_id,
          trf.destination_branch_id,
          qtyReceived,
          updatedStock.quantity_on_hand,
          dbItem.unit_cost,
          trf.transfer_number,
          transferId,
          actor.id,
          discrepancy > 0
            ? `Transfer receipt with discrepancy (-${discrepancy} units): ${discrepancyNotes || 'No note'}`
            : `Transfer receipt confirmed`
        );
      }

      checkAndNotifyStockLevel(db, dbItem.product_id, trf.destination_branch_id);
    }

    if (hasDiscrepancy && !discrepancyNotes.trim()) {
      throw new AppError(
        400,
        'Discrepancy notes are required when received quantities are less than dispatched quantities'
      );
    }

    db.prepare(
      `UPDATE stock_transfers
       SET status = 'received', received_by = ?, receiving_date = datetime('now'),
           discrepancy_notes = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(actor.id, discrepancyNotes.trim(), transferId);

    createNotification(db, {
      branchId: trf.source_branch_id,
      type: 'transfer_received',
      title: `Transfer Received: ${trf.transfer_number}`,
      message: hasDiscrepancy
        ? `Transfer ${trf.transfer_number} received with partial discrepancy noted by ${actor.full_name}.`
        : `Transfer ${trf.transfer_number} confirmed received in full by ${actor.full_name}.`,
      linkPath: '/stock-transfers',
    });

    recordAuditLog(db, {
      userId: actor.id,
      action: 'transfer_received',
      entityType: 'stock_transfer',
      entityId: transferId,
      branchId: trf.destination_branch_id,
      metadata: {
        transfer_number: trf.transfer_number,
        has_discrepancy: hasDiscrepancy,
        discrepancy_notes: discrepancyNotes.trim(),
      },
      ipAddress,
    });

    return getTransferById(db, transferId);
  });
}

export function getTransferById(db: DbInstance, id: number) {
  const header = db
    .prepare(
      `SELECT st.*,
              sb.name AS source_branch_name, sb.code AS source_branch_code,
              db.name AS destination_branch_name, db.code AS destination_branch_code,
              ru.full_name AS requested_by_name,
              au.full_name AS approved_by_name,
              du.full_name AS dispatched_by_name,
              rcu.full_name AS received_by_name
       FROM stock_transfers st
       JOIN branches sb ON sb.id = st.source_branch_id
       JOIN branches db ON db.id = st.destination_branch_id
       JOIN users ru ON ru.id = st.requested_by
       LEFT JOIN users au ON au.id = st.approved_by
       LEFT JOIN users du ON du.id = st.dispatched_by
       LEFT JOIN users rcu ON rcu.id = st.received_by
       WHERE st.id = ?`
    )
    .get(id);
  if (!header) return null;

  const items = db
    .prepare(
      `SELECT sti.*, p.sku, p.name AS product_name, p.unit_of_measure, p.unit_cost
       FROM stock_transfer_items sti
       JOIN products p ON p.id = sti.product_id
       WHERE sti.stock_transfer_id = ?`
    )
    .all(id);

  return { ...header, items };
}
