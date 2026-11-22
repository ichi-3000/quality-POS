import type { DbInstance } from '../db/types.ts';
import type { AppNextFunction, AppRequest, AppResponse } from '../httpTypes.ts';
import { recordAuditLog } from '../services/auditService.ts';
import {
  getSessionSecret,
  hmacSha256Hex,
  pbkdf2Sha256Hex,
  randomHex,
  timingSafeEqualHex,
} from '../utils/crypto.ts';

export type RoleSlug = 'admin' | 'procurement_manager' | 'branch_manager' | 'stock_controller';

export interface AuthUser {
  id: number;
  full_name: string;
  username: string;
  email: string;
  phone: string;
  role: RoleSlug;
  role_name: string;
  branch_id: number | null;
  branch_code: string | null;
  branch_name: string | null;
  status: 'active' | 'inactive';
}

export interface AuthenticatedRequest extends AppRequest {
  user?: AuthUser;
  sessionTokenHash?: string;
}

export class AppError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function hashPassword(password: string): string {
  const salt = randomHex(16);
  const derived = pbkdf2Sha256Hex(password, salt);
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const actualHex = pbkdf2Sha256Hex(password, salt);
  return timingSafeEqualHex(actualHex, expectedHex);
}

export function hashSessionToken(token: string): string {
  return hmacSha256Hex(getSessionSecret(), token);
}

export function generateSessionToken(): string {
  return randomHex(32);
}

export function isGlobalRole(role: RoleSlug): boolean {
  return role === 'admin' || role === 'procurement_manager';
}

export function createAuthMiddleware(db: DbInstance) {
  return function requireAuth(req: AuthenticatedRequest, res: AppResponse, next: AppNextFunction): void {
    const rawHeader = req.headers.authorization;
    const authHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const tokenHash = hashSessionToken(token);
    const row = db
      .prepare(
        `SELECT s.expires_at,
                u.id, u.full_name, u.username, u.email, u.phone, u.branch_id, u.status,
                r.slug AS role, r.name AS role_name,
                b.code AS branch_code, b.name AS branch_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN branches b ON b.id = u.branch_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash) as (AuthUser & { expires_at: string }) | undefined;

    if (!row) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      res.status(401).json({ error: 'Session expired. Please sign in again.' });
      return;
    }

    if (row.status !== 'active') {
      res.status(403).json({ error: 'User account is deactivated' });
      return;
    }

    req.user = {
      id: row.id,
      full_name: row.full_name,
      username: row.username,
      email: row.email,
      phone: row.phone,
      role: row.role,
      role_name: row.role_name,
      branch_id: row.branch_id,
      branch_code: row.branch_code,
      branch_name: row.branch_name,
      status: row.status,
    };
    req.sessionTokenHash = tokenHash;
    next();
  };
}

export function requireRoles(db: DbInstance, ...allowedRoles: RoleSlug[]) {
  return function roleGuard(req: AuthenticatedRequest, res: AppResponse, next: AppNextFunction): void {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!allowedRoles.includes(user.role)) {
      recordAuditLog(db, {
        userId: user.id,
        action: 'unauthorized_role_access',
        entityType: 'route',
        entityId: `${req.method} ${req.originalUrl}`,
        branchId: user.branch_id,
        metadata: { required_roles: allowedRoles, actual_role: user.role },
        ipAddress: req.ip || '',
      });
      res.status(403).json({ error: 'You do not have permission to perform this action' });
      return;
    }
    next();
  };
}

export function resolveScopedBranchId(
  db: DbInstance,
  user: AuthUser,
  requestedBranchId: unknown,
  req?: AppRequest
): number | null {
  if (isGlobalRole(user.role)) {
    if (
      requestedBranchId === undefined ||
      requestedBranchId === null ||
      requestedBranchId === '' ||
      requestedBranchId === 'all'
    ) {
      return null;
    }
    const parsed = Number(requestedBranchId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new AppError(400, 'Invalid branch ID');
    }
    return parsed;
  }

  if (!user.branch_id) {
    throw new AppError(403, 'User is not assigned to any branch');
  }

  if (
    requestedBranchId !== undefined &&
    requestedBranchId !== null &&
    requestedBranchId !== '' &&
    requestedBranchId !== 'all'
  ) {
    const parsed = Number(requestedBranchId);
    if (!Number.isInteger(parsed) || parsed !== user.branch_id) {
      recordAuditLog(db, {
        userId: user.id,
        action: 'unauthorized_branch_access',
        entityType: 'branch',
        entityId: String(requestedBranchId),
        branchId: user.branch_id,
        metadata: {
          attempted_branch_id: requestedBranchId,
          assigned_branch_id: user.branch_id,
          path: req?.originalUrl || '',
        },
        ipAddress: req?.ip || '',
      });
      throw new AppError(403, 'Branch access denied: you may only access your assigned branch');
    }
  }

  return user.branch_id;
}

export function assertBranchWriteAccess(
  db: DbInstance,
  user: AuthUser,
  targetBranchId: number,
  req?: AppRequest
): void {
  if (!Number.isInteger(targetBranchId) || targetBranchId <= 0) {
    throw new AppError(400, 'Valid branch ID is required');
  }
  const branch = db.prepare('SELECT id, status FROM branches WHERE id = ?').get(targetBranchId) as
    | { id: number; status: string }
    | undefined;
  if (!branch) {
    throw new AppError(404, 'Branch not found');
  }
  if (branch.status !== 'active') {
    throw new AppError(422, 'Selected branch is inactive');
  }

  if (!isGlobalRole(user.role)) {
    if (!user.branch_id || user.branch_id !== targetBranchId) {
      recordAuditLog(db, {
        userId: user.id,
        action: 'unauthorized_branch_write',
        entityType: 'branch',
        entityId: String(targetBranchId),
        branchId: user.branch_id,
        metadata: {
          attempted_branch_id: targetBranchId,
          assigned_branch_id: user.branch_id,
          path: req?.originalUrl || '',
        },
        ipAddress: req?.ip || '',
      });
      throw new AppError(403, 'Branch access denied: cannot modify another branch inventory');
    }
  }
}
