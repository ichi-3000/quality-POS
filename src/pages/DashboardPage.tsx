import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  ClipboardList,
  Package,
  TrendingUp,
} from 'lucide-react';
import { apiRequest, formatDateTime, formatUGX } from '../api/client';
import type { NavRoute } from '../components/Layout';
import { AlertBanner, StatusTag } from '../components/StatusTag';
import type { Branch, User } from '../types';

interface DashboardResponse {
  role: string;
  scopedBranchId: number | null;
  kpis: {
    total_products: number;
    active_products: number;
    total_branches: number;
    total_units: number;
    total_stock_value: number;
    low_stock_count: number;
    out_of_stock_count: number;
    pending_pos: number;
    pending_transfers: number;
    active_suppliers: number;
  };
  branchComparison: Array<{
    branch_id: number;
    branch_name: string;
    branch_code: string;
    total_units: number;
    stock_value: number;
    out_of_stock_count: number;
    low_stock_count: number;
  }>;
  movementSummary: Array<{
    transaction_type: string;
    tx_count: number;
    total_added: number;
    total_removed: number;
  }>;
  poStatusSummary: Array<{
    status: string;
    count: number;
    total_value: number;
  }>;
  alerts: Array<{
    product_id: number;
    branch_id: number;
    sku: string;
    product_name: string;
    category_name: string;
    branch_name: string;
    branch_code: string;
    quantity_on_hand: number;
    reorder_level: number;
    unit_cost: number;
    status: string;
    shortfall: number;
    suggested_replenishment: number;
  }>;
  recentActivity: Array<{
    id: number;
    transaction_ref: string;
    transaction_type: string;
    quantity_added: number;
    quantity_removed: number;
    balance_after: number;
    reference_number: string;
    created_at: string;
    product_name: string;
    sku: string;
    branch_name: string;
    user_name: string;
  }>;
  awaitingReceiptTransfers: Array<{
    id: number;
    transfer_number: string;
    source_branch_name: string;
    destination_branch_name: string;
    dispatch_date: string;
    status: string;
  }>;
}

interface DashboardPageProps {
  user: User;
  onNavigate: (route: NavRoute) => void;
}

export function DashboardPage({ user, onNavigate }: DashboardPageProps) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isGlobal = user.role === 'admin' || user.role === 'procurement_manager';

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (isGlobal && branchFilter) params.set('branch_id', branchFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const [dash, brRes] = await Promise.all([
        apiRequest<DashboardResponse>(`/api/dashboard?${params.toString()}`),
        isGlobal ? apiRequest<{ branches: Branch[] }>('/api/branches') : Promise.resolve({ branches: [] }),
      ]);
      setData(dash);
      setBranches(brRes.branches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, [branchFilter, dateFrom, dateTo]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white border border-slate-200 rounded-md animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-md animate-pulse" />
      </div>
    );
  }

  if (error) {
    return <AlertBanner type="error" message={error} />;
  }

  if (!data) return null;

  const maxBranchVal = Math.max(1, ...data.branchComparison.map((b) => b.stock_value));
  const maxMovement = Math.max(
    1,
    ...data.movementSummary.map((m) => Math.max(m.total_added, m.total_removed))
  );

  return (
    <div className="space-y-6">
      {/* Header Controls & Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-200 rounded-md p-4">
        <div>
          <div className="text-xs text-slate-500">
            {user.role_name} · {user.branch_name || 'Consolidated Network View'}
          </div>
          <h2 className="text-lg font-semibold text-[#1A3A5C]">
            {user.role === 'admin' && 'Enterprise Inventory Overview'}
            {user.role === 'procurement_manager' && 'Head Office Procurement & Stock Overview'}
            {user.role === 'branch_manager' && `${user.branch_name} — Branch Operations`}
            {user.role === 'stock_controller' && `${user.branch_name} — Stock Control Desk`}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isGlobal && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Date from"
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Date to"
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
          />
          {(branchFilter || dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setBranchFilter('');
                setDateFrom('');
                setDateTo('');
              }}
              className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Role-Specific Quick Actions for Stock Controller */}
      {user.role === 'stock_controller' && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('stock-intake')}
            className="px-4 py-2 text-sm font-medium bg-[#E67E22] hover:bg-[#cf6d17] text-white rounded"
          >
            Record Goods Received (GRN)
          </button>
          <button
            type="button"
            onClick={() => onNavigate('stock-issues')}
            className="px-4 py-2 text-sm font-medium bg-[#1A3A5C] hover:bg-[#142d47] text-white rounded"
          >
            Record Stock Issue
          </button>
          <button
            type="button"
            onClick={() => onNavigate('stock-transfers')}
            className="px-4 py-2 text-sm font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded"
          >
            Confirm Incoming Transfers ({data.awaitingReceiptTransfers.length})
          </button>
        </div>
      )}

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-md p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Total Stock Valuation</span>
            <TrendingUp className="w-4 h-4 text-[#1A3A5C]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[#1A3A5C] font-mono-num">
            {formatUGX(data.kpis.total_stock_value)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono-num">
            {data.kpis.total_units.toLocaleString()} total units on hand
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-md p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Active Catalogue SKUs</span>
            <Package className="w-4 h-4 text-[#1A3A5C]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 font-mono-num">
            {data.kpis.active_products}
            <span className="text-sm font-normal text-slate-500"> / {data.kpis.total_products}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {isGlobal ? `${data.kpis.total_branches} active branches` : user.branch_name}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-md p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Low / Out-of-Stock Alerts</span>
            <AlertTriangle className="w-4 h-4 text-[#D97706]" />
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-2xl font-bold text-[#D97706] font-mono-num">
              {data.kpis.low_stock_count} Low
            </span>
            <span className="text-lg font-bold text-[#DC2626] font-mono-num">
              {data.kpis.out_of_stock_count} Out
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Calculated live from reorder thresholds
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-md p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Open Procurement & Transfers</span>
            <ClipboardList className="w-4 h-4 text-[#E67E22]" />
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-2xl font-bold text-slate-900 font-mono-num">
              {data.kpis.pending_pos} POs
            </span>
            <span className="text-lg font-semibold text-[#1A3A5C] font-mono-num">
              {data.kpis.pending_transfers} Transfers
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data.kpis.active_suppliers} active suppliers
          </div>
        </div>
      </div>

      {/* Charts Row: Branch Stock Comparison + Stock Movement Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Branch Valuation & Stock Health */}
        <div className="bg-white border border-slate-200 rounded-md p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[#1A3A5C]">
                {isGlobal ? 'Branch Inventory Valuation Comparison' : 'Branch Stock Summary'}
              </h3>
              <p className="text-xs text-slate-500">
                Real-time cost value and unit count by branch
              </p>
            </div>
            <Building2 className="w-4 h-4 text-slate-400" />
          </div>

          <div className="space-y-4">
            {data.branchComparison.map((b) => {
              const pct = Math.max(4, Math.round((b.stock_value / maxBranchVal) * 100));
              return (
                <div key={b.branch_id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">
                      {b.branch_name} ({b.branch_code})
                    </span>
                    <span className="font-mono-num font-semibold text-[#1A3A5C]">
                      {formatUGX(b.stock_value)}
                    </span>
                  </div>
                  <div className="w-full h-3 bg-slate-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-[#1A3A5C] transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono-num">
                    <span>{b.total_units.toLocaleString()} units</span>
                    <span>
                      {b.low_stock_count} low · {b.out_of_stock_count} out of stock
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Stock Movement Summary */}
        <div className="bg-white border border-slate-200 rounded-md p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[#1A3A5C]">
                Stock Movement Summary by Transaction Type
              </h3>
              <p className="text-xs text-slate-500">
                Inbound vs. outbound unit volumes recorded in ledger
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-medium text-[#E67E22] hover:underline flex items-center gap-1"
            >
              <span>Full Ledger</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {data.movementSummary.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              No stock movements match the selected date range.
            </p>
          ) : (
            <div className="space-y-3">
              {data.movementSummary.map((m) => {
                const isInbound = m.total_added >= m.total_removed;
                const qty = isInbound ? m.total_added : m.total_removed;
                const pct = Math.max(4, Math.round((qty / maxMovement) * 100));
                return (
                  <div key={m.transaction_type} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <StatusTag status={m.transaction_type} />
                        <span className="text-slate-500 font-mono-num">{m.tx_count} tx</span>
                      </div>
                      <span className="font-mono-num font-medium text-slate-800">
                        {isInbound ? `+${qty.toLocaleString()}` : `-${qty.toLocaleString()}`} units
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded overflow-hidden">
                      <div
                        className={`h-full ${isInbound ? 'bg-emerald-600' : 'bg-[#E67E22]'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Incoming Transfers Awaiting Receipt (when present) */}
      {data.awaitingReceiptTransfers.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-md p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[#1A3A5C]">
              In-Transit Transfers Awaiting Receipt Confirmation
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('stock-transfers')}
              className="text-xs font-medium text-[#E67E22] hover:underline"
            >
              Open Transfers
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-4 font-medium">Transfer #</th>
                  <th className="py-2 pr-4 font-medium">Source Branch</th>
                  <th className="py-2 pr-4 font-medium">Destination</th>
                  <th className="py-2 pr-4 font-medium">Dispatched</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.awaitingReceiptTransfers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4 font-mono-num font-medium text-[#1A3A5C]">
                      {t.transfer_number}
                    </td>
                    <td className="py-2.5 pr-4">{t.source_branch_name}</td>
                    <td className="py-2.5 pr-4">{t.destination_branch_name}</td>
                    <td className="py-2.5 pr-4 text-slate-500">{formatDateTime(t.dispatch_date)}</td>
                    <td className="py-2.5">
                      <StatusTag status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Low-Stock & Out-of-Stock Alerts Table */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#1A3A5C]">
              Automated Low-Stock & Out-of-Stock Alerts
            </h3>
            <p className="text-xs text-slate-500">
              Products where current branch quantity is at or below configured reorder level
            </p>
          </div>
          <div className="flex items-center gap-2">
            {user.role !== 'stock_controller' && (
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50"
              >
                Full Low-Stock Report
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="px-3 py-1.5 text-xs font-medium bg-[#1A3A5C] text-white rounded hover:bg-[#142d47]"
            >
              View All Stock
            </button>
          </div>
        </div>

        {data.alerts.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            All active products are currently above their reorder levels.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F5F7FA] border-b border-slate-200 text-slate-600">
                  <th className="py-2.5 px-4 font-semibold">Product</th>
                  <th className="py-2.5 px-4 font-semibold">Branch</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Current Qty</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Reorder Level</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Shortfall</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Suggested Reorder</th>
                  <th className="py-2.5 px-4 font-semibold">Severity</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.alerts.map((a) => (
                  <tr key={`${a.product_id}-${a.branch_id}`} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{a.product_name}</div>
                      <div className="text-[11px] text-slate-500 font-mono-num">
                        {a.sku} · {a.category_name}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">{a.branch_name}</td>
                    <td className="py-2.5 px-4 text-right font-mono-num font-semibold">
                      {a.quantity_on_hand}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num text-slate-600">
                      {a.reorder_level}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num font-semibold text-red-700">
                      {a.shortfall}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num text-[#1A3A5C] font-medium">
                      {a.suggested_replenishment}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusTag status={a.status} />
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {user.role === 'procurement_manager' ? (
                        <button
                          type="button"
                          onClick={() => onNavigate('purchase-orders')}
                          className="text-xs font-medium text-[#E67E22] hover:underline"
                        >
                          Prepare PO
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onNavigate('stock-intake')}
                          className="text-xs font-medium text-[#E67E22] hover:underline"
                        >
                          Record GRN
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Inventory Ledger Activity */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#1A3A5C]">Recent Inventory Transactions</h3>
            <p className="text-xs text-slate-500">Latest immutable stock ledger entries</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('inventory')}
            className="text-xs font-medium text-[#1A3A5C] hover:underline"
          >
            View Ledger
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#F5F7FA] border-b border-slate-200 text-slate-600">
                <th className="py-2.5 px-4 font-semibold">Reference</th>
                <th className="py-2.5 px-4 font-semibold">Product</th>
                <th className="py-2.5 px-4 font-semibold">Branch</th>
                <th className="py-2.5 px-4 font-semibold">Type</th>
                <th className="py-2.5 px-4 font-semibold text-right">Delta</th>
                <th className="py-2.5 px-4 font-semibold text-right">Balance</th>
                <th className="py-2.5 px-4 font-semibold">User</th>
                <th className="py-2.5 px-4 font-semibold">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.recentActivity.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono-num text-[#1A3A5C] font-medium">
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
                  <td className="py-2.5 px-4 text-right font-mono-num font-semibold">
                    {tx.quantity_added > 0 ? (
                      <span className="text-emerald-700">+{tx.quantity_added}</span>
                    ) : (
                      <span className="text-red-700">-{tx.quantity_removed}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono-num font-semibold text-slate-900">
                    {tx.balance_after}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600">{tx.user_name}</td>
                  <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                    {formatDateTime(tx.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
