import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { apiRequest, formatDateTime } from '../api/client';
import { AlertBanner, EmptyState } from '../components/StatusTag';
import type { AuditLog, Branch, User } from '../types';

export function AuditLogsPage({ user }: { user: User }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const isGlobal = user.role === 'admin';

  useEffect(() => {
    if (isGlobal) {
      apiRequest<{ branches: Branch[] }>('/api/branches').then((r) => setBranches(r.branches));
    }
  }, [isGlobal]);

  async function loadLogs() {
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '30' });
      if (actionFilter.trim()) params.set('action', actionFilter.trim());
      if (isGlobal && branchFilter) params.set('branch_id', branchFilter);
      const res = await apiRequest<{
        logs: AuditLog[];
        pagination: { totalPages: number };
      }>(`/api/audit-logs?${params.toString()}`);
      setLogs(res.logs);
      setTotalPages(res.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    }
  }

  useEffect(() => {
    loadLogs();
  }, [page, actionFilter, branchFilter]);

  return (
    <div className="space-y-4">
      {error && <AlertBanner type="error" message={error} onClose={() => setError(null)} />}

      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#1A3A5C]">System Audit Trail</h2>
          <p className="text-xs text-slate-500">
            Read-only record of logins, stock operations, purchase orders, and security events
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex items-center gap-2.5 w-full lg:w-auto">
          <div className="relative w-full lg:w-auto">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={actionFilter}
              onChange={(e) => {
                setPage(1);
                setActionFilter(e.target.value);
              }}
              placeholder="Filter action (e.g. grn, login)..."
              className="w-full pl-9 pr-3 py-2 lg:py-1.5 min-h-[44px] lg:min-h-0 text-sm border border-slate-300 rounded"
            />
          </div>
          {isGlobal && (
            <select
              value={branchFilter}
              onChange={(e) => {
                setPage(1);
                setBranchFilter(e.target.value);
              }}
              className="w-full lg:w-auto px-3 py-2 lg:py-1.5 min-h-[44px] lg:min-h-0 text-sm border border-slate-300 rounded bg-white"
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {logs.length === 0 ? (
        <EmptyState
          title="No audit records found"
          description="Try clearing the action or branch filter."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {logs.map((l) => (
              <div key={l.id} className="p-3.5 space-y-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-mono-num font-semibold text-[#1A3A5C] break-all">
                    {l.action}
                  </div>
                  <span className="text-[11px] font-mono-num text-slate-500 shrink-0">
                    {formatDateTime(l.created_at)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[11px] text-slate-500">User</div>
                    <div className="font-medium text-slate-800">
                      {l.user_name || l.username || 'System'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Branch</div>
                    <div className="text-slate-700">{l.branch_name || 'Global'}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-[11px] text-slate-500">Entity</div>
                    <div className="font-mono-num text-slate-800">
                      {l.entity_type} {l.entity_id ? `#${l.entity_id}` : ''}
                    </div>
                  </div>
                </div>
                {l.metadata_json && (
                  <div className="p-2 bg-[#F5F7FA] border border-slate-200 rounded font-mono-num text-[11px] text-slate-600 break-all">
                    {l.metadata_json}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#1A3A5C] text-white">
                  <th className="py-3 px-4 font-semibold">Timestamp</th>
                  <th className="py-3 px-4 font-semibold">User</th>
                  <th className="py-3 px-4 font-semibold">Action</th>
                  <th className="py-3 px-4 font-semibold">Entity</th>
                  <th className="py-3 px-4 font-semibold">Branch</th>
                  <th className="py-3 px-4 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap font-mono-num">
                      {formatDateTime(l.created_at)}
                    </td>
                    <td className="py-2.5 px-4 font-medium">
                      {l.user_name || l.username || 'System'}
                    </td>
                    <td className="py-2.5 px-4 font-mono-num font-semibold text-[#1A3A5C]">
                      {l.action}
                    </td>
                    <td className="py-2.5 px-4 font-mono-num">
                      {l.entity_type} {l.entity_id ? `#${l.entity_id}` : ''}
                    </td>
                    <td className="py-2.5 px-4">{l.branch_name || 'Global'}</td>
                    <td className="py-2.5 px-4 font-mono-num text-[11px] text-slate-600 max-w-md truncate">
                      {l.metadata_json}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs text-slate-600">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex w-full sm:w-auto gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex-1 sm:flex-none px-3 py-2 sm:py-1 min-h-[40px] sm:min-h-0 border border-slate-300 rounded disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex-1 sm:flex-none px-3 py-2 sm:py-1 min-h-[40px] sm:min-h-0 border border-slate-300 rounded disabled:opacity-50"
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
