import crypto from 'node:crypto';
import type { DbInstance } from './connection.ts';
import { runInTransaction } from './connection.ts';
import { hashPassword } from '../middleware/auth.ts';
import { checkAndNotifyStockLevel, createNotification, recordAuditLog } from '../services/auditService.ts';

export function seedDatabase(db: DbInstance): void {
  const existingRoles = db.prepare('SELECT COUNT(*) AS cnt FROM roles').get() as { cnt: number };
  if (existingRoles.cnt > 0) {
    return;
  }

  runInTransaction(db, () => {
    // 1. Roles
    const roles = [
      ['admin', 'Administrator', 'Full system access across all branches, users, settings, and reports.'],
      ['procurement_manager', 'Procurement Manager', 'Head Office procurement, suppliers, purchase orders, and cross-branch stock visibility.'],
      ['branch_manager', 'Branch Manager', 'Branch-scoped inventory oversight, transfer approvals, and branch reporting.'],
      ['stock_controller', 'Stock Controller', 'Branch-scoped GRN intake, stock issues, and transfer receipt confirmation.'],
    ];
    const insertRole = db.prepare('INSERT INTO roles (slug, name, description) VALUES (?, ?, ?)');
    for (const r of roles) {
      insertRole.run(r[0], r[1], r[2]);
    }

    const roleMap = new Map<string, number>();
    for (const r of db.prepare('SELECT id, slug FROM roles').all() as Array<{ id: number; slug: string }>) {
      roleMap.set(r.slug, r.id);
    }

    // 2. Branches
    const branches = [
      ['Ntinda – Head Office', 'NTINDA', 'Plot 44, Ntinda-Kigowa Road, Kampala', '+256 414 285 100', 'ntinda@qualitysupermarkets.co.ug', 'David Ssemogerere'],
      ['Najjera Branch', 'NAJJERA', 'Najjera Trading Centre, Kira Municipality', '+256 414 285 200', 'najjera@qualitysupermarkets.co.ug', 'Sarah Namukasa'],
      ['Kyaliwajjala Branch', 'KYALI', 'Kyaliwajjala Main Road, Wakiso', '+256 414 285 300', 'kyaliwajjala@qualitysupermarkets.co.ug', 'Daniel Okello'],
    ];
    const insertBranch = db.prepare(
      'INSERT INTO branches (name, code, location, contact_phone, contact_email, manager_name) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const b of branches) {
      insertBranch.run(b[0], b[1], b[2], b[3], b[4], b[5]);
    }

    const branchMap = new Map<string, number>();
    for (const b of db.prepare('SELECT id, code FROM branches').all() as Array<{ id: number; code: string }>) {
      branchMap.set(b.code, b.id);
    }
    const ntindaId = branchMap.get('NTINDA')!;
    const najjeraId = branchMap.get('NAJJERA')!;
    const kyaliId = branchMap.get('KYALI')!;

    // 3. Users (demo credentials documented in README)
    const users = [
      ['System Administrator', 'admin', 'admin@qualitysupermarkets.co.ug', '+256 772 100 001', hashPassword('Admin@2026'), roleMap.get('admin')!, ntindaId],
      ['Grace Nakato', 'procurement', 'procurement@qualitysupermarkets.co.ug', '+256 772 100 002', hashPassword('Procure@2026'), roleMap.get('procurement_manager')!, ntindaId],
      ['David Ssemogerere', 'mgr.ntinda', 'ntinda.mgr@qualitysupermarkets.co.ug', '+256 772 100 003', hashPassword('Branch@2026'), roleMap.get('branch_manager')!, ntindaId],
      ['Sarah Namukasa', 'mgr.najjera', 'najjera.mgr@qualitysupermarkets.co.ug', '+256 772 100 004', hashPassword('Branch@2026'), roleMap.get('branch_manager')!, najjeraId],
      ['Peter Mugisha', 'ctrl.kyali', 'kyali.ctrl@qualitysupermarkets.co.ug', '+256 772 100 005', hashPassword('Stock@2026'), roleMap.get('stock_controller')!, kyaliId],
      ['Moses Kato', 'ctrl.najjera', 'najjera.ctrl@qualitysupermarkets.co.ug', '+256 772 100 006', hashPassword('Stock@2026'), roleMap.get('stock_controller')!, najjeraId],
    ];
    const insertUser = db.prepare(
      'INSERT INTO users (full_name, username, email, phone, password_hash, role_id, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const u of users) {
      insertUser.run(u[0], u[1], u[2], u[3], u[4], u[5], u[6]);
    }
    const adminId = (db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: number }).id;
    const procId = (db.prepare("SELECT id FROM users WHERE username = 'procurement'").get() as { id: number }).id;
    const mgrNajjeraId = (db.prepare("SELECT id FROM users WHERE username = 'mgr.najjera'").get() as { id: number }).id;
    const ctrlKyaliId = (db.prepare("SELECT id FROM users WHERE username = 'ctrl.kyali'").get() as { id: number }).id;
    const ctrlNajjeraId = (db.prepare("SELECT id FROM users WHERE username = 'ctrl.najjera'").get() as { id: number }).id;

    // 4. Categories
    const categories = [
      ['Beverages', 'BEV', 'Bottled water, sodas, juices, and soft drinks'],
      ['Cereals & Grains', 'CER', 'Rice, maize flour, sugar, and dry staples'],
      ['Dairy & Chilled', 'DAI', 'UHT milk, yoghurt, butter, and dairy products'],
      ['Cleaning Supplies', 'CLN', 'Laundry detergents, bar soaps, and disinfectants'],
      ['Confectionery & Bakery', 'CNF', 'Bread, biscuits, sweets, and snacks'],
      ['Household Items', 'HHD', 'Tissue paper, cooking oil, and kitchen essentials'],
      ['Personal Care', 'PRC', 'Petroleum jelly, toiletries, and body care'],
    ];
    const insertCat = db.prepare('INSERT INTO categories (name, code, description) VALUES (?, ?, ?)');
    for (const c of categories) {
      insertCat.run(c[0], c[1], c[2]);
    }
    const catMap = new Map<string, number>();
    for (const c of db.prepare('SELECT id, code FROM categories').all() as Array<{ id: number; code: string }>) {
      catMap.set(c.code, c.id);
    }

    // 5. Suppliers
    const suppliers = [
      ['SUP-001', 'Century Bottling Company Ltd', 'Ronald Wasswa', '+256 312 200 111', 'orders@centurybottling.ug', 'Plot 29, Namanve Industrial Park, Kampala', '1000248811', 'Coca-Cola, Minute Maid & Rwenzori distributor'],
      ['SUP-002', 'Mukwano Industries Uganda Ltd', 'Amina Namutebi', '+256 414 313 000', 'sales@mukwano.com', 'Plot 30, Mukwano Road, Industrial Area, Kampala', '1000019284', 'Edible oils, bar soaps, and household detergents'],
      ['SUP-003', 'Pearl Dairy Farms Ltd', 'Samuel Twinomujuni', '+256 393 266 410', 'supply@pearldairy.com', 'Mbarara / Kampala Depot, Ntinda', '1000412987', 'Lato UHT Milk & dairy supplies'],
      ['SUP-004', 'Kakira Sugar Works Ltd', 'Harriet Babirye', '+256 434 120 400', 'wholesale@kakirasugar.com', 'Jinja / Kampala Warehouse, Nakawa', '1000051120', 'Refined and brown sugar cartons'],
      ['SUP-005', 'Movit Products Ltd', 'Brian Kiggundu', '+256 414 272 190', 'trade@movit.co.ug', 'Zana, Entebbe Road, Kampala', '1000338192', 'Personal care and cosmetics'],
    ];
    const insertSup = db.prepare(
      'INSERT INTO suppliers (supplier_code, name, contact_person, phone, email, address, tin, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const s of suppliers) {
      insertSup.run(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]);
    }
    const supMap = new Map<string, number>();
    for (const s of db.prepare('SELECT id, supplier_code FROM suppliers').all() as Array<{ id: number; supplier_code: string }>) {
      supMap.set(s.supplier_code, s.id);
    }

    // 6. Products (16 realistic Ugandan supermarket products with UGX prices)
    const productsData = [
      // [sku, barcode, name, catCode, uom, cost, sell, reorder, supCode, expiryTracking, [ntindaQty, najjeraQty, kyaliQty]]
      ['QS-BEV-001', '6161101100011', 'Rwenzori Bottled Water 500ml (Pack of 12)', 'BEV', 'Pack', 9500, 12500, 30, 'SUP-001', 1, [140, 22, 65]],
      ['QS-BEV-002', '5449000000996', 'Coca-Cola Soda 500ml (Crate of 24)', 'BEV', 'Crate', 34000, 42000, 20, 'SUP-001', 1, [85, 42, 14]],
      ['QS-BEV-003', '6161101100035', 'Minute Maid Mango Juice 1L', 'BEV', 'Bottle', 4200, 5500, 25, 'SUP-001', 1, [60, 0, 18]],
      ['QS-CER-001', '6009880112014', 'Kibimba Long Grain Rice 5kg', 'CER', 'Bag', 19500, 24000, 20, 'SUP-004', 0, [92, 34, 48]],
      ['QS-CER-002', '6009880112021', 'Kakira Brown Sugar 2kg', 'CER', 'Packet', 7800, 9500, 35, 'SUP-004', 0, [115, 28, 12]],
      ['QS-CER-003', '6009880112038', 'Jesca Super Maize Flour 5kg', 'CER', 'Bag', 12000, 15500, 25, 'SUP-004', 0, [74, 30, 26]],
      ['QS-DAI-001', '6164001100112', 'Lato UHT Whole Milk 500ml (Carton of 12)', 'DAI', 'Carton', 21600, 27000, 18, 'SUP-003', 1, [54, 15, 0]],
      ['QS-DAI-002', '6164001100129', 'Blue Band Original Margarine 500g', 'DAI', 'Tub', 8500, 11000, 15, 'SUP-003', 1, [40, 19, 11]],
      ['QS-CLN-001', '6001087351001', 'Mukwano White Star Bar Soap 1kg (Carton)', 'CLN', 'Carton', 46000, 54000, 15, 'SUP-002', 0, [48, 25, 19]],
      ['QS-CLN-002', '6001087351018', 'Omo Fast Action Detergent 1kg', 'CLN', 'Packet', 9800, 12500, 24, 'SUP-002', 0, [68, 18, 32]],
      ['QS-HHD-001', '6001087351025', 'Fortune Butto Cooking Oil 3L Jerrycan', 'HHD', 'Jerrycan', 24500, 29500, 20, 'SUP-002', 1, [76, 38, 16]],
      ['QS-HHD-002', '6161108800104', 'Fay Soft Tissue Paper (10-Roll Pack)', 'HHD', 'Pack', 11000, 14500, 25, 'SUP-002', 0, [95, 40, 29]],
      ['QS-CNF-001', '6161109900210', 'Hot Loaf Sliced White Bread 800g', 'CNF', 'Loaf', 4500, 5800, 30, 'SUP-004', 1, [45, 22, 8]],
      ['QS-CNF-002', '6161109900227', 'Britania Digestive Biscuits 200g', 'CNF', 'Packet', 2800, 3800, 40, 'SUP-004', 1, [110, 55, 44]],
      ['QS-PRC-001', '6167001100301', 'Movit Herbal Petroleum Jelly 250g', 'PRC', 'Jar', 5200, 7000, 20, 'SUP-005', 1, [64, 31, 22]],
      ['QS-BEV-004', '6161101100097', 'Nile Club Non-Alcoholic Malt 500ml (Pack of 6)', 'BEV', 'Pack', 14500, 18000, 15, 'SUP-001', 1, [38, 14, 21]],
    ] as const;

    const insertProd = db.prepare(
      `INSERT INTO products (
        sku, barcode, name, category_id, description, unit_of_measure,
        unit_cost, selling_price, reorder_level, preferred_supplier_id, expiry_tracking, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    );
    const insertStock = db.prepare(
      `INSERT INTO stocks (product_id, branch_id, quantity_on_hand, last_movement_at)
       VALUES (?, ?, ?, datetime('now'))`
    );
    const insertTx = db.prepare(
      `INSERT INTO inventory_transactions (
        transaction_ref, product_id, branch_id, transaction_type,
        quantity_added, quantity_removed, balance_after, unit_cost,
        reference_number, source_entity, source_id, user_id, notes
      ) VALUES (?, ?, ?, 'opening_stock', ?, 0, ?, ?, 'OPEN-2026-INIT', 'opening', NULL, ?, ?)`
    );

    const branchIds = [ntindaId, najjeraId, kyaliId];
    const prodMap = new Map<string, { id: number; cost: number }>();

    for (const p of productsData) {
      const res = insertProd.run(
        p[0],
        p[1],
        p[2],
        catMap.get(p[3])!,
        `${p[2]} — Quality Supermarkets standard retail line`,
        p[4],
        p[5],
        p[6],
        p[7],
        supMap.get(p[8])!,
        p[9]
      );
      const prodId = Number(res.lastInsertRowid);
      prodMap.set(p[0], { id: prodId, cost: p[5] });

      const qtys = p[10];
      for (let i = 0; i < branchIds.length; i++) {
        const bId = branchIds[i];
        const qty = qtys[i];
        insertStock.run(prodId, bId, qty);
        if (qty > 0) {
          const ref = `TX-OPEN-${prodId}-${bId}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
          insertTx.run(ref, prodId, bId, qty, qty, p[5], adminId, 'Initial opening stock balance');
        }
        checkAndNotifyStockLevel(db, prodId, bId);
      }
    }

    // 7. Sample Purchase Orders
    const po1Water = prodMap.get('QS-BEV-001')!;
    const po1Soda = prodMap.get('QS-BEV-002')!;
    const po1Total = 40 * po1Water.cost + 20 * po1Soda.cost;
    const po1Res = db
      .prepare(
        `INSERT INTO purchase_orders (po_number, supplier_id, branch_id, order_date, expected_delivery_date, created_by, status, grand_total, notes)
         VALUES ('PO-20261118-0001', ?, ?, '2026-11-18', '2026-11-23', ?, 'sent', ?, 'Urgent beverage restock for Najjera Branch')`
      )
      .run(supMap.get('SUP-001')!, najjeraId, procId, po1Total);
    const po1Id = Number(po1Res.lastInsertRowid);
    db.prepare(
      `INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost, line_total)
       VALUES (?, ?, 40, 0, ?, ?), (?, ?, 20, 0, ?, ?)`
    ).run(
      po1Id,
      po1Water.id,
      po1Water.cost,
      40 * po1Water.cost,
      po1Id,
      po1Soda.id,
      po1Soda.cost,
      20 * po1Soda.cost
    );

    const po2Milk = prodMap.get('QS-DAI-001')!;
    const po2Total = 25 * po2Milk.cost;
    const po2Res = db
      .prepare(
        `INSERT INTO purchase_orders (po_number, supplier_id, branch_id, order_date, expected_delivery_date, created_by, status, grand_total, notes)
         VALUES ('PO-20261119-0002', ?, ?, '2026-11-19', '2026-11-24', ?, 'draft', ?, 'Draft dairy replenishment for Kyaliwajjala')`
      )
      .run(supMap.get('SUP-003')!, kyaliId, procId, po2Total);
    const po2Id = Number(po2Res.lastInsertRowid);
    db.prepare(
      `INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost, line_total)
       VALUES (?, ?, 25, 0, ?, ?)`
    ).run(po2Id, po2Milk.id, po2Milk.cost, po2Total);

    // 8. Sample GRN (already reflected in stock & ledger for Ntinda)
    const rice = prodMap.get('QS-CER-001')!;
    const grnTotal = 20 * rice.cost;
    const grnRes = db
      .prepare(
        `INSERT INTO stock_intakes (grn_number, branch_id, supplier_id, purchase_order_id, delivery_note_number, date_received, received_by, grand_total, remarks)
         VALUES ('GRN-20261120-0001', ?, ?, NULL, 'DN-88412', '2026-11-20', ?, ?, 'Routine rice delivery at Ntinda Head Office')`
      )
      .run(ntindaId, supMap.get('SUP-004')!, adminId, grnTotal);
    const grnId = Number(grnRes.lastInsertRowid);
    db.prepare(
      `INSERT INTO stock_intake_items (stock_intake_id, product_id, quantity_received, unit_cost, line_total)
       VALUES (?, ?, 20, ?, ?)`
    ).run(grnId, rice.id, rice.cost, grnTotal);
    db.prepare(`UPDATE stocks SET quantity_on_hand = quantity_on_hand + 20 WHERE product_id = ? AND branch_id = ?`).run(
      rice.id,
      ntindaId
    );
    const ntindaRiceBal = (
      db.prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = ? AND branch_id = ?').get(rice.id, ntindaId) as {
        quantity_on_hand: number;
      }
    ).quantity_on_hand;
    db.prepare(
      `INSERT INTO inventory_transactions (
        transaction_ref, product_id, branch_id, transaction_type,
        quantity_added, quantity_removed, balance_after, unit_cost,
        reference_number, source_entity, source_id, user_id, notes
      ) VALUES ('TX-GRN-SEED-001', ?, ?, 'grn', 20, 0, ?, ?, 'GRN-20261120-0001', 'stock_intake', ?, ?, 'Routine rice delivery at Ntinda')`
    ).run(rice.id, ntindaId, ntindaRiceBal, rice.cost, grnId, adminId);

    // 9. Sample Stock Issue (Sale + Damage)
    const bread = prodMap.get('QS-CNF-001')!;
    const issTotal = 4 * bread.cost;
    const issRes = db
      .prepare(
        `INSERT INTO stock_issues (issue_number, branch_id, issue_type, reference_number, reason, issue_date, issued_by, grand_total, notes)
         VALUES ('ISS-20261120-0001', ?, 'damage', 'DMG-KYA-09', 'Packaging torn during shelf restocking', '2026-11-20', ?, ?, 'Verified by Kyaliwajjala controller')`
      )
      .run(kyaliId, ctrlKyaliId, issTotal);
    const issId = Number(issRes.lastInsertRowid);
    db.prepare(
      `INSERT INTO stock_issue_items (stock_issue_id, product_id, quantity, unit_cost, line_total)
       VALUES (?, ?, 4, ?, ?)`
    ).run(issId, bread.id, bread.cost, issTotal);
    db.prepare(`UPDATE stocks SET quantity_on_hand = quantity_on_hand - 4 WHERE product_id = ? AND branch_id = ?`).run(
      bread.id,
      kyaliId
    );
    const kyaliBreadBal = (
      db.prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = ? AND branch_id = ?').get(bread.id, kyaliId) as {
        quantity_on_hand: number;
      }
    ).quantity_on_hand;
    db.prepare(
      `INSERT INTO inventory_transactions (
        transaction_ref, product_id, branch_id, transaction_type,
        quantity_added, quantity_removed, balance_after, unit_cost,
        reference_number, source_entity, source_id, user_id, notes
      ) VALUES ('TX-ISS-SEED-001', ?, ?, 'damage', 0, 4, ?, ?, 'ISS-20261120-0001', 'stock_issue', ?, ?, 'Packaging torn during restock')`
    ).run(bread.id, kyaliId, kyaliBreadBal, bread.cost, issId, ctrlKyaliId);

    // 10. Sample Inter-Branch Transfer (In Transit from Ntinda -> Najjera)
    const oil = prodMap.get('QS-HHD-001')!;
    const trfRes = db
      .prepare(
        `INSERT INTO stock_transfers (transfer_number, source_branch_id, destination_branch_id, requested_by, approved_by, dispatched_by, status, dispatch_date, notes)
         VALUES ('TRF-20261121-0001', ?, ?, ?, ?, ?, 'in_transit', datetime('now', '-2 hours'), 'Replenishment transfer of cooking oil from Head Office to Najjera')`
      )
      .run(ntindaId, najjeraId, mgrNajjeraId, adminId, adminId);
    const trfId = Number(trfRes.lastInsertRowid);
    db.prepare(
      `INSERT INTO stock_transfer_items (stock_transfer_id, product_id, quantity_requested, quantity_dispatched)
       VALUES (?, ?, 10, 10)`
    ).run(trfId, oil.id);
    db.prepare(`UPDATE stocks SET quantity_on_hand = quantity_on_hand - 10 WHERE product_id = ? AND branch_id = ?`).run(
      oil.id,
      ntindaId
    );
    const ntindaOilBal = (
      db.prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = ? AND branch_id = ?').get(oil.id, ntindaId) as {
        quantity_on_hand: number;
      }
    ).quantity_on_hand;
    db.prepare(
      `INSERT INTO inventory_transactions (
        transaction_ref, product_id, branch_id, transaction_type,
        quantity_added, quantity_removed, balance_after, unit_cost,
        reference_number, source_entity, source_id, user_id, notes
      ) VALUES ('TX-TRO-SEED-001', ?, ?, 'transfer_out', 0, 10, ?, ?, 'TRF-20261121-0001', 'stock_transfer', ?, ?, 'Dispatched to Najjera Branch')`
    ).run(oil.id, ntindaId, ntindaOilBal, oil.cost, trfId, adminId);

    createNotification(db, {
      branchId: najjeraId,
      type: 'transfer_dispatched',
      title: 'Incoming Transfer In Transit: TRF-20261121-0001',
      message: '10 units of Fortune Butto Cooking Oil 3L dispatched from Ntinda – Head Office to Najjera Branch.',
      linkPath: '/stock-transfers',
    });

    // 11. System Settings
    const settings: Array<[string, string]> = [
      ['business_name', 'Quality Supermarkets Uganda Limited'],
      ['system_name', 'QS-IMS'],
      ['currency', 'UGX'],
      ['default_reorder_level', '15'],
      ['default_reorder_multiplier', '2'],
      ['low_stock_alerts_enabled', 'true'],
      ['allow_negative_stock', 'false'],
    ];
    const insertSetting = db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)');
    for (const [k, v] of settings) {
      insertSetting.run(k, v);
    }

    // 12. Initial Audit Logs
    recordAuditLog(db, {
      userId: adminId,
      action: 'system_seeded',
      entityType: 'system',
      entityId: 'init',
      branchId: ntindaId,
      metadata: { branches: 3, products: productsData.length, users: users.length },
    });
    recordAuditLog(db, {
      userId: ctrlNajjeraId,
      action: 'login',
      entityType: 'session',
      entityId: String(ctrlNajjeraId),
      branchId: najjeraId,
      metadata: { username: 'ctrl.najjera' },
    });
  });
}
