import type { DbInstance } from '../db/connection.ts';
import {
  computeShortfall,
  computeStockStatus,
  computeSuggestedReplenishment,
} from './inventoryMath.ts';

export interface ReportFilters {
  branchId: number | null;
  categoryId?: number | null;
  productId?: number | null;
  supplierId?: number | null;
  transactionType?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export function generateReport(db: DbInstance, reportType: string, filters: ReportFilters) {
  const branchClause = filters.branchId ? 'AND b.id = ?' : '';
  const branchParams = filters.branchId ? [filters.branchId] : [];

  switch (reportType) {
    case 'stock_value_by_branch': {
      const rows = db
        .prepare(
          `SELECT b.id AS branch_id, b.name AS branch_name, b.code AS branch_code,
                  COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) AS product_count,
                  COALESCE(SUM(s.quantity_on_hand), 0) AS total_quantity,
                  COALESCE(SUM(s.quantity_on_hand * p.unit_cost), 0) AS total_cost_value,
                  COALESCE(SUM(s.quantity_on_hand * p.selling_price), 0) AS total_retail_value
           FROM branches b
           LEFT JOIN stocks s ON s.branch_id = b.id
           LEFT JOIN products p ON p.id = s.product_id
           WHERE 1=1 ${branchClause}
           GROUP BY b.id
           ORDER BY b.id ASC`
        )
        .all(...branchParams);
      return { reportType, rows };
    }

    case 'stock_value_by_product':
    case 'inventory_valuation': {
      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];
      if (filters.branchId) {
        conds.push('b.id = ?');
        params.push(filters.branchId);
      }
      if (filters.categoryId) {
        conds.push('c.id = ?');
        params.push(filters.categoryId);
      }
      if (filters.productId) {
        conds.push('p.id = ?');
        params.push(filters.productId);
      }
      const rows = db
        .prepare(
          `SELECT p.sku, p.name AS product_name, c.name AS category_name,
                  b.name AS branch_name, b.code AS branch_code,
                  s.quantity_on_hand AS quantity, p.unit_cost, p.selling_price,
                  (s.quantity_on_hand * p.unit_cost) AS total_value,
                  (s.quantity_on_hand * p.selling_price) AS retail_value
           FROM stocks s
           JOIN products p ON p.id = s.product_id
           JOIN categories c ON c.id = p.category_id
           JOIN branches b ON b.id = s.branch_id
           WHERE ${conds.join(' AND ')}
           ORDER BY total_value DESC, p.name ASC`
        )
        .all(...params);
      return { reportType, rows };
    }

    case 'stock_issues_by_type': {
      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];
      if (filters.branchId) {
        conds.push('si.branch_id = ?');
        params.push(filters.branchId);
      }
      if (filters.dateFrom) {
        conds.push('si.issue_date >= ?');
        params.push(filters.dateFrom);
      }
      if (filters.dateTo) {
        conds.push('si.issue_date <= ?');
        params.push(filters.dateTo);
      }
      const rows = db
        .prepare(
          `SELECT si.issue_type,
                  COUNT(DISTINCT si.id) AS issue_count,
                  COALESCE(SUM(sii.quantity), 0) AS total_quantity,
                  COALESCE(SUM(sii.line_total), 0) AS total_value
           FROM stock_issues si
           JOIN stock_issue_items sii ON sii.stock_issue_id = si.id
           WHERE ${conds.join(' AND ')}
           GROUP BY si.issue_type
           ORDER BY total_value DESC`
        )
        .all(...params);
      return { reportType, rows };
    }

    case 'top_intake_products': {
      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];
      if (filters.branchId) {
        conds.push('gi.branch_id = ?');
        params.push(filters.branchId);
      }
      if (filters.categoryId) {
        conds.push('p.category_id = ?');
        params.push(filters.categoryId);
      }
      if (filters.supplierId) {
        conds.push('gi.supplier_id = ?');
        params.push(filters.supplierId);
      }
      if (filters.dateFrom) {
        conds.push('gi.date_received >= ?');
        params.push(filters.dateFrom);
      }
      if (filters.dateTo) {
        conds.push('gi.date_received <= ?');
        params.push(filters.dateTo);
      }
      const rows = db
        .prepare(
          `SELECT p.sku, p.name AS product_name, c.name AS category_name,
                  COUNT(DISTINCT gi.id) AS grn_count,
                  COALESCE(SUM(gii.quantity_received), 0) AS total_quantity_received,
                  COALESCE(SUM(gii.line_total), 0) AS total_intake_value
           FROM stock_intake_items gii
           JOIN stock_intakes gi ON gi.id = gii.stock_intake_id
           JOIN products p ON p.id = gii.product_id
           JOIN categories c ON c.id = p.category_id
           WHERE ${conds.join(' AND ')}
           GROUP BY p.id
           ORDER BY total_quantity_received DESC
           LIMIT 50`
        )
        .all(...params);
      return { reportType, rows };
    }

    case 'low_stock_report': {
      const conds: string[] = ["p.status = 'active'", 's.quantity_on_hand <= p.reorder_level'];
      const params: Array<string | number> = [];
      if (filters.branchId) {
        conds.push('b.id = ?');
        params.push(filters.branchId);
      }
      if (filters.categoryId) {
        conds.push('c.id = ?');
        params.push(filters.categoryId);
      }
      const rawRows = db
        .prepare(
          `SELECT p.id AS product_id, p.sku, p.name AS product_name, c.name AS category_name,
                  b.id AS branch_id, b.name AS branch_name, b.code AS branch_code,
                  s.quantity_on_hand AS current_stock, p.reorder_level, p.unit_cost
           FROM stocks s
           JOIN products p ON p.id = s.product_id
           JOIN categories c ON c.id = p.category_id
           JOIN branches b ON b.id = s.branch_id
           WHERE ${conds.join(' AND ')}
           ORDER BY s.quantity_on_hand ASC, p.name ASC`
        )
        .all(...params) as Array<{
        product_id: number;
        sku: string;
        product_name: string;
        category_name: string;
        branch_id: number;
        branch_name: string;
        branch_code: string;
        current_stock: number;
        reorder_level: number;
        unit_cost: number;
      }>;

      const rows = rawRows.map((r) => ({
        ...r,
        status: computeStockStatus(r.current_stock, r.reorder_level),
        shortfall: computeShortfall(r.current_stock, r.reorder_level),
        suggested_reorder_qty: computeSuggestedReplenishment(r.current_stock, r.reorder_level),
        estimated_reorder_cost:
          computeSuggestedReplenishment(r.current_stock, r.reorder_level) * r.unit_cost,
      }));
      return { reportType, rows };
    }

    case 'stock_movement_report': {
      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];
      if (filters.branchId) {
        conds.push('it.branch_id = ?');
        params.push(filters.branchId);
      }
      if (filters.categoryId) {
        conds.push('p.category_id = ?');
        params.push(filters.categoryId);
      }
      if (filters.productId) {
        conds.push('it.product_id = ?');
        params.push(filters.productId);
      }
      if (filters.transactionType) {
        conds.push('it.transaction_type = ?');
        params.push(filters.transactionType);
      }
      if (filters.dateFrom) {
        conds.push("date(it.created_at) >= ?");
        params.push(filters.dateFrom);
      }
      if (filters.dateTo) {
        conds.push("date(it.created_at) <= ?");
        params.push(filters.dateTo);
      }
      const rows = db
        .prepare(
          `SELECT it.transaction_ref, it.created_at, p.sku, p.name AS product_name,
                  b.name AS branch_name, it.transaction_type,
                  it.quantity_added, it.quantity_removed, it.balance_after,
                  it.unit_cost, it.reference_number, u.full_name AS user_name, it.notes
           FROM inventory_transactions it
           JOIN products p ON p.id = it.product_id
           JOIN branches b ON b.id = it.branch_id
           JOIN users u ON u.id = it.user_id
           WHERE ${conds.join(' AND ')}
           ORDER BY it.id DESC
           LIMIT 300`
        )
        .all(...params);
      return { reportType, rows };
    }

    case 'purchase_order_report': {
      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];
      if (filters.branchId) {
        conds.push('po.branch_id = ?');
        params.push(filters.branchId);
      }
      if (filters.supplierId) {
        conds.push('po.supplier_id = ?');
        params.push(filters.supplierId);
      }
      if (filters.dateFrom) {
        conds.push('po.order_date >= ?');
        params.push(filters.dateFrom);
      }
      if (filters.dateTo) {
        conds.push('po.order_date <= ?');
        params.push(filters.dateTo);
      }
      const rows = db
        .prepare(
          `SELECT po.po_number, s.name AS supplier_name, b.name AS branch_name,
                  po.order_date, po.expected_delivery_date, po.status,
                  COALESCE(SUM(poi.quantity_ordered), 0) AS ordered_quantity,
                  COALESCE(SUM(poi.quantity_received), 0) AS received_quantity,
                  COALESCE(SUM(poi.quantity_ordered - poi.quantity_received), 0) AS remaining_quantity,
                  po.grand_total AS total_cost
           FROM purchase_orders po
           JOIN suppliers s ON s.id = po.supplier_id
           JOIN branches b ON b.id = po.branch_id
           LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
           WHERE ${conds.join(' AND ')}
           GROUP BY po.id
           ORDER BY po.order_date DESC, po.id DESC`
        )
        .all(...params);
      return { reportType, rows };
    }

    case 'supplier_performance': {
      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];
      if (filters.branchId) {
        conds.push('gi.branch_id = ?');
        params.push(filters.branchId);
      }
      if (filters.supplierId) {
        conds.push('s.id = ?');
        params.push(filters.supplierId);
      }
      if (filters.dateFrom) {
        conds.push('(gi.date_received IS NULL OR gi.date_received >= ?)');
        params.push(filters.dateFrom);
      }
      if (filters.dateTo) {
        conds.push('(gi.date_received IS NULL OR gi.date_received <= ?)');
        params.push(filters.dateTo);
      }
      const rows = db
        .prepare(
          `SELECT s.supplier_code, s.name AS supplier_name, s.contact_person, s.phone,
                  COUNT(DISTINCT po.id) AS total_pos,
                  COUNT(DISTINCT gi.id) AS delivery_count,
                  COALESCE(SUM(gi.grand_total), 0) AS total_delivered_value,
                  MAX(gi.date_received) AS last_delivery_date
           FROM suppliers s
           LEFT JOIN stock_intakes gi ON gi.supplier_id = s.id
           LEFT JOIN purchase_orders po ON po.supplier_id = s.id
           WHERE ${conds.join(' AND ')}
           GROUP BY s.id
           ORDER BY delivery_count DESC, total_delivered_value DESC`
        )
        .all(...params);
      return { reportType, rows };
    }

    default:
      return { reportType, rows: [] };
  }
}
