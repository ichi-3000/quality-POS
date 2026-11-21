import React, { useEffect, useState } from 'react';
import { Eye, Plus, Search, Trash2 } from 'lucide-react';
import { apiRequest, formatDate, formatUGX } from '../api/client';
import { AlertBanner, EmptyState, Modal, StatusTag } from '../components/StatusTag';
import type { Branch, StockIssue, StockItem, User } from '../types';

export function StockIssuesPage({ user }: { user: User }) {
  const [issues, setIssues] = useState<StockIssue[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchStocks, setBranchStocks] = useState<StockItem[]>([]);

  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<StockIssue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const [form, setForm] = useState({
    branch_id: user.branch_id ? String(user.branch_id) : '',
    issue_type: 'sale' as 'sale' | 'damage' | 'expiry' | 'adjustment',
    reference_number: '',
    reason: '',
    issue_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [lines, setLines] = useState<Array<{ product_id: string; quantity: number }>>([
    { product_id: '', quantity: 1 },
  ]);

  const isGlobal = user.role === 'admin' || user.role === 'procurement_manager';
  const canIssue = user.role !== 'procurement_manager';

  async function loadIssues() {
    try {
      const params = new URLSearchParams();
      if (isGlobal && branchFilter) params.set('branch_id', branchFilter);
      if (typeFilter) params.set('issue_type', typeFilter);
      if (search.trim()) params.set('search', search.trim());
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const res = await apiRequest<{ issues: StockIssue[] }>(`/api/stock-issues?${params.toString()}`);
      setIssues(res.issues);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load issues' });
    }
  }

  async function loadBranchStock(targetBranchId: string) {
    if (!targetBranchId) return;
    const res = await apiRequest<{ items: StockItem[] }>(
      `/api/inventory?branch_id=${targetBranchId}&limit=200`
    );
    setBranchStocks(res.items);
  }

  useEffect(() => {
    apiRequest<{ branches: Branch[] }>('/api/branches').then((r) => setBranches(r.branches));
  }, []);

  useEffect(() => {
    loadIssues();
  }, [search, branchFilter, typeFilter, dateFrom, dateTo]);

  function openNewIssue() {
    const defaultBranch = user.branch_id
      ? String(user.branch_id)
      : branches[0]
      ? String(branches[0].id)
      : '';
    setIdempotencyKey(`iss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setForm({
      branch_id: defaultBranch,
      issue_type: 'sale',
      reference_number: '',
      reason: '',
      issue_date: new Date().toISOString().slice(0, 10),
      notes: '',
    });
    setLines([{ product_id: '', quantity: 1 }]);
    loadBranchStock(defaultBranch);
    setCreateOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setBanner(null);
    try {
      const payload = {
        branch_id: Number(form.branch_id),
        issue_type: form.issue_type,
        reference_number: form.reference_number,
        reason: form.reason,
        issue_date: form.issue_date,
        notes: form.notes,
        idempotency_key: idempotencyKey,
        items: lines
          .filter((l) => l.product_id)
          .map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity) })),
      };
      const res = await apiRequest<{ issue: StockIssue }>('/api/stock-issues', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setCreateOpen(false);
      setBanner({
        type: 'success',
        text: `Stock Issue ${res.issue.issue_number} recorded. Branch stock deducted and ledger updated.`,
      });
      await loadIssues();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Stock issue failed' });
    } finally {
      setSubmitting(false);
    }
  }

  async function openDetail(id: number) {
    try {
      const res = await apiRequest<{ issue: StockIssue }>(`/api/stock-issues/${id}`);
      setSelectedIssue(res.issue);
      setDetailOpen(true);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load issue' });
    }
  }

  return (
    <div className="space-y-4">
      {banner && (
        <AlertBanner type={banner.type} message={banner.text} onClose={() => setBanner(null)} />
      )}

      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search issue #, reference, reason..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded"
            />
          </div>
          {isGlobal && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
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
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded bg-white"
          >
            <option value="">All Issue Types</option>
            <option value="sale">Sale</option>
            <option value="damage">Damage</option>
            <option value="expiry">Expiry</option>
            <option value="adjustment">Adjustment</option>
            <option value="transfer">Transfer</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2.5 py-1.5 text-sm border border-slate-300 rounded"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2.5 py-1.5 text-sm border border-slate-300 rounded"
          />
        </div>

        {canIssue && (
          <button
            type="button"
            onClick={openNewIssue}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Record Stock Issue</span>
          </button>
        )}
      </div>

      {issues.length === 0 ? (
        <EmptyState
          title="No stock issues found"
          description="Record sales issues, damaged goods, expired stock removals, or authorized adjustments."
          actionLabel={canIssue ? 'Record Stock Issue' : undefined}
          onAction={canIssue ? openNewIssue : undefined}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#1A3A5C] text-white">
                  <th className="py-3 px-4 font-semibold">Issue Number</th>
                  <th className="py-3 px-4 font-semibold">Date</th>
                  <th className="py-3 px-4 font-semibold">Branch</th>
                  <th className="py-3 px-4 font-semibold">Type</th>
                  <th className="py-3 px-4 font-semibold">Reason / Reference</th>
                  <th className="py-3 px-4 font-semibold text-right">Total Qty</th>
                  <th className="py-3 px-4 font-semibold text-right">Value</th>
                  <th className="py-3 px-4 font-semibold">Issued By</th>
                  <th className="py-3 px-4 font-semibold text-right">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {issues.map((iss) => (
                  <tr key={iss.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono-num font-semibold text-[#1A3A5C]">
                      {iss.issue_number}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">{formatDate(iss.issue_date)}</td>
                    <td className="py-3 px-4">{iss.branch_name}</td>
                    <td className="py-3 px-4">
                      <StatusTag status={iss.issue_type} />
                    </td>
                    <td className="py-3 px-4 max-w-xs truncate">
                      {iss.reason || iss.reference_number || '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold">
                      {iss.total_quantity}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold text-[#1A3A5C]">
                      {formatUGX(iss.grand_total)}
                    </td>
                    <td className="py-3 px-4">{iss.issued_by_name}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openDetail(iss.id)}
                        className="p-1.5 text-slate-600 hover:text-[#1A3A5C] rounded hover:bg-slate-100"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Stock Issue Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Record Stock Issue"
        subtitle="Stock cannot be issued above available branch quantity. All deductions write to the ledger."
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Branch *</label>
              <select
                required
                disabled={!isGlobal}
                value={form.branch_id}
                onChange={(e) => {
                  setForm({ ...form, branch_id: e.target.value });
                  loadBranchStock(e.target.value);
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white disabled:bg-slate-100"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Issue Type *</label>
              <select
                required
                value={form.issue_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    issue_type: e.target.value as 'sale' | 'damage' | 'expiry' | 'adjustment',
                  })
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              >
                <option value="sale">Sale</option>
                <option value="damage">Damage</option>
                <option value="expiry">Expiry</option>
                <option value="adjustment">Adjustment</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Issue Date *</label>
              <input
                type="date"
                required
                value={form.issue_date}
                onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Reference Number
              </label>
              <input
                type="text"
                value={form.reference_number}
                onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                placeholder="e.g. BATCH-SALE-042 or DMG-011"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Reason {['damage', 'expiry', 'adjustment'].includes(form.issue_type) ? '*' : '(Optional)'}
              </label>
              <input
                type="text"
                required={['damage', 'expiry', 'adjustment'].includes(form.issue_type)}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Required for damage, expiry, or adjustments"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
          </div>

          {/* Line Items */}
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2.5 bg-[#F5F7FA] border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1A3A5C]">Items to Issue</span>
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, { product_id: '', quantity: 1 }])}
                className="text-xs font-semibold text-[#E67E22] hover:underline"
              >
                + Add Line
              </button>
            </div>
            <div className="p-3 space-y-2.5">
              {lines.map((line, idx) => {
                const stockRec = branchStocks.find((s) => String(s.product_id) === line.product_id);
                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-12 sm:col-span-7">
                      <select
                        required
                        value={line.product_id}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, product_id: e.target.value } : l
                            )
                          )
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                      >
                        <option value="">Select product...</option>
                        {branchStocks.map((s) => (
                          <option key={s.product_id} value={s.product_id}>
                            {s.sku} · {s.product_name} (Avail: {s.quantity_on_hand})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-5 sm:col-span-2">
                      <input
                        type="number"
                        min={1}
                        required
                        value={line.quantity}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, quantity: Number(e.target.value) } : l
                            )
                          )
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded font-mono-num text-right"
                      />
                    </div>
                    <div className="col-span-5 sm:col-span-2 text-xs text-right font-mono-num text-slate-600">
                      {stockRec ? `Avail: ${stockRec.quantity_on_hand}` : '—'}
                    </div>
                    <div className="col-span-2 sm:col-span-1 text-right">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-1 text-slate-400 hover:text-red-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Additional Notes</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 text-sm font-medium border border-slate-300 rounded text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded disabled:opacity-60"
            >
              {submitting ? 'Processing...' : 'Confirm Stock Issue'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <Modal
        open={detailOpen && Boolean(selectedIssue)}
        onClose={() => setDetailOpen(false)}
        title={selectedIssue ? `Stock Issue — ${selectedIssue.issue_number}` : 'Stock Issue'}
        subtitle={
          selectedIssue
            ? `${selectedIssue.branch_name} · ${formatDate(selectedIssue.issue_date)}`
            : ''
        }
        maxWidth="max-w-2xl"
      >
        {selectedIssue && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Classification</div>
                <div className="mt-1">
                  <StatusTag status={selectedIssue.issue_type} />
                </div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Issued By</div>
                <div className="mt-1 font-medium">{selectedIssue.issued_by_name}</div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Reason</div>
                <div className="mt-1">{selectedIssue.reason || '—'}</div>
              </div>
            </div>

            <table className="w-full text-left border border-slate-200">
              <thead>
                <tr className="bg-[#1A3A5C] text-white">
                  <th className="py-2 px-3">SKU</th>
                  <th className="py-2 px-3">Product</th>
                  <th className="py-2 px-3 text-right">Quantity</th>
                  <th className="py-2 px-3 text-right">Unit Cost</th>
                  <th className="py-2 px-3 text-right">Total Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(selectedIssue.items || []).map((it) => (
                  <tr key={it.id}>
                    <td className="py-2 px-3 font-mono-num">{it.sku}</td>
                    <td className="py-2 px-3 font-medium">{it.product_name}</td>
                    <td className="py-2 px-3 text-right font-mono-num font-semibold">
                      {it.quantity} {it.unit_of_measure}
                    </td>
                    <td className="py-2 px-3 text-right font-mono-num">
                      {formatUGX(it.unit_cost)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono-num font-semibold">
                      {formatUGX(it.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
