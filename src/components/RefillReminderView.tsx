import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Bell, BellOff, CheckCheck } from 'lucide-react';
import { BRANCHES } from '../lib/types';
import type { BranchCode, RefillAlertRecord, UserRole } from '../lib/types';
import { api } from '../services/api';

interface RefillReminderViewProps {
  alerts: RefillAlertRecord[];
  userRole: UserRole;
  onRefresh: () => Promise<void>;
}

export const RefillReminderView: React.FC<RefillReminderViewProps> = ({ alerts, userRole, onRefresh }) => {
  const canResolve = userRole !== 'staff';
  const [statusFilter, setStatusFilter] = useState<'active' | 'resolved' | 'all'>('active');
  const [branchFilter, setBranchFilter] = useState<BranchCode | 'ALL'>('ALL');
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [resolvingAll, setResolvingAll] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(true);
  const [togglingSetting, setTogglingSetting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionStatus, setActionStatus] = useState('');

  useEffect(() => {
    let mounted = true;
    api
      .getRefillNotificationSetting()
      .then((res) => {
        if (mounted) setNotificationsEnabled(res.enabled);
      })
      .catch(() => {
        // Keep default if setting check fails
      });
    return () => {
      mounted = false;
    };
  }, []);

  const activeCount = useMemo(
    () => alerts.filter((a) => a.status === 'active').length,
    [alerts]
  );

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (branchFilter !== 'ALL' && a.exhaustedBranch !== branchFilter) return false;
      return true;
    });
  }, [alerts, statusFilter, branchFilter]);

  const handleResolve = async (id: number) => {
    setActionError('');
    setActionStatus('');
    setResolvingId(id);
    try {
      await api.resolveRefillAlert(id);
      await onRefresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setResolvingId(null);
    }
  };

  const handleResolveAll = async () => {
    if (!canResolve || activeCount === 0) return;
    setActionError('');
    setActionStatus('');
    setResolvingAll(true);
    try {
      const res = await api.resolveAllRefillAlerts();
      setActionStatus(`Resolved ${res.resolvedCount} refill notice(s).`);
      await onRefresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setResolvingAll(false);
    }
  };

  const handleToggleNotifications = async () => {
    if (!canResolve) return;
    setActionError('');
    setActionStatus('');
    setTogglingSetting(true);
    try {
      const res = await api.setRefillNotificationSetting(!notificationsEnabled);
      setNotificationsEnabled(res.enabled);
      setActionStatus(
        res.enabled
          ? 'Refill stock notifications turned ON.'
          : 'Refill stock notifications turned OFF.'
      );
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setTogglingSetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display font-semibold text-base text-slate-900 dark:text-slate-100">
              Cross-Branch Refill Reminders
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Triggers when a branch reaches 0 units while other branches combined hold more than 1 unit. Re-arms automatically after restock.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {(['active', 'resolved', 'all'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md capitalize whitespace-nowrap ${
                    statusFilter === st ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
            <select
              aria-label="Filter exhausted branch"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value as BranchCode | 'ALL')}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value="ALL">All Exhausted Branches</option>
              {BRANCHES.map((b) => (
                <option key={b.code} value={b.code}>{b.code} ({b.name})</option>
              ))}
            </select>

            {canResolve && (
              <>
                <button
                  type="button"
                  disabled={togglingSetting}
                  aria-pressed={notificationsEnabled}
                  onClick={handleToggleNotifications}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors disabled:opacity-50 ${
                    notificationsEnabled
                      ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-200'
                      : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {notificationsEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                  <span>Refill Notifications: {notificationsEnabled ? 'On' : 'Off'}</span>
                </button>

                <button
                  type="button"
                  disabled={resolvingAll || activeCount === 0}
                  onClick={handleResolveAll}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>{resolvingAll ? 'Resolving All...' : `Resolve All (${activeCount})`}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {!notificationsEnabled && (
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200">
            Refill stock notifications are currently turned off. New stock shortages will not emit alert notices until turned back on.
          </div>
        )}
        {actionError && (
          <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
            {actionError}
          </div>
        )}
        {actionStatus && (
          <div role="status" className="p-3 rounded-lg bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 text-xs text-teal-800 dark:text-teal-200">
            {actionStatus}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center">
          <CheckCircle2 className="w-8 h-8 text-teal-600 mx-auto mb-2" />
          <p className="text-sm font-medium">No {statusFilter === 'all' ? '' : statusFilter} refill alerts</p>
          <p className="text-xs text-slate-500 mt-1">
            When any branch reaches 0 units for a model that has 2+ units across other branches, an alert appears here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((a) => (
            <div
              key={a.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{a.exhaustedBranch} stock exhausted (0 units)</span>
                  </div>
                  <h4 className="font-display font-bold text-base text-slate-900 dark:text-slate-100 mt-1">
                    {a.brand} {a.model}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{a.variant}</p>
                </div>
                {a.status === 'active' ? (
                  canResolve ? (
                    <button
                      type="button"
                      disabled={resolvingId === a.id}
                      onClick={() => handleResolve(a.id)}
                      className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                    >
                      {resolvingId === a.id ? 'Resolving...' : 'Mark Resolved'}
                    </button>
                  ) : (
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
                      Active
                    </span>
                  )
                ) : (
                  <span className="text-xs font-medium text-green-700 dark:text-green-400 whitespace-nowrap">
                    Resolved
                  </span>
                )}
              </div>

              {/* Exact branch order RG -> NM -> JSM -> CC */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {BRANCHES.map((b) => {
                  const qty = b.code === 'RG' ? a.rg : b.code === 'NM' ? a.nm : b.code === 'JSM' ? a.jsm : a.cc;
                  const isExhausted = b.code === a.exhaustedBranch;
                  return (
                    <div
                      key={b.code}
                      className={`px-3 py-2 flex items-center justify-between ${
                        isExhausted ? 'bg-red-50/50 dark:bg-red-950/20 font-semibold text-red-700 dark:text-red-300' : ''
                      }`}
                    >
                      <span>{b.code} ({b.name})</span>
                      <span className="font-mono tabular-nums">{qty} {qty === 1 ? 'unit' : 'units'}</span>
                    </div>
                  );
                })}
                <div className="px-3 py-2 flex items-center justify-between bg-slate-50 dark:bg-slate-950/60 font-semibold">
                  <span>Other branches combined</span>
                  <span className="font-mono tabular-nums text-teal-700 dark:text-teal-400">
                    {a.otherBranchesQty} units
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>Triggered: {new Date(a.triggeredAt).toLocaleString()}</span>
                {a.resolvedAt && <span>Resolved by {a.resolvedBy}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
