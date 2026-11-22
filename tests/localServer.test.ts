import path from 'node:path';
import initSqlJs from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../server/db/migrations.ts';
import { seedDatabase } from '../server/db/seed.ts';
import { buildLocalRouter, type LocalHttpApp } from '../src/localDb/localServer.ts';
import { createSqlJsAdapter } from '../src/localDb/sqliteAdapter.ts';

let SQL: initSqlJs.SqlJsStatic;
let rawDb: initSqlJs.Database;
let router: LocalHttpApp;

function loginLocal(
  username: string,
  password: string,
  targetRouter: LocalHttpApp = router
): string {
  const res = targetRouter.dispatch('POST', '/api/auth/login', {}, { username, password });
  expect(res.status).toBe(200);
  const body = res.body as { token: string };
  expect(body.token).toBeTruthy();
  return body.token;
}

describe('Browser SQLite (sql.js) + LocalHttpApp End-to-End Tests', () => {
  beforeAll(async () => {
    const loader =
      typeof initSqlJs === 'function'
        ? initSqlJs
        : (initSqlJs as unknown as { default: typeof initSqlJs }).default;
    SQL = await loader({
      locateFile: () => path.resolve(process.cwd(), 'public/sql-wasm.wasm'),
      useOldExtensionFunctions: false,
    });
    rawDb = new SQL.Database();
    rawDb.exec('PRAGMA foreign_keys = ON;');
    const adapter = createSqlJsAdapter(rawDb);
    runMigrations(adapter);
    seedDatabase(adapter);
    router = buildLocalRouter(adapter);
  });

  it('authenticates all 4 hardcoded starter accounts and enforces RBAC + branch scope', () => {
    const unauth = router.dispatch('GET', '/api/products');
    expect(unauth.status).toBe(401);

    const adminToken = loginLocal('admin', 'Admin@2026');
    const procToken = loginLocal('procurement', 'Procure@2026');
    const najjeraToken = loginLocal('mgr.najjera', 'Branch@2026');
    const kyaliToken = loginLocal('ctrl.kyali', 'Stock@2026');

    const meRes = router.dispatch('GET', '/api/auth/me', {
      authorization: `Bearer ${adminToken}`,
    });
    expect(meRes.status).toBe(200);
    expect((meRes.body as { user: { username: string } }).user.username).toBe('admin');

    // Branch Manager at Najjera (branch 2) cannot query Ntinda (branch 1)
    const deniedBranch = router.dispatch('GET', '/api/inventory?branch_id=1', {
      authorization: `Bearer ${najjeraToken}`,
    });
    expect(deniedBranch.status).toBe(403);

    // Stock Controller at Kyaliwajjala cannot access Management Reports
    const deniedReport = router.dispatch('GET', '/api/reports/stock_valuation', {
      authorization: `Bearer ${kyaliToken}`,
    });
    expect(deniedReport.status).toBe(403);

    // Procurement Manager can view suppliers
    const supRes = router.dispatch('GET', '/api/suppliers', {
      authorization: `Bearer ${procToken}`,
    });
    expect(supRes.status).toBe(200);
  });

  it('records GRN stock intake, prevents negative stock issues, and generates CSV reports', () => {
    const adminToken = loginLocal('admin', 'Admin@2026');
    const authHeaders = { authorization: `Bearer ${adminToken}` };

    const invBefore = router.dispatch('GET', '/api/inventory?branch_id=1&limit=5', authHeaders);
    expect(invBefore.status).toBe(200);
    const firstItem = (invBefore.body as { items: Array<{ product_id: number; quantity_on_hand: number; unit_cost: number }> }).items[0];
    expect(firstItem).toBeTruthy();

    // Record GRN (+5 units)
    const grnRes = router.dispatch(
      'POST',
      '/api/grns',
      authHeaders,
      {
        branch_id: 1,
        supplier_id: 1,
        date_received: '2026-11-22',
        delivery_note_number: 'DN-LOCAL-100',
        notes: 'Browser DB GRN check',
        items: [
          {
            product_id: firstItem.product_id,
            quantity_received: 5,
            unit_cost: firstItem.unit_cost,
          },
        ],
      }
    );
    expect(grnRes.status).toBe(201);

    // Verify negative stock is rejected
    const badIssue = router.dispatch(
      'POST',
      '/api/stock-issues',
      authHeaders,
      {
        branch_id: 1,
        issue_type: 'damage',
        issue_date: '2026-11-22',
        reason: 'Overflow test',
        items: [
          {
            product_id: firstItem.product_id,
            quantity: firstItem.quantity_on_hand + 500,
          },
        ],
      }
    );
    expect(badIssue.status).toBe(422);

    // Verify CSV report generation
    const csvRes = router.dispatch('GET', '/api/reports/stock_valuation/csv?branch_id=1', authHeaders);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(typeof csvRes.body).toBe('string');
    expect((csvRes.body as string).length).toBeGreaterThan(20);
  });

  it('supports binary SQLite snapshot export and restore round-trip', () => {
    const exportedBytes = rawDb.export();
    expect(exportedBytes.byteLength).toBeGreaterThan(10000);

    const restoredRaw = new SQL.Database(exportedBytes);
    restoredRaw.exec('PRAGMA foreign_keys = ON;');
    const restoredAdapter = createSqlJsAdapter(restoredRaw);
    const restoredRouter = buildLocalRouter(restoredAdapter);

    const adminToken = loginLocal('admin', 'Admin@2026', restoredRouter);
    const grnList = restoredRouter.dispatch('GET', '/api/grns?search=DN-LOCAL-100', {
      authorization: `Bearer ${adminToken}`,
    });
    expect(grnList.status).toBe(200);
    expect((grnList.body as { grns: unknown[] }).grns.length).toBe(1);
    restoredRaw.close();
  });
});
