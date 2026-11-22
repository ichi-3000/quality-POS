import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runInTransaction, type DbInstance } from './types.ts';

export { runInTransaction, type DbInstance };

let sharedDb: DbInstance | null = null;

export function createDatabase(dbPath?: string): DbInstance {
  const resolvedPath =
    dbPath || process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'qsims.sqlite');

  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(resolvedPath) as unknown as DbInstance;
  db.exec('PRAGMA foreign_keys = ON;');
  if (resolvedPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export function getDatabase(): DbInstance {
  if (!sharedDb) {
    sharedDb = createDatabase();
  }
  return sharedDb;
}
