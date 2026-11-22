import type { DbInstance } from './db/types.ts';
import { runInTransaction } from './db/types.ts';
import type {
  AppNextFunction as NextFunction,
  AppRequest as Request,
  AppResponse as Response,
  HttpApp,
} from './httpTypes.ts';
import {
  AppError,
  createAuthMiddleware,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  isGlobalRole,
  requireRoles,
  resolveScopedBranchId,
  verifyPassword,
  type AuthenticatedRequest,
} from './middleware/auth.ts';
import { recordAuditLog } from './services/auditService.ts';
import { getDashboardData } from './services/dashboardService.ts';
import { createStockIntake, getGrnById } from './services/grnService.ts';
import {
  computeShortfall,
  computeStockStatus,
  computeStockValue,
  computeSuggestedReplenishment,
} from './services/inventoryMath.ts';
import { createStockIssue, getIssueById } from './services/issueService.ts';
import { createProduct, deleteProductSafely, updateProduct } from './services/productService.ts';
import {
  createPurchaseOrder,
  getPurchaseOrderById,
  updateDraftPurchaseOrder,
  updatePurchaseOrderStatus,
} from './services/purchaseOrderService.ts';
import { generateReport } from './services/reportService.ts';
import {
  createTransfer,
  getTransferById,
  receiveTransfer,
  transitionTransferStatus,
} from './services/transferService.ts';

function toPositiveInt(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function escapeCsvCell(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function registerRoutes(app: HttpApp, db: DbInstance): void {
  const requireAuth = createAuthMiddleware(db);

  // Simple in-memory rate limiter for login attempts
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();

  // ==========================================
  // AUTHENTICATION ROUTES
  // ==========================================
  app.post('/api/auth/login', (req: Request, res: Response, next: NextFunction) => {
    try {
      const identifier = String(req.body?.username || req.body?.email || '').trim();
      const password = String(req.body?.password || '');
      if (!identifier || !password) {
        throw new AppError(400, 'Username/email and password are required');
      }

      const key = `${req.ip || 'local'}:${identifier.toLowerCase()}`;
      const now = Date.now();
      const attempt = loginAttempts.get(key);
      if (attempt && attempt.resetAt > now && attempt.count >= 20) {
        throw new AppError(429, 'Too many failed login attempts. Please wait a few minutes.');
      }

      const userRow = db
        .prepare(
          `SELECT u.*, r.slug AS role, r.name AS role_name,
                  b.code AS branch_code, b.name AS branch_name
           FROM users u
           JOIN roles r ON r.id = u.role_id
           LEFT JOIN branches b ON b.id = u.branch_id
           WHERE lower(u.username) = lower(?) OR lower(u.email) = lower(?)`
        )
        .get(identifier, identifier) as
        | {
            id: number;
            full_name: string;
            username: string;
            email: string;
            phone: string;
            password_hash: string;
            role: 'admin' | 'procurement_manager' | 'branch_manager' | 'stock_controller';
            role_name: string;
            branch_id: number | null;
            branch_code: string | null;
            branch_name: string | null;
            status: 'active' | 'inactive';
          }
        | undefined;

      if (!userRow || !verifyPassword(password, userRow.password_hash)) {
        const cur = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + 15 * 60_000 };
        cur.count += 1;
        loginAttempts.set(key, cur);
        recordAuditLog(db, {
          userId: userRow?.id ?? null,
          action: 'login_failed',
          entityType: 'auth',
          entityId: identifier,
          branchId: userRow?.branch_id ?? null,
          ipAddress: req.ip || '',
        });
        throw new AppError(401, 'Invalid username or password');
      }

      if (userRow.status !== 'active') {
        throw new AppError(403, 'Your account has been deactivated. Contact an Administrator.');
      }

      loginAttempts.delete(key);
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

      db.prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?)`
      ).run(tokenHash, userRow.id, expiresAt, req.ip || '', String(req.headers['user-agent'] || '').slice(0, 200));

      db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(userRow.id);

      recordAuditLog(db, {
        userId: userRow.id,
        action: 'login',
        entityType: 'session',
        entityId: userRow.id,
        branchId: userRow.branch_id,
        metadata: { username: userRow.username, role: userRow.role },
        ipAddress: req.ip || '',
      });

      res.json({
        token,
        expiresAt,
        user: {
          id: userRow.id,
          full_name: userRow.full_name,
          username: userRow.username,
          email: userRow.email,
          phone: userRow.phone,
          role: userRow.role,
          role_name: userRow.role_name,
          branch_id: userRow.branch_id,
          branch_code: userRow.branch_code,
          branch_name: userRow.branch_name,
          status: userRow.status,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    if (req.sessionTokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
    }
    if (req.user) {
      recordAuditLog(db, {
        userId: req.user.id,
        action: 'logout',
        entityType: 'session',
        entityId: req.user.id,
        branchId: req.user.branch_id,
        ipAddress: req.ip || '',
      });
    }
    res.json({ message: 'Logged out successfully' });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const currentPassword = String(req.body?.current_password || '');
      const newPassword = String(req.body?.new_password || '');
      if (newPassword.length < 8) {
        throw new AppError(400, 'New password must be at least 8 characters');
      }
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
      if (!verifyPassword(currentPassword, row.password_hash)) {
        throw new AppError(400, 'Current password is incorrect');
      }
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
        hashPassword(newPassword),
        user.id
      );
      recordAuditLog(db, {
        userId: user.id,
        action: 'password_changed',
        entityType: 'user',
        entityId: user.id,
        branchId: user.branch_id,
        ipAddress: req.ip || '',
      });
      res.json({ message: 'Password updated successfully' });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // DASHBOARD & GLOBAL SEARCH
  // ==========================================
  app.get('/api/dashboard', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const scopedBranchId = resolveScopedBranchId(db, user, req.query.branch_id, req);
      const dateFrom = typeof req.query.date_from === 'string' ? req.query.date_from : undefined;
      const dateTo = typeof req.query.date_to === 'string' ? req.query.date_to : undefined;
      const data = getDashboardData(db, user, scopedBranchId, dateFrom, dateTo);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/search', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const q = String(req.query.q || '').trim();
      if (!q) {
        res.json({ products: [], suppliers: [], purchase_orders: [], transfers: [] });
        return;
      }
      const like = `%${q}%`;
      const products = db
        .prepare(
          `SELECT p.id, p.sku, p.name, c.name AS category_name, p.unit_cost
           FROM products p JOIN categories c ON c.id = p.category_id
           WHERE p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?
           LIMIT 6`
        )
        .all(like, like, like);

      const suppliers = isGlobalRole(user.role)
        ? db
            .prepare(
              `SELECT id, supplier_code, name, contact_person
               FROM suppliers WHERE name LIKE ? OR supplier_code LIKE ? LIMIT 5`
            )
            .all(like, like)
        : [];

      const scopedBranch = isGlobalRole(user.role) ? null : user.branch_id;
      const poRows = scopedBranch
        ? db
            .prepare(
              `SELECT id, po_number, status, order_date FROM purchase_orders
               WHERE branch_id = ? AND po_number LIKE ? LIMIT 5`
            )
            .all(scopedBranch, like)
        : db
            .prepare(
              `SELECT id, po_number, status, order_date FROM purchase_orders
               WHERE po_number LIKE ? LIMIT 5`
            )
            .all(like);

      const trfRows = scopedBranch
        ? db
            .prepare(
              `SELECT id, transfer_number, status FROM stock_transfers
               WHERE (source_branch_id = ? OR destination_branch_id = ?) AND transfer_number LIKE ? LIMIT 5`
            )
            .all(scopedBranch, scopedBranch, like)
        : db
            .prepare(
              `SELECT id, transfer_number, status FROM stock_transfers
               WHERE transfer_number LIKE ? LIMIT 5`
            )
            .all(like);

      res.json({ products, suppliers, purchase_orders: poRows, transfers: trfRows });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // BRANCHES & ROLES
  // ==========================================
  app.get('/api/branches', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const branches = db.prepare('SELECT * FROM branches ORDER BY id ASC').all();
    res.json({ branches });
  });

  app.put(
    '/api/branches/:id',
    requireAuth,
    requireRoles(db, 'admin'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const id = Number(req.params.id);
        const existing = db.prepare('SELECT * FROM branches WHERE id = ?').get(id) as
          | Record<string, string | number | null>
          | undefined;
        if (!existing) throw new AppError(404, 'Branch not found');

        db.prepare(
          `UPDATE branches
           SET name = ?, location = ?, contact_phone = ?, contact_email = ?, manager_name = ?, status = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          req.body?.name ?? existing.name,
          req.body?.location ?? existing.location,
          req.body?.contact_phone ?? existing.contact_phone,
          req.body?.contact_email ?? existing.contact_email,
          req.body?.manager_name ?? existing.manager_name,
          req.body?.status ?? existing.status,
          id
        );

        recordAuditLog(db, {
          userId: req.user!.id,
          action: 'branch_updated',
          entityType: 'branch',
          entityId: id,
          branchId: id,
          ipAddress: req.ip || '',
        });

        res.json({ branch: db.prepare('SELECT * FROM branches WHERE id = ?').get(id) });
      } catch (err) {
        next(err);
      }
    }
  );

  app.get('/api/roles', requireAuth, requireRoles(db, 'admin'), (_req: Request, res: Response) => {
    const roles = db.prepare('SELECT * FROM roles ORDER BY id ASC').all();
    res.json({ roles });
  });

  // ==========================================
  // CATEGORIES
  // ==========================================
  app.get('/api/categories', requireAuth, (_req: Request, res: Response) => {
    const categories = db
      .prepare(
        `SELECT c.*, COUNT(p.id) AS product_count
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.id
         GROUP BY c.id
         ORDER BY c.name ASC`
      )
      .all();
    res.json({ categories });
  });

  app.post(
    '/api/categories',
    requireAuth,
    requireRoles(db, 'admin', 'procurement_manager'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const name = String(req.body?.name || '').trim();
        const code = String(req.body?.code || '').trim().toUpperCase();
        const description = String(req.body?.description || '').trim();
        if (!name || !code) throw new AppError(400, 'Category name and code are required');
        const dup = db
          .prepare('SELECT id FROM categories WHERE lower(name) = lower(?) OR code = ?')
          .get(name, code);
        if (dup) throw new AppError(409, 'Category name or code already exists');

        const result = db
          .prepare('INSERT INTO categories (name, code, description) VALUES (?, ?, ?)')
          .run(name, code, description);
        const id = Number(result.lastInsertRowid);
        recordAuditLog(db, {
          userId: req.user!.id,
          action: 'category_created',
          entityType: 'category',
          entityId: id,
          metadata: { name, code },
          ipAddress: req.ip || '',
        });
        res.status(201).json({ category: db.prepare('SELECT * FROM categories WHERE id = ?').get(id) });
      } catch (err) {
        next(err);
      }
    }
  );

  app.put(
    '/api/categories/:id',
    requireAuth,
    requireRoles(db, 'admin', 'procurement_manager'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const id = Number(req.params.id);
        const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as
          | { id: number; name: string; code: string; description: string; status: string }
          | undefined;
        if (!existing) throw new AppError(404, 'Category not found');

        const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
        const code =
          req.body?.code !== undefined ? String(req.body.code).trim().toUpperCase() : existing.code;
        const description =
          req.body?.description !== undefined
            ? String(req.body.description).trim()
            : existing.description;
        const status = req.body?.status !== undefined ? String(req.body.status) : existing.status;

        db.prepare(
          `UPDATE categories SET name = ?, code = ?, description = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(name, code, description, status, id);

        recordAuditLog(db, {
          userId: req.user!.id,
          action: 'category_updated',
          entityType: 'category',
          entityId: id,
          metadata: { name, code, status },
          ipAddress: req.ip || '',
        });
        res.json({ category: db.prepare('SELECT * FROM categories WHERE id = ?').get(id) });
      } catch (err) {
        next(err);
      }
    }
  );

  // ==========================================
  // PRODUCTS
  // ==========================================
  app.get('/api/products', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const search = String(req.query.search || '').trim();
      const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
      const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
      const page = toPositiveInt(req.query.page, 1);
      const limit = Math.min(100, toPositiveInt(req.query.limit, 20));
      const offset = (page - 1) * limit;

      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];
      if (search) {
        conds.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR c.name LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like, like);
      }
      if (categoryId) {
        conds.push('p.category_id = ?');
        params.push(categoryId);
      }
      if (status) {
        conds.push('p.status = ?');
        params.push(status);
      }

      const totalRow = db
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM products p
           JOIN categories c ON c.id = p.category_id
           WHERE ${conds.join(' AND ')}`
        )
        .get(...params) as { cnt: number };

      const scopedBranch = isGlobalRole(user.role) ? null : user.branch_id;
      const stockJoinCond = scopedBranch ? 'AND s.branch_id = ?' : '';
      const stockParams = scopedBranch ? [scopedBranch] : [];

      const products = db
        .prepare(
          `SELECT p.*, c.name AS category_name, sup.name AS preferred_supplier_name,
                  COALESCE(SUM(s.quantity_on_hand), 0) AS total_stock,
                  COALESCE(SUM(s.quantity_on_hand * p.unit_cost), 0) AS total_stock_value
           FROM products p
           JOIN categories c ON c.id = p.category_id
           LEFT JOIN suppliers sup ON sup.id = p.preferred_supplier_id
           LEFT JOIN stocks s ON s.product_id = p.id ${stockJoinCond}
           WHERE ${conds.join(' AND ')}
           GROUP BY p.id
           ORDER BY p.name ASC
           LIMIT ? OFFSET ?`
        )
        .all(...stockParams, ...params, limit, offset);

      res.json({
        products,
        pagination: {
          page,
          limit,
          total: totalRow.cnt,
          totalPages: Math.max(1, Math.ceil(totalRow.cnt / limit)),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/products/:id', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const id = Number(req.params.id);
      const product = db
        .prepare(
          `SELECT p.*, c.name AS category_name, sup.name AS preferred_supplier_name
           FROM products p
           JOIN categories c ON c.id = p.category_id
           LEFT JOIN suppliers sup ON sup.id = p.preferred_supplier_id
           WHERE p.id = ?`
        )
        .get(id) as Record<string, unknown> | undefined;
      if (!product) throw new AppError(404, 'Product not found');

      const scopedBranch = isGlobalRole(user.role) ? null : user.branch_id;
      const branchStocks = db
        .prepare(
          `SELECT s.*, b.name AS branch_name, b.code AS branch_code
           FROM stocks s
           JOIN branches b ON b.id = s.branch_id
           WHERE s.product_id = ? ${scopedBranch ? 'AND s.branch_id = ?' : ''}
           ORDER BY b.id ASC`
        )
        .all(...(scopedBranch ? [id, scopedBranch] : [id])) as Array<{
        quantity_on_hand: number;
        branch_id: number;
        branch_name: string;
        branch_code: string;
        last_movement_at: string;
      }>;

      const enrichedStocks = branchStocks.map((bs) => ({
        ...bs,
        status: computeStockStatus(bs.quantity_on_hand, Number(product.reorder_level)),
        stock_value: computeStockValue(bs.quantity_on_hand, Number(product.unit_cost)),
      }));

      const movementHistory = db
        .prepare(
          `SELECT it.*, b.name AS branch_name, u.full_name AS user_name
           FROM inventory_transactions it
           JOIN branches b ON b.id = it.branch_id
           JOIN users u ON u.id = it.user_id
           WHERE it.product_id = ? ${scopedBranch ? 'AND it.branch_id = ?' : ''}
           ORDER BY it.id DESC
           LIMIT 30`
        )
        .all(...(scopedBranch ? [id, scopedBranch] : [id]));

      res.json({ product, branchStocks: enrichedStocks, movementHistory });
    } catch (err) {
      next(err);
    }
  });

  app.post(
    '/api/products',
    requireAuth,
    requireRoles(db, 'admin', 'procurement_manager'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const product = createProduct(db, req.body, req.user!.id, req.ip || '');
        res.status(201).json({ product });
      } catch (err) {
        next(err);
      }
    }
  );

  app.put(
    '/api/products/:id',
    requireAuth,
    requireRoles(db, 'admin', 'procurement_manager'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const product = updateProduct(db, Number(req.params.id), req.body, req.user!.id, req.ip || '');
        res.json({ product });
      } catch (err) {
        next(err);
      }
    }
  );

  app.delete(
    '/api/products/:id',
    requireAuth,
    requireRoles(db, 'admin'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        deleteProductSafely(db, Number(req.params.id), req.user!.id, req.ip || '');
        res.json({ message: 'Product deleted' });
      } catch (err) {
        next(err);
      }
    }
  );

  // ==========================================
  // INVENTORY & LEDGER
  // ==========================================
  app.get('/api/inventory', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const scopedBranchId = resolveScopedBranchId(db, user, req.query.branch_id, req);
      const search = String(req.query.search || '').trim();
      const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
      const stockStatus = typeof req.query.status === 'string' ? req.query.status : '';
      const sortBy = req.query.sort === 'qty_asc' ? 's.quantity_on_hand ASC' : req.query.sort === 'qty_desc' ? 's.quantity_on_hand DESC' : req.query.sort === 'value_desc' ? '(s.quantity_on_hand * p.unit_cost) DESC' : 'p.name ASC, b.id ASC';
      const page = toPositiveInt(req.query.page, 1);
      const limit = Math.min(200, toPositiveInt(req.query.limit, 25));
      const offset = (page - 1) * limit;

      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];

      if (scopedBranchId) {
        conds.push('s.branch_id = ?');
        params.push(scopedBranchId);
      }
      if (search) {
        conds.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }
      if (categoryId) {
        conds.push('p.category_id = ?');
        params.push(categoryId);
      }
      if (stockStatus === 'out_of_stock') {
        conds.push('s.quantity_on_hand = 0');
      } else if (stockStatus === 'low_stock') {
        conds.push('s.quantity_on_hand > 0 AND s.quantity_on_hand <= p.reorder_level');
      } else if (stockStatus === 'in_stock') {
        conds.push('s.quantity_on_hand > p.reorder_level');
      }

      const totalRow = db
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM stocks s
           JOIN products p ON p.id = s.product_id
           WHERE ${conds.join(' AND ')}`
        )
        .get(...params) as { cnt: number };

      const rawRows = db
        .prepare(
          `SELECT s.id, s.product_id, s.branch_id, s.quantity_on_hand, s.last_movement_at, s.updated_at,
                  p.sku, p.name AS product_name, p.unit_of_measure, p.unit_cost, p.selling_price, p.reorder_level, p.status AS product_status,
                  c.name AS category_name, b.name AS branch_name, b.code AS branch_code
           FROM stocks s
           JOIN products p ON p.id = s.product_id
           JOIN categories c ON c.id = p.category_id
           JOIN branches b ON b.id = s.branch_id
           WHERE ${conds.join(' AND ')}
           ORDER BY ${sortBy}
           LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset) as Array<Record<string, unknown>>;

      const items = rawRows.map((r) => {
        const qty = Number(r.quantity_on_hand);
        const reorder = Number(r.reorder_level);
        const cost = Number(r.unit_cost);
        return {
          ...r,
          stock_status: computeStockStatus(qty, reorder),
          stock_value: computeStockValue(qty, cost),
          shortfall: computeShortfall(qty, reorder),
          suggested_replenishment: computeSuggestedReplenishment(qty, reorder),
        };
      });

      res.json({
        items,
        pagination: {
          page,
          limit,
          total: totalRow.cnt,
          totalPages: Math.max(1, Math.ceil(totalRow.cnt / limit)),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/inventory/ledger', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const scopedBranchId = resolveScopedBranchId(db, user, req.query.branch_id, req);
      const productId = req.query.product_id ? Number(req.query.product_id) : null;
      const txType = typeof req.query.transaction_type === 'string' && req.query.transaction_type ? req.query.transaction_type : null;
      const dateFrom = typeof req.query.date_from === 'string' && req.query.date_from ? req.query.date_from : null;
      const dateTo = typeof req.query.date_to === 'string' && req.query.date_to ? req.query.date_to : null;
      const page = toPositiveInt(req.query.page, 1);
      const limit = Math.min(100, toPositiveInt(req.query.limit, 25));
      const offset = (page - 1) * limit;

      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];

      if (scopedBranchId) {
        conds.push('it.branch_id = ?');
        params.push(scopedBranchId);
      }
      if (productId) {
        conds.push('it.product_id = ?');
        params.push(productId);
      }
      if (txType) {
        conds.push('it.transaction_type = ?');
        params.push(txType);
      }
      if (dateFrom) {
        conds.push("date(it.created_at) >= ?");
        params.push(dateFrom);
      }
      if (dateTo) {
        conds.push("date(it.created_at) <= ?");
        params.push(dateTo);
      }

      const totalRow = db
        .prepare(`SELECT COUNT(*) AS cnt FROM inventory_transactions it WHERE ${conds.join(' AND ')}`)
        .get(...params) as { cnt: number };

      const transactions = db
        .prepare(
          `SELECT it.*, p.sku, p.name AS product_name, b.name AS branch_name, b.code AS branch_code, u.full_name AS user_name
           FROM inventory_transactions it
           JOIN products p ON p.id = it.product_id
           JOIN branches b ON b.id = it.branch_id
           JOIN users u ON u.id = it.user_id
           WHERE ${conds.join(' AND ')}
           ORDER BY it.id DESC
           LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset);

      res.json({
        transactions,
        pagination: {
          page,
          limit,
          total: totalRow.cnt,
          totalPages: Math.max(1, Math.ceil(totalRow.cnt / limit)),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // SUPPLIERS
  // ==========================================
  app.get('/api/suppliers', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const search = String(req.query.search || '').trim();
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    const conds: string[] = ['1=1'];
    const params: Array<string | number> = [];
    if (search) {
      conds.push('(s.name LIKE ? OR s.supplier_code LIKE ? OR s.contact_person LIKE ? OR s.phone LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (status) {
      conds.push('s.status = ?');
      params.push(status);
    }

    const suppliers = db
      .prepare(
        `SELECT s.*,
                COUNT(DISTINCT gi.id) AS delivery_count,
                COUNT(DISTINCT po.id) AS po_count,
                COUNT(DISTINCT p.id) AS supplied_product_count
         FROM suppliers s
         LEFT JOIN stock_intakes gi ON gi.supplier_id = s.id
         LEFT JOIN purchase_orders po ON po.supplier_id = s.id
         LEFT JOIN products p ON p.preferred_supplier_id = s.id
         WHERE ${conds.join(' AND ')}
         GROUP BY s.id
         ORDER BY s.name ASC`
      )
      .all(...params);
    res.json({ suppliers });
  });

  app.get('/api/suppliers/:id', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
      if (!supplier) throw new AppError(404, 'Supplier not found');

      const products = db
        .prepare(
          `SELECT p.id, p.sku, p.name, p.unit_cost, c.name AS category_name
           FROM products p JOIN categories c ON c.id = p.category_id
           WHERE p.preferred_supplier_id = ?`
        )
        .all(id);

      const user = req.user!;
      const scopedBranch = isGlobalRole(user.role) ? null : user.branch_id;
      const purchaseOrders = db
        .prepare(
          `SELECT po.*, b.name AS branch_name
           FROM purchase_orders po JOIN branches b ON b.id = po.branch_id
           WHERE po.supplier_id = ? ${scopedBranch ? 'AND po.branch_id = ?' : ''}
           ORDER BY po.id DESC LIMIT 20`
        )
        .all(...(scopedBranch ? [id, scopedBranch] : [id]));

      const deliveries = db
        .prepare(
          `SELECT gi.*, b.name AS branch_name, u.full_name AS received_by_name
           FROM stock_intakes gi
           JOIN branches b ON b.id = gi.branch_id
           JOIN users u ON u.id = gi.received_by
           WHERE gi.supplier_id = ? ${scopedBranch ? 'AND gi.branch_id = ?' : ''}
           ORDER BY gi.id DESC LIMIT 20`
        )
        .all(...(scopedBranch ? [id, scopedBranch] : [id]));

      res.json({ supplier, products, purchaseOrders, deliveries });
    } catch (err) {
      next(err);
    }
  });

  app.post(
    '/api/suppliers',
    requireAuth,
    requireRoles(db, 'admin', 'procurement_manager'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const name = String(req.body?.name || '').trim();
        const code = String(req.body?.supplier_code || '').trim().toUpperCase();
        if (!name || !code) throw new AppError(400, 'Supplier name and code are required');
        const dup = db.prepare('SELECT id FROM suppliers WHERE supplier_code = ?').get(code);
        if (dup) throw new AppError(409, `Supplier code "${code}" already exists`);

        const result = db
          .prepare(
            `INSERT INTO suppliers (supplier_code, name, contact_person, phone, email, address, tin, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            code,
            name,
            String(req.body?.contact_person || '').trim(),
            String(req.body?.phone || '').trim(),
            String(req.body?.email || '').trim(),
            String(req.body?.address || '').trim(),
            String(req.body?.tin || '').trim(),
            String(req.body?.notes || '').trim()
          );
        const id = Number(result.lastInsertRowid);
        recordAuditLog(db, {
          userId: req.user!.id,
          action: 'supplier_created',
          entityType: 'supplier',
          entityId: id,
          metadata: { supplier_code: code, name },
          ipAddress: req.ip || '',
        });
        res.status(201).json({ supplier: db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) });
      } catch (err) {
        next(err);
      }
    }
  );

  app.put(
    '/api/suppliers/:id',
    requireAuth,
    requireRoles(db, 'admin', 'procurement_manager'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const id = Number(req.params.id);
        const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as
          | Record<string, string | number | null>
          | undefined;
        if (!existing) throw new AppError(404, 'Supplier not found');

        db.prepare(
          `UPDATE suppliers
           SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, tin = ?, notes = ?, status = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          req.body?.name !== undefined ? String(req.body.name).trim() : existing.name,
          req.body?.contact_person !== undefined ? String(req.body.contact_person).trim() : existing.contact_person,
          req.body?.phone !== undefined ? String(req.body.phone).trim() : existing.phone,
          req.body?.email !== undefined ? String(req.body.email).trim() : existing.email,
          req.body?.address !== undefined ? String(req.body.address).trim() : existing.address,
          req.body?.tin !== undefined ? String(req.body.tin).trim() : existing.tin,
          req.body?.notes !== undefined ? String(req.body.notes).trim() : existing.notes,
          req.body?.status !== undefined ? String(req.body.status) : existing.status,
          id
        );

        recordAuditLog(db, {
          userId: req.user!.id,
          action: 'supplier_updated',
          entityType: 'supplier',
          entityId: id,
          ipAddress: req.ip || '',
        });
        res.json({ supplier: db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) });
      } catch (err) {
        next(err);
      }
    }
  );

  // ==========================================
  // PURCHASE ORDERS
  // ==========================================
  app.get('/api/purchase-orders', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const scopedBranchId = resolveScopedBranchId(db, user, req.query.branch_id, req);
      const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
      const supplierId = req.query.supplier_id ? Number(req.query.supplier_id) : null;
      const search = String(req.query.search || '').trim();

      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];

      if (scopedBranchId) {
        conds.push('po.branch_id = ?');
        params.push(scopedBranchId);
      }
      if (status) {
        conds.push('po.status = ?');
        params.push(status);
      }
      if (supplierId) {
        conds.push('po.supplier_id = ?');
        params.push(supplierId);
      }
      if (search) {
        conds.push('(po.po_number LIKE ? OR s.name LIKE ? OR b.name LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }

      const purchaseOrders = db
        .prepare(
          `SELECT po.*, s.name AS supplier_name, s.supplier_code,
                  b.name AS branch_name, b.code AS branch_code,
                  u.full_name AS created_by_name,
                  (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.purchase_order_id = po.id) AS item_count
           FROM purchase_orders po
           JOIN suppliers s ON s.id = po.supplier_id
           JOIN branches b ON b.id = po.branch_id
           JOIN users u ON u.id = po.created_by
           WHERE ${conds.join(' AND ')}
           ORDER BY po.id DESC`
        )
        .all(...params);

      res.json({ purchaseOrders });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/purchase-orders/:id', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const po = getPurchaseOrderById(db, Number(req.params.id)) as Record<string, unknown> | null;
      if (!po) throw new AppError(404, 'Purchase Order not found');
      resolveScopedBranchId(db, req.user!, po.branch_id, req);
      res.json({ purchaseOrder: po });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/purchase-orders', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const po = createPurchaseOrder(db, req.body, req.user!, req.ip || '');
      res.status(201).json({ purchaseOrder: po });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/purchase-orders/:id', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const po = updateDraftPurchaseOrder(db, Number(req.params.id), req.body, req.user!, req.ip || '');
      res.json({ purchaseOrder: po });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/purchase-orders/:id/status', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const action = req.body?.action as 'send' | 'cancel';
      if (!['send', 'cancel'].includes(action)) {
        throw new AppError(400, 'Invalid action. Use send or cancel.');
      }
      const po = updatePurchaseOrderStatus(db, Number(req.params.id), action, req.user!, req.ip || '');
      res.json({ purchaseOrder: po });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // STOCK INTAKE / GRN
  // ==========================================
  app.get('/api/grns', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const scopedBranchId = resolveScopedBranchId(db, user, req.query.branch_id, req);
      const search = String(req.query.search || '').trim();
      const dateFrom = typeof req.query.date_from === 'string' && req.query.date_from ? req.query.date_from : null;
      const dateTo = typeof req.query.date_to === 'string' && req.query.date_to ? req.query.date_to : null;

      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];

      if (scopedBranchId) {
        conds.push('gi.branch_id = ?');
        params.push(scopedBranchId);
      }
      if (search) {
        conds.push('(gi.grn_number LIKE ? OR s.name LIKE ? OR gi.delivery_note_number LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }
      if (dateFrom) {
        conds.push('gi.date_received >= ?');
        params.push(dateFrom);
      }
      if (dateTo) {
        conds.push('gi.date_received <= ?');
        params.push(dateTo);
      }

      const grns = db
        .prepare(
          `SELECT gi.*, b.name AS branch_name, b.code AS branch_code,
                  s.name AS supplier_name, u.full_name AS received_by_name,
                  po.po_number,
                  (SELECT COUNT(*) FROM stock_intake_items gii WHERE gii.stock_intake_id = gi.id) AS item_count
           FROM stock_intakes gi
           JOIN branches b ON b.id = gi.branch_id
           JOIN suppliers s ON s.id = gi.supplier_id
           JOIN users u ON u.id = gi.received_by
           LEFT JOIN purchase_orders po ON po.id = gi.purchase_order_id
           WHERE ${conds.join(' AND ')}
           ORDER BY gi.id DESC`
        )
        .all(...params);

      res.json({ grns });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/grns/:id', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const grn = getGrnById(db, Number(req.params.id)) as Record<string, unknown> | null;
      if (!grn) throw new AppError(404, 'GRN not found');
      resolveScopedBranchId(db, req.user!, grn.branch_id, req);
      res.json({ grn });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/grns', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      if (user.role === 'procurement_manager') {
        // Procurement manager oversees POs, while branch staff/admin physically record GRNs;
        // still allow if they operate at Head Office or let's check prompt:
        // Prompt: Stock Controller records GRNs, Branch Manager supervises/records, Admin full access.
        // Procurement Manager reviews incoming stock.
        throw new AppError(403, 'Goods Received Notes must be recorded by Branch Staff or Administrator');
      }
      const branchId = isGlobalRole(user.role)
        ? Number(req.body?.branch_id)
        : resolveScopedBranchId(db, user, req.body?.branch_id ?? user.branch_id, req)!;
      const grn = createStockIntake(db, { ...req.body, branch_id: branchId }, user, req.ip || '');
      res.status(201).json({ grn });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // STOCK ISSUES
  // ==========================================
  app.get('/api/stock-issues', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const scopedBranchId = resolveScopedBranchId(db, user, req.query.branch_id, req);
      const issueType = typeof req.query.issue_type === 'string' && req.query.issue_type ? req.query.issue_type : null;
      const search = String(req.query.search || '').trim();
      const dateFrom = typeof req.query.date_from === 'string' && req.query.date_from ? req.query.date_from : null;
      const dateTo = typeof req.query.date_to === 'string' && req.query.date_to ? req.query.date_to : null;

      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];

      if (scopedBranchId) {
        conds.push('si.branch_id = ?');
        params.push(scopedBranchId);
      }
      if (issueType) {
        conds.push('si.issue_type = ?');
        params.push(issueType);
      }
      if (search) {
        conds.push('(si.issue_number LIKE ? OR si.reference_number LIKE ? OR si.reason LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }
      if (dateFrom) {
        conds.push('si.issue_date >= ?');
        params.push(dateFrom);
      }
      if (dateTo) {
        conds.push('si.issue_date <= ?');
        params.push(dateTo);
      }

      const issues = db
        .prepare(
          `SELECT si.*, b.name AS branch_name, b.code AS branch_code, u.full_name AS issued_by_name,
                  (SELECT COUNT(*) FROM stock_issue_items sii WHERE sii.stock_issue_id = si.id) AS item_count,
                  (SELECT COALESCE(SUM(sii.quantity), 0) FROM stock_issue_items sii WHERE sii.stock_issue_id = si.id) AS total_quantity
           FROM stock_issues si
           JOIN branches b ON b.id = si.branch_id
           JOIN users u ON u.id = si.issued_by
           WHERE ${conds.join(' AND ')}
           ORDER BY si.id DESC`
        )
        .all(...params);

      res.json({ issues });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/stock-issues/:id', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const issue = getIssueById(db, Number(req.params.id)) as Record<string, unknown> | null;
      if (!issue) throw new AppError(404, 'Stock issue not found');
      resolveScopedBranchId(db, req.user!, issue.branch_id, req);
      res.json({ issue });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/stock-issues', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      if (user.role === 'procurement_manager') {
        throw new AppError(403, 'Stock issues must be recorded by Branch Staff or Administrator');
      }
      const branchId = isGlobalRole(user.role)
        ? Number(req.body?.branch_id)
        : resolveScopedBranchId(db, user, req.body?.branch_id ?? user.branch_id, req)!;
      const issue = createStockIssue(db, { ...req.body, branch_id: branchId }, user, req.ip || '');
      res.status(201).json({ issue });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // INTER-BRANCH STOCK TRANSFERS
  // ==========================================
  app.get('/api/transfers', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const scopedBranchId = isGlobalRole(user.role) ? (req.query.branch_id ? Number(req.query.branch_id) : null) : user.branch_id;
      const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
      const search = String(req.query.search || '').trim();

      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];
      if (scopedBranchId) {
        conds.push('(st.source_branch_id = ? OR st.destination_branch_id = ?)');
        params.push(scopedBranchId, scopedBranchId);
      }
      if (status) {
        conds.push('st.status = ?');
        params.push(status);
      }
      if (search) {
        conds.push('(st.transfer_number LIKE ? OR sb.name LIKE ? OR db.name LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }

      const transfers = db
        .prepare(
          `SELECT st.*,
                  sb.name AS source_branch_name, sb.code AS source_branch_code,
                  db.name AS destination_branch_name, db.code AS destination_branch_code,
                  ru.full_name AS requested_by_name,
                  (SELECT COUNT(*) FROM stock_transfer_items sti WHERE sti.stock_transfer_id = st.id) AS item_count
           FROM stock_transfers st
           JOIN branches sb ON sb.id = st.source_branch_id
           JOIN branches db ON db.id = st.destination_branch_id
           JOIN users ru ON ru.id = st.requested_by
           WHERE ${conds.join(' AND ')}
           ORDER BY st.id DESC`
        )
        .all(...params);

      res.json({ transfers });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/transfers/:id', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const trf = getTransferById(db, Number(req.params.id)) as Record<string, unknown> | null;
      if (!trf) throw new AppError(404, 'Stock transfer not found');
      if (
        !isGlobalRole(user.role) &&
        user.branch_id !== trf.source_branch_id &&
        user.branch_id !== trf.destination_branch_id
      ) {
        throw new AppError(403, 'Branch access denied for this stock transfer');
      }
      res.json({ transfer: trf });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/transfers', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const transfer = createTransfer(db, req.body, req.user!, req.ip || '');
      res.status(201).json({ transfer });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/transfers/:id/transition', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const action = req.body?.action as 'submit' | 'approve' | 'reject' | 'cancel' | 'dispatch';
      if (!['submit', 'approve', 'reject', 'cancel', 'dispatch'].includes(action)) {
        throw new AppError(400, 'Invalid transfer action');
      }
      const transfer = transitionTransferStatus(
        db,
        Number(req.params.id),
        action,
        req.user!,
        String(req.body?.notes || ''),
        req.ip || ''
      );
      res.json({ transfer });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/transfers/:id/receive', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const discrepancyNotes = String(req.body?.discrepancy_notes || '');
      const transfer = receiveTransfer(
        db,
        Number(req.params.id),
        items,
        discrepancyNotes,
        req.user!,
        req.ip || ''
      );
      res.json({ transfer });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // MANAGEMENT REPORTS & EXPORTS
  // ==========================================
  app.get('/api/reports/:reportType', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      if (user.role === 'stock_controller') {
        throw new AppError(403, 'Stock Controllers do not have access to Management Reports');
      }
      const scopedBranchId = resolveScopedBranchId(db, user, req.query.branch_id, req);
      const data = generateReport(db, String(req.params.reportType), {
        branchId: scopedBranchId,
        categoryId: req.query.category_id ? Number(req.query.category_id) : null,
        productId: req.query.product_id ? Number(req.query.product_id) : null,
        supplierId: req.query.supplier_id ? Number(req.query.supplier_id) : null,
        transactionType: typeof req.query.transaction_type === 'string' ? req.query.transaction_type : null,
        dateFrom: typeof req.query.date_from === 'string' ? req.query.date_from : null,
        dateTo: typeof req.query.date_to === 'string' ? req.query.date_to : null,
      });

      recordAuditLog(db, {
        userId: user.id,
        action: 'report_generated',
        entityType: 'report',
        entityId: String(req.params.reportType),
        branchId: scopedBranchId,
        ipAddress: req.ip || '',
      });

      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/reports/:reportType/csv', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      if (user.role === 'stock_controller') {
        throw new AppError(403, 'Stock Controllers do not have access to Management Reports');
      }
      const scopedBranchId = resolveScopedBranchId(db, user, req.query.branch_id, req);
      const data = generateReport(db, String(req.params.reportType), {
        branchId: scopedBranchId,
        categoryId: req.query.category_id ? Number(req.query.category_id) : null,
        productId: req.query.product_id ? Number(req.query.product_id) : null,
        supplierId: req.query.supplier_id ? Number(req.query.supplier_id) : null,
        transactionType: typeof req.query.transaction_type === 'string' ? req.query.transaction_type : null,
        dateFrom: typeof req.query.date_from === 'string' ? req.query.date_from : null,
        dateTo: typeof req.query.date_to === 'string' ? req.query.date_to : null,
      });

      const rows = data.rows as Array<Record<string, unknown>>;
      const headers = rows.length > 0 ? Object.keys(rows[0]) : ['message'];
      const lines = [headers.map(escapeCsvCell).join(',')];
      if (rows.length === 0) {
        lines.push('No matching records');
      } else {
        for (const r of rows) {
          lines.push(headers.map((h) => escapeCsvCell(r[h])).join(','));
        }
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="qsims-${String(req.params.reportType).replace(/[^a-z0-9_-]/gi, '')}.csv"`
      );
      res.send(lines.join('\n'));
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // NOTIFICATIONS
  // ==========================================
  app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const conds: string[] = ['1=1'];
    const params: Array<string | number> = [];

    if (!isGlobalRole(user.role)) {
      conds.push('(n.branch_id IS NULL OR n.branch_id = ?)');
      params.push(user.branch_id!);
    }
    conds.push('(n.user_id IS NULL OR n.user_id = ?)');
    params.push(user.id);
    conds.push('(n.target_role IS NULL OR n.target_role = ?)');
    params.push(user.role);

    const notifications = db
      .prepare(
        `SELECT n.*, b.name AS branch_name
         FROM notifications n
         LEFT JOIN branches b ON b.id = n.branch_id
         WHERE ${conds.join(' AND ')}
         ORDER BY n.is_read ASC, n.id DESC
         LIMIT 50`
      )
      .all(...params);

    const unreadRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM notifications n
         WHERE n.is_read = 0 AND ${conds.join(' AND ')}`
      )
      .get(...params) as { cnt: number };

    res.json({ notifications, unreadCount: unreadRow.cnt });
  });

  app.post('/api/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(Number(req.params.id));
    res.json({ message: 'Notification marked as read' });
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    if (isGlobalRole(user.role)) {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE is_read = 0').run();
    } else {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE is_read = 0 AND branch_id = ?').run(
        user.branch_id
      );
    }
    res.json({ message: 'All notifications marked as read' });
  });

  // ==========================================
  // USER MANAGEMENT (ADMIN ONLY)
  // ==========================================
  app.get(
    '/api/users',
    requireAuth,
    requireRoles(db, 'admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const search = String(req.query.search || '').trim();
      const roleSlug = typeof req.query.role === 'string' && req.query.role ? req.query.role : null;
      const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;

      const conds: string[] = ['1=1'];
      const params: Array<string | number> = [];

      if (search) {
        conds.push('(u.full_name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }
      if (roleSlug) {
        conds.push('r.slug = ?');
        params.push(roleSlug);
      }
      if (branchId) {
        conds.push('u.branch_id = ?');
        params.push(branchId);
      }

      const users = db
        .prepare(
          `SELECT u.id, u.full_name, u.username, u.email, u.phone, u.role_id, u.branch_id,
                  u.status, u.last_login_at, u.created_at,
                  r.slug AS role, r.name AS role_name,
                  b.name AS branch_name, b.code AS branch_code
           FROM users u
           JOIN roles r ON r.id = u.role_id
           LEFT JOIN branches b ON b.id = u.branch_id
           WHERE ${conds.join(' AND ')}
           ORDER BY u.id ASC`
        )
        .all(...params);

      res.json({ users });
    }
  );

  app.post(
    '/api/users',
    requireAuth,
    requireRoles(db, 'admin'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const fullName = String(req.body?.full_name || '').trim();
        const username = String(req.body?.username || '').trim().toLowerCase();
        const email = String(req.body?.email || '').trim().toLowerCase();
        const phone = String(req.body?.phone || '').trim();
        const password = String(req.body?.password || '');
        const roleId = Number(req.body?.role_id);
        const branchId = req.body?.branch_id ? Number(req.body.branch_id) : null;

        if (!fullName || !username || !email || !password || !roleId) {
          throw new AppError(400, 'Full name, username, email, password, and role are required');
        }
        if (password.length < 8) {
          throw new AppError(400, 'Password must be at least 8 characters');
        }

        const role = db.prepare('SELECT id, slug FROM roles WHERE id = ?').get(roleId) as
          | { id: number; slug: string }
          | undefined;
        if (!role) throw new AppError(404, 'Role not found');

        if (['branch_manager', 'stock_controller'].includes(role.slug) && !branchId) {
          throw new AppError(400, 'Branch assignment is required for Branch Managers and Stock Controllers');
        }

        const dup = db
          .prepare('SELECT id FROM users WHERE lower(username) = ? OR lower(email) = ?')
          .get(username, email);
        if (dup) throw new AppError(409, 'Username or email already exists');

        const result = db
          .prepare(
            `INSERT INTO users (full_name, username, email, phone, password_hash, role_id, branch_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
          )
          .run(fullName, username, email, phone, hashPassword(password), roleId, branchId);

        const newId = Number(result.lastInsertRowid);
        recordAuditLog(db, {
          userId: req.user!.id,
          action: 'user_created',
          entityType: 'user',
          entityId: newId,
          branchId,
          metadata: { username, role: role.slug },
          ipAddress: req.ip || '',
        });

        const created = db
          .prepare(
            `SELECT u.id, u.full_name, u.username, u.email, u.phone, u.role_id, u.branch_id, u.status, u.created_at,
                    r.slug AS role, r.name AS role_name, b.name AS branch_name
             FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN branches b ON b.id = u.branch_id
             WHERE u.id = ?`
          )
          .get(newId);

        res.status(201).json({ user: created });
      } catch (err) {
        next(err);
      }
    }
  );

  app.put(
    '/api/users/:id',
    requireAuth,
    requireRoles(db, 'admin'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const targetId = Number(req.params.id);
        const existing = db
          .prepare(
            `SELECT u.*, r.slug AS role_slug FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
          )
          .get(targetId) as
          | {
              id: number;
              full_name: string;
              email: string;
              phone: string;
              role_id: number;
              role_slug: string;
              branch_id: number | null;
              status: string;
            }
          | undefined;
        if (!existing) throw new AppError(404, 'User not found');

        const nextRoleId = req.body?.role_id !== undefined ? Number(req.body.role_id) : existing.role_id;
        const nextRole = db.prepare('SELECT id, slug FROM roles WHERE id = ?').get(nextRoleId) as
          | { id: number; slug: string }
          | undefined;
        if (!nextRole) throw new AppError(404, 'Role not found');

        const nextStatus = req.body?.status !== undefined ? String(req.body.status) : existing.status;
        const nextBranchId =
          req.body?.branch_id !== undefined
            ? req.body.branch_id
              ? Number(req.body.branch_id)
              : null
            : existing.branch_id;

        if (['branch_manager', 'stock_controller'].includes(nextRole.slug) && !nextBranchId) {
          throw new AppError(400, 'Branch assignment is required for Branch Managers and Stock Controllers');
        }

        // Prevent removing or deactivating the last active Administrator
        if (existing.role_slug === 'admin' && (nextStatus !== 'active' || nextRole.slug !== 'admin')) {
          const activeAdmins = db
            .prepare(
              `SELECT COUNT(*) AS cnt FROM users u
               JOIN roles r ON r.id = u.role_id
               WHERE r.slug = 'admin' AND u.status = 'active' AND u.id != ?`
            )
            .get(targetId) as { cnt: number };
          if (activeAdmins.cnt === 0) {
            throw new AppError(422, 'Cannot deactivate or demote the last active Administrator');
          }
        }

        runInTransaction(db, () => {
          db.prepare(
            `UPDATE users
             SET full_name = ?, email = ?, phone = ?, role_id = ?, branch_id = ?, status = ?, updated_at = datetime('now')
             WHERE id = ?`
          ).run(
            req.body?.full_name !== undefined ? String(req.body.full_name).trim() : existing.full_name,
            req.body?.email !== undefined ? String(req.body.email).trim().toLowerCase() : existing.email,
            req.body?.phone !== undefined ? String(req.body.phone).trim() : existing.phone,
            nextRoleId,
            nextBranchId,
            nextStatus,
            targetId
          );

          if (nextStatus !== 'active') {
            db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
          }

          recordAuditLog(db, {
            userId: req.user!.id,
            action: 'user_updated',
            entityType: 'user',
            entityId: targetId,
            branchId: nextBranchId,
            metadata: { role: nextRole.slug, status: nextStatus },
            ipAddress: req.ip || '',
          });
        });

        const updated = db
          .prepare(
            `SELECT u.id, u.full_name, u.username, u.email, u.phone, u.role_id, u.branch_id, u.status, u.created_at,
                    r.slug AS role, r.name AS role_name, b.name AS branch_name
             FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN branches b ON b.id = u.branch_id
             WHERE u.id = ?`
          )
          .get(targetId);

        res.json({ user: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/users/:id/reset-password',
    requireAuth,
    requireRoles(db, 'admin'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const targetId = Number(req.params.id);
        const newPassword = String(req.body?.new_password || '');
        if (newPassword.length < 8) {
          throw new AppError(400, 'New password must be at least 8 characters');
        }
        const user = db.prepare('SELECT id, branch_id FROM users WHERE id = ?').get(targetId) as
          | { id: number; branch_id: number | null }
          | undefined;
        if (!user) throw new AppError(404, 'User not found');

        db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
          hashPassword(newPassword),
          targetId
        );
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);

        recordAuditLog(db, {
          userId: req.user!.id,
          action: 'user_password_reset',
          entityType: 'user',
          entityId: targetId,
          branchId: user.branch_id,
          ipAddress: req.ip || '',
        });

        res.json({ message: 'Password reset successfully' });
      } catch (err) {
        next(err);
      }
    }
  );

  // ==========================================
  // AUDIT LOGS (IMMUTABLE)
  // ==========================================
  app.get(
    '/api/audit-logs',
    requireAuth,
    requireRoles(db, 'admin', 'branch_manager'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = req.user!;
        const scopedBranchId = resolveScopedBranchId(db, user, req.query.branch_id, req);
        const action = typeof req.query.action === 'string' && req.query.action ? req.query.action : null;
        const page = toPositiveInt(req.query.page, 1);
        const limit = Math.min(100, toPositiveInt(req.query.limit, 30));
        const offset = (page - 1) * limit;

        const conds: string[] = ['1=1'];
        const params: Array<string | number> = [];

        if (scopedBranchId) {
          conds.push('al.branch_id = ?');
          params.push(scopedBranchId);
        }
        if (action) {
          conds.push('al.action LIKE ?');
          params.push(`%${action}%`);
        }

        const totalRow = db
          .prepare(`SELECT COUNT(*) AS cnt FROM audit_logs al WHERE ${conds.join(' AND ')}`)
          .get(...params) as { cnt: number };

        const logs = db
          .prepare(
            `SELECT al.*, u.full_name AS user_name, u.username, b.name AS branch_name
             FROM audit_logs al
             LEFT JOIN users u ON u.id = al.user_id
             LEFT JOIN branches b ON b.id = al.branch_id
             WHERE ${conds.join(' AND ')}
             ORDER BY al.id DESC
             LIMIT ? OFFSET ?`
          )
          .all(...params, limit, offset);

        res.json({
          logs,
          pagination: {
            page,
            limit,
            total: totalRow.cnt,
            totalPages: Math.max(1, Math.ceil(totalRow.cnt / limit)),
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ==========================================
  // SYSTEM SETTINGS (ADMIN ONLY FOR WRITE)
  // ==========================================
  app.get('/api/settings', requireAuth, (_req: Request, res: Response) => {
    const rows = db.prepare('SELECT key, value, updated_at FROM system_settings').all() as Array<{
      key: string;
      value: string;
      updated_at: string;
    }>;
    const settings: Record<string, string> = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    res.json({ settings });
  });

  app.put(
    '/api/settings',
    requireAuth,
    requireRoles(db, 'admin'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const updates = req.body?.settings;
        if (!updates || typeof updates !== 'object') {
          throw new AppError(400, 'Settings payload is required');
        }
        const allowedKeys = new Set([
          'business_name',
          'system_name',
          'currency',
          'default_reorder_level',
          'default_reorder_multiplier',
          'low_stock_alerts_enabled',
          'allow_negative_stock',
        ]);
        const upsert = db.prepare(
          `INSERT INTO system_settings (key, value, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        );
        runInTransaction(db, () => {
          for (const [k, v] of Object.entries(updates)) {
            if (allowedKeys.has(k)) {
              upsert.run(k, String(v));
            }
          }
          recordAuditLog(db, {
            userId: req.user!.id,
            action: 'settings_updated',
            entityType: 'system_settings',
            entityId: 'global',
            metadata: updates as Record<string, unknown>,
            ipAddress: req.ip || '',
          });
        });
        res.json({ message: 'System settings saved' });
      } catch (err) {
        next(err);
      }
    }
  );

  // ==========================================
  // ERROR HANDLER
  // ==========================================
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('[QS-IMS API Error]', err);
    res.status(500).json({ error: 'An unexpected server error occurred' });
  });
}
