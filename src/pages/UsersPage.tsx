import React, { useEffect, useState } from 'react';
import { KeyRound, Pencil, Plus, Search } from 'lucide-react';
import { apiRequest, formatDateTime } from '../api/client';
import { AlertBanner, Modal, StatusTag } from '../components/StatusTag';
import type { Branch, User } from '../types';

interface RoleOption {
  id: number;
  slug: string;
  name: string;
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwUser, setPwUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const [form, setForm] = useState({
    full_name: '',
    username: '',
    email: '',
    phone: '',
    password: '',
    role_id: '',
    branch_id: '',
    status: 'active' as 'active' | 'inactive',
  });

  async function loadLookups() {
    const [rRes, bRes] = await Promise.all([
      apiRequest<{ roles: RoleOption[] }>('/api/roles'),
      apiRequest<{ branches: Branch[] }>('/api/branches'),
    ]);
    setRoles(rRes.roles);
    setBranches(bRes.branches);
  }

  async function loadUsers() {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (roleFilter) params.set('role', roleFilter);
      if (branchFilter) params.set('branch_id', branchFilter);
      const res = await apiRequest<{ users: User[] }>(`/api/users?${params.toString()}`);
      setUsers(res.users);
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load users' });
    }
  }

  useEffect(() => {
    loadLookups();
  }, []);

  useEffect(() => {
    loadUsers();
  }, [search, roleFilter, branchFilter]);

  function openAdd() {
    setEditing(null);
    setForm({
      full_name: '',
      username: '',
      email: '',
      phone: '',
      password: '',
      role_id: roles[0] ? String(roles[0].id) : '',
      branch_id: branches[0] ? String(branches[0].id) : '',
      status: 'active',
    });
    setFormOpen(true);
  }

  function openEdit(u: User) {
    setEditing(u);
    setForm({
      full_name: u.full_name,
      username: u.username,
      email: u.email,
      phone: u.phone || '',
      password: '',
      role_id: u.role_id ? String(u.role_id) : '',
      branch_id: u.branch_id ? String(u.branch_id) : '',
      status: u.status,
    });
    setFormOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    try {
      if (editing) {
        await apiRequest(`/api/users/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            full_name: form.full_name,
            email: form.email,
            phone: form.phone,
            role_id: Number(form.role_id),
            branch_id: form.branch_id ? Number(form.branch_id) : null,
            status: form.status,
          }),
        });
        setBanner({ type: 'success', text: `User "${form.full_name}" updated.` });
      } else {
        await apiRequest('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            full_name: form.full_name,
            username: form.username,
            email: form.email,
            phone: form.phone,
            password: form.password,
            role_id: Number(form.role_id),
            branch_id: form.branch_id ? Number(form.branch_id) : null,
          }),
        });
        setBanner({ type: 'success', text: `User "${form.full_name}" created.` });
      }
      setFormOpen(false);
      await loadUsers();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwUser) return;
    try {
      await apiRequest(`/api/users/${pwUser.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ new_password: newPassword }),
      });
      setPwOpen(false);
      setNewPassword('');
      setBanner({ type: 'success', text: `Password reset for ${pwUser.username}.` });
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Reset failed' });
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
              placeholder="Search name, username, email..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded bg-white"
          >
            <option value="">All Roles</option>
            {roles.map((r) => (
              <option key={r.id} value={r.slug}>
                {r.name}
              </option>
            ))}
          </select>
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
        </div>

        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Staff User</span>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#1A3A5C] text-white">
                <th className="py-3 px-4 font-semibold">Full Name</th>
                <th className="py-3 px-4 font-semibold">Username</th>
                <th className="py-3 px-4 font-semibold">Email / Phone</th>
                <th className="py-3 px-4 font-semibold">Role</th>
                <th className="py-3 px-4 font-semibold">Assigned Branch</th>
                <th className="py-3 px-4 font-semibold">Last Login</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-900">{u.full_name}</td>
                  <td className="py-3 px-4 font-mono-num text-[#1A3A5C]">{u.username}</td>
                  <td className="py-3 px-4">
                    <div>{u.email}</div>
                    <div className="text-[11px] text-slate-500">{u.phone}</div>
                  </td>
                  <td className="py-3 px-4 font-medium">{u.role_name}</td>
                  <td className="py-3 px-4">{u.branch_name || 'All Branches (HQ)'}</td>
                  <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                    {formatDateTime(u.last_login_at)}
                  </td>
                  <td className="py-3 px-4">
                    <StatusTag status={u.status} />
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap space-x-1">
                    <button
                      type="button"
                      onClick={() => openEdit(u)}
                      className="p-1.5 text-slate-600 hover:text-[#E67E22] rounded hover:bg-slate-100"
                      title="Edit User"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPwUser(u);
                        setNewPassword('');
                        setPwOpen(true);
                      }}
                      className="p-1.5 text-slate-600 hover:text-[#1A3A5C] rounded hover:bg-slate-100"
                      title="Reset Password"
                    >
                      <KeyRound className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit User Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit User — ${editing.username}` : 'Create Staff Account'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Username *</label>
              <input
                type="text"
                required
                disabled={Boolean(editing)}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded font-mono-num disabled:bg-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
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
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Role *</label>
              <select
                required
                value={form.role_id}
                onChange={(e) => setForm({ ...form, role_id: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Assigned Branch
              </label>
              <select
                value={form.branch_id}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              >
                <option value="">Head Office (All Branches)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!editing ? (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Initial Password (min 8 chars) *
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Account Status
              </label>
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
              Save User
            </button>
          </div>
        </form>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        open={pwOpen && Boolean(pwUser)}
        onClose={() => setPwOpen(false)}
        title={`Reset Password — ${pwUser?.username}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              New Password (minimum 8 characters)
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPwOpen(false)}
              className="px-4 py-2 text-sm font-medium border border-slate-300 rounded text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-[#1A3A5C] rounded"
            >
              Reset Password
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
