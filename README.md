# QS-IMS — Quality Supermarkets Uganda Limited Inventory Management System

A centralized, multi-branch, role-based Inventory Management System built for **Quality Supermarkets Uganda Limited** across its three Kampala branches:

1. **Ntinda – Head Office** (`NTINDA`)
2. **Najjera Branch** (`NAJJERA`)
3. **Kyaliwajjala Branch** (`KYALI`)

---

## 1. Runtime & Architecture Overview

> **Environment Note**: While the original project specification references PHP/Laravel + MySQL, this live workspace runs in a **Node.js 22 + Express + TypeScript + SQLite (`node:sqlite`) + React + Tailwind CSS** container where PHP/MySQL are not installed. All requested relational database constraints, MVC/service-layer separation, atomic transaction safety, RBAC policies, branch-level access isolation, reports, exports, automated tests, and documentation have been implemented natively and run live on port `3000`.

### Core System Layers
- **Presentation Layer (`src/`)**: Responsive React + TypeScript + Tailwind CSS corporate retail interface (`#1A3A5C` Primary Navy, `#E67E22` Primary Orange, `#F5F7FA` canvas, `Plus Jakarta Sans` + `DM Sans` + `JetBrains Mono` tabular numerals).
- **API & Security Layer (`server/app.ts`, `server/middleware/auth.ts`)**: Express REST API with `scrypt` password hashing, HMAC-SHA256 session tokens stored server-side, login rate limiting, role guards, and strict server-side branch scoping.
- **Business Logic Services (`server/services/`)**:
  - `productService.ts` — Product CRUD & automatic 3-branch stock initialization.
  - `grnService.ts` — Atomic Goods Received Note intake, PO reconciliation, idempotency protection.
  - `issueService.ts` — Classified stock issues (`sale`, `damage`, `expiry`, `adjustment`, `transfer`) with non-negative stock enforcement.
  - `transferService.ts` — Inter-branch transfer state machine (`draft` → `pending_approval` → `approved` → `in_transit` → `received`) with partial-receipt discrepancy tracking.
  - `purchaseOrderService.ts` — PO lifecycle (`draft` → `sent` → `partially_received` → `received` / `cancelled`) without prematurely altering stock.
  - `reportService.ts` — All 9 management reports + CSV export.
  - `dashboardService.ts` — Role-adaptive KPIs, branch comparisons, low-stock alerts, and recent activity.
  - `auditService.ts` — Immutable audit logging and automated low/out-of-stock notification generation.
- **Database Layer (`server/db/`)**: Normalized relational schema (`migrations.ts`) with foreign keys, unique constraints, check constraints, indexes, `BEGIN IMMEDIATE` atomic transactions, and realistic Ugandan supermarket seed data (`seed.ts`).

---

## 2. Requirements & Installation

- **Node.js**: `v22.x` or newer (includes built-in `node:sqlite`)
- **npm**: `v10.x` or newer

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (optional; defaults to ./data/qsims.sqlite)
cp .env.example .env

# 3. Start development server (runs migrations & idempotent seeder automatically)
npm run dev
```

The server listens on `http://localhost:3000`.

### Production Build & Start
```bash
npm run build
NODE_ENV=production npm start
```

### Running Automated Tests
```bash
npm test
```

---

## 3. Default Development Login Credentials

All seeded accounts use `scrypt` per-user salted password hashes. **Change or disable demo accounts before deploying to production.**

| Role | Username | Password | Assigned Branch |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin` | `Admin@2026` | Ntinda – Head Office (All Branches Access) |
| **Procurement Manager** | `procurement` | `Procure@2026` | Ntinda – Head Office (All Branches Access) |
| **Branch Manager (Ntinda)** | `mgr.ntinda` | `Branch@2026` | Ntinda – Head Office |
| **Branch Manager (Najjera)** | `mgr.najjera` | `Branch@2026` | Najjera Branch |
| **Stock Controller (Kyaliwajjala)** | `ctrl.kyali` | `Stock@2026` | Kyaliwajjala Branch |
| **Stock Controller (Najjera)** | `ctrl.najjera` | `Stock@2026` | Najjera Branch |

---

## 4. User Roles & Permissions Summary

- **Administrator**: Full privileges across all 3 branches, product catalogue, categories, suppliers, purchase orders, stock operations, reports, user/role management, audit logs, and system settings.
- **Procurement Manager**: Head Office cross-branch stock visibility, supplier management, purchase order creation/editing/tracking, procurement & valuation reports. Restricted from user management, system settings, and direct branch stock mutations.
- **Branch Manager**: Strictly scoped to their assigned branch. Supervises stock intake, views branch stock & issues, requests and approves branch transfers, views branch inventory reports and branch audit records. Denied access to other branches.
- **Stock Controller**: Strictly scoped to their assigned branch. Records Goods Received Notes (GRNs), records stock issues, views branch stock levels & movement history, and confirms incoming inter-branch transfer receipts. Cannot manage users, settings, or management reports.

---

## 5. Implemented Modules

1. **Role-Adaptive Dashboard**: Real-time KPIs, branch stock value comparison charts, movement summaries, automated low/out-of-stock alerts with shortfall & suggested reorder quantities, and recent ledger transactions.
2. **Product Catalogue & Categories**: Unique SKUs, barcodes, UGX unit cost & selling price, reorder levels, preferred suppliers, expiry tracking flags, and guarded deletion (prevents deleting transacted products; enforces deactivation instead).
3. **Inventory Levels & Immutable Ledger**: Separate per-branch stock tracking, automatic `In Stock` / `Low Stock` / `Out of Stock` status computation, and immutable `inventory_transactions` audit ledger.
4. **Stock Intake / GRN**: Auto-numbered GRNs, PO reconciliation (`partially_received` / `received`), idempotency key duplicate protection, and printable GRN vouchers.
5. **Stock Issues**: Classified into Sale, Damage, Expiry, Adjustment (reason mandatory), and Transfer (via Transfer workflow). Enforces non-negative stock inside atomic transactions.
6. **Inter-Branch Stock Transfers**: Full workflow (`Draft` → `Pending Approval` → `Approved` → `In Transit` → `Received` / `Rejected` / `Cancelled`), source deduction on dispatch, destination receipt confirmation with discrepancy logging.
7. **Supplier & Purchase Order Management**: Supplier profiles with delivery counts & history, dynamic PO line items, Draft/Sent/Received lifecycle, PDF download, and print views.
8. **Management Reports & Exports**: 9 interactive reports with Date, Branch, Category, Product, Supplier, and Transaction Type filters plus CSV export, jsPDF download, and print-friendly views.
9. **User Management, Audit Logs, Notifications & Settings**: Full staff RBAC administration (protects last active Admin), immutable security/operation audit logs, branch/role-scoped notifications, and UGX system settings.

---

## 6. Security, Backup & Troubleshooting

- **Security Safeguards**: `scrypt` password hashing, timing-safe comparison, HMAC-SHA256 hashed session tokens held in React memory (never `localStorage`), login rate limiting, parameterized SQL queries, server-side RBAC middleware, and forged `branch_id` rejection with audit logging.
- **Database Backups**: With SQLite WAL mode, run `sqlite3 data/qsims.sqlite ".backup 'backups/qsims-$(date +%F).sqlite'"` via cron for consistent hot backups.
- **Troubleshooting**:
  - *Database reset*: Stop the server, delete `data/qsims.sqlite*`, and restart `npm run dev` to recreate schema and seed data cleanly.
  - *Port 3000 busy*: Ensure no stale process is bound to port `3000`, or configure `PORT` in environment.

See [`docs/SYSTEM_DOCUMENTATION.md`](docs/SYSTEM_DOCUMENTATION.md) for the **Database ERD**, **System Architecture Diagram**, **Use Case Diagram**, **Key Workflows**, **Admin & User Manuals**, and **12-Scenario UAT Checklist**.
