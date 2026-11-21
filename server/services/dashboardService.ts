import type { DbInstance } from '../db/connection.ts';
import type { AuthUser } from '../middleware/auth.ts';
import {
  computeShortfall,
  computeStockStatus,
  computeSuggestedReplenishment,
} from './inventoryMath.ts';

export function getDashboardData(
  db: DbInstance,
  user: AuthUser,
  scopedBranchId: number | null,
  dateFrom?: string,
  dateTo?: string
) {
  const branchFilter = scopedBranchId ? 'AND s.branch_id = ?' : '';
  const branchParams = scopedBranchId ? [scopedBranchId] : [];

  const productStats = db
    .prepare(
      `SELECT COUNT(*) AS total_products,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_products
       FROM products`
    )
    .get() as { total_products: number; active_products: number };

  const branchCount = db
    .prepare(`SELECT COUNT(*) AS cnt FROM branches WHERE status = 'active'`)
    .get() as { cnt: number };

  const stockAgg = db
    .prepare(
      `SELECT COALESCE(SUM(s.quantity_on_hand), 0) AS total_units,
              COALESCE(SUM(s.quantity_on_hand * p.unit_cost), 0) AS total_stock_value,
              SUM(CASE WHEN p.status = 'active' AND s.quantity_on_hand = 0 THEN 1 ELSE 0 END) AS out_of_stock_count,
              SUM(CASE WHEN p.status = 'active' AND s.quantity_on_hand > 0 AND s.quantity_on_hand <= p.reorder_level THEN 1 ELSE 0 END) AS low_stock_count
       FROM stocks s
       JOIN products p ON p.id = s.product_id
       WHERE 1=1 ${branchFilter}`
    )
    .get(...branchParams) as {
    total_units: number;
    total_stock_value: number;
    out_of_stock_count: number;
    low_stock_count: number;
  };

  const poBranchFilter = scopedBranchId ? 'AND branch_id = ?' : '';
  const pendingPoRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM purchase_orders
       WHERE status IN ('draft', 'sent', 'partially_received') ${poBranchFilter}`
    )
    .get(...branchParams) as { cnt: number };

  const trfFilter = scopedBranchId
    ? 'AND (source_branch_id = ? OR destination_branch_id = ?)'
    : '';
  const trfParams = scopedBranchId ? [scopedBranchId, scopedBranchId] : [];
  const pendingTransferRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM stock_transfers
       WHERE status IN ('pending_approval', 'approved', 'dispatched', 'in_transit') ${trfFilter}`
    )
    .get(...trfParams) as { cnt: number };

  const supplierCount = db
    .prepare(`SELECT COUNT(*) AS cnt FROM suppliers WHERE status = 'active'`)
    .get() as { cnt: number };

  // Branch Comparison (only all branches if global role, else only their branch)
  const branchComparison = db
    .prepare(
      `SELECT b.id AS branch_id, b.name AS branch_name, b.code AS branch_code,
              COALESCE(SUM(s.quantity_on_hand), 0) AS total_units,
              COALESCE(SUM(s.quantity_on_hand * p.unit_cost), 0) AS stock_value,
              SUM(CASE WHEN p.status = 'active' AND s.quantity_on_hand = 0 THEN 1 ELSE 0 END) AS out_of_stock_count,
              SUM(CASE WHEN p.status = 'active' AND s.quantity_on_hand > 0 AND s.quantity_on_hand <= p.reorder_level THEN 1 ELSE 0 END) AS low_stock_count
       FROM branches b
       LEFT JOIN stocks s ON s.branch_id = b.id
       LEFT JOIN products p ON p.id = s.product_id
       WHERE 1=1 ${scopedBranchId ? 'AND b.id = ?' : ''}
       GROUP BY b.id
       ORDER BY b.id ASC`
    )
    .all(...branchParams);

  // Stock Movement Summary by Transaction Type
  const txConds: string[] = ['1=1'];
  const txParams: Array<string | number> = [];
  if (scopedBranchId) {
    txConds.push('branch_id = ?');
    txParams.push(scopedBranchId);
  }
  if (dateFrom) {
    txConds.push("date(created_at) >= ?");
    txParams.push(dateFrom);
  }
  if (dateTo) {
    txConds.push("date(created_at) <= ?");
    txParams.push(dateTo);
  }

  const movementSummary = db
    .prepare(
      `SELECT transaction_type,
              COUNT(*) AS tx_count,
              COALESCE(SUM(quantity_added), 0) AS total_added,
              COALESCE(SUM(quantity_removed), 0) AS total_removed
       FROM inventory_transactions
       WHERE ${txConds.join(' AND ')}
       GROUP BY transaction_type
       ORDER BY tx_count DESC`
    )
    .all(...txParams);

  // Low-stock & Out-of-stock Alerts
  const alertRowsRaw = db
    .prepare(
      `SELECT s.product_id, s.branch_id, p.sku, p.name AS product_name, c.name AS category_name,
              b.name AS branch_name, b.code AS branch_code,
              s.quantity_on_hand, p.reorder_level, p.unit_cost, p.preferred_supplier_id
       FROM stocks s
       JOIN products p ON p.id = s.product_id
       JOIN categories c ON c.id = p.category_id
       JOIN branches b ON b.id = s.branch_id
       WHERE p.status = 'active' AND s.quantity_on_hand <= p.reorder_level
       ${scopedBranchId ? 'AND s.branch_id = ?' : ''}
       ORDER BY s.quantity_on_hand ASC, (p.reorder_level - s.quantity_on_hand) DESC
       LIMIT 15`
    )
    .all(...branchParams) as Array<{
    product_id: number;
    branch_id: number;
    sku: string;
    product_name: string;
    category_name: string;
    branch_name: string;
    branch_code: string;
    quantity_on_hand: number;
    reorder_level: number;
    unit_cost: number;
    preferred_supplier_id: number | null;
  }>;

  const alerts = alertRowsRaw.map((a) => ({
    ...a,
    status: computeStockStatus(a.quantity_on_hand, a.reorder_level),
    shortfall: computeShortfall(a.quantity_on_hand, a.reorder_level),
    suggested_replenishment: computeSuggestedReplenishment(a.quantity_on_hand, a.reorder_level),
  }));

  // Recent Inventory Activity
  const recentActivity = db
    .prepare(
      `SELECT it.id, it.transaction_ref, it.transaction_type, it.quantity_added, it.quantity_removed,
              it.balance_after, it.reference_number, it.created_at,
              p.name AS product_name, p.sku, b.name AS branch_name, b.code AS branch_code,
              u.full_name AS user_name
       FROM inventory_transactions it
       JOIN products p ON p.id = it.product_id
       JOIN branches b ON b.id = it.branch_id
       JOIN users u ON u.id = it.user_id
       WHERE 1=1 ${scopedBranchId ? 'AND it.branch_id = ?' : ''}
       ORDER BY it.id DESC
       LIMIT 12`
    )
    .all(...branchParams);

  // POs by status (for Procurement & Admin)
  const poStatusSummary = db
    .prepare(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total_value
       FROM purchase_orders
       WHERE 1=1 ${poBranchFilter}
       GROUP BY status`
    )
    .all(...branchParams);

  // Incoming transfers awaiting receipt at user's branch
  const awaitingReceiptTransfers = db
    .prepare(
      `SELECT st.id, st.transfer_number, sb.name AS source_branch_name, db.name AS destination_branch_name,
              st.dispatch_date, st.status
       FROM stock_transfers st
       JOIN branches sb ON sb.id = st.source_branch_id
       JOIN branches db ON db.id = st.destination_branch_id
       WHERE st.status IN ('dispatched', 'in_transit')
       ${scopedBranchId ? 'AND st.destination_branch_id = ?' : ''}
       ORDER BY st.id DESC
       LIMIT 8`
    )
    .all(...branchParams);

  return {
    role: user.role,
    scopedBranchId,
    kpis: {
      total_products: productStats.total_products,
      active_products: productStats.active_products,
      total_branches: branchCount.cnt,
      total_units: stockAgg.total_units,
      total_stock_value: stockAgg.total_stock_value,
      low_stock_count: stockAgg.low_stock_count,
      out_of_stock_count: stockAgg.out_of_stock_count,
      pending_pos: pendingPoRow.cnt,
      pending_transfers: pendingTransferRow.cnt,
      active_suppliers: supplierCount.cnt,
    },
    branchComparison,
    movementSummary,
    poStatusSummary,
    alerts,
    recentActivity,
    awaitingReceiptTransfers,
  };
}
