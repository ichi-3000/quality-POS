import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  ClipboardCheck,
  FileSpreadsheet,
  FolderTree,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PackageMinus,
  PackagePlus,
  Search,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { apiRequest, formatDateTime } from '../api/client';
import type { NotificationItem, RoleSlug, User } from '../types';
import { AlertBanner, Modal } from './StatusTag';

export type NavRoute =
  | 'dashboard'
  | 'products'
  | 'categories'
  | 'inventory'
  | 'stock-intake'
  | 'stock-issues'
  | 'stock-transfers'
  | 'suppliers'
  | 'purchase-orders'
  | 'reports'
  | 'users'
  | 'audit-logs'
  | 'settings';

interface NavItem {
  id: NavRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: RoleSlug[];
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'procurement_manager', 'branch_manager', 'stock_controller'] },
  { id: 'products', label: 'Products', icon: Package, roles: ['admin', 'procurement_manager', 'branch_manager', 'stock_controller'] },
  { id: 'categories', label: 'Categories', icon: FolderTree, roles: ['admin', 'procurement_manager'] },
  { id: 'inventory', label: 'Inventory & Ledger', icon: Boxes, roles: ['admin', 'procurement_manager', 'branch_manager', 'stock_controller'] },
  { id: 'stock-intake', label: 'Stock Intake / GRN', icon: PackagePlus, roles: ['admin', 'branch_manager', 'stock_controller'] },
  { id: 'stock-issues', label: 'Stock Issues', icon: PackageMinus, roles: ['admin', 'branch_manager', 'stock_controller'] },
  { id: 'stock-transfers', label: 'Stock Transfers', icon: ArrowLeftRight, roles: ['admin', 'procurement_manager', 'branch_manager', 'stock_controller'] },
  { id: 'suppliers', label: 'Suppliers', icon: Truck, roles: ['admin', 'procurement_manager'] },
  { id: 'purchase-orders', label: 'Purchase Orders', icon: ClipboardCheck, roles: ['admin', 'procurement_manager', 'branch_manager', 'stock_controller'] },
  { id: 'reports', label: 'Reports', icon: BarChart3, roles: ['admin', 'procurement_manager', 'branch_manager'] },
  { id: 'users', label: 'User Management', icon: Users, roles: ['admin'] },
  { id: 'audit-logs', label: 'Audit Logs', icon: History, roles: ['admin', 'branch_manager'] },
  { id: 'settings', label: 'Settings', icon: Settings, roles: ['admin'] },
];

interface LayoutProps {
  user: User;
  activeRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export function Layout({ user, activeRoute, onNavigate, onLogout, children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    products: Array<{ id: number; sku: string; name: string; category_name: string }>;
    suppliers: Array<{ id: number; supplier_code: string; name: string }>;
    purchase_orders: Array<{ id: number; po_number: string; status: string }>;
    transfers: Array<{ id: number; transfer_number: string; status: string }>;
  } | null>(null);
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const allowedItems = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  const activeItem = NAV_ITEMS.find((n) => n.id === activeRoute);

  // Pick top 4 role-appropriate destinations for the mobile bottom bar
  const mobileQuickRoutes: NavRoute[] =
    user.role === 'stock_controller'
      ? ['dashboard', 'inventory', 'stock-intake', 'stock-issues']
      : user.role === 'procurement_manager'
      ? ['dashboard', 'products', 'purchase-orders', 'reports']
      : ['dashboard', 'inventory', 'stock-intake', 'purchase-orders'];

  const bottomNavItems = mobileQuickRoutes
    .map((id) => allowedItems.find((item) => item.id === id))
    .filter((item): item is NavItem => Boolean(item));

  async function loadNotifications() {
    try {
      const data = await apiRequest<{ notifications: NotificationItem[]; unreadCount: number }>(
        '/api/notifications'
      );
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // ignore transient poll errors
    }
  }

  useEffect(() => {
    loadNotifications();
    const timer = setInterval(loadNotifications, 30000);
    return () => clearInterval(timer);
  }, [activeRoute]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await apiRequest<typeof searchResults>(
          `/api/search?q=${encodeURIComponent(q)}`
        );
        setSearchResults(res);
      } catch {
        setSearchResults(null);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  async function markNotificationRead(id: number, linkPath: string) {
    try {
      await apiRequest(`/api/notifications/${id}/read`, { method: 'POST' });
      await loadNotifications();
      setNotifOpen(false);
      const route = linkPath.replace(/^\//, '') as NavRoute;
      if (allowedItems.some((i) => i.id === route)) {
        onNavigate(route);
      }
    } catch {
      // ignore
    }
  }

  async function markAllRead() {
    await apiRequest('/api/notifications/read-all', { method: 'POST' });
    await loadNotifications();
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      setPwMsg({ type: 'success', text: 'Password updated successfully.' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPwMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update password' });
    }
  }

  const branchLabel = user.branch_name || 'All Branches (Head Office)';

  function renderSearchDropdown() {
    if (!searchResults) return null;
    return (
      <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-md shadow-lg z-30 max-h-80 overflow-y-auto divide-y divide-slate-100">
        {searchResults.products.length === 0 &&
        searchResults.suppliers.length === 0 &&
        searchResults.purchase_orders.length === 0 &&
        searchResults.transfers.length === 0 ? (
          <div className="p-3 text-xs text-slate-500">No matching records found.</div>
        ) : (
          <>
            {searchResults.products.map((p) => (
              <button
                key={`sp-${p.id}`}
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults(null);
                  setMobileSearchOpen(false);
                  onNavigate('products');
                }}
                className="w-full px-3 py-2.5 min-h-[44px] text-left hover:bg-slate-50 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900 truncate">{p.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono-num">
                    {p.sku} · {p.category_name}
                  </div>
                </div>
                <span className="text-[11px] text-[#1A3A5C] font-medium shrink-0">Product</span>
              </button>
            ))}
            {searchResults.suppliers.map((s) => (
              <button
                key={`ss-${s.id}`}
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults(null);
                  setMobileSearchOpen(false);
                  if (allowedItems.some((i) => i.id === 'suppliers')) {
                    onNavigate('suppliers');
                  }
                }}
                className="w-full px-3 py-2.5 min-h-[44px] text-left hover:bg-slate-50 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900 truncate">{s.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono-num">{s.supplier_code}</div>
                </div>
                <span className="text-[11px] text-[#1A3A5C] font-medium shrink-0">Supplier</span>
              </button>
            ))}
            {searchResults.purchase_orders.map((po) => (
              <button
                key={`spo-${po.id}`}
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults(null);
                  setMobileSearchOpen(false);
                  onNavigate('purchase-orders');
                }}
                className="w-full px-3 py-2.5 min-h-[44px] text-left hover:bg-slate-50 flex items-center justify-between gap-2"
              >
                <span className="text-xs font-medium font-mono-num text-slate-900">
                  {po.po_number}
                </span>
                <span className="text-[11px] text-[#E67E22] font-medium">PO · {po.status}</span>
              </button>
            ))}
            {searchResults.transfers.map((trf) => (
              <button
                key={`strf-${trf.id}`}
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults(null);
                  setMobileSearchOpen(false);
                  onNavigate('stock-transfers');
                }}
                className="w-full px-3 py-2.5 min-h-[44px] text-left hover:bg-slate-50 flex items-center justify-between gap-2"
              >
                <span className="text-xs font-medium font-mono-num text-slate-900">
                  {trf.transfer_number}
                </span>
                <span className="text-[11px] text-[#1A3A5C] font-medium">Transfer</span>
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#F5F7FA] text-slate-900 overflow-x-hidden">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 sm:w-64 bg-[#1A3A5C] text-white flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-14 lg:h-16 px-4 sm:px-5 flex items-center justify-between border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#E67E22] flex items-center justify-center font-display font-bold text-sm tracking-tight text-white">
              QS
            </div>
            <div>
              <div className="font-display font-bold text-sm leading-tight tracking-tight text-white">
                QS-IMS
              </div>
              <div className="text-[11px] text-slate-300 leading-tight">
                Quality Supermarkets
              </div>
            </div>
          </div>
          <button
            type="button"
            className="lg:hidden text-slate-300 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2 rounded hover:bg-white/10"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile Branch Context Strip inside Drawer */}
        <div className="lg:hidden px-4 py-2.5 bg-[#142d47] border-b border-white/10 flex items-center gap-2 text-xs text-slate-200 shrink-0">
          <Building2 className="w-3.5 h-3.5 text-[#E67E22] shrink-0" />
          <span className="truncate font-medium">{branchLabel}</span>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-1">
          {allowedItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeRoute === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigate(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded text-sm font-medium transition-colors text-left whitespace-nowrap ${
                  isActive
                    ? 'bg-[#E67E22] text-white'
                    : 'text-slate-200 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom Logout */}
        <div className="p-3 border-t border-white/10 shrink-0">
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded text-sm font-medium text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navigation Bar */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
          <div className="h-14 lg:h-16 px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-4">
            {/* Left: Hamburger + Breadcrumb / Page Title */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded border border-slate-200 text-slate-700 hover:bg-slate-50 shrink-0"
                aria-label="Open navigation"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
                  <span>QS-IMS</span>
                  <span>/</span>
                  <span className="truncate">{activeItem?.label || 'Dashboard'}</span>
                </div>
                <h1 className="text-sm sm:text-base font-semibold text-[#1A3A5C] truncate">
                  {activeItem?.label || 'Dashboard'}
                </h1>
                <div className="sm:hidden text-[11px] text-slate-500 truncate">
                  {user.branch_code || 'HQ'} · {user.role_name}
                </div>
              </div>
            </div>

            {/* Center: Desktop Global Search */}
            <div className="hidden md:block relative w-full max-w-sm">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search SKU, product, PO, transfer..."
                  className="w-full pl-9 pr-3 py-1.5 text-sm bg-[#F5F7FA] border border-slate-200 rounded focus:outline-none focus:border-[#1A3A5C] focus:bg-white"
                />
              </div>
              {renderSearchDropdown()}
            </div>

            {/* Right: Mobile Search Toggle, Branch Indicator, Notifications, User Profile */}
            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setMobileSearchOpen((v) => !v);
                  setNotifOpen(false);
                  setProfileOpen(false);
                }}
                className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
                aria-label="Toggle search"
              >
                {mobileSearchOpen ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
              </button>

              {/* Branch Indicator */}
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-[#F5F7FA] border border-slate-200 rounded text-xs text-slate-700">
                <Building2 className="w-3.5 h-3.5 text-[#1A3A5C]" />
                <span className="font-medium truncate max-w-[160px]">{branchLabel}</span>
              </div>

              {/* Notifications */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen((v) => !v);
                    setProfileOpen(false);
                  }}
                  className="relative min-w-[44px] min-h-[44px] sm:min-w-[38px] sm:min-h-[38px] flex items-center justify-center rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
                  aria-label="Notifications"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded bg-[#E67E22] text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-16 sm:top-auto sm:mt-2 w-auto sm:w-96 bg-white border border-slate-200 rounded-md shadow-lg z-30">
                    <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#1A3A5C]">
                        Notifications ({unreadCount} unread)
                      </span>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={markAllRead}
                          className="text-xs font-medium text-[#E67E22] hover:underline min-h-[32px] px-1"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-72 sm:max-h-80 overflow-y-auto divide-y divide-slate-100">
                      {notifications.length === 0 ? (
                        <div className="p-4 text-xs text-slate-500 text-center">
                          No notifications for your role or branch.
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => markNotificationRead(n.id, n.link_path)}
                            className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${
                              n.is_read ? 'opacity-65' : 'bg-amber-50/30'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-900">{n.title}</span>
                              {!n.is_read && (
                                <span className="text-[10px] font-semibold text-[#E67E22]">New</span>
                              )}
                            </div>
                            <p className="text-xs text-slate-600 mt-0.5">{n.message}</p>
                            <div className="text-[11px] text-slate-400 mt-1">
                              {n.branch_name || 'All Branches'} · {formatDateTime(n.created_at)}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Profile Menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen((v) => !v);
                    setNotifOpen(false);
                  }}
                  className="flex items-center gap-2.5 min-w-[44px] min-h-[44px] sm:min-h-[38px] px-2 sm:px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-left justify-center"
                >
                  <div className="w-7 h-7 rounded bg-[#1A3A5C] text-white text-xs font-semibold flex items-center justify-center shrink-0">
                    {user.full_name
                      .split(' ')
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()}
                  </div>
                  <div className="hidden sm:block leading-tight">
                    <div className="text-xs font-semibold text-slate-900 whitespace-nowrap">
                      {user.full_name}
                    </div>
                    <div className="text-[11px] text-slate-500 whitespace-nowrap">
                      {user.role_name}
                    </div>
                  </div>
                </button>

                {profileOpen && (
                  <div className="absolute right-0 mt-2 w-60 max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-md shadow-lg z-30 py-1">
                    <div className="px-4 py-2.5 border-b border-slate-100">
                      <div className="text-xs font-semibold text-slate-900 truncate">{user.full_name}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {user.role_name} · {user.branch_code || 'HQ'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        setPwModalOpen(true);
                      }}
                      className="w-full px-4 py-2.5 min-h-[44px] text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Change Password</span>
                    </button>
                    {user.role === 'admin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setProfileOpen(false);
                          onNavigate('settings');
                        }}
                        className="w-full px-4 py-2.5 min-h-[44px] text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>System Settings</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onLogout}
                      className="w-full px-4 py-2.5 min-h-[44px] text-left text-xs text-red-700 hover:bg-red-50 flex items-center gap-2 border-t border-slate-100"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mobile Expandable Global Search Bar */}
          {mobileSearchOpen && (
            <div className="md:hidden px-3 pb-3 pt-1 border-t border-slate-100 bg-white relative">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search SKU, product, PO, transfer..."
                  className="w-full pl-9 pr-3 py-2.5 min-h-[44px] text-sm bg-[#F5F7FA] border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C] focus:bg-white"
                />
              </div>
              {renderSearchDropdown()}
            </div>
          )}
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-3 sm:p-4 lg:p-6 pb-20 lg:pb-6 max-w-[1600px] w-full mx-auto min-w-0">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile quick navigation"
        className="mobile-bottom-nav lg:hidden fixed bottom-0 inset-x-0 z-20 h-14 bg-white border-t border-slate-200 grid grid-cols-5"
      >
        {bottomNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeRoute === item.id;
          return (
            <button
              key={`mob-${item.id}`}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 px-1 min-h-[44px] transition-colors ${
                isActive ? 'text-[#E67E22]' : 'text-slate-500 hover:text-[#1A3A5C]'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-[10px] font-medium truncate max-w-full leading-tight">
                {item.id === 'stock-intake'
                  ? 'Intake'
                  : item.id === 'stock-issues'
                  ? 'Issues'
                  : item.id === 'purchase-orders'
                  ? 'POs'
                  : item.id === 'inventory'
                  ? 'Stock'
                  : item.label}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 px-1 min-h-[44px] text-slate-500 hover:text-[#1A3A5C]"
        >
          <Menu className="w-4 h-4 shrink-0" />
          <span className="text-[10px] font-medium leading-tight">More</span>
        </button>
      </nav>

      {/* Change Password Modal */}
      <Modal
        open={pwModalOpen}
        onClose={() => {
          setPwModalOpen(false);
          setPwMsg(null);
        }}
        title="Change Account Password"
        subtitle={`Signed in as ${user.username}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {pwMsg && <AlertBanner type={pwMsg.type} message={pwMsg.text} />}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Current Password
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
            />
          </div>
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
              className="w-full px-3 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded focus:outline-none focus:border-[#1A3A5C]"
            />
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPwModalOpen(false)}
              className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-sm font-medium border border-slate-300 rounded text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-sm font-medium bg-[#E67E22] hover:bg-[#cf6d17] text-white rounded"
            >
              Update Password
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
