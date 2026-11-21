import React, { useEffect, useState } from 'react';
import { Download, Eye, Plus, Printer, Search, Send, Trash2, XCircle } from 'lucide-react';
import { apiRequest, exportTableToPdf, formatDate, formatUGX } from '../api/client';
import type { NavRoute } from '../components/Layout';
import { AlertBanner, EmptyState, Modal, StatusTag } from '../components/StatusTag';
import type { Branch, Product, PurchaseOrder, Supplier, User } from '../types';

export function PurchaseOrdersPage({
  user,
  onNavigate,
}: {
  user: User;
  onNavigate: (route: NavRoute) => void;
}) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingPo, setEditingPo] = useState<PurchaseOrder | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedPo, setSelectedPo] = useState<PurchaseOrder | null>(null);

  const [form, setForm] = useState({
    supplier_id: '',
    branch_id: '',
    order_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: '',
    notes: '',
    status: 'draft' as 'draft' | 'sent',
  });
  const [lines, setLines] = useState<
    Array<{ product_id: string; quantity_ordered: number; unit_cost: number }>
  >([{ product_id: '', quantity_ordered: 10, unit_cost: 0 }]);

  const canManage = user.role === 'admin' || user.role === 'procurement_manager';

  async function loadLookups() {
    const [sRes, bRes, pRes] = await Promise.all([
      apiRequest<{ suppliers: Supplier[] }>('/api/suppliers?status=active'),
      apiRequest<{ branches: Branch[] }>('/api/branches'),
      apiRequest<{ products: Product[] }>('/api/products?limit=100&status=active'),
    ]);
    setSuppliers(sRes.suppliers);
    setBranches(bRes.branches);
    setProducts(pRes.products);
  }

  async function loadOrders() {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await apiRequest<{ purchaseOrders: PurchaseOrder[] }>(
        `/api/purchase-orders?${params.toString()}`
      );
      setOrders(res.purchaseOrders);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load POs' });
    }
  }

  useEffect(() => {
    loadLookups();
  }, []);

  useEffect(() => {
    loadOrders();
  }, [statusFilter, search]);

  function openNewPo() {
    setEditingPo(null);
    setForm({
      supplier_id: suppliers[0] ? String(suppliers[0].id) : '',
      branch_id: branches[0] ? String(branches[0].id) : '',
      order_date: new Date().toISOString().slice(0, 10),
      expected_delivery_date: '',
      notes: '',
      status: 'draft',
    });
    setLines([{ product_id: '', quantity_ordered: 10, unit_cost: 0 }]);
    setFormOpen(true);
  }

  async function openEditDraft(poId: number) {
    try {
      const res = await apiRequest<{ purchaseOrder: PurchaseOrder }>(
        `/api/purchase-orders/${poId}`
      );
      const po = res.purchaseOrder;
      setEditingPo(po);
      setForm({
        supplier_id: String(po.supplier_id),
        branch_id: String(po.branch_id),
        order_date: po.order_date,
        expected_delivery_date: po.expected_delivery_date || '',
        notes: po.notes || '',
        status: 'draft',
      });
      setLines(
        (po.items || []).map((i) => ({
          product_id: String(i.product_id),
          quantity_ordered: i.quantity_ordered,
          unit_cost: i.unit_cost,
        }))
      );
      setFormOpen(true);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load draft PO' });
    }
  }

  function handleProductChange(idx: number, prodId: string) {
    const prod = products.find((p) => String(p.id) === prodId);
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx ? { ...l, product_id: prodId, unit_cost: prod ? prod.unit_cost : 0 } : l
      )
    );
  }

  async function handleSavePo(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    try {
      const payload = {
        supplier_id: Number(form.supplier_id),
        branch_id: Number(form.branch_id),
        order_date: form.order_date,
        expected_delivery_date: form.expected_delivery_date || null,
        notes: form.notes,
        status: form.status,
        items: lines
          .filter((l) => l.product_id)
          .map((l) => ({
            product_id: Number(l.product_id),
            quantity_ordered: Number(l.quantity_ordered),
            unit_cost: Number(l.unit_cost),
          })),
      };

      if (editingPo) {
        const res = await apiRequest<{ purchaseOrder: PurchaseOrder }>(
          `/api/purchase-orders/${editingPo.id}`,
          { method: 'PUT', body: JSON.stringify(payload) }
        );
        setBanner({ type: 'success', text: `Purchase Order ${res.purchaseOrder.po_number} updated.` });
      } else {
        const res = await apiRequest<{ purchaseOrder: PurchaseOrder }>('/api/purchase-orders', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setBanner({
          type: 'success',
          text: `Purchase Order ${res.purchaseOrder.po_number} created (${res.purchaseOrder.status}). Stock will update only when goods are received via GRN.`,
        });
      }
      setFormOpen(false);
      await loadOrders();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save PO' });
    }
  }

  async function openDetail(id: number) {
    try {
      const res = await apiRequest<{ purchaseOrder: PurchaseOrder }>(`/api/purchase-orders/${id}`);
      setSelectedPo(res.purchaseOrder);
      setDetailOpen(true);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load PO' });
    }
  }

  async function handleStatusAction(id: number, action: 'send' | 'cancel') {
    try {
      const res = await apiRequest<{ purchaseOrder: PurchaseOrder }>(
        `/api/purchase-orders/${id}/status`,
        {
          method: 'POST',
          body: JSON.stringify({ action }),
        }
      );
      setSelectedPo(res.purchaseOrder);
      setBanner({
        type: 'success',
        text: `Purchase Order ${res.purchaseOrder.po_number} marked as ${res.purchaseOrder.status}.`,
      });
      await loadOrders();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Action failed' });
    }
  }

  function downloadPoPdf(po: PurchaseOrder) {
    exportTableToPdf(
      `Purchase Order: ${po.po_number}`,
      `Supplier: ${po.supplier_name} | Receiving Branch: ${po.branch_name} | Status: ${po.status.toUpperCase()}`,
      ['SKU', 'Product', 'Ordered', 'Received', 'Unit Cost', 'Line Total'],
      (po.items || []).map((i) => [
        i.sku || '',
        i.product_name || '',
        i.quantity_ordered,
        i.quantity_received || 0,
        formatUGX(i.unit_cost),
        formatUGX(i.line_total || i.quantity_ordered * i.unit_cost),
      ]),
      `${po.po_number}.pdf`
    );
  }

  const draftTotal = lines.reduce(
    (s, l) => s + (Number(l.quantity_ordered) || 0) * (Number(l.unit_cost) || 0),
    0
  );

  return (
    <div className="space-y-4">
      {banner && (
        <AlertBanner type={banner.type} message={banner.text} onClose={() => setBanner(null)} />
      )}

      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-center gap-2.5 flex-1">
          <div className="relative lg:flex-1 lg:min-w-[200px] lg:max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search PO #, supplier, branch..."
              className="w-full pl-9 pr-3 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full lg:w-auto px-3 py-2 min-h-[44px] lg:min-h-[36px] text-sm border border-slate-300 rounded bg-white"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="partially_received">Partially Received</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={openNewPo}
            className="w-full lg:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] lg:min-h-[38px] text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Create Purchase Order</span>
          </button>
        )}
      </div>

      {orders.length === 0 ? (
        <EmptyState
          title="No Purchase Orders found"
          description="Create purchase orders to replenish branch stock from approved suppliers."
          actionLabel={canManage ? 'Create Purchase Order' : undefined}
          onAction={canManage ? openNewPo : undefined}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {orders.map((po) => (
              <div key={po.id} className="p-3.5 space-y-2.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono-num font-semibold text-[#1A3A5C] text-sm">
                      {po.po_number}
                    </div>
                    <div className="font-medium text-slate-900 mt-0.5">{po.supplier_name}</div>
                  </div>
                  <StatusTag status={po.status} />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                  <div>
                    <div className="text-[11px] text-slate-500">Receiving Branch</div>
                    <div className="font-medium text-slate-800">{po.branch_name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500">Grand Total</div>
                    <div className="font-mono-num font-semibold text-[#1A3A5C]">
                      {formatUGX(po.grand_total)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Order Date</div>
                    <div className="text-slate-700">{formatDate(po.order_date)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500">Expected Delivery</div>
                    <div className="text-slate-700">{formatDate(po.expected_delivery_date)}</div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => openDetail(po.id)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] text-xs font-medium text-[#1A3A5C] border border-slate-200 rounded hover:bg-slate-50"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View Order</span>
                  </button>
                  {canManage && po.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => openEditDraft(po.id)}
                      className="flex-1 inline-flex items-center justify-center px-3 py-2 min-h-[44px] text-xs font-medium text-[#E67E22] border border-slate-200 rounded hover:bg-slate-50"
                    >
                      Edit Draft
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#1A3A5C] text-white">
                  <th className="py-3 px-4 font-semibold">PO Number</th>
                  <th className="py-3 px-4 font-semibold">Supplier</th>
                  <th className="py-3 px-4 font-semibold">Receiving Branch</th>
                  <th className="py-3 px-4 font-semibold">Order Date</th>
                  <th className="py-3 px-4 font-semibold">Expected Delivery</th>
                  <th className="py-3 px-4 font-semibold text-right">Grand Total</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono-num font-semibold text-[#1A3A5C]">
                      {po.po_number}
                    </td>
                    <td className="py-3 px-4 font-medium">{po.supplier_name}</td>
                    <td className="py-3 px-4">{po.branch_name}</td>
                    <td className="py-3 px-4 whitespace-nowrap">{formatDate(po.order_date)}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {formatDate(po.expected_delivery_date)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold text-[#1A3A5C]">
                      {formatUGX(po.grand_total)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusTag status={po.status} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() => openDetail(po.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-100"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View</span>
                      </button>
                      {canManage && po.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() => openEditDraft(po.id)}
                          className="px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-100"
                        >
                          Edit Draft
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / Edit Draft PO Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingPo ? `Edit Draft PO — ${editingPo.po_number}` : 'Create Purchase Order'}
        subtitle="Creating or sending a Purchase Order does not alter stock until goods are received via GRN."
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleSavePo} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Supplier *</label>
              <select
                required
                value={form.supplier_id}
                onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white"
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
                Receiving Branch *
              </label>
              <select
                required
                value={form.branch_id}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Order Date *</label>
              <input
                type="date"
                required
                value={form.order_date}
                onChange={(e) => setForm({ ...form, order_date: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Expected Delivery
              </label>
              <input
                type="date"
                value={form.expected_delivery_date}
                onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Save Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as 'draft' | 'sent' })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              >
                <option value="draft">Save as Draft</option>
                <option value="sent">Mark as Sent</option>
              </select>
            </div>
          </div>

          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2.5 bg-[#F5F7FA] border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1A3A5C]">Order Line Items</span>
              <button
                type="button"
                onClick={() =>
                  setLines((prev) => [
                    ...prev,
                    { product_id: '', quantity_ordered: 10, unit_cost: 0 },
                  ])
                }
                className="text-xs font-semibold text-[#E67E22] hover:underline"
              >
                + Add Line
              </button>
            </div>
            <div className="p-3 space-y-2.5">
              {lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-center bg-[#F5F7FA] sm:bg-transparent p-2.5 sm:p-0 rounded sm:rounded-none border border-slate-200 sm:border-0"
                >
                  <div className="col-span-12 sm:col-span-5">
                    <label className="block sm:hidden text-[11px] font-medium text-slate-600 mb-1">
                      Product
                    </label>
                    <select
                      required
                      value={line.product_id}
                      onChange={(e) => handleProductChange(idx, e.target.value)}
                      className="w-full px-2.5 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 text-xs border border-slate-300 rounded bg-white"
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
                    <label className="block sm:hidden text-[11px] font-medium text-slate-600 mb-1">
                      Quantity
                    </label>
                    <input
                      type="number"
                      min={1}
                      required
                      value={line.quantity_ordered}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, quantity_ordered: Number(e.target.value) } : l
                          )
                        )
                      }
                      className="w-full px-2.5 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 text-xs border border-slate-300 rounded bg-white font-mono-num text-right"
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <label className="block sm:hidden text-[11px] font-medium text-slate-600 mb-1">
                      Unit Cost (UGX)
                    </label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={line.unit_cost}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, unit_cost: Number(e.target.value) } : l
                          )
                        )
                      }
                      className="w-full px-2.5 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 text-xs border border-slate-300 rounded bg-white font-mono-num text-right"
                    />
                  </div>
                  <div className="col-span-9 sm:col-span-2 flex items-center justify-between sm:block sm:text-right text-xs font-mono-num font-semibold">
                    <span className="sm:hidden text-[11px] font-sans font-normal text-slate-500">
                      Line Total
                    </span>
                    <span>{formatUGX(line.quantity_ordered * line.unit_cost)}</span>
                  </div>
                  <div className="col-span-3 sm:col-span-1 text-right">
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                        className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 p-1.5 text-slate-400 hover:text-red-700"
                        aria-label="Remove line item"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 bg-[#F5F7FA] border-t border-slate-200 flex items-center justify-between text-xs font-semibold">
              <span>Grand Total</span>
              <span className="font-mono-num text-sm text-[#1A3A5C]">{formatUGX(draftTotal)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Order Notes</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 min-h-[44px] text-sm font-medium border border-slate-300 rounded text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded"
            >
              Save Purchase Order
            </button>
          </div>
        </form>
      </Modal>

      {/* PO Detail & Print / PDF Modal */}
      <Modal
        open={detailOpen && Boolean(selectedPo)}
        onClose={() => setDetailOpen(false)}
        title={selectedPo ? `Purchase Order — ${selectedPo.po_number}` : 'Purchase Order'}
        subtitle={
          selectedPo ? `${selectedPo.supplier_name} → ${selectedPo.branch_name}` : ''
        }
        maxWidth="max-w-3xl"
      >
        {selectedPo && (
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Status</div>
                <div className="mt-1">
                  <StatusTag status={selectedPo.status} />
                </div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Order Date</div>
                <div className="mt-1 font-medium">{formatDate(selectedPo.order_date)}</div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Expected Delivery</div>
                <div className="mt-1 font-medium">
                  {formatDate(selectedPo.expected_delivery_date)}
                </div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Prepared By</div>
                <div className="mt-1 font-medium">{selectedPo.created_by_name}</div>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#1A3A5C] text-white">
                    <th className="py-2 px-3 whitespace-nowrap">SKU</th>
                    <th className="py-2 px-3">Product</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap">Ordered</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap">Received</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap">Remaining</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap">Unit Cost</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(selectedPo.items || []).map((it, idx) => (
                    <tr key={idx}>
                      <td className="py-2 px-3 font-mono-num whitespace-nowrap">{it.sku}</td>
                      <td className="py-2 px-3 font-medium">{it.product_name}</td>
                      <td className="py-2 px-3 text-right font-mono-num whitespace-nowrap">
                        {it.quantity_ordered}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-num text-emerald-700 font-semibold whitespace-nowrap">
                        {it.quantity_received ?? 0}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-num text-amber-700 whitespace-nowrap">
                        {it.quantity_remaining ?? it.quantity_ordered - (it.quantity_received || 0)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-num whitespace-nowrap">
                        {formatUGX(it.unit_cost)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-num font-semibold whitespace-nowrap">
                        {formatUGX(it.line_total ?? it.quantity_ordered * it.unit_cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[#F5F7FA] border-t border-slate-200 font-semibold">
                    <td colSpan={6} className="py-2.5 px-3 text-right">
                      Grand Total
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num text-[#1A3A5C] whitespace-nowrap">
                      {formatUGX(selectedPo.grand_total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {selectedPo.grns && selectedPo.grns.length > 0 && (
              <div>
                <h4 className="font-semibold text-[#1A3A5C] mb-1.5">Linked Deliveries (GRNs)</h4>
                <div className="space-y-1">
                  {selectedPo.grns.map((g) => (
                    <div
                      key={g.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#F5F7FA] border border-slate-200 rounded"
                    >
                      <span className="font-mono-num font-medium">{g.grn_number}</span>
                      <span>{formatDate(g.date_received)}</span>
                      <span className="font-mono-num font-semibold">{formatUGX(g.grand_total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:justify-between gap-2 pt-3 border-t border-slate-200 no-print">
              <div className="grid grid-cols-2 sm:flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] sm:min-h-0 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={() => downloadPoPdf(selectedPo)}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] sm:min-h-0 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PDF</span>
                </button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                {canManage && selectedPo.status === 'draft' && (
                  <button
                    type="button"
                    onClick={() => handleStatusAction(selectedPo.id, 'send')}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 min-h-[44px] sm:min-h-0 text-xs font-medium bg-[#E67E22] text-white rounded hover:bg-[#cf6d17]"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Mark as Sent</span>
                  </button>
                )}
                {canManage && ['draft', 'sent'].includes(selectedPo.status) && (
                  <button
                    type="button"
                    onClick={() => handleStatusAction(selectedPo.id, 'cancel')}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] sm:min-h-0 text-xs font-medium text-red-700 border border-red-200 rounded hover:bg-red-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Cancel PO</span>
                  </button>
                )}
                {user.role !== 'procurement_manager' &&
                  ['sent', 'partially_received'].includes(selectedPo.status) && (
                    <button
                      type="button"
                      onClick={() => {
                        setDetailOpen(false);
                        onNavigate('stock-intake');
                      }}
                      className="px-4 py-2 min-h-[44px] sm:min-h-0 text-xs font-medium bg-[#1A3A5C] text-white rounded hover:bg-[#142d47]"
                    >
                      Receive via GRN
                    </button>
                  )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
