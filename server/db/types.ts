export interface DbRunResult {
  lastInsertRowid: number | bigint;
  changes: number | bigint;
}

export interface DbStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): DbRunResult;
}

export interface DbInstance {
  exec(sql: string): void;
  prepare(sql: string): DbStatement;
}

export function runInTransaction<T>(db: DbInstance, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure if already rolled back
    }
    throw err;
  }
}
