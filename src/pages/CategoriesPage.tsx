import React, { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { apiRequest } from '../api/client';
import { AlertBanner, Modal, StatusTag } from '../components/StatusTag';
import type { Category } from '../types';

export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: '', code: '', description: '', status: 'active' });

  async function loadCategories() {
    try {
      const res = await apiRequest<{ categories: Category[] }>('/api/categories');
      setCategories(res.categories);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load' });
    }
  }

  useEffect(() => {
    loadCategories();
  }, []);

  function openAdd() {
    setEditing(null);
    setForm({ name: '', code: '', description: '', status: 'active' });
    setModalOpen(true);
  }

  function openEdit(c: Category) {
    setEditing(c);
    setForm({
      name: c.name,
      code: c.code,
      description: c.description || '',
      status: c.status,
    });
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editing) {
        await apiRequest(`/api/categories/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
        setBanner({ type: 'success', text: `Category "${form.name}" updated.` });
      } else {
        await apiRequest('/api/categories', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        setBanner({ type: 'success', text: `Category "${form.name}" created.` });
      }
      setModalOpen(false);
      await loadCategories();
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
        <div>
          <h2 className="text-sm font-semibold text-[#1A3A5C]">Product Categories</h2>
          <p className="text-xs text-slate-500">
            Configure retail product classifications used across all branches
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Category</span>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        {/* Mobile Category Cards */}
        <div className="md:hidden divide-y divide-slate-100">
          {categories.map((c) => (
            <div key={`m-cat-${c.id}`} className="p-4 space-y-2.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono-num font-semibold text-[#1A3A5C]">{c.code}</div>
                  <div className="text-sm font-semibold text-slate-900 mt-0.5">{c.name}</div>
                  {c.description && <p className="text-slate-600 mt-1">{c.description}</p>}
                </div>
                <StatusTag status={c.status} />
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-slate-600 font-mono-num font-medium">
                  {c.product_count ?? 0} product(s)
                </span>
                <button
                  type="button"
                  onClick={() => openEdit(c)}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium border border-slate-300 rounded hover:bg-slate-50"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#1A3A5C] text-white">
                <th className="py-3 px-4 font-semibold">Code</th>
                <th className="py-3 px-4 font-semibold">Category Name</th>
                <th className="py-3 px-4 font-semibold">Description</th>
                <th className="py-3 px-4 font-semibold text-right">Products</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono-num font-semibold text-[#1A3A5C]">{c.code}</td>
                  <td className="py-3 px-4 font-medium text-slate-900">{c.name}</td>
                  <td className="py-3 px-4 text-slate-600">{c.description}</td>
                  <td className="py-3 px-4 text-right font-mono-num font-semibold">
                    {c.product_count ?? 0}
                  </td>
                  <td className="py-3 px-4">
                    <StatusTag status={c.status} />
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-100"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Category — ${editing.name}` : 'Add Product Category'}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Category Name *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Short Code (3–6 chars) *
            </label>
            <input
              type="text"
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded font-mono-num focus:outline-none focus:border-[#1A3A5C]"
            />
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
          {editing && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded bg-white"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-sm font-medium border border-slate-300 rounded text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded"
            >
              Save Category
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
