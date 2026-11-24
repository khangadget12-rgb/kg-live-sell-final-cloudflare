import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, setAuthToken, subscribeRealtimeEvents } from './services/api';
import { playNotificationSound, triggerBrowserNotification } from './services/soundAndPwa';
import type {
  AccessoryRecord,
  AppTab,
  GoogleSheetRecord,
  LaptopRecord,
  NotificationRecord,
  RajshahiSyncStatus,
  RefillAlertRecord,
  SaleRecord,
  UserAccount,
} from './lib/types';
import { LoginScreen } from './components/LoginScreen';
import { AppShell } from './components/AppShell';
import { DashboardView } from './components/DashboardView';
import { LiveSellView } from './components/LiveSellView';
import { SalesLedgerView } from './components/SalesLedgerView';
import { StockSheetView } from './components/StockSheetView';
import { LaptopFinderView } from './components/LaptopFinderView';
import { AccessoriesView } from './components/AccessoriesView';
import { RefillReminderView } from './components/RefillReminderView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<UserAccount | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');

  // Shared domain data
  const [laptops, setLaptops] = useState<LaptopRecord[]>([]);
  const [sheets, setSheets] = useState<GoogleSheetRecord[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [accessories, setAccessories] = useState<AccessoryRecord[]>([]);
  const [refillAlerts, setRefillAlerts] = useState<RefillAlertRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [rajshahiSyncStatus, setRajshahiSyncStatus] = useState<RajshahiSyncStatus | null>(null);
  const [syncPulseVersion, setSyncPulseVersion] = useState(0);

  const prevUnreadRef = useRef<number | null>(null);
  const syncVersionRef = useRef<number | null>(null);
  const syncReloadInFlightRef = useRef(false);

  // Apply light/dark/system theme class on <html>
  useEffect(() => {
    const theme = user?.preferences.theme ?? 'light';
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const isDark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', isDark);
    };

    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [user?.preferences.theme]);

  const loadOperationalData = useCallback(async (currentUser: UserAccount) => {
    const [opRes, sheetRes, salesRes, accRes, refillRes, syncRes] = await Promise.all([
      api.getOperationalLaptops(),
      api.listSheets(),
      api.listSales(),
      api.listAccessories(),
      api.listRefillAlerts(),
      api.getRajshahiSyncStatus().catch(() => null),
    ]);
    setLaptops(opRes.laptops);
    setSheets(sheetRes.sheets);
    setSales(salesRes.sales);
    setAccessories(accRes.accessories);
    setRefillAlerts(refillRes.alerts);
    if (syncRes) {
      setRajshahiSyncStatus(syncRes.status);
    }

    if (currentUser.role !== 'staff') {
      const notifRes = await api.listNotifications();
      setNotifications(notifRes.notifications);
      setUnreadCount(notifRes.unreadCount);
      prevUnreadRef.current = notifRes.unreadCount;
    } else {
      setNotifications([]);
      setUnreadCount(0);
      prevUnreadRef.current = 0;
    }
  }, []);

  const reloadAfterSync = useCallback(async (currentUser: UserAccount) => {
    if (syncReloadInFlightRef.current) return;
    syncReloadInFlightRef.current = true;
    try {
      await loadOperationalData(currentUser);
    } finally {
      syncReloadInFlightRef.current = false;
    }
  }, [loadOperationalData]);

  // Bootstrap authentication session
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const sess = await api.session();
        if (!active) return;
        setNeedsSetup(sess.needsSetup);
        if (sess.user) {
          setUser(sess.user);
          setActiveTab(sess.user.role === 'staff' ? 'live-sell' : 'dashboard');
          await loadOperationalData(sess.user);
        }
      } catch {
        // ignore network bootstrap error
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadOperationalData]);

  // Poll notifications for Admin / Super Admin and play chime + browser alert on new unread notifications
  useEffect(() => {
    if (!user || user.role === 'staff') return;
    const interval = window.setInterval(async () => {
      try {
        const res = await api.listNotifications();
        setNotifications(res.notifications);
        setUnreadCount(res.unreadCount);

        if (prevUnreadRef.current !== null && res.unreadCount > prevUnreadRef.current) {
          playNotificationSound(user.preferences.soundEnabled);
          const latest = res.notifications.find((n) => !n.isRead);
          if (latest) {
            triggerBrowserNotification(latest.title, latest.message);
          }
        }
        prevUnreadRef.current = res.unreadCount;
      } catch {
        // Ignore transient poll errors
      }
    }, 15000);
    return () => window.clearInterval(interval);
  }, [user]);

  // Five-second low-cost sync-version poll. Full data is reloaded only when
  // another user or background sheet scan actually changes the shared data.
  // SSE remains the immediate path; this is a fallback for missed/disconnected events.
  useEffect(() => {
    if (!user) {
      syncVersionRef.current = null;
      return;
    }

    let stopped = false;
    let checking = false;
    const checkSyncVersion = async () => {
      if (stopped || document.hidden || checking) return;
      checking = true;
      try {
        const result = await api.getSyncVersion();
        if (syncVersionRef.current === null) {
          syncVersionRef.current = result.syncVersion;
        } else if (syncVersionRef.current !== result.syncVersion) {
          syncVersionRef.current = result.syncVersion;
          await reloadAfterSync(user);
          setSyncPulseVersion((v) => v + 1);
        }
      } catch {
        // A transient network failure is retried on the next 5-second tick.
      } finally {
        checking = false;
      }
    };

    void checkSyncVersion();
    const interval = window.setInterval(() => void checkSyncVersion(), 5000);
    const onVisibilityChange = () => {
      if (!document.hidden) void checkSyncVersion();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user, reloadAfterSync]);

  // Track active session duration across all authenticated roles (including Staff)
  useEffect(() => {
    if (!user) return;
    const sendHeartbeat = () => {
      api.heartbeat(!document.hidden).catch(() => {});
    };
    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 30000);
    const onVisChange = () => {
      sendHeartbeat();
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [user?.id]);

  // Subscribe to instant real-time server events (Rajshahi sheet auto-sync, sales, manual refresh)
  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeRealtimeEvents((evt) => {
      syncVersionRef.current = evt.syncVersion;
      if (evt.type === 'inventory_updated' || evt.type === 'datasets_updated') {
        reloadAfterSync(user).catch(() => {});
        setSyncPulseVersion((v) => v + 1);
      } else if (evt.type === 'sync_status_updated') {
        api.getRajshahiSyncStatus().then((r) => setRajshahiSyncStatus(r.status)).catch(() => {});
      }
    });
    return () => {
      unsubscribe();
    };
  }, [user, reloadAfterSync]);

  const handleAuthenticated = async (authedUser: UserAccount) => {
    setUser(authedUser);
    setNeedsSetup(false);
    setActiveTab(authedUser.role === 'staff' ? 'live-sell' : 'dashboard');
    await loadOperationalData(authedUser);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    setLaptops([]);
    setSales([]);
    setNotifications([]);
    setUnreadCount(0);
    prevUnreadRef.current = null;
  };

  const handleRefreshAll = async () => {
    if (!user) return;
    await loadOperationalData(user);
  };

  const handleSaleCompleted = async () => {
    if (!user) return;
    const prevUnread = prevUnreadRef.current ?? 0;
    await loadOperationalData(user);
    if (user.role !== 'staff') {
      const notifRes = await api.listNotifications();
      if (notifRes.unreadCount > prevUnread) {
        playNotificationSound(user.preferences.soundEnabled);
      }
    }
  };

  const handleMarkNotificationRead = async (id: number) => {
    await api.markNotificationRead(id);
    const notifRes = await api.listNotifications();
    setNotifications(notifRes.notifications);
    setUnreadCount(notifRes.unreadCount);
    prevUnreadRef.current = notifRes.unreadCount;
  };

  const handleMarkAllRead = async () => {
    await api.markAllNotificationsRead();
    const notifRes = await api.listNotifications();
    setNotifications(notifRes.notifications);
    setUnreadCount(notifRes.unreadCount);
    prevUnreadRef.current = notifRes.unreadCount;
  };

  const handleToggleSound = async () => {
    if (!user) return;
    const nextPrefs = { ...user.preferences, soundEnabled: !user.preferences.soundEnabled };
    const res = await api.updateMyPreferences({ preferences: nextPrefs });
    setUser(res.user);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-sm text-slate-500 dark:text-slate-400">
        Loading Khan Gadget · KG Live Sell...
      </div>
    );
  }

  if (!user) {
    return <LoginScreen needsSetup={needsSetup} onAuthenticated={handleAuthenticated} />;
  }

  const effectiveTab: AppTab = activeTab;

  const activeRefillCount = refillAlerts.filter((a) => a.status === 'active').length;

  return (
    <AppShell
      user={user}
      activeTab={effectiveTab}
      onSelectTab={setActiveTab}
      onLogout={handleLogout}
      notifications={notifications}
      unreadCount={unreadCount}
      activeRefillCount={activeRefillCount}
      onMarkRead={handleMarkNotificationRead}
      onMarkAllRead={handleMarkAllRead}
      onToggleSound={handleToggleSound}
    >
      {effectiveTab === 'dashboard' && (
        <DashboardView
          laptops={laptops}
          sales={sales}
          refillAlerts={refillAlerts}
          preferences={user.preferences}
          onNavigate={setActiveTab}
        />
      )}

      {effectiveTab === 'live-sell' && (
        <LiveSellView
          user={user}
          laptops={laptops}
          sheets={sheets}
          onSaleCompleted={handleSaleCompleted}
          onUserUpdated={setUser}
        />
      )}

      {effectiveTab === 'sales-ledger' && (
        <SalesLedgerView
          sales={sales}
          userRole={user.role}
          preferences={user.preferences}
          onRefresh={handleRefreshAll}
        />
      )}

      {effectiveTab === 'stock-sheet' && (
        <StockSheetView
          laptops={laptops}
          userRole={user.role}
          preferences={user.preferences}
          rajshahiSyncStatus={rajshahiSyncStatus}
          onSyncStatusUpdated={setRajshahiSyncStatus}
          onRefresh={handleRefreshAll}
          onOpenSettings={() => setActiveTab('settings')}
        />
      )}

      {effectiveTab === 'laptop-finder' && (
        <LaptopFinderView
          operationalLaptops={laptops}
          userRole={user.role}
          preferences={user.preferences}
          syncPulseVersion={syncPulseVersion}
          rajshahiSyncStatus={rajshahiSyncStatus}
          onSyncStatusUpdated={setRajshahiSyncStatus}
          onOperationalRefresh={handleRefreshAll}
        />
      )}

      {effectiveTab === 'accessories' && (
        <AccessoriesView
          accessories={accessories}
          userRole={user.role}
          preferences={user.preferences}
          onRefresh={handleRefreshAll}
        />
      )}

      {effectiveTab === 'refill-reminder' && (
        <RefillReminderView
          alerts={refillAlerts}
          userRole={user.role}
          onRefresh={handleRefreshAll}
        />
      )}

      {effectiveTab === 'reports' && (
        <ReportsView preferences={user.preferences} />
      )}

      {effectiveTab === 'settings' && (
        <SettingsView
          user={user}
          sheets={sheets}
          rajshahiSyncStatus={rajshahiSyncStatus}
          onSyncStatusUpdated={setRajshahiSyncStatus}
          onUserUpdated={setUser}
          onSheetsUpdated={async () => {
            const res = await api.listSheets();
            setSheets(res.sheets);
          }}
          onDatabaseRestored={handleRefreshAll}
        />
      )}
    </AppShell>
  );
}
