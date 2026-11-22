import type { DbInstance } from '../db/types.ts';
import { runInTransaction } from '../db/types.ts';
import { AppError, assertBranchWriteAccess, type AuthUser } from '../middleware/auth.ts';
import { checkAndNotifyStockLevel, createNotification, recordAuditLog } from './auditService.ts';
import { computeGrandTotal, computeLineTotal } from './inventoryMath.ts';
import { randomHex } from '../utils/crypto.ts';

export type IssueType = 'sale' | 'transfer' | 'damage' | 'expiry' | 'adjustment';

export interface IssueItemInput {
  product_id: number;
  quantity: number;
}

export interface CreateIssueInput {
  branch_id: number;
  issue_type: IssueType;
  reference_number?: string;
  reason?: string;
  issue_date: string;
  notes?: string;
  idempotency_key?: string;
  items: IssueItemInput[];
}

function generateIssueNumber(db: DbInstance): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM stock_issues').get() as { cnt: number };
  const seq = String(countRow.cnt + 1).padStart(4, '0');
  const suffix = randomHex(2).toUpperCase();
  return `ISS-${datePart}-${seq}-${suffix}`;
}

function generateLedgerRef(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomHex(3).toUpperCase()}`;
}

export function createStockIssue(
  db: DbInstance,
  input: CreateIssueInput,
  actor: AuthUser,
  ipAddress = '',
  options: { allowTransferType?: boolean; insideTransaction?: boolean } = {}
) {
  assertBranchWriteAccess(db, actor, input.branch_id, undefined);

  const allowedTypes: IssueType[] = ['sale', 'damage', 'expiry', 'adjustment', 'transfer'];
  if (!allowedTypes.includes(input.issue_type)) {
    throw new AppError(400, 'Invalid stock issue type');
  }
  if (input.issue_type === 'transfer' && !options.allowTransferType) {
    throw new AppError(
      400,
      'Inter-branch transfers must be processed through the Stock Transfers workflow'
    );
  }
  if (
    ['adjustment', 'damage', 'expiry'].includes(input.issue_type) &&
    !(input.reason || '').trim()
  ) {
    throw new AppError(
      400,
      `A clear reason is required for ${input.issue_type} stock issues`
    );
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new AppError(400, 'At least one product line item is required');
  }

  if (input.idempotency_key) {
    const existing = db
      .prepare('SELECT id, issue_number FROM stock_issues WHERE idempotency_key = ?')
      .get(input.idempotency_key) as { id: number; issue_number: string } | undefined;
    if (existing) {
      throw new AppError(
        409,
        `Duplicate stock issue prevented. Already recorded as ${existing.issue_number}`
      );
    }
  }

  const exec = () => {
    const preparedLines: Array<{
      product_id: number;
      product_name: string;
      quantity: number;
      unit_cost: number;
      line_total: number;
      current_qty: number;
    }> = [];

    const seenProducts = new Set<number>();

    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new AppError(400, 'Issue quantity must be a positive whole number');
      }
      if (seenProducts.has(item.product_id)) {
        throw new AppError(400, 'Duplicate product lines in a single stock issue are not allowed');
      }
      seenProducts.add(item.product_id);

      const product = db
        .prepare('SELECT id, name, unit_cost FROM products WHERE id = ?')
        .get(item.product_id) as { id: number; name: string; unit_cost: number } | undefined;
      if (!product) {
        throw new AppError(404, `Product ID ${item.product_id} not found`);
      }

      const stock = db
        .prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = ? AND branch_id = ?')
        .get(item.product_id, input.branch_id) as { quantity_on_hand: number } | undefined;
      const available = stock ? stock.quantity_on_hand : 0;

      if (available < item.quantity) {
        throw new AppError(
          422,
          `Insufficient stock for "${product.name}". Available: ${available}, requested: ${item.quantity}`
        );
      }

      const lineTotal = computeLineTotal(item.quantity, product.unit_cost);
      preparedLines.push({
        product_id: product.id,
        product_name: product.name,
        quantity: item.quantity,
        unit_cost: product.unit_cost,
        line_total: lineTotal,
        current_qty: available,
      });
    }

    const grandTotal = computeGrandTotal(preparedLines.map((l) => l.line_total));
    const issueNumber = generateIssueNumber(db);

    const issueRes = db
      .prepare(
        `INSERT INTO stock_issues (
          issue_number, idempotency_key, branch_id, issue_type,
          reference_number, reason, issue_date, issued_by, grand_total, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        issueNumber,
        input.idempotency_key || null,
        input.branch_id,
        input.issue_type,
        (input.reference_number || '').trim(),
        (input.reason || '').trim(),
        input.issue_date || new Date().toISOString().slice(0, 10),
        actor.id,
        grandTotal,
        (input.notes || '').trim()
      );

    const issueId = Number(issueRes.lastInsertRowid);
    const ledgerType = input.issue_type === 'transfer' ? 'transfer_out' : input.issue_type;

    for (const line of preparedLines) {
      db.prepare(
        `INSERT INTO stock_issue_items (stock_issue_id, product_id, quantity, unit_cost, line_total)
         VALUES (?, ?, ?, ?, ?)`
      ).run(issueId, line.product_id, line.quantity, line.unit_cost, line.line_total);

      const updateRes = db
        .prepare(
          `UPDATE stocks
           SET quantity_on_hand = quantity_on_hand - ?,
               last_movement_at = datetime('now'),
               updated_at = datetime('now')
           WHERE product_id = ? AND branch_id = ? AND quantity_on_hand >= ?`
        )
        .run(line.quantity, line.product_id, input.branch_id, line.quantity);

      if (updateRes.changes === 0) {
        throw new AppError(422, `Insufficient stock for "${line.product_name}" during commit`);
      }

      const updatedStock = db
        .prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = ? AND branch_id = ?')
        .get(line.product_id, input.branch_id) as { quantity_on_hand: number };

      db.prepare(
        `INSERT INTO inventory_transactions (
          transaction_ref, product_id, branch_id, transaction_type,
          quantity_added, quantity_removed, balance_after, unit_cost,
          reference_number, source_entity, source_id, user_id, notes
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'stock_issue', ?, ?, ?)`
      ).run(
        generateLedgerRef('TX-ISS'),
        line.product_id,
        input.branch_id,
        ledgerType,
        line.quantity,
        updatedStock.quantity_on_hand,
        line.unit_cost,
        issueNumber,
        issueId,
        actor.id,
        (input.reason || input.notes || `Stock issue (${input.issue_type})`).trim()
      );

      checkAndNotifyStockLevel(db, line.product_id, input.branch_id);
    }

    if (input.issue_type === 'adjustment') {
      createNotification(db, {
        targetRole: 'admin',
        branchId: input.branch_id,
        type: 'stock_adjustment',
        title: `Stock Adjustment Recorded: ${issueNumber}`,
        message: `${actor.full_name} recorded an adjustment (${input.reason}) totaling UGX ${grandTotal.toLocaleString('en-UG')}.`,
        linkPath: '/stock-issues',
      });
    }

    recordAuditLog(db, {
      userId: actor.id,
      action: input.issue_type === 'adjustment' ? 'stock_adjustment' : 'stock_issue_created',
      entityType: 'stock_issue',
      entityId: issueId,
      branchId: input.branch_id,
      metadata: {
        issue_number: issueNumber,
        issue_type: input.issue_type,
        reason: input.reason || '',
        grand_total: grandTotal,
      },
      ipAddress,
    });

    return getIssueById(db, issueId);
  };

  return options.insideTransaction ? exec() : runInTransaction(db, exec);
}

export function getIssueById(db: DbInstance, id: number) {
  const header = db
    .prepare(
      `SELECT si.*, b.name AS branch_name, b.code AS branch_code,
              u.full_name AS issued_by_name
       FROM stock_issues si
       JOIN branches b ON b.id = si.branch_id
       JOIN users u ON u.id = si.issued_by
       WHERE si.id = ?`
    )
    .get(id);
  if (!header) return null;

  const items = db
    .prepare(
      `SELECT item.*, p.sku, p.name AS product_name, p.unit_of_measure
       FROM stock_issue_items item
       JOIN products p ON p.id = item.product_id
       WHERE item.stock_issue_id = ?`
    )
    .all(id);

  return { ...header, items };
}
