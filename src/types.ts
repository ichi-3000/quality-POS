export type RoleSlug = 'admin' | 'procurement_manager' | 'branch_manager' | 'stock_controller';

export interface User {
  id: number;
  full_name: string;
  username: string;
  email: string;
  phone: string;
  role_id?: number;
  role: RoleSlug;
  role_name: string;
  branch_id: number | null;
  branch_code: string | null;
  branch_name: string | null;
  status: 'active' | 'inactive';
  last_login_at?: string | null;
  created_at?: string;
}

export interface Branch {
  id: number;
  name: string;
  code: string;
  location: string;
  contact_phone: string;
  contact_email: string;
  manager_name: string;
  status: 'active' | 'inactive';
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  code: string;
  description: string;
  status: 'active' | 'inactive';
  product_count?: number;
}

export interface Product {
  id: number;
  sku: string;
  barcode: string;
  name: string;
  category_id: number;
  category_name?: string;
  description: string;
  unit_of_measure: string;
  unit_cost: number;
  selling_price: number;
  reorder_level: number;
  preferred_supplier_id: number | null;
  preferred_supplier_name?: string | null;
  expiry_tracking: number | boolean;
  status: 'active' | 'inactive';
  total_stock?: number;
  total_stock_value?: number;
  created_at?: string;
  updated_at?: string;
}

export interface StockItem {
  id: number;
  product_id: number;
  branch_id: number;
  quantity_on_hand: number;
  last_movement_at: string | null;
  updated_at: string;
  sku: string;
  product_name: string;
  unit_of_measure: string;
  unit_cost: number;
  selling_price: number;
  reorder_level: number;
  product_status: string;
  category_name: string;
  branch_name: string;
  branch_code: string;
  stock_status: 'in_stock' | 'low_stock' | 'out_of_stock';
  stock_value: number;
  shortfall: number;
  suggested_replenishment: number;
}

export interface Supplier {
  id: number;
  supplier_code: string;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  tin: string;
  notes: string;
  status: 'active' | 'inactive';
  delivery_count?: number;
  po_count?: number;
  supplied_product_count?: number;
  created_at?: string;
}

export interface PurchaseOrderItem {
  id?: number;
  product_id: number;
  sku?: string;
  product_name?: string;
  unit_of_measure?: string;
  quantity_ordered: number;
  quantity_received?: number;
  quantity_remaining?: number;
  unit_cost: number;
  line_total?: number;
}

export interface PurchaseOrder {
  id: number;
  po_number: string;
  supplier_id: number;
  supplier_name: string;
  supplier_code: string;
  branch_id: number;
  branch_name: string;
  branch_code: string;
  order_date: string;
  expected_delivery_date: string | null;
  created_by: number;
  created_by_name: string;
  status: 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';
  grand_total: number;
  notes: string;
  item_count?: number;
  items?: PurchaseOrderItem[];
  grns?: Array<{
    id: number;
    grn_number: string;
    date_received: string;
    grand_total: number;
    delivery_note_number: string;
  }>;
}

export interface Grn {
  id: number;
  grn_number: string;
  branch_id: number;
  branch_name: string;
  branch_code: string;
  supplier_id: number;
  supplier_name: string;
  purchase_order_id: number | null;
  po_number: string | null;
  delivery_note_number: string;
  date_received: string;
  received_by: number;
  received_by_name: string;
  grand_total: number;
  remarks: string;
  item_count?: number;
  created_at: string;
  items?: Array<{
    id: number;
    product_id: number;
    sku: string;
    product_name: string;
    unit_of_measure: string;
    quantity_received: number;
    unit_cost: number;
    line_total: number;
  }>;
}

export interface StockIssue {
  id: number;
  issue_number: string;
  branch_id: number;
  branch_name: string;
  branch_code: string;
  issue_type: 'sale' | 'transfer' | 'damage' | 'expiry' | 'adjustment';
  reference_number: string;
  reason: string;
  issue_date: string;
  issued_by: number;
  issued_by_name: string;
  grand_total: number;
  notes: string;
  item_count?: number;
  total_quantity?: number;
  created_at: string;
  items?: Array<{
    id: number;
    product_id: number;
    sku: string;
    product_name: string;
    unit_of_measure: string;
    quantity: number;
    unit_cost: number;
    line_total: number;
  }>;
}

export interface StockTransfer {
  id: number;
  transfer_number: string;
  source_branch_id: number;
  source_branch_name: string;
  source_branch_code: string;
  destination_branch_id: number;
  destination_branch_name: string;
  destination_branch_code: string;
  requested_by: number;
  requested_by_name: string;
  approved_by_name?: string | null;
  dispatched_by_name?: string | null;
  received_by_name?: string | null;
  status:
    | 'draft'
    | 'pending_approval'
    | 'approved'
    | 'dispatched'
    | 'in_transit'
    | 'received'
    | 'rejected'
    | 'cancelled';
  dispatch_date: string | null;
  receiving_date: string | null;
  notes: string;
  discrepancy_notes: string;
  item_count?: number;
  created_at: string;
  items?: Array<{
    id: number;
    product_id: number;
    sku: string;
    product_name: string;
    unit_of_measure: string;
    unit_cost: number;
    quantity_requested: number;
    quantity_dispatched: number;
    quantity_received: number;
    discrepancy_quantity: number;
  }>;
}

export interface LedgerTransaction {
  id: number;
  transaction_ref: string;
  product_id: number;
  sku: string;
  product_name: string;
  branch_id: number;
  branch_name: string;
  branch_code: string;
  transaction_type: string;
  quantity_added: number;
  quantity_removed: number;
  balance_after: number;
  unit_cost: number;
  reference_number: string;
  user_name: string;
  notes: string;
  created_at: string;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  message: string;
  link_path: string;
  branch_name: string | null;
  is_read: number;
  created_at: string;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  user_name: string | null;
  username: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  branch_id: number | null;
  branch_name: string | null;
  metadata_json: string;
  ip_address: string;
  created_at: string;
}
