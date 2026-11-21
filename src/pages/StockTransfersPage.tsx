import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Eye, Plus, Search, Trash2, Truck } from 'lucide-react';
import { apiRequest, formatDateTime } from '../api/client';
import { AlertBanner, EmptyState, Modal, StatusTag } from '../components/StatusTag';
import type { Branch, Product, StockTransfer, User } from '../types';

export function StockTransfersPage({ user }: { user: User }) {
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<StockTransfer | null>(null);

  const [form, setForm] = useState({
    source_branch_id: '',
    destination_branch_id: user.branch_id ? String(user.branch_id) : '',
    notes: '',
    submit_immediately: true,
  });
  const [lines, setLines] = useState<Array<{ product_id: string; quantity_requested: number }>>([
    { product_id: '', quantity_requested: 1 },
  ]);

  const [receiveQuantities, setReceiveQuantities] = useState<Record<number, number>>({});
  const [discrepancyNotes, setDiscrepancyNotes] = useState('');

  const isGlobal = user.role === 'admin' || user.role === 'procurement_manager';
  const canCreate = user.role !== 'stock_controller';

  async function loadLookups() {
    const [bRes, pRes] = await Promise.all([
      apiRequest<{ branches: Branch[] }>('/api/branches'),
      apiRequest<{ products: Product[] }>('/api/products?limit=100&status=active'),
    ]);
    setBranches(bRes.branches);
    setProducts(pRes.products);
  }

  async function loadTransfers() {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await apiRequest<{ transfers: StockTransfer[] }>(
        `/api/transfers?${params.toString()}`
      );
      setTransfers(res.transfers);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load transfers' });
    }
  }

  useEffect(() => {
    loadLookups();
  }, []);

  useEffect(() => {
    loadTransfers();
  }, [statusFilter, search]);

  function openNewTransfer() {
    const firstSource = branches.find((b) => b.id !== user.branch_id)?.id || branches[0]?.id;
    const firstDest = user.branch_id || branches.find((b) => b.id !== firstSource)?.id;
    setForm({
      source_branch_id: firstSource ? String(firstSource) : '',
      destination_branch_id: firstDest ? String(firstDest) : '',
      notes: '',
      submit_immediately: true,
    });
    setLines([{ product_id: '', quantity_requested: 1 }]);
    setCreateOpen(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    try {
      const payload = {
        source_branch_id: Number(form.source_branch_id),
        destination_branch_id: Number(form.destination_branch_id),
        notes: form.notes,
        submit_immediately: form.submit_immediately,
        items: lines
          .filter((l) => l.product_id)
          .map((l) => ({
            product_id: Number(l.product_id),
            quantity_requested: Number(l.quantity_requested),
          })),
      };
      const res = await apiRequest<{ transfer: StockTransfer }>('/api/transfers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setCreateOpen(false);
      setBanner({
        type: 'success',
        text: `Transfer ${res.transfer.transfer_number} created (${res.transfer.status.replace('_', ' ')}).`,
      });
      await loadTransfers();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Transfer creation failed' });
    }
  }

  async function openDetail(id: number) {
    try {
      const res = await apiRequest<{ transfer: StockTransfer }>(`/api/transfers/${id}`);
      setSelected(res.transfer);
      const initRecv: Record<number, number> = {};
      for (const it of res.transfer.items || []) {
        initRecv[it.product_id] = it.quantity_dispatched || it.quantity_requested;
      }
      setReceiveQuantities(initRecv);
      setDiscrepancyNotes('');
      setDetailOpen(true);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load transfer' });
    }
  }

  async function runTransition(action: 'submit' | 'approve' | 'reject' | 'cancel' | 'dispatch') {
    if (!selected) return;
    try {
      const res = await apiRequest<{ transfer: StockTransfer }>(
        `/api/transfers/${selected.id}/transition`,
        {
          method: 'POST',
          body: JSON.stringify({ action }),
        }
      );
      setSelected(res.transfer);
      setBanner({
        type: 'success',
        text: `Transfer ${res.transfer.transfer_number} updated to ${res.transfer.status.replace('_', ' ')}.`,
      });
      await loadTransfers();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Transition failed' });
    }
  }

  async function handleReceive() {
    if (!selected) return;
    try {
      const items = (selected.items || []).map((it) => ({
        product_id: it.product_id,
        quantity_received: receiveQuantities[it.product_id] ?? it.quantity_dispatched,
      }));
      const res = await apiRequest<{ transfer: StockTransfer }>(
        `/api/transfers/${selected.id}/receive`,
        {
          method: 'POST',
          body: JSON.stringify({ items, discrepancy_notes: discrepancyNotes }),
        }
      );
      setSelected(res.transfer);
      setBanner({
        type: 'success',
        text: `Transfer ${res.transfer.transfer_number} confirmed received. Destination branch stock credited.`,
      });
      await loadTransfers();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Receipt failed' });
    }
  }

  return (
    <div className="space-y-4">
      {banner && (
        <AlertBanner type={banner.type} message={banner.text} onClose={() => setBanner(null)} />
      )}

      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search transfer # or branch..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded bg-white"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="in_transit">In Transit</option>
            <option value="received">Received</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={openNewTransfer}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Inter-Branch Transfer</span>
          </button>
        )}
      </div>

      {transfers.length === 0 ? (
        <EmptyState
          title="No inter-branch transfers found"
          description="Request or dispatch stock transfers between Ntinda, Najjera, and Kyaliwajjala."
          actionLabel={canCreate ? 'New Transfer' : undefined}
          onAction={canCreate ? openNewTransfer : undefined}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#1A3A5C] text-white">
                  <th className="py-3 px-4 font-semibold">Transfer #</th>
                  <th className="py-3 px-4 font-semibold">Route</th>
                  <th className="py-3 px-4 font-semibold">Requested By</th>
                  <th className="py-3 px-4 font-semibold text-right">Items</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Updated</th>
                  <th className="py-3 px-4 font-semibold text-right">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono-num font-semibold text-[#1A3A5C]">
                      {t.transfer_number}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-medium">{t.source_branch_name}</span>
                      <ArrowRight className="w-3 h-3 inline mx-1.5 text-slate-400" />
                      <span className="font-medium">{t.destination_branch_name}</span>
                    </td>
                    <td className="py-3 px-4">{t.requested_by_name}</td>
                    <td className="py-3 px-4 text-right font-mono-num">{t.item_count}</td>
                    <td className="py-3 px-4">
                      <StatusTag status={t.status} />
                    </td>
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                      {formatDateTime(t.created_at)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openDetail(t.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-slate-200 rounded hover:bg-slate-100"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Open</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Transfer Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Inter-Branch Stock Transfer"
        subtitle="Source branch stock is validated immediately and deducted upon dispatch."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Source Branch *
              </label>
              <select
                required
                value={form.source_branch_id}
                onChange={(e) => setForm({ ...form, source_branch_id: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Destination Branch *
              </label>
              <select
                required
                value={form.destination_branch_id}
                onChange={(e) => setForm({ ...form, destination_branch_id: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2.5 bg-[#F5F7FA] border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1A3A5C]">Products to Transfer</span>
              <button
                type="button"
                onClick={() =>
                  setLines((prev) => [...prev, { product_id: '', quantity_requested: 1 }])
                }
                className="text-xs font-semibold text-[#E67E22] hover:underline"
              >
                + Add Line
              </button>
            </div>
            <div className="p-3 space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-8">
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
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} · {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <input
                      type="number"
                      min={1}
                      required
                      value={line.quantity_requested}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, quantity_requested: Number(e.target.value) } : l
                          )
                        )
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded font-mono-num text-right"
                    />
                  </div>
                  <div className="col-span-1 text-right">
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
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Transfer Notes</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={form.submit_immediately}
              onChange={(e) => setForm({ ...form, submit_immediately: e.target.checked })}
            />
            <span>Submit immediately for Approval (uncheck to save as Draft)</span>
          </label>

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
              className="px-4 py-2 text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded"
            >
              Create Transfer
            </button>
          </div>
        </form>
      </Modal>

      {/* Transfer Workflow & Receipt Confirmation Modal */}
      <Modal
        open={detailOpen && Boolean(selected)}
        onClose={() => setDetailOpen(false)}
        title={selected ? `Stock Transfer — ${selected.transfer_number}` : 'Transfer'}
        subtitle={
          selected
            ? `${selected.source_branch_name} → ${selected.destination_branch_name}`
            : ''
        }
        maxWidth="max-w-3xl"
      >
        {selected && (
          <div className="space-y-5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-[#F5F7FA] border border-slate-200 rounded">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Current Status:</span>
                <StatusTag status={selected.status} />
              </div>
              <div className="text-slate-600">
                Requested by <span className="font-medium">{selected.requested_by_name}</span>
                {selected.approved_by_name && ` · Approved by ${selected.approved_by_name}`}
                {selected.dispatched_by_name && ` · Dispatched by ${selected.dispatched_by_name}`}
                {selected.received_by_name && ` · Received by ${selected.received_by_name}`}
              </div>
            </div>

            <table className="w-full text-left border border-slate-200">
              <thead>
                <tr className="bg-[#1A3A5C] text-white">
                  <th className="py-2 px-3">SKU</th>
                  <th className="py-2 px-3">Product</th>
                  <th className="py-2 px-3 text-right">Requested</th>
                  <th className="py-2 px-3 text-right">Dispatched</th>
                  <th className="py-2 px-3 text-right">Received</th>
                  <th className="py-2 px-3 text-right">Discrepancy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(selected.items || []).map((it) => {
                  const canConfirmReceipt =
                    ['in_transit', 'dispatched'].includes(selected.status) &&
                    (isGlobal || user.branch_id === selected.destination_branch_id);
                  return (
                    <tr key={it.id}>
                      <td className="py-2 px-3 font-mono-num">{it.sku}</td>
                      <td className="py-2 px-3 font-medium">{it.product_name}</td>
                      <td className="py-2 px-3 text-right font-mono-num">{it.quantity_requested}</td>
                      <td className="py-2 px-3 text-right font-mono-num">{it.quantity_dispatched}</td>
                      <td className="py-2 px-3 text-right font-mono-num">
                        {canConfirmReceipt ? (
                          <input
                            type="number"
                            min={0}
                            max={it.quantity_dispatched}
                            value={receiveQuantities[it.product_id] ?? it.quantity_dispatched}
                            onChange={(e) =>
                              setReceiveQuantities((prev) => ({
                                ...prev,
                                [it.product_id]: Number(e.target.value),
                              }))
                            }
                            className="w-20 px-2 py-1 text-xs border border-slate-300 rounded text-right font-mono-num"
                          />
                        ) : (
                          it.quantity_received
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-num text-red-700 font-semibold">
                        {it.discrepancy_quantity > 0 ? `-${it.discrepancy_quantity}` : '0'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {selected.notes && (
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded text-slate-700">
                <span className="font-semibold">Notes: </span>
                {selected.notes}
              </div>
            )}

            {selected.discrepancy_notes && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-900">
                <span className="font-semibold">Discrepancy Notes: </span>
                {selected.discrepancy_notes}
              </div>
            )}

            {/* Receipt Discrepancy Box when ready to receive */}
            {['in_transit', 'dispatched'].includes(selected.status) &&
              (isGlobal || user.branch_id === selected.destination_branch_id) && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Discrepancy / Receiving Notes (Required if received qty differs from dispatched)
                  </label>
                  <input
                    type="text"
                    value={discrepancyNotes}
                    onChange={(e) => setDiscrepancyNotes(e.target.value)}
                    placeholder="Enter reason for any short-delivery or damaged units..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
                  />
                </div>
              )}

            {/* Workflow Action Buttons */}
            <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-slate-200">
              {selected.status === 'draft' && canCreate && (
                <>
                  <button
                    type="button"
                    onClick={() => runTransition('cancel')}
                    className="px-3 py-2 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50"
                  >
                    Cancel Transfer
                  </button>
                  <button
                    type="button"
                    onClick={() => runTransition('submit')}
                    className="px-4 py-2 text-xs font-medium bg-[#E67E22] text-white rounded hover:bg-[#cf6d17]"
                  >
                    Submit for Approval
                  </button>
                </>
              )}

              {selected.status === 'pending_approval' &&
                user.role !== 'stock_controller' &&
                (isGlobal || user.branch_id === selected.source_branch_id) && (
                  <>
                    <button
                      type="button"
                      onClick={() => runTransition('reject')}
                      className="px-3 py-2 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => runTransition('approve')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#1A3A5C] text-white rounded hover:bg-[#142d47]"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve Transfer</span>
                    </button>
                  </>
                )}

              {selected.status === 'approved' &&
                (isGlobal || user.branch_id === selected.source_branch_id) && (
                  <button
                    type="button"
                    onClick={() => runTransition('dispatch')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#E67E22] text-white rounded hover:bg-[#cf6d17]"
                  >
                    <Truck className="w-3.5 h-3.5" />
                    <span>Dispatch & Deduct Source Stock</span>
                  </button>
                )}

              {['in_transit', 'dispatched'].includes(selected.status) &&
                (isGlobal || user.branch_id === selected.destination_branch_id) && (
                  <button
                    type="button"
                    onClick={handleReceive}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-emerald-700 text-white rounded hover:bg-emerald-800"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Confirm Receipt at Destination</span>
                  </button>
                )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
