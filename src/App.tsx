import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, setAuthToken, subscribeRealtimeEvents } from './services/api';
import { enableNotificationAudio, playNotificationSound, triggerBrowserNotification } from './services/soundAndPwa';
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

  const latestNotificationIdRef = useRef<number | null>(null);
  const notificationPollRef = useRef<(() => void) | null>(null);
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

    // Every role can read only its own notification inbox. Establish a baseline
    // once per login so pre-existing unread alerts are not replayed as new.
    const notifRes = await api.listNotifications();
    setNotifications(notifRes.notifications);
    setUnreadCount(notifRes.unreadCount);
    const latestId = notifRes.notifications.reduce((max, item) => Math.max(max, item.id), 0);
    if (latestNotificationIdRef.current === null) latestNotificationIdRef.current = latestId;
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

  // Poll the signed-in user's own inbox. Compare notification IDs (not unread
  // counts) so a newly inserted notification is never missed when another one
  // is read at the same time. Foreground polling is intentionally lightweight.
  useEffect(() => {
    if (!user) return;
    let stopped = false;
    let checking = false;
    const pollNotifications = async () => {
      if (stopped || checking) return;
      checking = true;
      try {
        const res = await api.listNotifications();
        if (stopped) return;
        setNotifications(res.notifications);
        setUnreadCount(res.unreadCount);
        const highestId = res.notifications.reduce((max, item) => Math.max(max, item.id), 0);
        const previousId = latestNotificationIdRef.current;
        if (previousId !== null && highestId > previousId && user.receiveNotifications) {
          const newItems = res.notifications
            .filter((item) => item.id > previousId)
            .sort((a, b) => a.id - b.id);
          if (newItems.length > 0) {
            playNotificationSound(user.preferences.soundEnabled);
            for (const item of newItems.slice(-3)) {
              await triggerBrowserNotification(item.title, item.message, `kg-live-sell-notification-${item.id}`);
            }
          }
        }
        latestNotificationIdRef.current = Math.max(previousId ?? 0, highestId);
      } catch {
        // Retry automatically on the next tick; preserve the last good inbox.
      } finally {
        checking = false;
      }
    };
    const pollNow = () => { void pollNotifications(); };
    notificationPollRef.current = pollNow;
    pollNow();
    // SSE delivers immediate hints when a sale or stock update creates alerts.
    // A 15-second poll remains as a recovery path if the stream disconnects.
    // Browser timers may be throttled in background tabs; true alerts after the
    // app is fully closed require a Web Push subscription, not page polling.
    const interval = window.setInterval(pollNow, 15000);
    const onVisibilityChange = () => { if (!document.hidden) pollNow(); };
    const onFocus = () => pollNow();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopped = true;
      if (notificationPollRef.current === pollNow) notificationPollRef.current = null;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
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
    const interval = window.setInterval(() => void checkSyncVersion(), 15000);
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

  // Poll the persisted Rajshahi scanner heartbeat as a fallback when an SSE
  // connection is interrupted or the Settings screen is not open.
  useEffect(() => {
    if (!user) return;
    let stopped = false;
    let checking = false;
    const refreshStatus = async () => {
      if (stopped || checking || document.hidden) return;
      checking = true;
      try {
        const result = await api.getRajshahiSyncStatus();
        if (!stopped) setRajshahiSyncStatus(result.status);
      } catch {
        // Keep the last known scanner status and retry next time.
      } finally {
        checking = false;
      }
    };
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 15000);
    const onVisibility = () => { if (!document.hidden) void refreshStatus(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.id]);

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
        notificationPollRef.current?.();
        reloadAfterSync(user).catch(() => {});
        setSyncPulseVersion((v) => v + 1);
        if (evt.type === 'inventory_updated' && ['sale_recorded', 'sale_voided', 'sale_deleted'].includes(evt.reason || '')) {
          window.dispatchEvent(new Event('kg-sales-counts-updated'));
        }
      } else if (evt.type === 'sync_status_updated') {
        api.getRajshahiSyncStatus().then((r) => setRajshahiSyncStatus(r.status)).catch(() => {});
      } else if (evt.type === 'sales_counts_updated') {
        window.dispatchEvent(new Event('kg-sales-counts-updated'));
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
    latestNotificationIdRef.current = null;
  };

  const handleRefreshAll = async () => {
    if (!user) return;
    await loadOperationalData(user);
  };

  const handleSaleCompleted = async () => {
    if (!user) return;
    await loadOperationalData(user);
  };

  const handleMarkNotificationRead = async (id: number) => {
    await api.markNotificationRead(id);
    const notifRes = await api.listNotifications();
    setNotifications(notifRes.notifications);
    setUnreadCount(notifRes.unreadCount);
  };

  const handleMarkAllRead = async () => {
    await api.markAllNotificationsRead();
    const notifRes = await api.listNotifications();
    setNotifications(notifRes.notifications);
    setUnreadCount(notifRes.unreadCount);
  };

  const handleToggleSound = async () => {
    if (!user) return;
    const nextEnabled = !user.preferences.soundEnabled;
    if (nextEnabled) void enableNotificationAudio();
    const nextPrefs = { ...user.preferences, soundEnabled: nextEnabled };
    const res = await api.updateMyPreferences({ preferences: nextPrefs });
    setUser(res.user);
  };

  const handleToggleNotificationPreference = async () => {
    if (!user) return;
    const res = await api.updateMyPreferences({ receiveNotifications: !user.receiveNotifications });
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
      onToggleNotificationPreference={handleToggleNotificationPreference}
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
