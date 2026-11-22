import type { DbInstance } from '../db/types.ts';
import { computeStockStatus } from './inventoryMath.ts';

export interface AuditEntry {
  userId: number | null;
  action: string;
  entityType: string;
  entityId?: string | number;
  branchId?: number | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export function recordAuditLog(db: DbInstance, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, branch_id, metadata_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.userId ?? null,
    entry.action,
    entry.entityType,
    entry.entityId !== undefined ? String(entry.entityId) : '',
    entry.branchId ?? null,
    JSON.stringify(entry.metadata ?? {}),
    entry.ipAddress ?? ''
  );
}

export interface NotificationInput {
  userId?: number | null;
  targetRole?: string | null;
  branchId?: number | null;
  type: string;
  title: string;
  message: string;
  linkPath?: string;
}

export function createNotification(db: DbInstance, input: NotificationInput): void {
  db.prepare(
    `INSERT INTO notifications (user_id, target_role, branch_id, type, title, message, link_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.userId ?? null,
    input.targetRole ?? null,
    input.branchId ?? null,
    input.type,
    input.title,
    input.message,
    input.linkPath ?? ''
  );
}

export function checkAndNotifyStockLevel(
  db: DbInstance,
  productId: number,
  branchId: number
): void {
  const row = db
    .prepare(
      `SELECT s.quantity_on_hand, p.name AS product_name, p.sku, p.reorder_level, b.name AS branch_name
       FROM stocks s
       JOIN products p ON p.id = s.product_id
       JOIN branches b ON b.id = s.branch_id
       WHERE s.product_id = ? AND s.branch_id = ?`
    )
    .get(productId, branchId) as
    | {
        quantity_on_hand: number;
        product_name: string;
        sku: string;
        reorder_level: number;
        branch_name: string;
      }
    | undefined;

  if (!row) return;

  const status = computeStockStatus(row.quantity_on_hand, row.reorder_level);
  if (status === 'in_stock') return;

  const type = status === 'out_of_stock' ? 'out_of_stock' : 'low_stock';
  const title =
    status === 'out_of_stock'
      ? `Out of Stock: ${row.product_name}`
      : `Low Stock Alert: ${row.product_name}`;
  const message =
    status === 'out_of_stock'
      ? `${row.product_name} (${row.sku}) at ${row.branch_name} has reached 0 units (Reorder level: ${row.reorder_level}).`
      : `${row.product_name} (${row.sku}) at ${row.branch_name} is at ${row.quantity_on_hand} units (Reorder level: ${row.reorder_level}).`;

  // Avoid spamming identical unread alerts for the same product & branch
  const existing = db
    .prepare(
      `SELECT id FROM notifications
       WHERE type = ? AND branch_id = ? AND is_read = 0 AND message LIKE ?`
    )
    .get(type, branchId, `%${row.sku}%`);

  if (!existing) {
    createNotification(db, {
      branchId,
      type,
      title,
      message,
      linkPath: '/inventory',
    });
  }
}
