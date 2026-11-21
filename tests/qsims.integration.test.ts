import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import { createDatabase, type DbInstance } from '../server/db/connection.ts';
import { runMigrations } from '../server/db/migrations.ts';
import { seedDatabase } from '../server/db/seed.ts';

let db: DbInstance;
let app: ReturnType<typeof createApp>;

async function loginAs(username: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  expect(res.status).toBe(200);
  expect(res.body.token).toBeTruthy();
  return res.body.token as string;
}

describe('QS-IMS Integration, Security & Inventory Integrity Tests', () => {
  beforeAll(() => {
    db = createDatabase(':memory:');
    runMigrations(db);
    seedDatabase(db);
    app = createApp(db);
  });

  it('rejects invalid credentials and protects unauthenticated routes', async () => {
    const unauth = await request(app).get('/api/products');
    expect(unauth.status).toBe(401);

    const badLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'WrongPassword!' });
    expect(badLogin.status).toBe(401);
  });

  it('creates a new product and automatically initializes 0 stock across all 3 branches', async () => {
    const adminToken = await loginAs('admin', 'Admin@2026');

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        sku: 'QS-TEST-901',
        name: 'Test Maize Porridge 1kg',
        category_id: 2,
        unit_of_measure: 'Packet',
        unit_cost: 4000,
        selling_price: 5500,
        reorder_level: 10,
      });

    expect(res.status).toBe(201);
    const productId = res.body.product.id;

    // Duplicate SKU should be rejected
    const dupRes = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        sku: 'QS-TEST-901',
        name: 'Duplicate SKU Product',
        category_id: 2,
        unit_of_measure: 'Packet',
        unit_cost: 4000,
        selling_price: 5500,
        reorder_level: 10,
      });
    expect(dupRes.status).toBe(409);

    const detail = await request(app)
      .get(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.branchStocks).toHaveLength(3);
    for (const bs of detail.body.branchStocks) {
      expect(bs.quantity_on_hand).toBe(0);
    }
  });

  it('prevents deleting a product that already has inventory transactions', async () => {
    const adminToken = await loginAs('admin', 'Admin@2026');
    const delRes = await request(app)
      .delete('/api/products/1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(409);
  });

  it('enforces Purchase Order -> GRN workflow without increasing stock on PO creation and prevents duplicate GRN', async () => {
    const procToken = await loginAs('procurement', 'Procure@2026');
    const najjeraCtrlToken = await loginAs('ctrl.najjera', 'Stock@2026');

    // Check current stock of Product 3 at Najjera (branch 2) — seeded at 0
    const beforeInv = await request(app)
      .get('/api/inventory?branch_id=2&search=QS-BEV-003')
      .set('Authorization', `Bearer ${najjeraCtrlToken}`);
    expect(beforeInv.status).toBe(200);
    const qtyBefore = beforeInv.body.items[0].quantity_on_hand;

    // Procurement creates PO and marks Sent
    const poRes = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${procToken}`)
      .send({
        supplier_id: 1,
        branch_id: 2,
        order_date: '2026-11-21',
        status: 'sent',
        items: [{ product_id: 3, quantity_ordered: 30, unit_cost: 4200 }],
      });
    expect(poRes.status).toBe(201);
    const poId = poRes.body.purchaseOrder.id;

    // Stock must STILL be unchanged
    const midInv = await request(app)
      .get('/api/inventory?branch_id=2&search=QS-BEV-003')
      .set('Authorization', `Bearer ${najjeraCtrlToken}`);
    expect(midInv.body.items[0].quantity_on_hand).toBe(qtyBefore);

    // Stock Controller at Najjera records partial GRN of 20 units
    const idemKey = 'test-grn-idem-001';
    const grnRes = await request(app)
      .post('/api/grns')
      .set('Authorization', `Bearer ${najjeraCtrlToken}`)
      .send({
        branch_id: 2,
        supplier_id: 1,
        purchase_order_id: poId,
        delivery_note_number: 'DN-TEST-1',
        date_received: '2026-11-21',
        idempotency_key: idemKey,
        items: [{ product_id: 3, quantity_received: 20, unit_cost: 4200 }],
      });
    expect(grnRes.status).toBe(201);

    // Duplicate GRN submission with same idempotency_key must be rejected
    const dupGrn = await request(app)
      .post('/api/grns')
      .set('Authorization', `Bearer ${najjeraCtrlToken}`)
      .send({
        branch_id: 2,
        supplier_id: 1,
        purchase_order_id: poId,
        date_received: '2026-11-21',
        idempotency_key: idemKey,
        items: [{ product_id: 3, quantity_received: 20, unit_cost: 4200 }],
      });
    expect(dupGrn.status).toBe(409);

    // Verify stock increased by 20 and PO status became partially_received
    const afterInv = await request(app)
      .get('/api/inventory?branch_id=2&search=QS-BEV-003')
      .set('Authorization', `Bearer ${najjeraCtrlToken}`);
    expect(afterInv.body.items[0].quantity_on_hand).toBe(qtyBefore + 20);

    const poCheck = await request(app)
      .get(`/api/purchase-orders/${poId}`)
      .set('Authorization', `Bearer ${procToken}`);
    expect(poCheck.body.purchaseOrder.status).toBe('partially_received');
  });

  it('rejects issuing more stock than available and updates ledger accurately on valid issue', async () => {
    const kyaliCtrlToken = await loginAs('ctrl.kyali', 'Stock@2026');

    // Kyaliwajjala (branch 3) has 0 of Product 7 (Lato Milk)
    const failIssue = await request(app)
      .post('/api/stock-issues')
      .set('Authorization', `Bearer ${kyaliCtrlToken}`)
      .send({
        branch_id: 3,
        issue_type: 'sale',
        issue_date: '2026-11-21',
        items: [{ product_id: 7, quantity: 5 }],
      });
    expect(failIssue.status).toBe(422);

    // Adjustment without reason must fail
    const noReasonAdj = await request(app)
      .post('/api/stock-issues')
      .set('Authorization', `Bearer ${kyaliCtrlToken}`)
      .send({
        branch_id: 3,
        issue_type: 'adjustment',
        issue_date: '2026-11-21',
        items: [{ product_id: 1, quantity: 2 }],
      });
    expect(noReasonAdj.status).toBe(400);

    // Valid sale of 5 units of Product 1 (Rwenzori Water)
    const before = db
      .prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = 1 AND branch_id = 3')
      .get() as { quantity_on_hand: number };

    const okIssue = await request(app)
      .post('/api/stock-issues')
      .set('Authorization', `Bearer ${kyaliCtrlToken}`)
      .send({
        branch_id: 3,
        issue_type: 'sale',
        issue_date: '2026-11-21',
        items: [{ product_id: 1, quantity: 5 }],
      });
    expect(okIssue.status).toBe(201);

    const after = db
      .prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = 1 AND branch_id = 3')
      .get() as { quantity_on_hand: number };
    expect(after.quantity_on_hand).toBe(before.quantity_on_hand - 5);
  });

  it('conserves stock across inter-branch transfers and prevents double receipt', async () => {
    const adminToken = await loginAs('admin', 'Admin@2026');
    const najjeraMgrToken = await loginAs('mgr.najjera', 'Branch@2026');

    const srcBefore = (
      db.prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = 4 AND branch_id = 1').get() as {
        quantity_on_hand: number;
      }
    ).quantity_on_hand;
    const dstBefore = (
      db.prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = 4 AND branch_id = 2').get() as {
        quantity_on_hand: number;
      }
    ).quantity_on_hand;

    // Same-branch transfer must fail
    const sameBranch = await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        source_branch_id: 1,
        destination_branch_id: 1,
        items: [{ product_id: 4, quantity_requested: 5 }],
      });
    expect(sameBranch.status).toBe(422);

    // Create transfer Ntinda (1) -> Najjera (2) for 10 units of Product 4
    const trfRes = await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${najjeraMgrToken}`)
      .send({
        source_branch_id: 1,
        destination_branch_id: 2,
        submit_immediately: true,
        items: [{ product_id: 4, quantity_requested: 10 }],
      });
    expect(trfRes.status).toBe(201);
    const trfId = trfRes.body.transfer.id;

    // Approve & Dispatch from Ntinda (via Admin)
    const appRes = await request(app)
      .post(`/api/transfers/${trfId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' });
    expect(appRes.status).toBe(200);

    const dispRes = await request(app)
      .post(`/api/transfers/${trfId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'dispatch' });
    expect(dispRes.status).toBe(200);
    expect(dispRes.body.transfer.status).toBe('in_transit');

    const srcAfterDispatch = (
      db.prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = 4 AND branch_id = 1').get() as {
        quantity_on_hand: number;
      }
    ).quantity_on_hand;
    expect(srcAfterDispatch).toBe(srcBefore - 10);

    // Najjera Manager confirms receipt
    const recvRes = await request(app)
      .post(`/api/transfers/${trfId}/receive`)
      .set('Authorization', `Bearer ${najjeraMgrToken}`)
      .send({ items: [{ product_id: 4, quantity_received: 10 }] });
    expect(recvRes.status).toBe(200);
    expect(recvRes.body.transfer.status).toBe('received');

    // Second receipt attempt must be rejected
    const doubleRecv = await request(app)
      .post(`/api/transfers/${trfId}/receive`)
      .set('Authorization', `Bearer ${najjeraMgrToken}`)
      .send({ items: [{ product_id: 4, quantity_received: 10 }] });
    expect(doubleRecv.status).toBe(422);

    const dstAfter = (
      db.prepare('SELECT quantity_on_hand FROM stocks WHERE product_id = 4 AND branch_id = 2').get() as {
        quantity_on_hand: number;
      }
    ).quantity_on_hand;
    expect(dstAfter).toBe(dstBefore + 10);
  });

  it('enforces RBAC and strict branch isolation against forged branch_id requests', async () => {
    const najjeraMgrToken = await loginAs('mgr.najjera', 'Branch@2026');
    const kyaliCtrlToken = await loginAs('ctrl.kyali', 'Stock@2026');
    const adminToken = await loginAs('admin', 'Admin@2026');

    // Najjera Branch Manager attempting to view Ntinda (branch 1) inventory must be denied
    const forgedRead = await request(app)
      .get('/api/inventory?branch_id=1')
      .set('Authorization', `Bearer ${najjeraMgrToken}`);
    expect(forgedRead.status).toBe(403);

    // Najjera Branch Manager attempting to record GRN for Ntinda (branch 1) must be denied
    const forgedWrite = await request(app)
      .post('/api/grns')
      .set('Authorization', `Bearer ${najjeraMgrToken}`)
      .send({
        branch_id: 1,
        supplier_id: 1,
        date_received: '2026-11-21',
        items: [{ product_id: 1, quantity_received: 5 }],
      });
    expect(forgedWrite.status).toBe(403);

    // Stock Controller cannot access User Management, Settings, or Management Reports
    expect(
      (await request(app).get('/api/users').set('Authorization', `Bearer ${kyaliCtrlToken}`)).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .put('/api/settings')
          .set('Authorization', `Bearer ${kyaliCtrlToken}`)
          .send({ settings: { currency: 'USD' } })
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/reports/stock_value_by_branch')
          .set('Authorization', `Bearer ${kyaliCtrlToken}`)
      ).status
    ).toBe(403);

    // Cannot deactivate the last active Administrator
    const adminUser = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as {
      id: number;
    };
    const deactivateAdmin = await request(app)
      .put(`/api/users/${adminUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' });
    expect(deactivateAdmin.status).toBe(422);

    // Verify ledger balance consistency: latest ledger balance_after equals stocks.quantity_on_hand
    const stocks = db
      .prepare('SELECT product_id, branch_id, quantity_on_hand FROM stocks')
      .all() as Array<{ product_id: number; branch_id: number; quantity_on_hand: number }>;
    for (const s of stocks) {
      const lastTx = db
        .prepare(
          'SELECT balance_after FROM inventory_transactions WHERE product_id = ? AND branch_id = ? ORDER BY id DESC LIMIT 1'
        )
        .get(s.product_id, s.branch_id) as { balance_after: number } | undefined;
      if (lastTx) {
        expect(lastTx.balance_after).toBe(s.quantity_on_hand);
      } else {
        expect(s.quantity_on_hand).toBe(0);
      }
    }
  });
});
