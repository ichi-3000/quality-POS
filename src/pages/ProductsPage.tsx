import React, { useEffect, useState } from 'react';
import { Eye, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { apiRequest, formatDateTime, formatUGX } from '../api/client';
import { AlertBanner, EmptyState, Modal, StatusTag } from '../components/StatusTag';
import type { Category, Product, Supplier, User } from '../types';

export function ProductsPage({ user }: { user: User }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<{
    product: Product;
    branchStocks: Array<{
      branch_id: number;
      branch_name: string;
      branch_code: string;
      quantity_on_hand: number;
      status: string;
      stock_value: number;
      last_movement_at: string | null;
    }>;
    movementHistory: Array<{
      id: number;
      transaction_ref: string;
      transaction_type: string;
      quantity_added: number;
      quantity_removed: number;
      balance_after: number;
      reference_number: string;
      branch_name: string;
      user_name: string;
      created_at: string;
    }>;
  } | null>(null);

  const [form, setForm] = useState({
    sku: '',
    barcode: '',
    name: '',
    category_id: '',
    description: '',
    unit_of_measure: 'Piece',
    unit_cost: '0',
    selling_price: '0',
    reorder_level: '15',
    preferred_supplier_id: '',
    expiry_tracking: false,
    status: 'active' as 'active' | 'inactive',
  });

  const canManage = user.role === 'admin' || user.role === 'procurement_manager';

  async function loadLookups() {
    const [catRes, supRes] = await Promise.all([
      apiRequest<{ categories: Category[] }>('/api/categories'),
      apiRequest<{ suppliers: Supplier[] }>('/api/suppliers'),
    ]);
    setCategories(catRes.categories);
    setSuppliers(supRes.suppliers);
  }

  async function loadProducts() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '15' });
      if (search.trim()) params.set('search', search.trim());
      if (categoryId) params.set('category_id', categoryId);
      if (statusFilter) params.set('status', statusFilter);

      const res = await apiRequest<{
        products: Product[];
        pagination: { page: number; totalPages: number; total: number };
      }>(`/api/products?${params.toString()}`);
      setProducts(res.products);
      setTotalPages(res.pagination.totalPages);
      setTotalCount(res.pagination.total);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load products' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLookups();
  }, []);

  useEffect(() => {
    loadProducts();
  }, [page, search, categoryId, statusFilter]);

  function openAdd() {
    setEditing(null);
    setForm({
      sku: '',
      barcode: '',
      name: '',
      category_id: categories[0] ? String(categories[0].id) : '',
      description: '',
      unit_of_measure: 'Piece',
      unit_cost: '0',
      selling_price: '0',
      reorder_level: '15',
      preferred_supplier_id: '',
      expiry_tracking: false,
      status: 'active',
    });
    setFormOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      sku: p.sku,
      barcode: p.barcode || '',
      name: p.name,
      category_id: String(p.category_id),
      description: p.description || '',
      unit_of_measure: p.unit_of_measure,
      unit_cost: String(p.unit_cost),
      selling_price: String(p.selling_price),
      reorder_level: String(p.reorder_level),
      preferred_supplier_id: p.preferred_supplier_id ? String(p.preferred_supplier_id) : '',
      expiry_tracking: Boolean(p.expiry_tracking),
      status: p.status,
    });
    setFormOpen(true);
  }

  async function openDetail(id: number) {
    try {
      const res = await apiRequest<typeof detailData>(`/api/products/${id}`);
      setDetailData(res);
      setDetailOpen(true);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load details' });
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    const payload = {
      sku: form.sku,
      barcode: form.barcode,
      name: form.name,
      category_id: Number(form.category_id),
      description: form.description,
      unit_of_measure: form.unit_of_measure,
      unit_cost: Number(form.unit_cost),
      selling_price: Number(form.selling_price),
      reorder_level: Number(form.reorder_level),
      preferred_supplier_id: form.preferred_supplier_id ? Number(form.preferred_supplier_id) : null,
      expiry_tracking: form.expiry_tracking,
      status: form.status,
    };

    try {
      if (editing) {
        await apiRequest(`/api/products/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setBanner({ type: 'success', text: `Product "${form.name}" updated.` });
      } else {
        await apiRequest('/api/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setBanner({
          type: 'success',
          text: `Product "${form.name}" created and initialized at 0 stock across all 3 branches.`,
        });
      }
      setFormOpen(false);
      await loadProducts();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    }
  }

  async function toggleStatus(p: Product) {
    const nextStatus = p.status === 'active' ? 'inactive' : 'active';
    try {
      await apiRequest(`/api/products/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus }),
      });
      setBanner({ type: 'success', text: `${p.name} marked as ${nextStatus}.` });
      await loadProducts();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Update failed' });
    }
  }

  async function handleDelete(p: Product) {
    try {
      await apiRequest(`/api/products/${p.id}`, { method: 'DELETE' });
      setBanner({ type: 'success', text: `Product "${p.name}" deleted.` });
      await loadProducts();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Cannot delete product' });
    }
  }

  return (
    <div className="space-y-4">
      {banner && (
        <AlertBanner type={banner.type} message={banner.text} onClose={() => setBanner(null)} />
      )}

      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-center gap-2.5 flex-1">
          <div className="relative sm:col-span-2 lg:flex-1 lg:min-w-[220px] lg:max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
              placeholder="Search name, SKU, barcode..."
              className="w-full pl-9 pr-3 py-2 min-h-[44px] lg:min-h-[38px] text-sm border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
            />
          </div>

          <select
            value={categoryId}
            onChange={(e) => {
              setPage(1);
              setCategoryId(e.target.value);
            }}
            className="w-full lg:w-auto px-3 py-2 min-h-[44px] lg:min-h-[38px] text-sm border border-slate-300 rounded bg-white focus:outline-none focus:border-[#1A3A5C]"
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
            className="w-full lg:w-auto px-3 py-2 min-h-[44px] lg:min-h-[38px] text-sm border border-slate-300 rounded bg-white focus:outline-none focus:border-[#1A3A5C]"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          {(search || categoryId || statusFilter) && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setCategoryId('');
                setStatusFilter('');
                setPage(1);
              }}
              className="w-full sm:w-auto px-3 py-2 min-h-[44px] lg:min-h-[38px] text-xs font-medium border border-slate-300 rounded hover:bg-slate-50"
            >
              Clear Filters
            </button>
          )}
        </div>

        {canManage && (
          <button
            type="button"
            onClick={openAdd}
            className="w-full lg:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </button>
        )}
      </div>

      {/* Catalogue Table / Mobile Cards */}
      {!loading && products.length === 0 ? (
        <EmptyState
          title="No products match your filters"
          description="Adjust your search criteria or add a new product to the Quality Supermarkets catalogue."
          actionLabel={canManage ? 'Add Product' : undefined}
          onAction={canManage ? openAdd : undefined}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          {/* Mobile Product Cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {products.map((p) => (
              <div key={`m-prod-${p.id}`} className="p-4 space-y-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono-num text-[11px] font-semibold text-[#1A3A5C]">
                      {p.sku} · {p.category_name}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 mt-0.5">{p.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {p.unit_of_measure}
                      {p.barcode ? ` · ${p.barcode}` : ''}
                    </div>
                  </div>
                  <StatusTag status={p.status} />
                </div>

                <div className="grid grid-cols-2 gap-2 bg-[#F5F7FA] p-2.5 rounded border border-slate-200">
                  <div>
                    <div className="text-[10px] text-slate-500">Unit Cost</div>
                    <div className="font-mono-num font-medium">{formatUGX(p.unit_cost)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Selling Price</div>
                    <div className="font-mono-num font-semibold text-slate-900">
                      {formatUGX(p.selling_price)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Total Stock (Min {p.reorder_level})</div>
                    <div className="font-mono-num font-bold text-slate-900">{p.total_stock ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Stock Value</div>
                    <div className="font-mono-num font-semibold text-[#1A3A5C]">
                      {formatUGX(p.total_stock_value)}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openDetail(p.id)}
                    className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50 text-[#1A3A5C]"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Details</span>
                  </button>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50 text-slate-800"
                      >
                        <Pencil className="w-4 h-4" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleStatus(p)}
                        className="min-h-[44px] px-3 py-2 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50"
                      >
                        {p.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    </>
                  )}
                  {user.role === 'admin' && (
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center border border-red-200 text-red-700 rounded hover:bg-red-50"
                      title="Delete (only if unused)"
                    >
                      <Trash2 className="w-4 h-4" />
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
                  <th className="py-3 px-4 font-semibold">SKU</th>
                  <th className="py-3 px-4 font-semibold">Product Name</th>
                  <th className="py-3 px-4 font-semibold">Category</th>
                  <th className="py-3 px-4 font-semibold text-right">Unit Cost</th>
                  <th className="py-3 px-4 font-semibold text-right">Selling Price</th>
                  <th className="py-3 px-4 font-semibold text-right">Reorder Lvl</th>
                  <th className="py-3 px-4 font-semibold text-right">Stock Qty</th>
                  <th className="py-3 px-4 font-semibold text-right">Stock Value</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono-num font-medium text-[#1A3A5C] whitespace-nowrap">
                      {p.sku}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{p.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {p.unit_of_measure}
                        {p.barcode ? ` · ${p.barcode}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">{p.category_name}</td>
                    <td className="py-3 px-4 text-right font-mono-num whitespace-nowrap">
                      {formatUGX(p.unit_cost)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num whitespace-nowrap">
                      {formatUGX(p.selling_price)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num">{p.reorder_level}</td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold">
                      {p.total_stock ?? 0}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-medium text-[#1A3A5C] whitespace-nowrap">
                      {formatUGX(p.total_stock_value)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusTag status={p.status} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openDetail(p.id)}
                          className="p-1.5 text-slate-600 hover:text-[#1A3A5C] rounded hover:bg-slate-100"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {canManage && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEdit(p)}
                              className="p-1.5 text-slate-600 hover:text-[#E67E22] rounded hover:bg-slate-100"
                              title="Edit Product"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleStatus(p)}
                              className="px-2 py-1 text-[11px] font-medium border border-slate-200 rounded hover:bg-slate-100"
                            >
                              {p.status === 'active' ? 'Deactivate' : 'Activate'}
                            </button>
                          </>
                        )}
                        {user.role === 'admin' && (
                          <button
                            type="button"
                            onClick={() => handleDelete(p)}
                            className="p-1.5 text-slate-400 hover:text-red-700 rounded hover:bg-red-50"
                            title="Delete (only if unused)"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-4 py-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
            <span>
              Showing page {page} of {totalPages} ({totalCount} products)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex-1 sm:flex-none px-3 py-2 sm:py-1 min-h-[40px] sm:min-h-[32px] border border-slate-300 rounded disabled:opacity-50 hover:bg-slate-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex-1 sm:flex-none px-3 py-2 sm:py-1 min-h-[40px] sm:min-h-[32px] border border-slate-300 rounded disabled:opacity-50 hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit Product — ${editing.sku}` : 'Add New Product'}
        subtitle="New products automatically initialize zero-stock records across Ntinda, Najjera, and Kyaliwajjala."
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Product Code / SKU *
              </label>
              <input
                type="text"
                required
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="e.g. QS-BEV-010"
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded font-mono-num focus:outline-none focus:border-[#1A3A5C]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Barcode</label>
              <input
                type="text"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                placeholder="Optional EAN/UPC"
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded font-mono-num focus:outline-none focus:border-[#1A3A5C]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Product Name *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Rwenzori Mineral Water 1.5L"
              className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category *</label>
              <select
                required
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded bg-white focus:outline-none focus:border-[#1A3A5C]"
              >
                <option value="">Select category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Unit of Measure *
              </label>
              <input
                type="text"
                required
                value={form.unit_of_measure}
                onChange={(e) => setForm({ ...form, unit_of_measure: e.target.value })}
                placeholder="Piece, Pack, Carton, Kg"
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Preferred Supplier
              </label>
              <select
                value={form.preferred_supplier_id}
                onChange={(e) => setForm({ ...form, preferred_supplier_id: e.target.value })}
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded bg-white focus:outline-none focus:border-[#1A3A5C]"
              >
                <option value="">None</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Unit Cost (UGX) *
              </label>
              <input
                type="number"
                min={0}
                required
                value={form.unit_cost}
                onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded font-mono-num focus:outline-none focus:border-[#1A3A5C]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Selling Price (UGX) *
              </label>
              <input
                type="number"
                min={0}
                required
                value={form.selling_price}
                onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded font-mono-num focus:outline-none focus:border-[#1A3A5C]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Reorder Level *
              </label>
              <input
                type="number"
                min={0}
                required
                value={form.reorder_level}
                onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded font-mono-num focus:outline-none focus:border-[#1A3A5C]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 min-h-[36px]">
              <input
                type="checkbox"
                checked={form.expiry_tracking}
                onChange={(e) => setForm({ ...form, expiry_tracking: e.target.checked })}
                className="rounded border-slate-300 w-4 h-4"
              />
              <span>Track expiry dates for this product</span>
            </label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}
              className="w-full sm:w-auto px-3 py-2 min-h-[44px] sm:min-h-[36px] text-sm sm:text-xs border border-slate-300 rounded bg-white"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-sm font-medium border border-slate-300 rounded text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded"
            >
              {editing ? 'Save Changes' : 'Create Product'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Product Detail Modal */}
      <Modal
        open={detailOpen && Boolean(detailData)}
        onClose={() => setDetailOpen(false)}
        title={detailData ? detailData.product.name : 'Product Details'}
        subtitle={
          detailData
            ? `${detailData.product.sku} · ${detailData.product.category_name} · ${detailData.product.unit_of_measure}`
            : ''
        }
        maxWidth="max-w-3xl"
      >
        {detailData && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Unit Cost</div>
                <div className="mt-1 font-mono-num font-semibold text-[#1A3A5C]">
                  {formatUGX(detailData.product.unit_cost)}
                </div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Selling Price</div>
                <div className="mt-1 font-mono-num font-semibold text-slate-900">
                  {formatUGX(detailData.product.selling_price)}
                </div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Reorder Level</div>
                <div className="mt-1 font-mono-num font-semibold text-slate-900">
                  {detailData.product.reorder_level} {detailData.product.unit_of_measure}
                </div>
              </div>
              <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded">
                <div className="text-slate-500">Preferred Supplier</div>
                <div className="mt-1 font-medium text-slate-900 truncate">
                  {detailData.product.preferred_supplier_name || 'Not assigned'}
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[#1A3A5C] mb-2">Stock by Branch</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs border border-slate-200">
                  <thead>
                    <tr className="bg-[#F5F7FA] border-b border-slate-200 text-slate-600">
                      <th className="py-2 px-3">Branch</th>
                      <th className="py-2 px-3 text-right">Qty on Hand</th>
                      <th className="py-2 px-3 text-right">Valuation</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detailData.branchStocks.map((bs) => (
                      <tr key={bs.branch_id}>
                        <td className="py-2 px-3 font-medium whitespace-nowrap">
                          {bs.branch_name} ({bs.branch_code})
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num font-semibold">
                          {bs.quantity_on_hand}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num whitespace-nowrap">
                          {formatUGX(bs.stock_value)}
                        </td>
                        <td className="py-2 px-3">
                          <StatusTag status={bs.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[#1A3A5C] mb-2">Recent Stock Ledger</h4>
              {detailData.movementHistory.length === 0 ? (
                <p className="text-xs text-slate-500">No inventory movements recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs border border-slate-200">
                    <thead>
                      <tr className="bg-[#F5F7FA] border-b border-slate-200 text-slate-600">
                        <th className="py-2 px-3">Reference</th>
                        <th className="py-2 px-3">Branch</th>
                        <th className="py-2 px-3">Type</th>
                        <th className="py-2 px-3 text-right">Change</th>
                        <th className="py-2 px-3 text-right">Balance</th>
                        <th className="py-2 px-3">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detailData.movementHistory.map((m) => (
                        <tr key={m.id}>
                          <td className="py-2 px-3 font-mono-num whitespace-nowrap">{m.reference_number}</td>
                          <td className="py-2 px-3 whitespace-nowrap">{m.branch_name}</td>
                          <td className="py-2 px-3">
                            <StatusTag status={m.transaction_type} />
                          </td>
                          <td className="py-2 px-3 text-right font-mono-num font-semibold">
                            {m.quantity_added > 0 ? `+${m.quantity_added}` : `-${m.quantity_removed}`}
                          </td>
                          <td className="py-2 px-3 text-right font-mono-num">{m.balance_after}</td>
                          <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{formatDateTime(m.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
