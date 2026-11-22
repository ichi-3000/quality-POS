import type initSqlJs from 'sql.js';
import type { DbInstance, DbRunResult, DbStatement } from '../../server/db/types';

type SqlJsDatabase = initSqlJs.Database;
type SqlValue = initSqlJs.SqlValue;

function normalizeParams(params: unknown[]): SqlValue[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'bigint') return Number(p);
    if (p instanceof Uint8Array) return p;
    if (typeof p === 'number' || typeof p === 'string') return p;
    return String(p);
  });
}

export function createSqlJsAdapter(rawDb: SqlJsDatabase): DbInstance {
  return {
    exec(sql: string): void {
      rawDb.exec(sql);
    },

    prepare(sql: string): DbStatement {
      return {
        get(...params: unknown[]): unknown {
          const stmt = rawDb.prepare(sql);
          try {
            if (params.length > 0) {
              stmt.bind(normalizeParams(params));
            }
            if (stmt.step()) {
              return stmt.getAsObject();
            }
            return undefined;
          } finally {
            stmt.free();
          }
        },

        all(...params: unknown[]): unknown[] {
          const stmt = rawDb.prepare(sql);
          const rows: unknown[] = [];
          try {
            if (params.length > 0) {
              stmt.bind(normalizeParams(params));
            }
            while (stmt.step()) {
              rows.push(stmt.getAsObject());
            }
            return rows;
          } finally {
            stmt.free();
          }
        },

        run(...params: unknown[]): DbRunResult {
          const stmt = rawDb.prepare(sql);
          try {
            if (params.length > 0) {
              stmt.bind(normalizeParams(params));
            }
            stmt.step();
          } finally {
            stmt.free();
          }
          const changes = rawDb.getRowsModified();
          const rowIdRes = rawDb.exec('SELECT last_insert_rowid() AS id');
          const lastInsertRowid = Number(rowIdRes[0]?.values?.[0]?.[0] ?? 0);
          return {
            lastInsertRowid,
            changes,
          };
        },
      };
    },
  };
}
