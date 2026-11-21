import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { apiRequest, formatDateTime, formatUGX } from '../api/client';
import type { NavRoute } from '../components/Layout';
import { AlertBanner, EmptyState, StatusTag } from '../components/StatusTag';
import type { Branch, Category, LedgerTransaction, StockItem, User } from '../types';

export function InventoryPage({
  user,
  onNavigate,
}: {
  user: User;
  onNavigate: (route: NavRoute) => void;
}) {
  const [tab, setTab] = useState<'levels' | 'ledger'>('levels');
  const [items, setItems] = useState<StockItem[]>([]);
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState('');
  const [txType, setTxType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const isGlobal = user.role === 'admin' || user.role === 'procurement_manager';

  useEffect(() => {
    Promise.all([
      apiRequest<{ branches: Branch[] }>('/api/branches'),
      apiRequest<{ categories: Category[] }>('/api/categories'),
    ]).then(([b, c]) => {
      setBranches(b.branches);
      setCategories(c.categories);
    });
  }, []);

  async function loadData() {
    setError(null);
    try {
      if (tab === 'levels') {
        const params = new URLSearchParams({ page: String(page), limit: '25' });
        if (isGlobal && branchId) params.set('branch_id', branchId);
        if (search.trim()) params.set('search', search.trim());
        if (categoryId) params.set('category_id', categoryId);
        if (statusFilter) params.set('status', statusFilter);
        if (sort) params.set('sort', sort);
        const res = await apiRequest<{
          items: StockItem[];
          pagination: { totalPages: number; total: number };
        }>(`/api/inventory?${params.toString()}`);
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
        setTotalCount(res.pagination.total);
      } else {
        const params = new URLSearchParams({ page: String(page), limit: '25' });
        if (isGlobal && branchId) params.set('branch_id', branchId);
        if (txType) params.set('transaction_type', txType);
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        const res = await apiRequest<{
          transactions: LedgerTransaction[];
          pagination: { totalPages: number; total: number };
        }>(`/api/inventory/ledger?${params.toString()}`);
        setTransactions(res.transactions);
        setTotalPages(res.pagination.totalPages);
        setTotalCount(res.pagination.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory');
    }
  }

  useEffect(() => {
    loadData();
  }, [tab, page, search, branchId, categoryId, statusFilter, sort, txType, dateFrom, dateTo]);

  return (
    <div className="space-y-4">
      {error && <AlertBanner type="error" message={error} onClose={() => setError(null)} />}

      {/* Tab Switcher + Quick Operational Links */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="grid grid-cols-2 sm:inline-flex w-full sm:w-auto p-1 bg-white border border-slate-200 rounded-md">
          <button
            type="button"
            onClick={() => {
              setTab('levels');
              setPage(1);
            }}
            className={`px-3 sm:px-4 py-2 sm:py-1.5 min-h-[40px] sm:min-h-[34px] text-xs font-semibold rounded transition-colors ${
              tab === 'levels'
                ? 'bg-[#1A3A5C] text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Branch Stock Levels
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('ledger');
              setPage(1);
            }}
            className={`px-3 sm:px-4 py-2 sm:py-1.5 min-h-[40px] sm:min-h-[34px] text-xs font-semibold rounded transition-colors ${
              tab === 'ledger'
                ? 'bg-[#1A3A5C] text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Immutable Stock Ledger
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs">
          <span className="text-slate-500">
            Stock changes only via recorded GRN, Issue, or Transfer transactions.
          </span>
          {user.role !== 'procurement_manager' && (
            <button
              type="button"
              onClick={() => onNavigate('stock-intake')}
              className="w-full sm:w-auto px-3 py-2 min-h-[44px] sm:min-h-[34px] bg-[#E67E22] hover:bg-[#cf6d17] text-white font-medium rounded shrink-0"
            >
              Record GRN
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-md p-4 grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-center gap-2.5">
        {tab === 'levels' && (
          <div className="relative sm:col-span-2 lg:flex-1 lg:min-w-[200px] lg:max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
              placeholder="Search product or SKU..."
              className="w-full pl-9 pr-3 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
            />
          </div>
        )}

        {isGlobal && (
          <select
            value={branchId}
            onChange={(e) => {
              setPage(1);
              setBranchId(e.target.value);
            }}
            className="w-full lg:w-auto px-3 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded bg-white"
          >
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}

        {tab === 'levels' ? (
          <>
            <select
              value={categoryId}
              onChange={(e) => {
                setPage(1);
                setCategoryId(e.target.value);
              }}
              className="w-full lg:w-auto px-3 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded bg-white"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => {
                setPage(1);
                setStatusFilter(e.target.value);
              }}
              className="w-full lg:w-auto px-3 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded bg-white"
            >
              <option value="">All Stock Statuses</option>
              <option value="in_stock">In Stock</option>
              <option value="low_stock">Low Stock</option>
              <option value="out_of_stock">Out of Stock</option>
            </select>

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="w-full lg:w-auto px-3 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded bg-white"
            >
              <option value="">Sort: Product Name</option>
              <option value="qty_asc">Quantity (Low to High)</option>
              <option value="qty_desc">Quantity (High to Low)</option>
              <option value="value_desc">Stock Value (High to Low)</option>
            </select>
          </>
        ) : (
          <>
            <select
              value={txType}
              onChange={(e) => {
                setPage(1);
                setTxType(e.target.value);
              }}
              className="w-full lg:w-auto px-3 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded bg-white"
            >
              <option value="">All Transaction Types</option>
              <option value="opening_stock">Opening Stock</option>
              <option value="grn">GRN / Intake</option>
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
              onChange={(e) => {
                setPage(1);
                setDateFrom(e.target.value);
              }}
              aria-label="Date from"
              className="w-full lg:w-auto px-2.5 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setPage(1);
                setDateTo(e.target.value);
              }}
              aria-label="Date to"
              className="w-full lg:w-auto px-2.5 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded"
            />
          </>
        )}

        <button
          type="button"
          onClick={() => {
            setSearch('');
            setBranchId('');
            setCategoryId('');
            setStatusFilter('');
            setSort('');
            setTxType('');
            setDateFrom('');
            setDateTo('');
            setPage(1);
          }}
          className="w-full sm:w-auto px-3 py-2 min-h-[44px] lg:min-h-[36px] text-xs font-medium border border-slate-300 rounded hover:bg-slate-50"
        >
          Clear Filters
        </button>
      </div>

      {/* Table / Mobile Cards */}
      {tab === 'levels' ? (
        items.length === 0 ? (
          <EmptyState
            title="No matching stock records"
            description="No branch stock entries matched your current filter selection."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
            {/* Mobile Stock Level Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {items.map((row) => (
                <div key={`m-stk-${row.id}`} className="p-4 space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono-num text-[11px] font-semibold text-[#1A3A5C]">
                        {row.sku} · {row.branch_name} ({row.branch_code})
                      </div>
                      <div className="text-sm font-semibold text-slate-900 mt-0.5">
                        {row.product_name}
                      </div>
                      <div className="text-[11px] text-slate-500">{row.category_name}</div>
                    </div>
                    <StatusTag status={row.stock_status} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 bg-[#F5F7FA] p-2.5 rounded border border-slate-200">
                    <div>
                      <div className="text-[10px] text-slate-500">On Hand (Min {row.reorder_level})</div>
                      <div className="font-mono-num font-bold text-slate-900">
                        {row.quantity_on_hand}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Unit Cost</div>
                      <div className="font-mono-num">{formatUGX(row.unit_cost)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Stock Value</div>
                      <div className="font-mono-num font-semibold text-[#1A3A5C]">
                        {formatUGX(row.stock_value)}
                      </div>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Last movement: {formatDateTime(row.last_movement_at || row.updated_at)}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Stock Level Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#1A3A5C] text-white">
                    <th className="py-3 px-4 font-semibold">SKU</th>
                    <th className="py-3 px-4 font-semibold">Product</th>
                    <th className="py-3 px-4 font-semibold">Branch</th>
                    <th className="py-3 px-4 font-semibold text-right">Qty on Hand</th>
                    <th className="py-3 px-4 font-semibold text-right">Reorder Lvl</th>
                    <th className="py-3 px-4 font-semibold text-right">Unit Cost</th>
                    <th className="py-3 px-4 font-semibold text-right">Stock Value</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold">Last Movement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono-num text-[#1A3A5C] font-medium whitespace-nowrap">
                        {row.sku}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{row.product_name}</div>
                        <div className="text-[11px] text-slate-500">{row.category_name}</div>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {row.branch_name} ({row.branch_code})
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-num font-bold text-slate-900">
                        {row.quantity_on_hand}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-num text-slate-600">
                        {row.reorder_level}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-num whitespace-nowrap">
                        {formatUGX(row.unit_cost)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-num font-semibold text-[#1A3A5C] whitespace-nowrap">
                        {formatUGX(row.stock_value)}
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusTag status={row.stock_status} />
                      </td>
                      <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                        {formatDateTime(row.last_movement_at || row.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
              <span>
                Page {page} of {totalPages} ({totalCount} branch-product records)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="flex-1 sm:flex-none px-3 py-2 sm:py-1 min-h-[40px] sm:min-h-[32px] border border-slate-300 rounded disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="flex-1 sm:flex-none px-3 py-2 sm:py-1 min-h-[40px] sm:min-h-[32px] border border-slate-300 rounded disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )
      ) : transactions.length === 0 ? (
        <EmptyState
          title="No ledger transactions found"
          description="No stock movements match the selected filters."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          {/* Mobile Ledger Cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {transactions.map((tx) => (
              <div key={`m-led-${tx.id}`} className="p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-num font-semibold text-[#1A3A5C]">
                    {tx.reference_number}
                  </span>
                  <StatusTag status={tx.transaction_type} />
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">{tx.product_name}</div>
                    <div className="text-[11px] text-slate-500 font-mono-num">
                      {tx.sku} · {tx.branch_name}
                    </div>
                  </div>
                  <div className="text-right font-mono-num shrink-0">
                    <div className="font-bold">
                      {tx.quantity_added > 0 ? (
                        <span className="text-emerald-700">+{tx.quantity_added}</span>
                      ) : (
                        <span className="text-red-700">-{tx.quantity_removed}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">Bal: {tx.balance_after}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="font-mono-num truncate mr-2">{tx.transaction_ref}</span>
                  <span className="shrink-0">
                    {tx.user_name} · {formatDateTime(tx.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Ledger Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#1A3A5C] text-white">
                  <th className="py-3 px-4 font-semibold">Transaction Ref</th>
                  <th className="py-3 px-4 font-semibold">Document Ref</th>
                  <th className="py-3 px-4 font-semibold">Product</th>
                  <th className="py-3 px-4 font-semibold">Branch</th>
                  <th className="py-3 px-4 font-semibold">Type</th>
                  <th className="py-3 px-4 font-semibold text-right">Added</th>
                  <th className="py-3 px-4 font-semibold text-right">Removed</th>
                  <th className="py-3 px-4 font-semibold text-right">Balance After</th>
                  <th className="py-3 px-4 font-semibold">User</th>
                  <th className="py-3 px-4 font-semibold">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono-num text-[11px] text-slate-600">
                      {tx.transaction_ref}
                    </td>
                    <td className="py-2.5 px-4 font-mono-num font-medium text-[#1A3A5C]">
                      {tx.reference_number}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{tx.product_name}</div>
                      <div className="text-[11px] text-slate-500 font-mono-num">{tx.sku}</div>
                    </td>
                    <td className="py-2.5 px-4">{tx.branch_name}</td>
                    <td className="py-2.5 px-4">
                      <StatusTag status={tx.transaction_type} />
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num text-emerald-700 font-semibold">
                      {tx.quantity_added > 0 ? `+${tx.quantity_added}` : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num text-red-700 font-semibold">
                      {tx.quantity_removed > 0 ? `-${tx.quantity_removed}` : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num font-bold">
                      {tx.balance_after}
                    </td>
                    <td className="py-2.5 px-4">{tx.user_name}</td>
                    <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                      {formatDateTime(tx.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
            <span>
              Page {page} of {totalPages} ({totalCount} ledger entries)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex-1 sm:flex-none px-3 py-2 sm:py-1 min-h-[40px] sm:min-h-[32px] border border-slate-300 rounded disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex-1 sm:flex-none px-3 py-2 sm:py-1 min-h-[40px] sm:min-h-[32px] border border-slate-300 rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
