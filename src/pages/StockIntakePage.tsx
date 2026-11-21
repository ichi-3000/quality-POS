import React, { useEffect, useState } from 'react';
import { Eye, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { apiRequest, formatDate, formatUGX } from '../api/client';
import { AlertBanner, EmptyState, Modal } from '../components/StatusTag';
import type { Branch, Grn, Product, PurchaseOrder, Supplier, User } from '../types';

export function StockIntakePage({ user }: { user: User }) {
  const [grns, setGrns] = useState<Grn[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [openPos, setOpenPos] = useState<PurchaseOrder[]>([]);

  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedGrn, setSelectedGrn] = useState<Grn | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [form, setForm] = useState({
    branch_id: user.branch_id ? String(user.branch_id) : '',
    supplier_id: '',
    purchase_order_id: '',
    delivery_note_number: '',
    date_received: new Date().toISOString().slice(0, 10),
    remarks: '',
  });
  const [lines, setLines] = useState<
    Array<{ product_id: string; quantity_received: number; unit_cost: number }>
  >([{ product_id: '', quantity_received: 1, unit_cost: 0 }]);

  const isGlobal = user.role === 'admin' || user.role === 'procurement_manager';
  const canRecordGrn = user.role !== 'procurement_manager';

  async function loadLookups() {
    const [bRes, sRes, pRes, poRes] = await Promise.all([
      apiRequest<{ branches: Branch[] }>('/api/branches'),
      apiRequest<{ suppliers: Supplier[] }>('/api/suppliers?status=active'),
      apiRequest<{ products: Product[] }>('/api/products?limit=100&status=active'),
      apiRequest<{ purchaseOrders: PurchaseOrder[] }>('/api/purchase-orders'),
    ]);
    setBranches(bRes.branches);
    setSuppliers(sRes.suppliers);
    setProducts(pRes.products);
    setOpenPos(
      poRes.purchaseOrders.filter((po) => ['sent', 'partially_received'].includes(po.status))
    );
  }

  async function loadGrns() {
    try {
      const params = new URLSearchParams();
      if (isGlobal && branchFilter) params.set('branch_id', branchFilter);
      if (search.trim()) params.set('search', search.trim());
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const res = await apiRequest<{ grns: Grn[] }>(`/api/grns?${params.toString()}`);
      setGrns(res.grns);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load GRNs' });
    }
  }

  useEffect(() => {
    loadLookups();
  }, []);

  useEffect(() => {
    loadGrns();
  }, [search, branchFilter, dateFrom, dateTo]);

  function openNewGrn() {
    setIdempotencyKey(`grn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setForm({
      branch_id: user.branch_id ? String(user.branch_id) : branches[0] ? String(branches[0].id) : '',
      supplier_id: suppliers[0] ? String(suppliers[0].id) : '',
      purchase_order_id: '',
      delivery_note_number: '',
      date_received: new Date().toISOString().slice(0, 10),
      remarks: '',
    });
    setLines([{ product_id: '', quantity_received: 1, unit_cost: 0 }]);
    setCreateOpen(true);
  }

  async function handlePoSelect(poIdStr: string) {
    setForm((f) => ({ ...f, purchase_order_id: poIdStr }));
    if (!poIdStr) return;
    try {
      const res = await apiRequest<{ purchaseOrder: PurchaseOrder }>(
        `/api/purchase-orders/${poIdStr}`
      );
      const po = res.purchaseOrder;
      setForm((f) => ({
        ...f,
        purchase_order_id: poIdStr,
        supplier_id: String(po.supplier_id),
        branch_id: String(po.branch_id),
      }));
      const remainingLines = (po.items || [])
        .filter((i) => (i.quantity_remaining ?? i.quantity_ordered - (i.quantity_received || 0)) > 0)
        .map((i) => ({
          product_id: String(i.product_id),
          quantity_received:
            i.quantity_remaining ?? i.quantity_ordered - (i.quantity_received || 0),
          unit_cost: i.unit_cost,
        }));
      if (remainingLines.length > 0) {
        setLines(remainingLines);
      }
    } catch {
      // ignore
    }
  }

  function handleProductChange(idx: number, prodIdStr: string) {
    const prod = products.find((p) => String(p.id) === prodIdStr);
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx
          ? { ...l, product_id: prodIdStr, unit_cost: prod ? prod.unit_cost : 0 }
          : l
      )
    );
  }

  async function handleSubmitGrn(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setBanner(null);
    try {
      const payload = {
        branch_id: Number(form.branch_id),
        supplier_id: Number(form.supplier_id),
        purchase_order_id: form.purchase_order_id ? Number(form.purchase_order_id) : null,
        delivery_note_number: form.delivery_note_number,
        date_received: form.date_received,
        remarks: form.remarks,
        idempotency_key: idempotencyKey,
        items: lines
          .filter((l) => l.product_id)
          .map((l) => ({
            product_id: Number(l.product_id),
            quantity_received: Number(l.quantity_received),
            unit_cost: Number(l.unit_cost),
          })),
      };

      const res = await apiRequest<{ grn: Grn }>('/api/grns', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setCreateOpen(false);
      setBanner({
        type: 'success',
        text: `GRN ${res.grn.grn_number} recorded. Stock and inventory ledger updated atomically.`,
      });
      await Promise.all([loadGrns(), loadLookups()]);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'GRN submission failed' });
    } finally {
      setSubmitting(false);
    }
  }

  async function openGrnDetail(id: number) {
    try {
      const res = await apiRequest<{ grn: Grn }>(`/api/grns/${id}`);
      setSelectedGrn(res.grn);
      setDetailOpen(true);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load GRN' });
    }
  }

  const grandTotal = lines.reduce(
    (sum, l) => sum + (Number(l.quantity_received) || 0) * (Number(l.unit_cost) || 0),
    0
  );

  return (
    <div className="space-y-4">
      {banner && (
        <AlertBanner type={banner.type} message={banner.text} onClose={() => setBanner(null)} />
      )}

      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-center gap-2.5 flex-1">
          <div className="relative sm:col-span-2 lg:flex-1 lg:min-w-[200px] lg:max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search GRN #, supplier, DN #..."
              className="w-full pl-9 pr-3 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded"
            />
          </div>
          {isGlobal && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
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
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Date from"
            className="w-full lg:w-auto px-2.5 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Date to"
            className="w-full lg:w-auto px-2.5 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded"
          />
        </div>

        {canRecordGrn && (
          <button
            type="button"
            onClick={openNewGrn}
            className="w-full lg:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New GRN / Stock Intake</span>
          </button>
        )}
      </div>

      {grns.length === 0 ? (
        <EmptyState
          title="No Goods Received Notes found"
          description="Record physical supplier deliveries to increase branch stock and update the ledger."
          actionLabel={canRecordGrn ? 'New GRN' : undefined}
          onAction={canRecordGrn ? openNewGrn : undefined}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          {/* Mobile GRN Cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {grns.map((g) => (
              <div key={`m-grn-${g.id}`} className="p-4 space-y-2.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono-num font-semibold text-[#1A3A5C] text-sm">
                      {g.grn_number}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {formatDate(g.date_received)} · {g.branch_name}
                    </div>
                  </div>
                  <div className="text-right font-mono-num font-bold text-[#1A3A5C] text-sm">
                    {formatUGX(g.grand_total)}
                  </div>
                </div>
                <div className="font-medium text-slate-900">{g.supplier_name}</div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="font-mono-num">
                    {g.po_number || 'Direct'}{' '}
                    {g.delivery_note_number ? `· DN ${g.delivery_note_number}` : ''}
                  </span>
                  <span>
                    {g.item_count} items · {g.received_by_name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openGrnDetail(g.id)}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50 text-[#1A3A5C]"
                >
                  <Eye className="w-4 h-4" />
                  <span>View GRN Voucher</span>
                </button>
              </div>
            ))}
          </div>

          {/* Desktop GRN Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#1A3A5C] text-white">
                  <th className="py-3 px-4 font-semibold">GRN Number</th>
                  <th className="py-3 px-4 font-semibold">Date Received</th>
                  <th className="py-3 px-4 font-semibold">Branch</th>
                  <th className="py-3 px-4 font-semibold">Supplier</th>
                  <th className="py-3 px-4 font-semibold">PO / Delivery Note</th>
                  <th className="py-3 px-4 font-semibold text-right">Items</th>
                  <th className="py-3 px-4 font-semibold text-right">Grand Total</th>
                  <th className="py-3 px-4 font-semibold">Received By</th>
                  <th className="py-3 px-4 font-semibold text-right">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {grns.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono-num font-semibold text-[#1A3A5C]">
                      {g.grn_number}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">{formatDate(g.date_received)}</td>
                    <td className="py-3 px-4">{g.branch_name}</td>
                    <td className="py-3 px-4 font-medium">{g.supplier_name}</td>
                    <td className="py-3 px-4 font-mono-num text-slate-600">
                      {g.po_number || 'Direct'} {g.delivery_note_number ? `· DN ${g.delivery_note_number}` : ''}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num">{g.item_count}</td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold text-[#1A3A5C]">
                      {formatUGX(g.grand_total)}
                    </td>
                    <td className="py-3 px-4">{g.received_by_name}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openGrnDetail(g.id)}
                        className="p-1.5 text-slate-600 hover:text-[#1A3A5C] rounded hover:bg-slate-100"
                        title="View GRN Voucher"
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

      {/* Create GRN Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Record Goods Received Note (GRN)"
        subtitle="Atomic stock intake — automatically increases branch stock and writes ledger entries."
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleSubmitGrn} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Link Purchase Order (Optional)
              </label>
              <select
                value={form.purchase_order_id}
                onChange={(e) => handlePoSelect(e.target.value)}
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded bg-white"
              >
                <option value="">Direct Delivery (No PO)</option>
                {openPos
                  .filter((po) => isGlobal || po.branch_id === user.branch_id)
                  .map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.po_number} · {po.supplier_name} ({po.branch_code})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Receiving Branch *
              </label>
              <select
                required
                disabled={!isGlobal || Boolean(form.purchase_order_id)}
                value={form.branch_id}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded bg-white disabled:bg-slate-100"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Supplier *</label>
              <select
                required
                disabled={Boolean(form.purchase_order_id)}
                value={form.supplier_id}
                onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded bg-white disabled:bg-slate-100"
              >
                <option value="">Select supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Delivery Note #
              </label>
              <input
                type="text"
                value={form.delivery_note_number}
                onChange={(e) => setForm({ ...form, delivery_note_number: e.target.value })}
                placeholder="e.g. DN-90211"
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Date Received *
              </label>
              <input
                type="date"
                required
                value={form.date_received}
                onChange={(e) => setForm({ ...form, date_received: e.target.value })}
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded"
              />
            </div>
          </div>

          {/* Line Items */}
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2.5 bg-[#F5F7FA] border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1A3A5C]">Received Line Items</span>
              <button
                type="button"
                onClick={() =>
                  setLines((prev) => [
                    ...prev,
                    { product_id: '', quantity_received: 1, unit_cost: 0 },
                  ])
                }
                className="text-xs font-semibold text-[#E67E22] hover:underline min-h-[36px] px-2"
              >
                + Add Product Line
              </button>
            </div>
            <div className="p-3 space-y-3 sm:space-y-2.5">
              {lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-center bg-[#F5F7FA] sm:bg-transparent p-2.5 sm:p-0 rounded sm:rounded-none border sm:border-0 border-slate-200"
                >
                  <div className="col-span-12 sm:col-span-5">
                    <label className="sm:hidden block text-[11px] font-medium text-slate-600 mb-1">
                      Product
                    </label>
                    <select
                      required
                      value={line.product_id}
                      onChange={(e) => handleProductChange(idx, e.target.value)}
                      className="w-full px-2.5 py-2 sm:py-1.5 min-h-[44px] sm:min-h-[34px] text-xs border border-slate-300 rounded bg-white"
                    >
                      <option value="">Select product...</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} · {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <label className="sm:hidden block text-[11px] font-medium text-slate-600 mb-1">
                      Qty Received
                    </label>
                    <input
                      type="number"
                      min={1}
                      required
                      value={line.quantity_received}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, quantity_received: Number(e.target.value) } : l
                          )
                        )
                      }
                      placeholder="Qty"
                      className="w-full px-2.5 py-2 sm:py-1.5 min-h-[44px] sm:min-h-[34px] text-xs border border-slate-300 rounded font-mono-num text-right bg-white"
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <label className="sm:hidden block text-[11px] font-medium text-slate-600 mb-1">
                      Unit Cost
                    </label>
                    <input
                      type="number"
                      min={0}
                      required
                      disabled={user.role !== 'admin'}
                      value={line.unit_cost}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, unit_cost: Number(e.target.value) } : l
                          )
                        )
                      }
                      className="w-full px-2.5 py-2 sm:py-1.5 min-h-[44px] sm:min-h-[34px] text-xs border border-slate-300 rounded font-mono-num text-right bg-white disabled:bg-slate-100"
                    />
                  </div>
                  <div className="col-span-9 sm:col-span-2 sm:text-right text-xs font-mono-num font-semibold text-slate-800">
                    <span className="sm:hidden text-slate-500 font-sans font-normal mr-1">Total:</span>
                    {formatUGX(line.quantity_received * line.unit_cost)}
                  </div>
                  <div className="col-span-3 sm:col-span-1 text-right">
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                        className="min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 inline-flex items-center justify-center p-1.5 text-slate-500 hover:text-red-700"
                        aria-label="Remove line"
                      >
                        <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 bg-[#F5F7FA] border-t border-slate-200 flex items-center justify-between text-xs font-semibold">
              <span className="text-slate-600">Grand Total</span>
              <span className="font-mono-num text-sm text-[#1A3A5C]">{formatUGX(grandTotal)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Remarks</label>
            <textarea
              rows={2}
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              placeholder="Condition of goods, vehicle registration, or batch notes..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-sm font-medium border border-slate-300 rounded text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded disabled:opacity-60"
            >
              {submitting ? 'Processing GRN...' : 'Confirm & Post GRN'}
            </button>
          </div>
        </form>
      </Modal>

      {/* GRN Detail Voucher Modal */}
      <Modal
        open={detailOpen && Boolean(selectedGrn)}
        onClose={() => setDetailOpen(false)}
        title={selectedGrn ? `Goods Received Note — ${selectedGrn.grn_number}` : 'GRN'}
        subtitle={
          selectedGrn
            ? `${selectedGrn.branch_name} · Received on ${formatDate(selectedGrn.date_received)}`
            : ''
        }
        maxWidth="max-w-3xl"
      >
        {selectedGrn && (
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Supplier</div>
                <div className="mt-1 font-semibold">{selectedGrn.supplier_name}</div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Purchase Order</div>
                <div className="mt-1 font-mono-num font-semibold">
                  {selectedGrn.po_number || 'Direct Delivery'}
                </div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Delivery Note #</div>
                <div className="mt-1 font-mono-num">{selectedGrn.delivery_note_number || '—'}</div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Received By</div>
                <div className="mt-1 font-medium">{selectedGrn.received_by_name}</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border border-slate-200">
                <thead>
                  <tr className="bg-[#1A3A5C] text-white">
                    <th className="py-2 px-3">SKU</th>
                    <th className="py-2 px-3">Product</th>
                    <th className="py-2 px-3 text-right">Qty Received</th>
                    <th className="py-2 px-3 text-right">Unit Cost</th>
                    <th className="py-2 px-3 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(selectedGrn.items || []).map((it) => (
                    <tr key={it.id}>
                      <td className="py-2 px-3 font-mono-num whitespace-nowrap">{it.sku}</td>
                      <td className="py-2 px-3 font-medium">{it.product_name}</td>
                      <td className="py-2 px-3 text-right font-mono-num font-semibold whitespace-nowrap">
                        {it.quantity_received} {it.unit_of_measure}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-num whitespace-nowrap">
                        {formatUGX(it.unit_cost)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-num font-semibold whitespace-nowrap">
                        {formatUGX(it.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[#F5F7FA] border-t border-slate-200 font-semibold">
                    <td colSpan={4} className="py-2.5 px-3 text-right">
                      Grand Total
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num text-[#1A3A5C] whitespace-nowrap">
                      {formatUGX(selectedGrn.grand_total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {selectedGrn.remarks && (
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <span className="font-semibold text-slate-700">Remarks: </span>
                <span className="text-slate-600">{selectedGrn.remarks}</span>
              </div>
            )}

            <div className="flex justify-end no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] text-xs font-medium bg-[#1A3A5C] text-white rounded hover:bg-[#142d47]"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print GRN Voucher</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
