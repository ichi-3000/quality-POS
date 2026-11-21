import type { DbInstance } from './connection.ts';

export function runMigrations(db: DbInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      location TEXT NOT NULL,
      contact_phone TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      manager_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      branch_id INTEGER NULL REFERENCES branches(id),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      last_login_at TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      contact_person TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      tin TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      barcode TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      description TEXT NOT NULL DEFAULT '',
      unit_of_measure TEXT NOT NULL DEFAULT 'Piece',
      unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
      selling_price INTEGER NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
      reorder_level INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
      preferred_supplier_id INTEGER NULL REFERENCES suppliers(id),
      expiry_tracking INTEGER NOT NULL DEFAULT 0 CHECK (expiry_tracking IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
      last_movement_at TEXT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (product_id, branch_id)
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_number TEXT NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      order_date TEXT NOT NULL,
      expected_delivery_date TEXT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partially_received', 'received', 'cancelled')),
      grand_total INTEGER NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
      quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
      unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
      line_total INTEGER NOT NULL CHECK (line_total >= 0),
      UNIQUE (purchase_order_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS stock_intakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grn_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NULL UNIQUE,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      purchase_order_id INTEGER NULL REFERENCES purchase_orders(id),
      delivery_note_number TEXT NOT NULL DEFAULT '',
      date_received TEXT NOT NULL,
      received_by INTEGER NOT NULL REFERENCES users(id),
      grand_total INTEGER NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
      remarks TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_intake_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_intake_id INTEGER NOT NULL REFERENCES stock_intakes(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
      unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
      line_total INTEGER NOT NULL CHECK (line_total >= 0)
    );

    CREATE TABLE IF NOT EXISTS stock_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NULL UNIQUE,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      issue_type TEXT NOT NULL CHECK (issue_type IN ('sale', 'transfer', 'damage', 'expiry', 'adjustment')),
      reference_number TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      issue_date TEXT NOT NULL,
      issued_by INTEGER NOT NULL REFERENCES users(id),
      grand_total INTEGER NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_issue_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_issue_id INTEGER NOT NULL REFERENCES stock_issues(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
      line_total INTEGER NOT NULL CHECK (line_total >= 0)
    );

    CREATE TABLE IF NOT EXISTS stock_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_number TEXT NOT NULL UNIQUE,
      source_branch_id INTEGER NOT NULL REFERENCES branches(id),
      destination_branch_id INTEGER NOT NULL REFERENCES branches(id),
      requested_by INTEGER NOT NULL REFERENCES users(id),
      approved_by INTEGER NULL REFERENCES users(id),
      dispatched_by INTEGER NULL REFERENCES users(id),
      received_by INTEGER NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'dispatched', 'in_transit', 'received', 'rejected', 'cancelled')),
      dispatch_date TEXT NULL,
      receiving_date TEXT NULL,
      notes TEXT NOT NULL DEFAULT '',
      discrepancy_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (source_branch_id != destination_branch_id)
    );

    CREATE TABLE IF NOT EXISTS stock_transfer_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
      quantity_dispatched INTEGER NOT NULL DEFAULT 0 CHECK (quantity_dispatched >= 0),
      quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
      discrepancy_quantity INTEGER NOT NULL DEFAULT 0,
      UNIQUE (stock_transfer_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_ref TEXT NOT NULL UNIQUE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'opening_stock', 'grn', 'sale', 'transfer_out', 'transfer_in', 'damage', 'expiry', 'adjustment', 'reversal'
      )),
      quantity_added INTEGER NOT NULL DEFAULT 0 CHECK (quantity_added >= 0),
      quantity_removed INTEGER NOT NULL DEFAULT 0 CHECK (quantity_removed >= 0),
      balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
      unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
      reference_number TEXT NOT NULL,
      source_entity TEXT NOT NULL DEFAULT '',
      source_id INTEGER NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NULL REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      branch_id INTEGER NULL REFERENCES branches(id),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE,
      target_role TEXT NULL,
      branch_id INTEGER NULL REFERENCES branches(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link_path TEXT NOT NULL DEFAULT '',
      is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes for query performance
    CREATE INDEX IF NOT EXISTS idx_stocks_branch_product ON stocks(branch_id, product_id);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
    CREATE INDEX IF NOT EXISTS idx_inv_tx_product_branch ON inventory_transactions(product_id, branch_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_inv_tx_branch_created ON inventory_transactions(branch_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_inv_tx_type ON inventory_transactions(transaction_type);
    CREATE INDEX IF NOT EXISTS idx_po_branch_status ON purchase_orders(branch_id, status);
    CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_intake_branch_date ON stock_intakes(branch_id, date_received);
    CREATE INDEX IF NOT EXISTS idx_issue_branch_date ON stock_issues(branch_id, issue_date);
    CREATE INDEX IF NOT EXISTS idx_transfer_branches_status ON stock_transfers(source_branch_id, destination_branch_id, status);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_branch ON audit_logs(branch_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(is_read, branch_id, target_role);
  `);
}
