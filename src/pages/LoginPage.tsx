import React, { useState } from 'react';
import { Lock, ShieldCheck, User as UserIcon } from 'lucide-react';
import { apiRequest, setAuthToken } from '../api/client';
import type { User } from '../types';
import { AlertBanner } from '../components/StatusTag';

interface LoginPageProps {
  onLoginSuccess: (user: User) => void;
}

const DEMO_ACCOUNTS = [
  { label: 'Administrator (HQ)', username: 'admin', pass: 'Admin@2026', branch: 'All Branches' },
  { label: 'Procurement Manager', username: 'procurement', pass: 'Procure@2026', branch: 'Head Office' },
  { label: 'Branch Manager (Najjera)', username: 'mgr.najjera', pass: 'Branch@2026', branch: 'Najjera Branch' },
  { label: 'Stock Controller (Kyaliwajjala)', username: 'ctrl.kyali', pass: 'Stock@2026', branch: 'Kyaliwajjala' },
];

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Admin@2026');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitCredentials(userVal: string, passVal: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: userVal, password: passVal }),
      });
      setAuthToken(res.token);
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitCredentials(username, password);
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA] flex flex-col lg:flex-row">
      {/* Left Brand Panel */}
      <div className="lg:w-5/12 bg-[#1A3A5C] text-white p-8 lg:p-14 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-[#E67E22] flex items-center justify-center font-display font-bold text-lg text-white">
              QS
            </div>
            <div>
              <div className="font-display font-bold text-lg tracking-tight">QS-IMS</div>
              <div className="text-xs text-slate-300">Quality Supermarkets Uganda Limited</div>
            </div>
          </div>

          <h1 className="mt-10 font-display text-3xl lg:text-4xl font-bold leading-tight text-white">
            Centralized Multi-Branch Inventory Control
          </h1>
          <p className="mt-4 text-sm text-slate-200 leading-relaxed max-w-md">
            Real-time stock visibility, atomic Goods Received Notes, auditable stock issues,
            inter-branch transfers, and procurement reconciliation across Kampala branches.
          </p>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3 border-t border-white/15 pt-6">
            <div className="text-xs text-slate-200">
              <span className="font-semibold text-white">Ntinda – Head Office</span> · Code: NTINDA
            </div>
            <div className="text-xs text-slate-200">
              <span className="font-semibold text-white">Najjera Branch</span> · Code: NAJJERA
            </div>
            <div className="text-xs text-slate-200">
              <span className="font-semibold text-white">Kyaliwajjala Branch</span> · Code: KYALI
            </div>
          </div>
        </div>

        <div className="mt-10 text-xs text-slate-300 border-t border-white/15 pt-4">
          Quality Supermarkets Uganda Limited · Inventory Operations Platform
        </div>
      </div>

      {/* Right Sign-In Panel */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-md p-6 sm:p-8">
          <div className="flex items-center gap-2 text-xs font-medium text-[#1A3A5C]">
            <ShieldCheck className="w-4 h-4 text-[#E67E22]" />
            <span>Authenticated Access</span>
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold text-slate-900">
            Sign in to QS-IMS
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Enter your assigned staff username or email address.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error && <AlertBanner type="error" message={error} />}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Username or Email
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. admin or mgr.najjera"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-[#E67E22] hover:bg-[#cf6d17] disabled:opacity-60 text-white text-sm font-semibold rounded transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Development Role Quick-Sign-In */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <div className="text-xs font-medium text-slate-600 mb-2.5">
              Quick Role Sign-In (Development Demo Accounts)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.username}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setUsername(acc.username);
                    setPassword(acc.pass);
                    submitCredentials(acc.username, acc.pass);
                  }}
                  className="text-left px-3 py-2 border border-slate-200 rounded hover:border-[#1A3A5C] hover:bg-slate-50 transition-colors"
                >
                  <div className="text-xs font-semibold text-[#1A3A5C]">{acc.label}</div>
                  <div className="text-[11px] text-slate-500 font-mono-num">
                    {acc.username} · {acc.branch}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
