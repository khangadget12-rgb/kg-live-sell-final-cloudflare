import React, { useEffect, useState } from 'react';
import {
  UserPlus,
  ExternalLink,
  Plus,
  Trash2,
  DatabaseBackup,
  RotateCcw,
  Save,
  Shield,
  FileSpreadsheet,
  Download,
  History,
  CheckCircle2,
  Clock,
  RefreshCw,
  KeyRound,
  X,
} from 'lucide-react';
import type {
  AuditLogRecord,
  GoogleSheetRecord,
  RajshahiSyncStatus,
  SessionLogRecord,
  UserAccount,
  UserPreferences,
  UserRole,
  UserSessionSummary,
} from '../lib/types';
import { formatDurationShort } from '../lib/formatters';
import { api } from '../services/api';

interface SettingsViewProps {
  user: UserAccount;
  sheets: GoogleSheetRecord[];
  rajshahiSyncStatus?: RajshahiSyncStatus | null;
  onSyncStatusUpdated?: (status: RajshahiSyncStatus) => void;
  onUserUpdated: (user: UserAccount) => void;
  onSheetsUpdated: () => Promise<void>;
  onDatabaseRestored: () => Promise<void>;
}

interface BackupEntry {
  id: number;
  filename: string;
  reason: string;
  sizeBytes: number;
  createdAt: string;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  user,
  sheets,
  rajshahiSyncStatus,
  onSyncStatusUpdated,
  onUserUpdated,
  onSheetsUpdated,
  onDatabaseRestored,
}) => {
  // Personal Preferences State
  const [prefs, setPrefs] = useState<UserPreferences>(user.preferences);
  const [preferredSheetId, setPreferredSheetId] = useState<number | null>(user.preferredSheetId);
  const [prefSavedMsg, setPrefSavedMsg] = useState('');
  const [prefSaving, setPrefSaving] = useState(false);

  // Admin / Super Admin Management State
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [sessionLogs, setSessionLogs] = useState<SessionLogRecord[]>([]);
  const [sessionSummaries, setSessionSummaries] = useState<UserSessionSummary[]>([]);
  const [sessionRoleFilter, setSessionRoleFilter] = useState<string>('');
  const [sessionSearch, setSessionSearch] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [mgmtError, setMgmtError] = useState('');
  const [mgmtStatus, setMgmtStatus] = useState('');

  // Rajshahi Live Sheet Auto-Scanner State
  const [liveSheetUrl, setLiveSheetUrl] = useState(rajshahiSyncStatus?.sheetUrl || '');
  const [autoScanEnabled, setAutoScanEnabled] = useState(rajshahiSyncStatus?.autoScanEnabled ?? true);
  const [scanIntervalSec, setScanIntervalSec] = useState(rajshahiSyncStatus?.intervalSeconds ?? 30);
  const [syncConfigSaving, setSyncConfigSaving] = useState(false);
  const [syncScanRunning, setSyncScanRunning] = useState(false);
  const [syncConfigMsg, setSyncConfigMsg] = useState('');
  const [syncConfigErr, setSyncConfigErr] = useState('');

  // New User Form (Username + Password; Role for Super Admin)
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('staff');

  // Password Change & Delete User Modals
  const [passwordTarget, setPasswordTarget] = useState<UserAccount | null>(null);
  const [passwordValue, setPasswordValue] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserAccount | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  // New Google Sheet Form (Super Admin)
  const [sheetName, setSheetName] = useState('');
  const [sheetBranch, setSheetBranch] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');

  // Restore confirmation modal
  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    setPrefs(user.preferences);
    setPreferredSheetId(user.preferredSheetId);
  }, [user]);

  useEffect(() => {
    if (rajshahiSyncStatus) {
      setLiveSheetUrl(rajshahiSyncStatus.sheetUrl);
      setAutoScanEnabled(rajshahiSyncStatus.autoScanEnabled);
      setScanIntervalSec(rajshahiSyncStatus.intervalSeconds);
    }
  }, [rajshahiSyncStatus?.sheetUrl, rajshahiSyncStatus?.autoScanEnabled, rajshahiSyncStatus?.intervalSeconds]);

  // Keep the live-scanner panel current even if no inventory change occurs.
  useEffect(() => {
    let stopped = false;
    let checking = false;
    const refreshScannerStatus = async () => {
      if (stopped || checking || document.hidden) return;
      checking = true;
      try {
        const result = await api.getRajshahiSyncStatus();
        if (!stopped) onSyncStatusUpdated?.(result.status);
      } catch {
        // The main app retains the last known good status on transient failures.
      } finally {
        checking = false;
      }
    };
    void refreshScannerStatus();
    const timer = window.setInterval(() => void refreshScannerStatus(), 12000);
    const onVisibility = () => { if (!document.hidden) void refreshScannerStatus(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [onSyncStatusUpdated]);

  const loadSessionLogs = async (roleFilterVal = sessionRoleFilter) => {
    if (user.role === 'staff') return;
    setLoadingSessions(true);
    try {
      const sRes = await api.listSessionLogs(roleFilterVal || undefined);
      setSessionLogs(sRes.sessions);
      setSessionSummaries(sRes.summaries);
    } catch (err) {
      setMgmtError((err as Error).message);
    } finally {
      setLoadingSessions(false);
    }
  };

  const loadAdminData = async () => {
    if (user.role === 'staff') return;
    try {
      const [uRes, bRes, aRes, sRes] = await Promise.all([
        api.listUsers(),
        api.listBackups(),
        api.listAuditLogs(),
        api.listSessionLogs(sessionRoleFilter || undefined),
      ]);
      setUsers(uRes.users);
      setBackups(bRes.backups);
      setAuditLogs(aRes.logs);
      setSessionLogs(sRes.sessions);
      setSessionSummaries(sRes.summaries);
    } catch (err) {
      setMgmtError((err as Error).message);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, [user.role]);

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setPrefSaving(true);
    setPrefSavedMsg('');
    try {
      const res = await api.updateMyPreferences({
        preferences: prefs,
        preferredSheetId,
      });
      onUserUpdated(res.user);
      setPrefSavedMsg('Preferences saved to your profile.');
      setTimeout(() => setPrefSavedMsg(''), 3000);
    } catch (err) {
      setMgmtError((err as Error).message);
    } finally {
      setPrefSaving(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setMgmtError('');
    setMgmtStatus('');
    try {
      const effectiveRole = newRole;
      await api.createUser({
        username: newUsername.trim(),
        password: newPassword,
        role: effectiveRole,
      });
      setNewUsername('');
      setNewPassword('');
      setMgmtStatus(`Created ${effectiveRole.replace('_', ' ')} account.`);
      await loadAdminData();
    } catch (err) {
      setMgmtError((err as Error).message);
    }
  };

  const handleToggleUserActive = async (target: UserAccount) => {
    setMgmtError('');
    setMgmtStatus('');
    try {
      await api.updateUser(target.id, { isActive: !target.isActive });
      setMgmtStatus(`${target.isActive ? 'Deactivated' : 'Reactivated'} @${target.username}.`);
      await loadAdminData();
    } catch (err) {
      setMgmtError((err as Error).message);
    }
  };

  const handleSaveUserPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordTarget) return;
    setMgmtError('');
    setMgmtStatus('');
    setPasswordSaving(true);
    try {
      await api.updateUser(passwordTarget.id, { password: passwordValue });
      setMgmtStatus(`Updated password for @${passwordTarget.username}.`);
      setPasswordTarget(null);
      setPasswordValue('');
    } catch (err) {
      setMgmtError((err as Error).message);
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deleteTarget) return;
    setMgmtError('');
    setMgmtStatus('');
    setDeletingUser(true);
    try {
      await api.deleteUser(deleteTarget.id);
      setMgmtStatus(`Deleted account @${deleteTarget.username}.`);
      setDeleteTarget(null);
      await loadAdminData();
    } catch (err) {
      setMgmtError((err as Error).message);
    } finally {
      setDeletingUser(false);
    }
  };

  const handleToggleUserNotify = async (target: UserAccount) => {
    setMgmtError('');
    try {
      await api.updateUser(target.id, { receiveNotifications: !target.receiveNotifications });
      await loadAdminData();
    } catch (err) {
      setMgmtError((err as Error).message);
    }
  };

  const handleAddSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    setMgmtError('');
    setMgmtStatus('');
    try {
      await api.createSheet({
        name: sheetName.trim(),
        branchLabel: sheetBranch.trim(),
        url: sheetUrl.trim(),
        isAvailable: true,
      });
      setSheetName('');
      setSheetBranch('');
      setSheetUrl('');
      setMgmtStatus('Added Google Sheet link.');
      await onSheetsUpdated();
    } catch (err) {
      setMgmtError((err as Error).message);
    }
  };

  const handleToggleSheetAvailable = async (s: GoogleSheetRecord) => {
    setMgmtError('');
    try {
      await api.updateSheet(s.id, { isAvailable: !s.isAvailable });
      await onSheetsUpdated();
    } catch (err) {
      setMgmtError((err as Error).message);
    }
  };

  const handleDeleteSheet = async (id: number) => {
    setMgmtError('');
    try {
      await api.deleteSheet(id);
      await onSheetsUpdated();
    } catch (err) {
      setMgmtError((err as Error).message);
    }
  };

  const handleSaveRajshahiSyncConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncConfigErr('');
    setSyncConfigMsg('');
    setSyncConfigSaving(true);
    try {
      const res = await api.updateRajshahiSyncConfig({
        sheetUrl: liveSheetUrl.trim(),
        autoScanEnabled,
        intervalSeconds: scanIntervalSec,
        scanNow: true,
      });
      onSyncStatusUpdated?.(res.status);
      await onSheetsUpdated();
      if (res.syncResult?.changed) {
        await onDatabaseRestored();
        setSyncConfigMsg(`Saved & synced immediately: ${res.syncResult.summary}`);
      } else if (res.syncResult?.status.lastError) {
        setSyncConfigErr(res.syncResult.status.lastError);
      } else {
        setSyncConfigMsg(
          res.status.sheetUrl
            ? `Live auto-scan saved (${res.status.autoScanEnabled ? `every ${res.status.intervalSeconds}s` : 'paused'}).`
            : 'Live sheet URL cleared (local operational inventory active).'
        );
      }
    } catch (err) {
      setSyncConfigErr((err as Error).message);
    } finally {
      setSyncConfigSaving(false);
    }
  };

  const handleManualScanRajshahi = async () => {
    setSyncConfigErr('');
    setSyncConfigMsg('');
    setSyncScanRunning(true);
    try {
      const res = await api.triggerRajshahiSync();
      onSyncStatusUpdated?.(res.status);
      if (res.changed) {
        await onDatabaseRestored();
      }
      if (res.status.lastError) {
        setSyncConfigErr(res.status.lastError);
      } else {
        setSyncConfigMsg(res.changed ? `Synced changes: ${res.summary}` : res.summary);
      }
    } catch (err) {
      setSyncConfigErr((err as Error).message);
    } finally {
      setSyncScanRunning(false);
    }
  };

  const handleCreateBackup = async () => {
    setMgmtError('');
    setMgmtStatus('');
    try {
      const res = await api.createBackup('Manual Settings Backup');
      setMgmtStatus(`Created SQLite backup: ${res.backup.filename}`);
      await loadAdminData();
    } catch (err) {
      setMgmtError((err as Error).message);
    }
  };

  const handleConfirmRestore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    setMgmtError('');
    try {
      await api.restoreBackup(restoreTarget.id);
      setRestoreTarget(null);
      setMgmtStatus(`Restored database from ${restoreTarget.filename}.`);
      await onDatabaseRestored();
      await loadAdminData();
    } catch (err) {
      setMgmtError((err as Error).message);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6">
      {mgmtError && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
          {mgmtError}
        </div>
      )}
      {mgmtStatus && (
        <div role="status" className="p-3.5 rounded-xl bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 text-xs font-medium text-teal-800 dark:text-teal-200">
          {mgmtStatus}
        </div>
      )}

      {/* 1. PERSONAL PREFERENCES (All roles including Staff) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-display font-bold text-base">Personal Display, Theme &amp; Sheet Preferences</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Saved individually for your account ({user.fullName}) across sessions
          </p>
        </div>

        <form onSubmit={handleSavePreferences} className="mt-5 space-y-5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="pref-theme" className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Theme Mode
              </label>
              <select
                id="pref-theme"
                value={prefs.theme}
                onChange={(e) => setPrefs((p) => ({ ...p, theme: e.target.value as UserPreferences['theme'] }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System Default</option>
              </select>
            </div>

            <div>
              <label htmlFor="pref-layout" className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                SpecLedger Layout
              </label>
              <select
                id="pref-layout"
                value={prefs.layout}
                onChange={(e) => setPrefs((p) => ({ ...p, layout: e.target.value as UserPreferences['layout'] }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="table">Table View</option>
                <option value="cards">Card Grid</option>
              </select>
            </div>

            <div>
              <label htmlFor="pref-density" className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Row Density
              </label>
              <select
                id="pref-density"
                value={prefs.density}
                onChange={(e) => setPrefs((p) => ({ ...p, density: e.target.value as UserPreferences['density'] }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </div>

            <div>
              <label htmlFor="pref-currency" className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Currency Formatting
              </label>
              <select
                id="pref-currency"
                value={prefs.currencyFormat}
                onChange={(e) => setPrefs((p) => ({ ...p, currencyFormat: e.target.value as UserPreferences['currencyFormat'] }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="south_asian">South Asian (৳1,50,000)</option>
                <option value="international">International (৳150,000)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div>
              <label htmlFor="pref-sheet" className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Default Preferred Google Sheet
              </label>
              <select
                id="pref-sheet"
                value={preferredSheetId ?? ''}
                onChange={(e) => setPreferredSheetId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="">Auto-select first available sheet</option>
                {sheets.filter((s) => s.isAvailable).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.branchLabel}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-5 py-2">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.showAskingPrice}
                  onChange={(e) => setPrefs((p) => ({ ...p, showAskingPrice: e.target.checked }))}
                  className="rounded border-slate-300 text-teal-600"
                />
                <span>Show Asking Price</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.showDiscountedPrice ?? true}
                  onChange={(e) => setPrefs((p) => ({ ...p, showDiscountedPrice: e.target.checked }))}
                  className="rounded border-slate-300 text-teal-600"
                />
                <span>Show Discounted Price</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.showBorderPrice}
                  onChange={(e) => setPrefs((p) => ({ ...p, showBorderPrice: e.target.checked }))}
                  className="rounded border-slate-300 text-teal-600"
                />
                <span>Show Border Price</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.showBranchStock}
                  onChange={(e) => setPrefs((p) => ({ ...p, showBranchStock: e.target.checked }))}
                  className="rounded border-slate-300 text-teal-600"
                />
                <span>Show Branch Stock</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.soundEnabled}
                  onChange={(e) => setPrefs((p) => ({ ...p, soundEnabled: e.target.checked }))}
                  className="rounded border-slate-300 text-teal-600"
                />
                <span>Notification Sound</span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={prefSaving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{prefSaving ? 'Saving...' : 'Save My Preferences'}</span>
            </button>
            {prefSavedMsg && (
              <span className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {prefSavedMsg}
              </span>
            )}
          </div>
        </form>
      </section>

      {/* 2. GOOGLE SHEETS MANAGEMENT & LIVE AUTO-SCANNER */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-teal-600" />
            <div>
              <h3 className="font-display font-bold text-base">Rajshahi Live Sheet Auto-Scanner &amp; Directory</h3>
              <p className="text-xs text-slate-500">
Checks your public Rajshahi sheet in the background, validates all four branch stock columns, and updates every connected screen when a real change is detected.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={syncScanRunning}
            onClick={handleManualScanRajshahi}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncScanRunning ? 'animate-spin' : ''}`} />
            <span>{syncScanRunning ? 'Scanning Sheet...' : 'Scan & Sync Now'}</span>
          </button>
        </div>

        {/* Continuous Rajshahi Live Sheet Scanner Controls */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-3 text-xs">
          {user.role !== 'staff' ? (
            <form onSubmit={handleSaveRajshahiSyncConfig} className="space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                <div className="lg:col-span-6">
                  <label htmlFor="rajshahi-live-url" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Public Rajshahi Google Sheet URL (CSV-accessible link)
                  </label>
                  <input
                    id="rajshahi-live-url"
                    type="url"
                    placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                    value={liveSheetUrl}
                    onChange={(e) => setLiveSheetUrl(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label htmlFor="rajshahi-scan-interval" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Scan Interval
                  </label>
                  <select
                    id="rajshahi-scan-interval"
                    value={scanIntervalSec}
                    onChange={(e) => setScanIntervalSec(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value={15}>Every 15s</option>
                    <option value={30}>Every 30s (recommended)</option>
                    <option value={60}>Every 60s</option>
                    <option value={120}>Every 2 minutes</option>
                  </select>
                </div>
                <div className="lg:col-span-2 flex items-center gap-2 py-2">
                  <input
                    id="rajshahi-autoscan-toggle"
                    type="checkbox"
                    checked={autoScanEnabled}
                    onChange={(e) => setAutoScanEnabled(e.target.checked)}
                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                  />
                  <label htmlFor="rajshahi-autoscan-toggle" className="font-medium text-slate-700 dark:text-slate-300">
                    Continuous Scan
                  </label>
                </div>
                <div className="lg:col-span-2">
                  <button
                    type="submit"
                    disabled={syncConfigSaving}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold whitespace-nowrap disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{syncConfigSaving ? 'Saving...' : 'Save & Sync'}</span>
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Auto-Scan: {rajshahiSyncStatus?.autoScanEnabled ? `Active every ${rajshahiSyncStatus.intervalSeconds}s` : 'Paused'}
              </span>
              {rajshahiSyncStatus?.sheetUrl && (
                <a
                  href={rajshahiSyncStatus.sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 hover:underline font-medium"
                >
                  <span>Open Rajshahi Live Sheet</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="min-w-0">
              {rajshahiSyncStatus?.scanning
                ? 'Scanning Rajshahi sheet now…'
                : rajshahiSyncStatus?.autoScanEnabled && rajshahiSyncStatus.sheetUrl
                  ? 'Background scanner scheduled on Cloudflare (does not depend on this page being open)'
                  : 'Scanner paused'}
              {rajshahiSyncStatus?.lastScanAt && ` · Last check: ${new Date(rajshahiSyncStatus.lastScanAt).toLocaleString()}`}
              {rajshahiSyncStatus?.nextScanAt && rajshahiSyncStatus.autoScanEnabled && ` · Next check: ${new Date(rajshahiSyncStatus.nextScanAt).toLocaleTimeString()}`}
              {rajshahiSyncStatus?.lastScanSummary && ` · ${rajshahiSyncStatus.lastScanSummary}`}
              {rajshahiSyncStatus?.lastScanModelCount !== undefined && ` · ${rajshahiSyncStatus.lastScanModelCount} models / ${rajshahiSyncStatus.lastScanTotalUnits ?? 0} units`}
              {rajshahiSyncStatus?.lastScanBranchSummary && ` · Branch stock: ${rajshahiSyncStatus.lastScanBranchSummary}`}
            </span>
            {syncConfigMsg && <span className="text-teal-700 dark:text-teal-400 font-semibold">{syncConfigMsg}</span>}
            {(syncConfigErr || rajshahiSyncStatus?.lastError) && <span className="text-red-600 dark:text-red-400 font-semibold">{syncConfigErr || rajshahiSyncStatus?.lastError}</span>}
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Cloudflare scans in the background on the selected interval. Google can still take a few minutes to republish a changed Sheet. In Google Sheets, open File → Share → Publish to web → Published content &amp; settings and keep “Automatically republish when changes are made” enabled. Use a published /d/e/.../pubhtml link or a normal /d/.../edit link; both are supported.
          </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Sheet Name</th>
                <th className="py-2 px-3 font-medium">Branch Label</th>
                <th className="py-2 px-3 font-medium">Direct Link</th>
                <th className="py-2 px-3 font-medium">Status</th>
                {user.role === 'super_admin' && <th className="py-2 pl-3 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sheets.map((s) => (
                <tr key={s.id}>
                  <td className="py-2.5 pr-4 font-semibold">{s.name}</td>
                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{s.branchLabel}</td>
                  <td className="py-2.5 px-3">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 hover:underline font-medium"
                    >
                      <span>Open Original Sheet</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={s.isAvailable ? 'text-green-700 dark:text-green-400 font-semibold' : 'text-slate-400'}>
                      {s.isAvailable ? 'Available' : 'Hidden'}
                    </span>
                  </td>
                  {user.role === 'super_admin' && (
                    <td className="py-2.5 pl-3 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => handleToggleSheetAvailable(s)}
                        className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        {s.isAvailable ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSheet(s.id)}
                        aria-label={`Delete ${s.name}`}
                        className="px-2 py-1 rounded border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="w-3 h-3 inline" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {user.role === 'super_admin' && (
          <form onSubmit={handleAddSheet} className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <input
              type="text"
              required
              placeholder="Sheet Name (e.g. Khulna Sheet)"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <input
              type="text"
              required
              placeholder="Branch Label"
              value={sheetBranch}
              onChange={(e) => setSheetBranch(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <input
              type="url"
              required
              placeholder="https://docs.google.com/spreadsheets/..."
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Sheet Link</span>
            </button>
          </form>
        )}
      </section>

      {/* 3. USER ACCOUNTS, RBAC & NOTIFICATION RECIPIENTS (Admin & Super Admin) */}
      {user.role !== 'staff' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
            <Shield className="w-4 h-4 text-teal-600" />
            <div>
              <h3 className="font-display font-bold text-base">User Accounts &amp; Notification Recipients</h3>
              <p className="text-xs text-slate-500">
                Create Staff, Admin, and Super Admin accounts; reset passwords, deactivate, and delete accounts. Staff accounts are not assigned to a fixed branch.
              </p>
            </div>
          </div>

          {/* 2-Step Create User Form (Username + Password, plus Role for Super Admin) */}
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs items-end">
            <div>
              <label htmlFor="u-user" className="block font-medium text-slate-600 dark:text-slate-300 mb-1">1. Username *</label>
              <input
                id="u-user"
                type="text"
                required
                placeholder="e.g. rahim_rg"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="u-pass" className="block font-medium text-slate-600 dark:text-slate-300 mb-1">2. Password *</label>
              <input
                id="u-pass"
                type="password"
                required
                minLength={6}
                placeholder="Min 6 chars"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            {(user.role === 'super_admin' || user.role === 'admin') && (
              <div>
                <label htmlFor="u-role" className="block font-medium text-slate-600 dark:text-slate-300 mb-1">Role</label>
                <select
                  id="u-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
            )}
            <div>
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Create Account</span>
              </button>
            </div>
          </form>

          {/* Users Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 pr-4 font-medium">Username</th>
                  <th className="py-2 px-3 font-medium">Role</th>
                  <th className="py-2 px-3 font-medium">Alerts Recipient</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 pl-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u) => {
                  const canManageTarget = user.role === 'super_admin' || user.role === 'admin';
                  return (
                    <tr key={u.id}>
                      <td className="py-2.5 pr-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">@{u.username}</div>
                        {u.fullName && u.fullName !== u.username && (
                          <div className="text-[11px] text-slate-500">{u.fullName}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 uppercase font-mono text-[11px] font-semibold">
                        {u.role.replace('_', ' ')}
                      </td>
                      <td className="py-2.5 px-3">
                        {u.role === 'staff' ? (
                          <span className="text-slate-400">N/A (Staff)</span>
                        ) : user.role === 'super_admin' ? (
                          <button
                            type="button"
                            onClick={() => handleToggleUserNotify(u)}
                            className={`px-2.5 py-1 rounded border text-[11px] font-semibold whitespace-nowrap ${
                              u.receiveNotifications
                                ? 'border-teal-300 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300'
                                : 'border-slate-200 dark:border-slate-700 text-slate-500'
                            }`}
                          >
                            {u.receiveNotifications ? 'Receiving Alerts' : 'Muted'}
                          </button>
                        ) : (
                          <span>{u.receiveNotifications ? 'Receiving' : 'Muted'}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={u.isActive ? 'text-green-700 dark:text-green-400 font-semibold' : 'text-red-600'}>
                          {u.isActive ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        {canManageTarget && u.id !== user.id ? (
                          <div className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
                            {(user.role === 'super_admin' || user.role === 'admin') && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPasswordTarget(u);
                                  setPasswordValue('');
                                }}
                                aria-label={`Change password for ${u.username}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                              >
                                <KeyRound className="w-3 h-3" />
                                <span>Password</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleToggleUserActive(u)}
                              className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                            >
                              {u.isActive ? 'Deactivate' : 'Reactivate'}
                            </button>
                            {(user.role === 'super_admin' || user.role === 'admin') && (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(u)}
                                aria-label={`Delete ${u.username}`}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 whitespace-nowrap shrink-0"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete Account</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 3.5. STAFF & USER SESSION VIEWER (Admin & Super Admin) */}
      {user.role !== 'staff' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-teal-600" />
              <div>
                <h3 className="font-display font-bold text-base">Staff &amp; User Session Viewer</h3>
                <p className="text-xs text-slate-500">
                  Tracks who signed in, active time spent on the software, and login/logout timestamps
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input
                type="text"
                aria-label="Search sessions by name or username"
                placeholder="Search user..."
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <select
                aria-label="Filter sessions by role"
                value={sessionRoleFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setSessionRoleFilter(val);
                  loadSessionLogs(val);
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="">All Roles</option>
                <option value="staff">Staff Only</option>
                {(user.role === 'super_admin' || user.role === 'admin') && <option value="admin">Admin Only</option>}
                {(user.role === 'super_admin' || user.role === 'admin') && <option value="super_admin">Super Admin Only</option>}
              </select>
              <button
                type="button"
                disabled={loadingSessions}
                onClick={() => loadSessionLogs(sessionRoleFilter)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingSessions ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {(() => {
            const q = sessionSearch.trim().toLowerCase();
            const filteredSummaries = sessionSummaries.filter(
              (s) => !q || `${s.fullName} ${s.username} ${s.role}`.toLowerCase().includes(q)
            );
            const filteredLogs = sessionLogs.filter(
              (s) => !q || `${s.fullName} ${s.username} ${s.role}`.toLowerCase().includes(q)
            );
            const onlineCount = filteredSummaries.filter((s) => s.isOnline).length;
            const totalActiveSecs = filteredSummaries.reduce((sum, s) => sum + s.totalActiveSeconds, 0);

            return (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                    <div className="text-[11px] text-slate-500">Active Now (Last 2m)</div>
                    <div className="font-mono text-lg font-bold tabular-nums mt-0.5 text-teal-700 dark:text-teal-400">
                      {onlineCount}
                    </div>
                  </div>
                  <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                    <div className="text-[11px] text-slate-500">Tracked Sessions</div>
                    <div className="font-mono text-lg font-bold tabular-nums mt-0.5">{filteredLogs.length}</div>
                  </div>
                  <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                    <div className="text-[11px] text-slate-500">Total Active Duration</div>
                    <div className="font-mono text-lg font-bold tabular-nums mt-0.5">
                      {formatDurationShort(totalActiveSecs)}
                    </div>
                  </div>
                </div>

                {/* Accumulated Usage by User */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Usage Summary by Staff / User
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                          <th className="py-2 pr-4 font-medium">User</th>
                          <th className="py-2 px-3 font-medium">Role</th>
                          <th className="py-2 px-3 text-right font-medium">Sessions</th>
                          <th className="py-2 px-3 text-right font-medium">Total Active Time</th>
                          <th className="py-2 px-3 font-medium">Last Activity</th>
                          <th className="py-2 pl-3 text-right font-medium">Presence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredSummaries.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-5 text-center text-slate-500">
                              No tracked user sessions yet.
                            </td>
                          </tr>
                        ) : (
                          filteredSummaries.map((sum) => (
                            <tr key={sum.userId}>
                              <td className="py-2.5 pr-4">
                                <div className="font-semibold text-slate-900 dark:text-slate-100">{sum.fullName}</div>
                                <div className="text-[11px] font-mono text-slate-500">@{sum.username}</div>
                              </td>
                              <td className="py-2.5 px-3 uppercase font-mono text-[11px] font-semibold">
                                {sum.role.replace('_', ' ')}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums">{sum.sessionCount}</td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-teal-700 dark:text-teal-400">
                                {formatDurationShort(sum.totalActiveSeconds)}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 tabular-nums">
                                {new Date(sum.lastSeenAt).toLocaleString()}
                              </td>
                              <td className="py-2.5 pl-3 text-right font-semibold">
                                <span className={sum.isOnline ? 'text-green-700 dark:text-green-400' : 'text-slate-400'}>
                                  {sum.isOnline ? 'Online' : 'Offline'}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Detailed Session History */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Individual Login Sessions
                  </h4>
                  <div className="max-h-72 overflow-y-auto overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-950/60 sticky top-0">
                        <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                          <th className="py-2 px-3 font-medium">User</th>
                          <th className="py-2 px-3 font-medium">Login Time</th>
                          <th className="py-2 px-3 font-medium">Last Active / Logout</th>
                          <th className="py-2 px-3 text-right font-medium">Duration</th>
                          <th className="py-2 px-3 font-medium">Status</th>
                          <th className="py-2 px-3 font-medium">IP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredLogs.slice(0, 60).map((s) => (
                          <tr key={s.id}>
                            <td className="py-2 px-3">
                              <span className="font-medium text-slate-900 dark:text-slate-100">{s.fullName}</span>{' '}
                              <span className="font-mono text-[11px] text-slate-500">({s.role})</span>
                            </td>
                            <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
                              {new Date(s.loginAt).toLocaleString()}
                            </td>
                            <td className="py-2 px-3 font-mono text-[11px] text-slate-500 tabular-nums">
                              {new Date(s.logoutAt || s.lastSeenAt).toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums">
                              {formatDurationShort(s.activeSeconds)}
                            </td>
                            <td className="py-2 px-3 uppercase font-mono text-[11px]">
                              <span
                                className={
                                  s.status === 'active'
                                    ? 'text-green-700 dark:text-green-400 font-semibold'
                                    : 'text-slate-500'
                                }
                              >
                                {s.status}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-mono text-[11px] text-slate-500">{s.ipAddress || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}
        </section>
      )}

      {/* 4. BACKUPS & DATABASE RESTORE (Admin creates; Super Admin restores) */}
      {user.role !== 'staff' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <DatabaseBackup className="w-4 h-4 text-teal-600" />
                <div>
                  <h3 className="font-display font-bold text-sm">SQLite Backups &amp; Restoration</h3>
                  <p className="text-[11px] text-slate-500">
                    {user.role === 'super_admin'
                      ? 'Automatic & manual backups · Super Admin can restore'
                      : 'Only Super Admin can restore the full business database'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCreateBackup}
                className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold whitespace-nowrap"
              >
                Create Backup
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {backups.length === 0 ? (
                <div className="py-6 text-center text-slate-500">No backups recorded yet.</div>
              ) : (
                backups.map((b) => (
                  <div key={b.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono font-semibold truncate">{b.filename}</div>
                      <div className="text-[11px] text-slate-500">
                        {b.reason} · {(b.sizeBytes / 1024).toFixed(1)} KB · {new Date(b.createdAt).toLocaleString()}
                      </div>
                    </div>
                    {user.role === 'super_admin' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={`/api/backups/${b.id}/download`}
                          className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                          aria-label={`Download ${b.filename}`}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => setRestoreTarget(b)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-semibold hover:bg-amber-50 dark:hover:bg-amber-950/30"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Restore</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Audit Logs */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
              <History className="w-4 h-4 text-teal-600" />
              <div>
                <h3 className="font-display font-bold text-sm">Recent Audit Trail</h3>
                <p className="text-[11px] text-slate-500">Tamper-evident operational log across sales, voids, stock &amp; RBAC</p>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {auditLogs.slice(0, 30).map((log) => (
                <div key={log.id} className="py-2.5 space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{log.action}</span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-slate-600 dark:text-slate-300">{log.details}</div>
                  <div className="text-[11px] text-slate-500">
                    Actor: {log.actorName} ({log.actorRole})
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Credits Footer */}
      <footer className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-6 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span>Khan Gadget · KG Live Sell + SpecLedger</span>
        <span className="font-semibold text-slate-700 dark:text-slate-200">
          Developed and Published by Alam Ar Rafi
        </span>
      </footer>

      {/* Change User Password Modal */}
      {passwordTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSaveUserPassword}
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-teal-600" />
                <h3 className="font-display font-bold text-base">
                  Change Password · @{passwordTarget.username}
                </h3>
              </div>
              <button
                type="button"
                aria-label="Close change password modal"
                onClick={() => setPasswordTarget(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Role: <strong className="uppercase font-mono">{passwordTarget.role.replace('_', ' ')}</strong>
            </div>
            <div>
              <label htmlFor="reset-user-pass" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                New Password (min 6 characters) *
              </label>
              <input
                id="reset-user-pass"
                type="password"
                required
                minLength={6}
                placeholder="Enter new password"
                value={passwordValue}
                onChange={(e) => setPasswordValue(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPasswordTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={passwordSaving}
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold disabled:opacity-50"
              >
                {passwordSaving ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div
            role="dialog"
            aria-label={`Delete account ${deleteTarget.username}`}
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
          >
            <h3 className="font-display font-bold text-base text-red-600 dark:text-red-400">
              Delete User Account
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Permanently delete <strong>@{deleteTarget.username}</strong> ({deleteTarget.role.replace('_', ' ')})? Historical sales and session logs remain preserved, but this account will no longer exist.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingUser}
                onClick={handleConfirmDeleteUser}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50"
              >
                {deletingUser ? 'Deleting...' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Database Confirmation Modal */}
      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <h3 className="font-display font-bold text-base text-amber-600 dark:text-amber-400">
              Confirm Full Database Restore
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Restoring <strong>{restoreTarget.filename}</strong> replaces the live database state with that snapshot. A safety backup of the current database will be created first.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRestoreTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={restoring}
                onClick={handleConfirmRestore}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-50"
              >
                {restoring ? 'Restoring...' : 'Confirm Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
