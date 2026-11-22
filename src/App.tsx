import React, { useEffect, useState } from 'react';
import { apiRequest, getAuthToken, setAuthToken } from './api/client';
import { Layout, NAV_ITEMS, type NavRoute } from './components/Layout';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { DashboardPage } from './pages/DashboardPage';
import { InventoryPage } from './pages/InventoryPage';
import { LoginPage } from './pages/LoginPage';
import { ProductsPage } from './pages/ProductsPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { StockIntakePage } from './pages/StockIntakePage';
import { StockIssuesPage } from './pages/StockIssuesPage';
import { StockTransfersPage } from './pages/StockTransfersPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { UsersPage } from './pages/UsersPage';
import type { User } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState<boolean>(() => Boolean(getAuthToken()));
  const [activeRoute, setActiveRoute] = useState<NavRoute>('dashboard');

  async function syncSessionFromDb() {
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      setCheckingSession(false);
      return;
    }
    try {
      const res = await apiRequest<{ user: User }>('/api/auth/me');
      setUser(res.user);
    } catch {
      setAuthToken(null);
      setUser(null);
      setActiveRoute('dashboard');
    } finally {
      setCheckingSession(false);
    }
  }

  useEffect(() => {
    void syncSessionFromDb();
  }, []);

  async function handleLogout() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore if session already expired
    } finally {
      setAuthToken(null);
      setUser(null);
      setActiveRoute('dashboard');
    }
  }

  function handleNavigate(route: NavRoute) {
    if (!user) return;
    const item = NAV_ITEMS.find((n) => n.id === route);
    if (item && item.roles.includes(user.role)) {
      setActiveRoute(route);
    } else {
      setActiveRoute('dashboard');
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#F5F7FA] flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-md px-6 py-5 text-center space-y-2 max-w-xs w-full">
          <div className="w-10 h-10 mx-auto rounded bg-[#1A3A5C] text-white font-display font-bold text-lg flex items-center justify-center">
            QS
          </div>
          <div className="text-sm font-semibold text-[#1A3A5C]">Initializing QS-IMS</div>
          <div className="text-xs text-slate-500">Loading local branch database...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        onLoginSuccess={(loggedInUser) => {
          setUser(loggedInUser);
          setActiveRoute('dashboard');
        }}
      />
    );
  }

  function renderPage() {
    if (!user) return null;
    switch (activeRoute) {
      case 'dashboard':
        return <DashboardPage user={user} onNavigate={handleNavigate} />;
      case 'products':
        return <ProductsPage user={user} />;
      case 'categories':
        return <CategoriesPage />;
      case 'inventory':
        return <InventoryPage user={user} onNavigate={handleNavigate} />;
      case 'stock-intake':
        return <StockIntakePage user={user} />;
      case 'stock-issues':
        return <StockIssuesPage user={user} />;
      case 'stock-transfers':
        return <StockTransfersPage user={user} />;
      case 'suppliers':
        return <SuppliersPage />;
      case 'purchase-orders':
        return <PurchaseOrdersPage user={user} onNavigate={handleNavigate} />;
      case 'reports':
        return <ReportsPage user={user} />;
      case 'users':
        return <UsersPage />;
      case 'audit-logs':
        return <AuditLogsPage user={user} />;
      case 'settings':
        return (
          <SettingsPage
            onDatabaseReplaced={() => {
              void syncSessionFromDb();
            }}
          />
        );
      default:
        return <DashboardPage user={user} onNavigate={handleNavigate} />;
    }
  }

  return (
    <Layout
      user={user}
      activeRoute={activeRoute}
      onNavigate={handleNavigate}
      onLogout={handleLogout}
    >
      {renderPage()}
    </Layout>
  );
}
