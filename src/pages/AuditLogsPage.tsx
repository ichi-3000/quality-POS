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

      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#1A3A5C]">System Audit Trail</h2>
          <p className="text-xs text-slate-500">
            Read-only record of logins, stock operations, purchase orders, and security events
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={actionFilter}
              onChange={(e) => {
                setPage(1);
                setActionFilter(e.target.value);
              }}
              placeholder="Filter action (e.g. grn, login)..."
              className="pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded"
            />
          </div>
          {isGlobal && (
            <select
              value={branchFilter}
              onChange={(e) => {
                setPage(1);
                setBranchFilter(e.target.value);
              }}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded bg-white"
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
          <div className="overflow-x-auto">
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
          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 border border-slate-300 rounded disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1 border border-slate-300 rounded disabled:opacity-50"
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
