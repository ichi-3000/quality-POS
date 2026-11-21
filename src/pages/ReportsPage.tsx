import React, { useEffect, useState } from 'react';
import { Download, FileText, Printer } from 'lucide-react';
import {
  apiRequest,
  downloadCsvReport,
  exportTableToPdf,
  formatDate,
  formatDateTime,
  formatUGX,
} from '../api/client';
import { AlertBanner, EmptyState, StatusTag } from '../components/StatusTag';
import type { Branch, Category, Product, Supplier, User } from '../types';

const REPORT_TYPES = [
  { id: 'stock_value_by_branch', label: 'A. Stock Value by Branch' },
  { id: 'stock_value_by_product', label: 'B. Stock Value by Product' },
  { id: 'stock_issues_by_type', label: 'C. Stock Issues by Type' },
  { id: 'top_intake_products', label: 'D. Top Intake Products' },
  { id: 'low_stock_report', label: 'E. Low-Stock Report' },
  { id: 'stock_movement_report', label: 'F. Stock Movement Report' },
  { id: 'purchase_order_report', label: 'G. Purchase Order Report' },
  { id: 'supplier_performance', label: 'H. Supplier Delivery History' },
  { id: 'inventory_valuation', label: 'I. Inventory Valuation' },
] as const;

type ReportId = (typeof REPORT_TYPES)[number]['id'];

export function ReportsPage({ user }: { user: User }) {
  const [reportType, setReportType] = useState<ReportId>('stock_value_by_branch');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [branchId, setBranchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [txType, setTxType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGlobal = user.role === 'admin' || user.role === 'procurement_manager';

  useEffect(() => {
    Promise.all([
      apiRequest<{ branches: Branch[] }>('/api/branches'),
      apiRequest<{ categories: Category[] }>('/api/categories'),
      apiRequest<{ products: Product[] }>('/api/products?limit=100'),
      apiRequest<{ suppliers: Supplier[] }>('/api/suppliers'),
    ]).then(([b, c, p, s]) => {
      setBranches(b.branches);
      setCategories(c.categories);
      setProducts(p.products);
      setSuppliers(s.suppliers);
    });
  }, []);

  function buildQuery() {
    const params = new URLSearchParams();
    if (isGlobal && branchId) params.set('branch_id', branchId);
    if (categoryId) params.set('category_id', categoryId);
    if (productId) params.set('product_id', productId);
    if (supplierId) params.set('supplier_id', supplierId);
    if (txType) params.set('transaction_type', txType);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    return params.toString();
  }

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const qs = buildQuery();
      const res = await apiRequest<{ rows: Array<Record<string, unknown>> }>(
        `/api/reports/${reportType}?${qs}`
      );
      setRows(res.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, [reportType, branchId, categoryId, productId, supplierId, txType, dateFrom, dateTo]);

  const activeMeta = REPORT_TYPES.find((r) => r.id === reportType)!;

  function formatCell(key: string, val: unknown): React.ReactNode {
    if (val === null || val === undefined || val === '') return '—';
    if (
      key.includes('value') ||
      key.includes('cost') ||
      key.includes('price')
    ) {
      return <span className="font-mono-num">{formatUGX(Number(val))}</span>;
    }
    if (key === 'status' || key === 'issue_type' || key === 'transaction_type') {
      return <StatusTag status={String(val)} />;
    }
    if (key.includes('created_at')) {
      return formatDateTime(String(val));
    }
    if (key.includes('date')) {
      return formatDate(String(val));
    }
    if (typeof val === 'number') {
      return <span className="font-mono-num font-medium">{val.toLocaleString()}</span>;
    }
    return String(val);
  }

  function formatPlainCell(key: string, val: unknown): string {
    if (val === null || val === undefined || val === '') return '-';
    if (key.includes('value') || key.includes('cost') || key.includes('price')) {
      return formatUGX(Number(val));
    }
    return String(val);
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  function handleExportPdf() {
    if (rows.length === 0) return;
    const headers = columns.map((c) => c.replace(/_/g, ' ').toUpperCase());
    const body = rows.map((r) => columns.map((c) => formatPlainCell(c, r[c])));
    exportTableToPdf(
      activeMeta.label,
      `Scope: ${isGlobal ? (branchId ? 'Filtered Branch' : 'All Branches') : user.branch_name}`,
      headers,
      body,
      `qsims-${reportType}.pdf`
    );
  }

  async function handleExportCsv() {
    try {
      await downloadCsvReport(
        `/api/reports/${reportType}/csv?${buildQuery()}`,
        `qsims-${reportType}.csv`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV export failed');
    }
  }

  return (
    <div className="space-y-4">
      {error && <AlertBanner type="error" message={error} onClose={() => setError(null)} />}

      {/* Report Selector Tabs */}
      <div className="bg-white border border-slate-200 rounded-md p-4 no-print">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-[#1A3A5C]">Management & Inventory Reports</h2>
            <p className="text-xs text-slate-500">
              All figures are computed directly from verified database stock and ledger records
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1A3A5C] text-white rounded hover:bg-[#142d47] disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#E67E22] text-white rounded hover:bg-[#cf6d17]"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {REPORT_TYPES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setReportType(r.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                reportType === r.id
                  ? 'bg-[#1A3A5C] text-white border-[#1A3A5C]'
                  : 'bg-[#F5F7FA] text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-wrap items-center gap-2.5 no-print">
        {isGlobal && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
          >
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="px-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="px-3 py-1.5 text-xs border border-slate-300 rounded bg-white max-w-[200px]"
        >
          <option value="">All Products</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} · {p.name}
            </option>
          ))}
        </select>
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="px-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
        >
          <option value="">All Suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={txType}
          onChange={(e) => setTxType(e.target.value)}
          className="px-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
        >
          <option value="">All Tx Types</option>
          <option value="opening_stock">Opening Stock</option>
          <option value="grn">GRN</option>
          <option value="sale">Sale</option>
          <option value="transfer_out">Transfer Out</option>
          <option value="transfer_in">Transfer In</option>
          <option value="damage">Damage</option>
          <option value="expiry">Expiry</option>
          <option value="adjustment">Adjustment</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
        />
        <button
          type="button"
          onClick={() => {
            setBranchId('');
            setCategoryId('');
            setProductId('');
            setSupplierId('');
            setTxType('');
            setDateFrom('');
            setDateTo('');
          }}
          className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50"
        >
          Clear Filters
        </button>
      </div>

      {/* Report Data Table */}
      {loading ? (
        <div className="h-48 bg-white border border-slate-200 rounded-md animate-pulse" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No records for this report"
          description="Try widening your date range or clearing active filters."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1A3A5C]">{activeMeta.label}</h3>
            <span className="text-xs text-slate-500 font-mono-num">{rows.length} row(s)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#1A3A5C] text-white">
                  {columns.map((col) => (
                    <th key={col} className="py-2.5 px-4 font-semibold capitalize whitespace-nowrap">
                      {col.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    {columns.map((col) => (
                      <td key={col} className="py-2.5 px-4 whitespace-nowrap">
                        {formatCell(col, r[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
