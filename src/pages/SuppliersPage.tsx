import React, { useEffect, useState } from 'react';
import { Eye, Pencil, Plus, Search } from 'lucide-react';
import { apiRequest, formatDate, formatUGX } from '../api/client';
import { AlertBanner, EmptyState, Modal, StatusTag } from '../components/StatusTag';
import type { Supplier } from '../types';

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState<{
    supplier: Supplier;
    products: Array<{ id: number; sku: string; name: string; unit_cost: number; category_name: string }>;
    purchaseOrders: Array<{ id: number; po_number: string; branch_name: string; order_date: string; grand_total: number; status: string }>;
    deliveries: Array<{ id: number; grn_number: string; branch_name: string; date_received: string; grand_total: number; received_by_name: string }>;
  } | null>(null);

  const [form, setForm] = useState({
    supplier_code: '',
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    tin: '',
    notes: '',
    status: 'active' as 'active' | 'inactive',
  });

  async function loadSuppliers() {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiRequest<{ suppliers: Supplier[] }>(`/api/suppliers?${params.toString()}`);
      setSuppliers(res.suppliers);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load suppliers' });
    }
  }

  useEffect(() => {
    loadSuppliers();
  }, [search, statusFilter]);

  function openAdd() {
    setEditing(null);
    setForm({
      supplier_code: '',
      name: '',
      contact_person: '',
      phone: '',
      email: '',
      address: '',
      tin: '',
      notes: '',
      status: 'active',
    });
    setFormOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      supplier_code: s.supplier_code,
      name: s.name,
      contact_person: s.contact_person || '',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      tin: s.tin || '',
      notes: s.notes || '',
      status: s.status,
    });
    setFormOpen(true);
  }

  async function openProfile(id: number) {
    try {
      const res = await apiRequest<typeof profile>(`/api/suppliers/${id}`);
      setProfile(res);
      setProfileOpen(true);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load profile' });
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editing) {
        await apiRequest(`/api/suppliers/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
        setBanner({ type: 'success', text: `Supplier "${form.name}" updated.` });
      } else {
        await apiRequest('/api/suppliers', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        setBanner({ type: 'success', text: `Supplier "${form.name}" created.` });
      }
      setFormOpen(false);
      await loadSuppliers();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    }
  }

  return (
    <div className="space-y-4">
      {banner && (
        <AlertBanner type={banner.type} message={banner.text} onClose={() => setBanner(null)} />
      )}

      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search supplier name, code, contact..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded bg-white"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Supplier</span>
        </button>
      </div>

      {suppliers.length === 0 ? (
        <EmptyState
          title="No suppliers found"
          description="Add approved supermarket suppliers to track deliveries and purchase orders."
          actionLabel="Add Supplier"
          onAction={openAdd}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#1A3A5C] text-white">
                  <th className="py-3 px-4 font-semibold">Code</th>
                  <th className="py-3 px-4 font-semibold">Supplier Name</th>
                  <th className="py-3 px-4 font-semibold">Contact Person</th>
                  <th className="py-3 px-4 font-semibold">Phone / Email</th>
                  <th className="py-3 px-4 font-semibold text-right">Deliveries</th>
                  <th className="py-3 px-4 font-semibold text-right">POs</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono-num font-semibold text-[#1A3A5C]">
                      {s.supplier_code}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{s.name}</div>
                      {s.tin && <div className="text-[11px] text-slate-500">TIN: {s.tin}</div>}
                    </td>
                    <td className="py-3 px-4">{s.contact_person || '—'}</td>
                    <td className="py-3 px-4">
                      <div>{s.phone || '—'}</div>
                      <div className="text-[11px] text-slate-500">{s.email}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold">
                      {s.delivery_count ?? 0}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num">{s.po_count ?? 0}</td>
                    <td className="py-3 px-4">
                      <StatusTag status={s.status} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openProfile(s.id)}
                          className="p-1.5 text-slate-600 hover:text-[#1A3A5C] rounded hover:bg-slate-100"
                          title="Supplier Profile"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(s)}
                          className="p-1.5 text-slate-600 hover:text-[#E67E22] rounded hover:bg-slate-100"
                          title="Edit Supplier"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit Supplier — ${editing.supplier_code}` : 'Add New Supplier'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Supplier Code *
              </label>
              <input
                type="text"
                required
                disabled={Boolean(editing)}
                value={form.supplier_code}
                onChange={(e) => setForm({ ...form, supplier_code: e.target.value.toUpperCase() })}
                placeholder="SUP-006"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded font-mono-num disabled:bg-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Supplier Name *
              </label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Contact Person</label>
              <input
                type="text"
                value={form.contact_person}
                onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                URA TIN (Tax Identification)
              </label>
              <input
                type="text"
                value={form.tin}
                onChange={(e) => setForm({ ...form, tin: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded font-mono-num"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
            />
          </div>

          {editing && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}
                className="px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 text-sm font-medium border border-slate-300 rounded text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded"
            >
              Save Supplier
            </button>
          </div>
        </form>
      </Modal>

      {/* Supplier Profile Modal */}
      <Modal
        open={profileOpen && Boolean(profile)}
        onClose={() => setProfileOpen(false)}
        title={profile ? profile.supplier.name : 'Supplier Profile'}
        subtitle={
          profile
            ? `${profile.supplier.supplier_code} · ${profile.supplier.contact_person} · ${profile.supplier.phone}`
            : ''
        }
        maxWidth="max-w-3xl"
      >
        {profile && (
          <div className="space-y-6 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Address</div>
                <div className="mt-1 font-medium text-slate-900">
                  {profile.supplier.address || '—'}
                </div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Tax ID (TIN)</div>
                <div className="mt-1 font-mono-num font-medium text-slate-900">
                  {profile.supplier.tin || '—'}
                </div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Email</div>
                <div className="mt-1 font-medium text-slate-900">
                  {profile.supplier.email || '—'}
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-[#1A3A5C] mb-2">
                Products Supplied ({profile.products.length})
              </h4>
              {profile.products.length === 0 ? (
                <p className="text-slate-500">No products have this supplier marked as preferred.</p>
              ) : (
                <table className="w-full text-left border border-slate-200">
                  <thead>
                    <tr className="bg-[#F5F7FA] border-b border-slate-200">
                      <th className="py-2 px-3">SKU</th>
                      <th className="py-2 px-3">Product</th>
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3 text-right">Unit Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {profile.products.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 px-3 font-mono-num">{p.sku}</td>
                        <td className="py-2 px-3 font-medium">{p.name}</td>
                        <td className="py-2 px-3">{p.category_name}</td>
                        <td className="py-2 px-3 text-right font-mono-num">
                          {formatUGX(p.unit_cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <h4 className="font-semibold text-[#1A3A5C] mb-2">
                Delivery History / GRNs ({profile.deliveries.length})
              </h4>
              {profile.deliveries.length === 0 ? (
                <p className="text-slate-500">No GRN deliveries recorded yet.</p>
              ) : (
                <table className="w-full text-left border border-slate-200">
                  <thead>
                    <tr className="bg-[#F5F7FA] border-b border-slate-200">
                      <th className="py-2 px-3">GRN #</th>
                      <th className="py-2 px-3">Branch</th>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3 text-right">Value</th>
                      <th className="py-2 px-3">Received By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {profile.deliveries.map((d) => (
                      <tr key={d.id}>
                        <td className="py-2 px-3 font-mono-num text-[#1A3A5C] font-medium">
                          {d.grn_number}
                        </td>
                        <td className="py-2 px-3">{d.branch_name}</td>
                        <td className="py-2 px-3">{formatDate(d.date_received)}</td>
                        <td className="py-2 px-3 text-right font-mono-num font-semibold">
                          {formatUGX(d.grand_total)}
                        </td>
                        <td className="py-2 px-3">{d.received_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
