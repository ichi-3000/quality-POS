import initSqlJs from 'sql.js';
import type { DbInstance } from '../../server/db/types';
import { runMigrations } from '../../server/db/migrations';
import { seedDatabase } from '../../server/db/seed';
import { createSqlJsAdapter } from './sqliteAdapter';
import {
  broadcastDbUpdate,
  clearDbSnapshot,
  loadDbSnapshot,
  saveDbSnapshot,
  subscribeDbSync,
} from './indexedDbStore';

type SqlJsStatic = initSqlJs.SqlJsStatic;
type SqlJsDatabase = initSqlJs.Database;

let sqlJsStaticPromise: Promise<SqlJsStatic> | null = null;
let activeRawDb: SqlJsDatabase | null = null;
let activeDbAdapter: DbInstance | null = null;
let initPromise: Promise<DbInstance> | null = null;
let syncSubscribed = false;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsStaticPromise) {
    const loader =
      typeof initSqlJs === 'function'
        ? initSqlJs
        : (initSqlJs as unknown as { default: typeof initSqlJs }).default;
    sqlJsStaticPromise = loader({
      locateFile: () => '/sql-wasm.wasm',
      useOldExtensionFunctions: false,
    });
  }
  return sqlJsStaticPromise;
}

function attachExternalSyncListener() {
  if (syncSubscribed) return;
  syncSubscribed = true;
  subscribeDbSync(() => {
    // Reload snapshot cleanly when a sibling tab persists a newer snapshot
    void reloadFromIndexedDb();
  });
}

async function reloadFromIndexedDb(): Promise<void> {
  const bytes = await loadDbSnapshot();
  if (!bytes || bytes.byteLength === 0) return;
  try {
    const SQL = await getSqlJs();
    const nextRaw = new SQL.Database(bytes);
    nextRaw.exec('PRAGMA foreign_keys = ON;');
    const nextAdapter = createSqlJsAdapter(nextRaw);
    runMigrations(nextAdapter);
    const prevRaw = activeRawDb;
    activeRawDb = nextRaw;
    activeDbAdapter = nextAdapter;
    prevRaw?.close();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('qsims:db-updated'));
    }
  } catch {
    // Ignore corrupt external snapshot
  }
}

async function initializeBrowserDb(): Promise<DbInstance> {
  attachExternalSyncListener();
  const SQL = await getSqlJs();
  const snapshot = await loadDbSnapshot();

  if (snapshot && snapshot.byteLength > 0) {
    try {
      const raw = new SQL.Database(snapshot);
      raw.exec('PRAGMA foreign_keys = ON;');
      const adapter = createSqlJsAdapter(raw);
      runMigrations(adapter);
      // Verify core tables contain expected seed structure
      const userCountRow = adapter
        .prepare('SELECT COUNT(*) AS cnt FROM users')
        .get() as { cnt: number } | undefined;
      if (userCountRow && Number(userCountRow.cnt) > 0) {
        activeRawDb = raw;
        activeDbAdapter = adapter;
        return adapter;
      }
      raw.close();
    } catch {
      // Fall through to fresh initialization if snapshot is invalid
    }
  }

  const freshRaw = new SQL.Database();
  freshRaw.exec('PRAGMA foreign_keys = ON;');
  const freshAdapter = createSqlJsAdapter(freshRaw);
  runMigrations(freshAdapter);
  seedDatabase(freshAdapter);

  activeRawDb = freshRaw;
  activeDbAdapter = freshAdapter;

  await saveDbSnapshot(freshRaw.export());
  return freshAdapter;
}

export async function getBrowserDb(): Promise<DbInstance> {
  if (activeDbAdapter) {
    return activeDbAdapter;
  }
  if (!initPromise) {
    initPromise = initializeBrowserDb().finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

export async function persistBrowserDb(): Promise<void> {
  if (!activeRawDb) return;
  const bytes = activeRawDb.export();
  await saveDbSnapshot(bytes);
  broadcastDbUpdate();
}

export async function exportBrowserDbBytes(): Promise<Uint8Array> {
  await getBrowserDb();
  if (!activeRawDb) {
    throw new Error('Browser database is not initialized');
  }
  return activeRawDb.export();
}

export async function importBrowserDbBytes(bytes: Uint8Array): Promise<void> {
  if (!bytes || bytes.byteLength < 100) {
    throw new Error('Selected file is not a valid QS-IMS SQLite database backup');
  }
  const SQL = await getSqlJs();
  let candidateRaw: SqlJsDatabase | null = null;
  try {
    candidateRaw = new SQL.Database(bytes);
    candidateRaw.exec('PRAGMA foreign_keys = ON;');
    const candidateAdapter = createSqlJsAdapter(candidateRaw);

    const tables = candidateAdapter
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map((t) => t.name));
    const required = ['roles', 'branches', 'users', 'products', 'stocks', 'inventory_transactions'];
    for (const reqTable of required) {
      if (!tableNames.has(reqTable)) {
        throw new Error(`Backup file is missing required QS-IMS table "${reqTable}"`);
      }
    }

    runMigrations(candidateAdapter);
    const prevRaw = activeRawDb;
    activeRawDb = candidateRaw;
    activeDbAdapter = candidateAdapter;
    candidateRaw = null;
    prevRaw?.close();

    await saveDbSnapshot(activeRawDb.export());
    broadcastDbUpdate();
  } catch (err) {
    candidateRaw?.close();
    throw err instanceof Error ? err : new Error('Failed to restore SQLite backup');
  }
}

export async function resetBrowserDb(): Promise<void> {
  const SQL = await getSqlJs();
  const freshRaw = new SQL.Database();
  freshRaw.exec('PRAGMA foreign_keys = ON;');
  const freshAdapter = createSqlJsAdapter(freshRaw);
  runMigrations(freshAdapter);
  seedDatabase(freshAdapter);

  const prevRaw = activeRawDb;
  activeRawDb = freshRaw;
  activeDbAdapter = freshAdapter;
  prevRaw?.close();

  await clearDbSnapshot();
  await saveDbSnapshot(freshRaw.export());
  broadcastDbUpdate();
}
