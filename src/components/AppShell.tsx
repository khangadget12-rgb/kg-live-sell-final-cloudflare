import React, { useState } from 'react';
import {
  LayoutDashboard,
  ShoppingBag,
  ReceiptText,
  Boxes,
  Search,
  HardDrive,
  AlertTriangle,
  BarChart3,
  Settings,
  Bell,
  LogOut,
  Menu,
  X,
  Volume2,
  VolumeX,
  ExternalLink,
  CheckCheck,
  Download,
  WifiOff,
} from 'lucide-react';
import type { AppTab, NotificationRecord, UserAccount } from '../lib/types';
import { KgEmblem } from './KgEmblem';
import {
  requestBrowserNotificationPermission,
  useOnlineStatus,
  usePWAInstall,
} from '../services/soundAndPwa';

interface NavItem {
  id: AppTab;
  label: string;
  icon: React.FC<{ className?: string }>;
  roles: UserAccount['role'][];
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['super_admin', 'admin', 'staff'] },
  { id: 'live-sell', label: 'Live Sell', icon: ShoppingBag, roles: ['super_admin', 'admin', 'staff'] },
  { id: 'sales-ledger', label: 'Sales Ledger', icon: ReceiptText, roles: ['super_admin', 'admin', 'staff'] },
  { id: 'stock-sheet', label: 'Stock Sheet', icon: Boxes, roles: ['super_admin', 'admin', 'staff'] },
  { id: 'laptop-finder', label: 'Laptop Finder', icon: Search, roles: ['super_admin', 'admin', 'staff'] },
  { id: 'accessories', label: 'Accessories & RAM/SSD', icon: HardDrive, roles: ['super_admin', 'admin', 'staff'] },
  { id: 'refill-reminder', label: 'Refill Reminder', icon: AlertTriangle, roles: ['super_admin', 'admin', 'staff'] },
  { id: 'reports', label: 'Reports', icon: BarChart3, roles: ['super_admin', 'admin', 'staff'] },
  { id: 'settings', label: 'Settings', icon: Settings, roles: ['super_admin', 'admin', 'staff'] },
];

interface AppShellProps {
  user: UserAccount;
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  onLogout: () => void;
  notifications: NotificationRecord[];
  unreadCount: number;
  activeRefillCount: number;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  onToggleSound: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  user,
  activeTab,
  onSelectTab,
  onLogout,
  notifications,
  unreadCount,
  activeRefillCount,
  onMarkRead,
  onMarkAllRead,
  onToggleSound,
  children,
}) => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [showIOSInstall, setShowIOSInstall] = useState(false);
  const [browserPerm, setBrowserPerm] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  const currentTitle = visibleNav.find((n) => n.id === activeTab)?.label ?? 'Dashboard';

  const roleLabel =
    user.role === 'super_admin' ? 'Super Admin' : user.role === 'admin' ? 'Admin' : 'Staff';

  const handlePermission = async () => {
    const res = await requestBrowserNotificationPermission();
    setBrowserPerm(res);
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="h-16 px-5 flex items-center justify-center border-b border-slate-200 dark:border-slate-800">
          <KgEmblem size={40} />
        </div>

        <nav aria-label="Main navigation" className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-teal-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'refill-reminder' && activeRefillCount > 0 && (
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      active ? 'text-teal-100' : 'text-amber-600 dark:text-amber-400 font-semibold'
                    }`}
                  >
                    {activeRefillCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
          <div className="text-xs text-slate-600 dark:text-slate-300 truncate font-medium">
            {user.fullName}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <span>{roleLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{user.role === 'staff' || user.assignedBranch === 'ALL' ? 'All Branches' : user.assignedBranch}</span>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-white dark:bg-slate-900 h-full flex flex-col border-r border-slate-200 dark:border-slate-800">
            <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center">
                <KgEmblem size={36} />
              </div>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav aria-label="Mobile navigation" className="flex-1 p-3 space-y-1 overflow-y-auto">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelectTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap ${
                      active
                        ? 'bg-teal-600 text-white'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </span>
                    {item.id === 'refill-reminder' && activeRefillCount > 0 && (
                      <span className="font-mono text-xs tabular-nums">{activeRefillCount}</span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={onLogout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out ({user.fullName})</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: 3 clean zones, single line */}
        <header className="h-16 px-4 sm:px-6 flex items-center justify-between gap-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="font-display font-semibold text-base sm:text-lg text-slate-900 dark:text-slate-100 truncate whitespace-nowrap">
              {currentTitle}
            </h2>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
            <span>KG Live Sell</span>
            <span aria-hidden="true">/</span>
            <span>{currentTitle}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isOnline && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 whitespace-nowrap">
                <WifiOff className="w-3.5 h-3.5" />
                <span>Offline</span>
              </span>
            )}

            {!isInstalled && isInstallable && (
              <button
                type="button"
                onClick={install}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Install App</span>
              </button>
            )}

            {!isInstalled && !isInstallable && isIOS && (
              <button
                type="button"
                onClick={() => setShowIOSInstall(true)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium whitespace-nowrap shrink-0"
              >
                Install on iOS
              </button>
            )}

            {user.role !== 'staff' && (
              <button
                type="button"
                aria-label={`Notifications (${unreadCount} unread)`}
                onClick={() => setNotifOpen(true)}
                className="relative flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <Bell className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                <span className="hidden sm:inline">Alerts</span>
                {unreadCount > 0 && (
                  <span className="font-mono tabular-nums text-xs font-semibold text-teal-700 dark:text-teal-300">
                    {unreadCount}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => onSelectTab('live-sell')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'live-sell'
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                  : 'bg-teal-600 hover:bg-teal-700 text-white'
              }`}
            >
              New Laptop Sale
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Persistent Notification Centre Drawer */}
      {notifOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-slate-950/50" onClick={() => setNotifOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Notification Centre"
            className="relative z-10 w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full flex flex-col"
          >
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-900 dark:text-slate-100">
                  Notification Centre
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {unreadCount} unread · Sales sheet reminders &amp; refill alerts
                </p>
              </div>
              <button
                type="button"
                aria-label="Close notifications"
                onClick={() => setNotifOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-950/50">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleSound}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                >
                  {user.preferences.soundEnabled ? (
                    <>
                      <Volume2 className="w-3.5 h-3.5 text-teal-600" />
                      <span>Sound On</span>
                    </>
                  ) : (
                    <>
                      <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                      <span>Sound Muted</span>
                    </>
                  )}
                </button>

                {browserPerm !== 'granted' && browserPerm !== 'unsupported' && (
                  <button
                    type="button"
                    onClick={handlePermission}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-teal-700 dark:text-teal-300"
                  >
                    Enable Browser Alerts
                  </button>
                )}
              </div>

              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  No notifications yet. Sale sheet reminders and refill alerts will appear here.
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-4 space-y-1.5 ${
                      n.isRead ? 'bg-white dark:bg-slate-900' : 'bg-teal-50/40 dark:bg-teal-950/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{n.title}</p>
                      <span className="font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">
                        {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{n.message}</p>
                    <div className="pt-1 flex items-center justify-between gap-3 text-xs">
                      <div className="text-slate-500 dark:text-slate-400">
                        {n.branch && <span>Branch: {n.branch}</span>}
                        {n.employeeName && <span> · By: {n.employeeName}</span>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {n.sheetUrl && (
                          <a
                            href={n.sheetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-teal-700 dark:text-teal-400 hover:underline"
                          >
                            <span>Open Sheet</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {!n.isRead && (
                          <button
                            type="button"
                            onClick={() => onMarkRead(n.id)}
                            className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showIOSInstall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-3">
            <h3 className="font-display font-semibold text-base">Install KG Live Sell on iOS</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              1. Tap the <strong>Share</strong> icon in Safari.<br />
              2. Scroll down and choose <strong>Add to Home Screen</strong>.
            </p>
            <button
              type="button"
              onClick={() => setShowIOSInstall(false)}
              className="w-full py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
