import type { DbInstance } from '../db/types.ts';
import { runInTransaction } from '../db/types.ts';
import { AppError } from '../middleware/auth.ts';
import { recordAuditLog } from './auditService.ts';

export interface ProductInput {
  sku: string;
  barcode?: string;
  name: string;
  category_id: number;
  description?: string;
  unit_of_measure: string;
  unit_cost: number;
  selling_price: number;
  reorder_level: number;
  preferred_supplier_id?: number | null;
  expiry_tracking?: boolean;
  status?: 'active' | 'inactive';
}

export function createProduct(
  db: DbInstance,
  input: ProductInput,
  actorUserId: number,
  ipAddress = ''
) {
  const sku = input.sku.trim().toUpperCase();
  const name = input.name.trim();
  if (!sku || !name) {
    throw new AppError(400, 'Product SKU and name are required');
  }
  if (input.unit_cost < 0 || input.selling_price < 0 || input.reorder_level < 0) {
    throw new AppError(400, 'Unit cost, selling price, and reorder level must be non-negative');
  }

  const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(sku);
  if (existing) {
    throw new AppError(409, `A product with SKU "${sku}" already exists`);
  }

  const category = db
    .prepare('SELECT id FROM categories WHERE id = ?')
    .get(input.category_id);
  if (!category) {
    throw new AppError(404, 'Selected category does not exist');
  }

  if (input.preferred_supplier_id) {
    const sup = db
      .prepare('SELECT id FROM suppliers WHERE id = ?')
      .get(input.preferred_supplier_id);
    if (!sup) {
      throw new AppError(404, 'Preferred supplier does not exist');
    }
  }

  return runInTransaction(db, () => {
    const result = db
      .prepare(
        `INSERT INTO products (
          sku, barcode, name, category_id, description, unit_of_measure,
          unit_cost, selling_price, reorder_level, preferred_supplier_id,
          expiry_tracking, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sku,
        (input.barcode || '').trim(),
        name,
        input.category_id,
        (input.description || '').trim(),
        (input.unit_of_measure || 'Piece').trim(),
        Math.round(input.unit_cost),
        Math.round(input.selling_price),
        Math.round(input.reorder_level),
        input.preferred_supplier_id || null,
        input.expiry_tracking ? 1 : 0,
        input.status || 'active'
      );

    const productId = Number(result.lastInsertRowid);

    // Initialize zero-quantity stock records for ALL branches automatically
    const branches = db.prepare('SELECT id FROM branches').all() as Array<{ id: number }>;
    const insertStock = db.prepare(
      `INSERT INTO stocks (product_id, branch_id, quantity_on_hand) VALUES (?, ?, 0)`
    );
    for (const branch of branches) {
      insertStock.run(productId, branch.id);
    }

    recordAuditLog(db, {
      userId: actorUserId,
      action: 'product_created',
      entityType: 'product',
      entityId: productId,
      metadata: { sku, name, branches_initialized: branches.length },
      ipAddress,
    });

    return db
      .prepare(
        `SELECT p.*, c.name AS category_name, s.name AS preferred_supplier_name
         FROM products p
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
         WHERE p.id = ?`
      )
      .get(productId);
  });
}

export function updateProduct(
  db: DbInstance,
  productId: number,
  input: Partial<ProductInput>,
  actorUserId: number,
  ipAddress = ''
) {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as
    | Record<string, string | number | null>
    | undefined;
  if (!existing) {
    throw new AppError(404, 'Product not found');
  }

  const nextSku = input.sku !== undefined ? input.sku.trim().toUpperCase() : String(existing.sku);
  if (!nextSku) {
    throw new AppError(400, 'Product SKU cannot be empty');
  }

  const dup = db
    .prepare('SELECT id FROM products WHERE sku = ? AND id != ?')
    .get(nextSku, productId);
  if (dup) {
    throw new AppError(409, `A product with SKU "${nextSku}" already exists`);
  }

  const nextName = input.name !== undefined ? input.name.trim() : String(existing.name);
  if (!nextName) {
    throw new AppError(400, 'Product name cannot be empty');
  }

  const nextUnitCost =
    input.unit_cost !== undefined ? Math.round(input.unit_cost) : Number(existing.unit_cost);
  const nextSellingPrice =
    input.selling_price !== undefined
      ? Math.round(input.selling_price)
      : Number(existing.selling_price);
  const nextReorder =
    input.reorder_level !== undefined
      ? Math.round(input.reorder_level)
      : Number(existing.reorder_level);

  if (nextUnitCost < 0 || nextSellingPrice < 0 || nextReorder < 0) {
    throw new AppError(400, 'Prices and reorder level must be non-negative');
  }

  return runInTransaction(db, () => {
    db.prepare(
      `UPDATE products
       SET sku = ?, barcode = ?, name = ?, category_id = ?, description = ?,
           unit_of_measure = ?, unit_cost = ?, selling_price = ?, reorder_level = ?,
           preferred_supplier_id = ?, expiry_tracking = ?, status = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      nextSku,
      input.barcode !== undefined ? input.barcode.trim() : existing.barcode,
      nextName,
      input.category_id !== undefined ? input.category_id : existing.category_id,
      input.description !== undefined ? input.description.trim() : existing.description,
      input.unit_of_measure !== undefined
        ? input.unit_of_measure.trim()
        : existing.unit_of_measure,
      nextUnitCost,
      nextSellingPrice,
      nextReorder,
      input.preferred_supplier_id !== undefined
        ? input.preferred_supplier_id || null
        : existing.preferred_supplier_id,
      input.expiry_tracking !== undefined
        ? input.expiry_tracking
          ? 1
          : 0
        : existing.expiry_tracking,
      input.status !== undefined ? input.status : existing.status,
      productId
    );

    recordAuditLog(db, {
      userId: actorUserId,
      action: 'product_updated',
      entityType: 'product',
      entityId: productId,
      metadata: { sku: nextSku, name: nextName },
      ipAddress,
    });

    return db
      .prepare(
        `SELECT p.*, c.name AS category_name, s.name AS preferred_supplier_name
         FROM products p
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
         WHERE p.id = ?`
      )
      .get(productId);
  });
}

export function deleteProductSafely(
  db: DbInstance,
  productId: number,
  actorUserId: number,
  ipAddress = ''
): void {
  const existing = db.prepare('SELECT id, sku, name FROM products WHERE id = ?').get(productId) as
    | { id: number; sku: string; name: string }
    | undefined;
  if (!existing) {
    throw new AppError(404, 'Product not found');
  }

  const txRef = db
    .prepare('SELECT id FROM inventory_transactions WHERE product_id = ? LIMIT 1')
    .get(productId);
  const poRef = db
    .prepare('SELECT id FROM purchase_order_items WHERE product_id = ? LIMIT 1')
    .get(productId);

  if (txRef || poRef) {
    throw new AppError(
      409,
      'Cannot delete product that has been used in inventory or procurement transactions. Deactivate it instead.'
    );
  }

  runInTransaction(db, () => {
    db.prepare('DELETE FROM stocks WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    recordAuditLog(db, {
      userId: actorUserId,
      action: 'product_deleted',
      entityType: 'product',
      entityId: productId,
      metadata: { sku: existing.sku, name: existing.name },
      ipAddress,
    });
  });
}
