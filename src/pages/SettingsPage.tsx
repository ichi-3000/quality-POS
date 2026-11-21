import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { apiRequest } from '../api/client';
import { AlertBanner, StatusTag } from '../components/StatusTag';
import type { Branch } from '../types';

export function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({
    business_name: 'Quality Supermarkets Uganda Limited',
    system_name: 'QS-IMS',
    currency: 'UGX',
    default_reorder_level: '15',
    default_reorder_multiplier: '2',
    low_stock_alerts_enabled: 'true',
    allow_negative_stock: 'false',
  });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function loadAll() {
    const [sRes, bRes] = await Promise.all([
      apiRequest<{ settings: Record<string, string> }>('/api/settings'),
      apiRequest<{ branches: Branch[] }>('/api/branches'),
    ]);
    setSettings((prev) => ({ ...prev, ...sRes.settings }));
    setBranches(bRes.branches);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    try {
      await apiRequest('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings }),
      });
      setBanner({ type: 'success', text: 'System settings saved.' });
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    }
  }

  async function saveBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!editingBranch) return;
    try {
      await apiRequest(`/api/branches/${editingBranch.id}`, {
        method: 'PUT',
        body: JSON.stringify(editingBranch),
      });
      setEditingBranch(null);
      setBanner({ type: 'success', text: `Branch "${editingBranch.name}" updated.` });
      await loadAll();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Branch update failed' });
    }
  }

  return (
    <div className="space-y-6">
      {banner && (
        <AlertBanner type={banner.type} message={banner.text} onClose={() => setBanner(null)} />
      )}

      {/* System Preferences */}
      <form
        onSubmit={saveSettings}
        className="bg-white border border-slate-200 rounded-md p-6 space-y-4"
      >
        <div className="border-b border-slate-200 pb-3">
          <h2 className="text-sm font-semibold text-[#1A3A5C]">
            System Configuration & Stock Alert Preferences
          </h2>
          <p className="text-xs text-slate-500">
            Administrator-only configuration for currency, business branding, and reorder defaults
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Business Name</label>
            <input
              type="text"
              value={settings.business_name}
              onChange={(e) => setSettings({ ...settings, business_name: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">System Name</label>
            <input
              type="text"
              value={settings.system_name}
              onChange={(e) => setSettings({ ...settings, system_name: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Default Currency
            </label>
            <input
              type="text"
              value={settings.currency}
              onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded font-mono-num"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Default Reorder Level
            </label>
            <input
              type="number"
              min={1}
              value={settings.default_reorder_level}
              onChange={(e) => setSettings({ ...settings, default_reorder_level: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded font-mono-num"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Suggested Reorder Multiplier
            </label>
            <input
              type="number"
              min={1}
              value={settings.default_reorder_multiplier}
              onChange={(e) =>
                setSettings({ ...settings, default_reorder_multiplier: e.target.value })
              }
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded font-mono-num"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Automated Low-Stock Alerts
            </label>
            <select
              value={settings.low_stock_alerts_enabled}
              onChange={(e) =>
                setSettings({ ...settings, low_stock_alerts_enabled: e.target.value })
              }
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded"
          >
            <Save className="w-4 h-4" />
            <span>Save Settings</span>
          </button>
        </div>
      </form>

      {/* Branch Configuration */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-[#1A3A5C]">Supermarket Branch Network</h3>
          <p className="text-xs text-slate-500">
            Manage contact details, location, and assigned managers for each Kampala branch
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#1A3A5C] text-white">
                <th className="py-3 px-4 font-semibold">Code</th>
                <th className="py-3 px-4 font-semibold">Branch Name</th>
                <th className="py-3 px-4 font-semibold">Location</th>
                <th className="py-3 px-4 font-semibold">Manager</th>
                <th className="py-3 px-4 font-semibold">Contact</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {branches.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono-num font-semibold text-[#1A3A5C]">{b.code}</td>
                  <td className="py-3 px-4 font-medium">{b.name}</td>
                  <td className="py-3 px-4 text-slate-600">{b.location}</td>
                  <td className="py-3 px-4">{b.manager_name}</td>
                  <td className="py-3 px-4">
                    <div>{b.contact_phone}</div>
                    <div className="text-[11px] text-slate-500">{b.contact_email}</div>
                  </td>
                  <td className="py-3 px-4">
                    <StatusTag status={b.status} />
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => setEditingBranch(b)}
                      className="px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-100"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editingBranch && (
          <form
            onSubmit={saveBranch}
            className="p-6 bg-[#F5F7FA] border-t border-slate-200 space-y-4"
          >
            <h4 className="text-xs font-semibold text-[#1A3A5C]">
              Editing Branch: {editingBranch.code}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                value={editingBranch.name}
                onChange={(e) => setEditingBranch({ ...editingBranch, name: e.target.value })}
                placeholder="Branch Name"
                className="px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              />
              <input
                type="text"
                value={editingBranch.location}
                onChange={(e) => setEditingBranch({ ...editingBranch, location: e.target.value })}
                placeholder="Location"
                className="px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              />
              <input
                type="text"
                value={editingBranch.manager_name}
                onChange={(e) =>
                  setEditingBranch({ ...editingBranch, manager_name: e.target.value })
                }
                placeholder="Branch Manager"
                className="px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              />
              <input
                type="text"
                value={editingBranch.contact_phone}
                onChange={(e) =>
                  setEditingBranch({ ...editingBranch, contact_phone: e.target.value })
                }
                placeholder="Phone"
                className="px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              />
              <input
                type="email"
                value={editingBranch.contact_email}
                onChange={(e) =>
                  setEditingBranch({ ...editingBranch, contact_email: e.target.value })
                }
                placeholder="Email"
                className="px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              />
              <select
                value={editingBranch.status}
                onChange={(e) =>
                  setEditingBranch({
                    ...editingBranch,
                    status: e.target.value as 'active' | 'inactive',
                  })
                }
                className="px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingBranch(null)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-medium bg-[#1A3A5C] text-white rounded"
              >
                Save Branch
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
