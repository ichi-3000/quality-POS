import React, { useState } from 'react';
import { apiRequest, setAuthToken } from './api/client';
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
  const [activeRoute, setActiveRoute] = useState<NavRoute>('dashboard');

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
        return <SettingsPage />;
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
