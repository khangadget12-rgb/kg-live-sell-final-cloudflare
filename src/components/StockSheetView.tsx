import React, { useEffect, useMemo, useState } from 'react';
import { Search, Download, SlidersHorizontal, RefreshCw, Edit3, X, Eye, EyeOff } from 'lucide-react';
import { BRANCHES, LAPTOP_CATEGORIES } from '../lib/types';
import type {
  BranchCode,
  LaptopCategory,
  LaptopRecord,
  RajshahiSyncStatus,
  UserPreferences,
  UserRole,
} from '../lib/types';
import { formatCurrency } from '../lib/formatters';
import { computeBranchBrandBreakdown, computeInventoryAnalytics } from '../lib/smartSearch';
import { api } from '../services/api';

interface StockSheetViewProps {
  laptops: LaptopRecord[];
  userRole: UserRole;
  preferences: UserPreferences;
  rajshahiSyncStatus?: RajshahiSyncStatus | null;
  onSyncStatusUpdated?: (status: RajshahiSyncStatus) => void;
  onRefresh: () => Promise<void>;
  onOpenSettings?: () => void;
}

export const StockSheetView: React.FC<StockSheetViewProps> = ({
  laptops,
  userRole,
  preferences,
  rajshahiSyncStatus,
  onSyncStatusUpdated,
  onRefresh,
  onOpenSettings,
}) => {
  const canEdit = userRole !== 'staff';
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<LaptopCategory | 'ALL'>('ALL');
  const [branchFilter, setBranchFilter] = useState<BranchCode | 'ALL'>('ALL');
  const [availability, setAvailability] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');

  const [showAsking, setShowAsking] = useState(preferences.showAskingPrice);
  const [showDiscounted, setShowDiscounted] = useState(preferences.showDiscountedPrice ?? true);
  const [showBorder, setShowBorder] = useState(preferences.showBorderPrice);

  useEffect(() => {
    setShowAsking(preferences.showAskingPrice);
    setShowDiscounted(preferences.showDiscountedPrice ?? true);
    setShowBorder(preferences.showBorderPrice);
  }, [preferences.showAskingPrice, preferences.showDiscountedPrice, preferences.showBorderPrice]);

  const [detailTarget, setDetailTarget] = useState<LaptopRecord | null>(null);
  const [editTarget, setEditTarget] = useState<LaptopRecord | null>(null);
  const [adjRg, setAdjRg] = useState(0);
  const [adjNm, setAdjNm] = useState(0);
  const [adjJsm, setAdjJsm] = useState(0);
  const [adjCc, setAdjCc] = useState(0);
  const [adjError, setAdjError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');

  const analytics = useMemo(() => computeInventoryAnalytics(laptops), [laptops]);
  const branchBreakdown = useMemo(
    () => computeBranchBrandBreakdown(laptops, branchFilter),
    [laptops, branchFilter]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return laptops.filter((l) => {
      if (categoryFilter !== 'ALL' && l.category !== categoryFilter) return false;
      if (branchFilter !== 'ALL') {
        const bq = branchFilter === 'RG' ? l.rg : branchFilter === 'NM' ? l.nm : branchFilter === 'JSM' ? l.jsm : l.cc;
        if (bq <= 0) return false;
      }
      if (availability === 'in_stock' && l.qty <= 0) return false;
      if (availability === 'out_of_stock' && l.qty > 0) return false;
      if (q) {
        const hay = `${l.brand} ${l.model} ${l.variant} ${l.processor} ${l.category} ${l.serialWarranty}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [laptops, query, categoryFilter, branchFilter, availability]);

  const openAdjust = (l: LaptopRecord) => {
    setEditTarget(l);
    setAdjRg(l.rg);
    setAdjNm(l.nm);
    setAdjJsm(l.jsm);
    setAdjCc(l.cc);
    setAdjError('');
  };

  const handleSaveAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setAdjError('');
    if ([adjRg, adjNm, adjJsm, adjCc].some((n) => !Number.isInteger(n) || n < 0)) {
      setAdjError('All branch stock counts must be 0 or greater.');
      return;
    }
    setSaving(true);
    try {
      await api.adjustStock({
        laptopId: editTarget.id,
        rg: adjRg,
        nm: adjNm,
        jsm: adjJsm,
        cc: adjCc,
      });
      setEditTarget(null);
      await onRefresh();
    } catch (err) {
      setAdjError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = () => {
    const headers = ['Brand', 'Model', 'Variant', 'Category', 'Condition', 'Ask Price', 'Dis Price', 'Border', 'RG', 'NM', 'JSM', 'CC', 'Total'];
    const lines = [headers.join(',')];
    for (const l of filtered) {
      const vals = [
        l.brand,
        l.model,
        l.variant,
        l.category,
        l.condition,
        l.askPrice,
        l.disPrice,
        l.borderPrice,
        l.rg,
        l.nm,
        l.jsm,
        l.cc,
        l.qty,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(vals.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kg-stock-sheet-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReloadBuiltIn = async () => {
    setReloading(true);
    setSyncNotice('');
    try {
      await api.reloadRajshahi();
      await onRefresh();
      setSyncNotice('Reloaded built-in Rajshahi baseline.');
    } finally {
      setReloading(false);
    }
  };

  const handleManualSyncSheet = async () => {
    setSyncingSheet(true);
    setSyncNotice('');
    try {
      const res = await api.triggerRajshahiSync();
      onSyncStatusUpdated?.(res.status);
      await onRefresh();
      setSyncNotice(res.changed ? `Synced changes: ${res.summary}` : res.summary);
    } catch (err) {
      setSyncNotice((err as Error).message);
    } finally {
      setSyncingSheet(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Totals Strip (exact RG -> NM -> JSM -> CC order) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Models</div>
          <div className="font-mono text-xl font-bold tabular-nums mt-1">{analytics.totalModels}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Physical Units</div>
          <div className="font-mono text-xl font-bold tabular-nums mt-1 text-teal-700 dark:text-teal-400">
            {analytics.totalUnits}
          </div>
        </div>
        {BRANCHES.map((b) => (
          <button
            key={b.code}
            type="button"
            onClick={() => setBranchFilter((prev) => (prev === b.code ? 'ALL' : b.code))}
            className={`text-left bg-white dark:bg-slate-900 border rounded-xl p-4 transition-colors ${
              branchFilter === b.code
                ? 'border-teal-600 dark:border-teal-500 bg-teal-50/40 dark:bg-teal-950/20'
                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <div className="text-xs text-slate-500">{b.code} · {b.name}</div>
            <div className="font-mono text-xl font-bold tabular-nums mt-1">{analytics.branchTotals[b.code]}</div>
          </button>
        ))}
      </div>

      {/* Filters, Price Eye Toggles & Actions */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                aria-label="Search stock sheet"
                placeholder="Search model, variant, processor..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as LaptopCategory | 'ALL')}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value="ALL">All Categories</option>
              {LAPTOP_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <select
              aria-label="Filter by branch availability"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value as BranchCode | 'ALL')}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value="ALL">All Branches</option>
              {BRANCHES.map((b) => (
                <option key={b.code} value={b.code}>{b.code} · {b.name}</option>
              ))}
            </select>

            <select
              aria-label="Filter by stock status"
              value={availability}
              onChange={(e) => setAvailability(e.target.value as 'all' | 'in_stock' | 'out_of_stock')}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value="all">All Availability</option>
              <option value="in_stock">Available (&gt; 0)</option>
              <option value="out_of_stock">Out of Stock (0)</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={syncingSheet}
              onClick={handleManualSyncSheet}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingSheet ? 'animate-spin' : ''}`} />
              <span>{syncingSheet ? 'Scanning...' : 'Refresh / Sync Sheet'}</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            {canEdit && (
              <button
                type="button"
                disabled={reloading}
                onClick={handleReloadBuiltIn}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reloading ? 'animate-spin' : ''}`} />
                <span>Reload Baseline</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Scanner Info Strip */}
        <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Rajshahi Sheet Live Scanner:
            </span>
            {rajshahiSyncStatus?.sheetUrl ? (
              <span>
                {rajshahiSyncStatus.autoScanEnabled
                  ? `Active (scanning every ${rajshahiSyncStatus.intervalSeconds}s)`
                  : 'Paused (manual refresh only)'}
                {rajshahiSyncStatus.lastScanAt &&
                  ` · Last checked ${new Date(rajshahiSyncStatus.lastScanAt).toLocaleTimeString()}`}
                {rajshahiSyncStatus.lastChangeSummary &&
                  ` · ${rajshahiSyncStatus.lastChangeSummary}`}
              </span>
            ) : (
              <span>
                Local operational inventory active.{' '}
                {canEdit && onOpenSettings ? (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="text-teal-700 dark:text-teal-400 font-semibold hover:underline"
                  >
                    Connect Live Google Sheet URL in Settings
                  </button>
                ) : (
                  'Refresh checks for latest server updates.'
                )}
              </span>
            )}
          </div>
          {(syncNotice || rajshahiSyncStatus?.lastError) && (
            <span className={rajshahiSyncStatus?.lastError ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-teal-700 dark:text-teal-400 font-medium'}>
              {syncNotice || rajshahiSyncStatus?.lastError}
            </span>
          )}
        </div>

        {/* 3 Price Eye Visibility Toggles (Available to all users) */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-slate-500 dark:text-slate-400 mr-1">Price Visibility:</span>
            <button
              type="button"
              aria-pressed={showAsking}
              onClick={() => setShowAsking((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium whitespace-nowrap shrink-0 transition-colors ${
                showAsking
                  ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {showAsking ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>Asking Price</span>
            </button>
            <button
              type="button"
              aria-pressed={showDiscounted}
              onClick={() => setShowDiscounted((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium whitespace-nowrap shrink-0 transition-colors ${
                showDiscounted
                  ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {showDiscounted ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>Discounted Price</span>
            </button>
            <button
              type="button"
              aria-pressed={showBorder}
              onClick={() => setShowBorder((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium whitespace-nowrap shrink-0 transition-colors ${
                showBorder
                  ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {showBorder ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>Border Price</span>
            </button>
          </div>
          <span className="text-[11px] text-slate-500">
            Click any laptop model to view full specs &amp; prices
          </span>
        </div>
      </div>

      {/* Brand-Wise Branch Count + Total Count */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
              Brand-Wise Count · {branchFilter === 'ALL' ? 'All Rajshahi Branches' : `${branchFilter} Branch`}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              In-stock laptop quantities grouped by brand for the active branch selection
            </p>
          </div>
          <div className="font-mono text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-200">
            Total: <span className="text-teal-700 dark:text-teal-400">{branchBreakdown.totalUnits}</span> units ·{' '}
            {branchBreakdown.totalModels} models
          </div>
        </div>

        {branchBreakdown.brands.length === 0 ? (
          <p className="text-xs text-slate-500 py-2">No in-stock laptops for this branch.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
            {branchBreakdown.brands.map((item) => (
              <button
                key={item.brand}
                type="button"
                onClick={() => setQuery((prev) => (prev.toLowerCase() === item.brand.toLowerCase() ? '' : item.brand))}
                className="text-left p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-teal-500 transition-colors"
              >
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{item.brand}</div>
                <div className="mt-1 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                  <strong className="text-teal-700 dark:text-teal-400">{item.unitCount}</strong> units · {item.modelCount} models
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Main Stock Sheet Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-500">
                <th className="py-3 px-4 font-semibold">Model</th>
                <th className="py-3 px-3 font-semibold">Variant</th>
                <th className="py-3 px-3 font-semibold">Category</th>
                {showAsking && <th className="py-3 px-3 text-right font-semibold">Asking</th>}
                {showDiscounted && <th className="py-3 px-3 text-right font-semibold">Dis. Price</th>}
                {showBorder && <th className="py-3 px-3 text-right font-semibold">Border</th>}
                <th className="py-3 px-2.5 text-right font-semibold">RG</th>
                <th className="py-3 px-2.5 text-right font-semibold">NM</th>
                <th className="py-3 px-2.5 text-right font-semibold">JSM</th>
                <th className="py-3 px-2.5 text-right font-semibold">CC</th>
                <th className="py-3 px-3 text-right font-semibold">Total</th>
                {canEdit && <th className="py-3 px-4 text-right font-semibold">Adjust</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-sm text-slate-500">
                    No laptops match your current Stock Sheet filters.
                  </td>
                </tr>
              ) : (
                filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => setDetailTarget(l)}
                        className="text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 rounded"
                      >
                        <div className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-teal-700 dark:group-hover:text-teal-400 group-hover:underline">
                          {l.brand} {l.model}
                        </div>
                        <div className="text-[11px] text-slate-500">{l.condition} · View specs</div>
                      </button>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{l.variant}</td>
                    <td className="py-2.5 px-3 text-slate-500">{l.category}</td>
                    {showAsking && (
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                        {l.askPrice > 0 ? formatCurrency(l.askPrice, preferences.currencyFormat) : '—'}
                      </td>
                    )}
                    {showDiscounted && (
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                        {l.disPrice > 0 ? formatCurrency(l.disPrice, preferences.currencyFormat) : '—'}
                      </td>
                    )}
                    {showBorder && (
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                        {l.borderPrice > 0 ? formatCurrency(l.borderPrice, preferences.currencyFormat) : '—'}
                      </td>
                    )}
                    <td className={`py-2.5 px-2.5 text-right font-mono tabular-nums ${l.rg === 0 ? 'text-slate-400' : 'font-semibold'}`}>{l.rg}</td>
                    <td className={`py-2.5 px-2.5 text-right font-mono tabular-nums ${l.nm === 0 ? 'text-slate-400' : 'font-semibold'}`}>{l.nm}</td>
                    <td className={`py-2.5 px-2.5 text-right font-mono tabular-nums ${l.jsm === 0 ? 'text-slate-400' : 'font-semibold'}`}>{l.jsm}</td>
                    <td className={`py-2.5 px-2.5 text-right font-mono tabular-nums ${l.cc === 0 ? 'text-slate-400' : 'font-semibold'}`}>{l.cc}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">{l.qty}</td>
                    {canEdit && (
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => openAdjust(l)}
                          aria-label={`Adjust stock for ${l.brand} ${l.model}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium whitespace-nowrap shrink-0"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Adjust</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Model Detail Modal (shows enabled prices + full technical specs + branch stock) */}
      {detailTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div
            role="dialog"
            aria-label={`Details for ${detailTarget.brand} ${detailTarget.model}`}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
          >
            <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="text-xs font-mono text-teal-700 dark:text-teal-400">
                  {detailTarget.category} · {detailTarget.condition}
                </div>
                <h3 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100 mt-0.5">
                  {detailTarget.brand} {detailTarget.model}
                </h3>
                <p className="text-xs text-slate-500">{detailTarget.variant}</p>
              </div>
              <button
                type="button"
                aria-label="Close model details"
                onClick={() => setDetailTarget(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Price Summary + Quick Eye Toggles */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Pricing</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-pressed={showAsking}
                    onClick={() => setShowAsking((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded border whitespace-nowrap ${
                      showAsking ? 'border-teal-600 text-teal-700 dark:text-teal-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'
                    }`}
                  >
                    {showAsking ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    <span>Asking</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={showDiscounted}
                    onClick={() => setShowDiscounted((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded border whitespace-nowrap ${
                      showDiscounted ? 'border-teal-600 text-teal-700 dark:text-teal-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'
                    }`}
                  >
                    {showDiscounted ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    <span>Discounted</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={showBorder}
                    onClick={() => setShowBorder((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded border whitespace-nowrap ${
                      showBorder ? 'border-teal-600 text-teal-700 dark:text-teal-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'
                    }`}
                  >
                    {showBorder ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    <span>Border</span>
                  </button>
                </div>
              </div>

              {showAsking || showDiscounted || showBorder ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  {showAsking && (
                    <div>
                      <div className="text-[11px] text-slate-500">Asking Price</div>
                      <div className="font-mono text-base font-bold tabular-nums mt-0.5">
                        {detailTarget.askPrice > 0 ? formatCurrency(detailTarget.askPrice, preferences.currencyFormat) : '—'}
                      </div>
                    </div>
                  )}
                  {showDiscounted && (
                    <div>
                      <div className="text-[11px] text-slate-500">Discounted Price</div>
                      <div className="font-mono text-base font-bold tabular-nums text-teal-700 dark:text-teal-400 mt-0.5">
                        {detailTarget.disPrice > 0 ? formatCurrency(detailTarget.disPrice, preferences.currencyFormat) : '—'}
                      </div>
                    </div>
                  )}
                  {showBorder && (
                    <div>
                      <div className="text-[11px] text-slate-500">Border Price</div>
                      <div className="font-mono text-base font-bold tabular-nums mt-0.5">
                        {detailTarget.borderPrice > 0 ? formatCurrency(detailTarget.borderPrice, preferences.currencyFormat) : '—'}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 flex items-center justify-between">
                  <span>All prices are currently hidden.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAsking(true);
                      setShowDiscounted(true);
                      setShowBorder(true);
                    }}
                    className="text-teal-700 dark:text-teal-400 font-semibold hover:underline"
                  >
                    Show All Prices
                  </button>
                </div>
              )}
            </div>

            {/* Branch Matrix */}
            <div className="grid grid-cols-5 gap-2 text-center font-mono tabular-nums text-xs">
              <div className="p-2 rounded border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] text-slate-500">RG</div>
                <div className="font-bold text-sm">{detailTarget.rg}</div>
              </div>
              <div className="p-2 rounded border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] text-slate-500">NM</div>
                <div className="font-bold text-sm">{detailTarget.nm}</div>
              </div>
              <div className="p-2 rounded border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] text-slate-500">JSM</div>
                <div className="font-bold text-sm">{detailTarget.jsm}</div>
              </div>
              <div className="p-2 rounded border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] text-slate-500">CC</div>
                <div className="font-bold text-sm">{detailTarget.cc}</div>
              </div>
              <div className="p-2 rounded bg-slate-100 dark:bg-slate-800">
                <div className="text-[10px] text-slate-500">TOTAL</div>
                <div className="font-bold text-sm">{detailTarget.qty}</div>
              </div>
            </div>

            {/* Full Specification Grid */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs border-t border-slate-200 dark:border-slate-800 pt-4">
              <div><dt className="text-slate-500">Processor</dt><dd className="font-medium">{detailTarget.processor || '—'}</dd></div>
              <div><dt className="text-slate-500">CPU Gen / Cores</dt><dd className="font-medium">{detailTarget.cpuGen ? `${detailTarget.cpuGen}th Gen` : '—'} {detailTarget.cpuCoresThreads}</dd></div>
              <div><dt className="text-slate-500">RAM</dt><dd className="font-medium">{detailTarget.ramGb ? `${detailTarget.ramGb} GB ${detailTarget.ramType} ${detailTarget.ramBus}` : '—'}</dd></div>
              <div><dt className="text-slate-500">Storage</dt><dd className="font-medium">{detailTarget.storageConfig || (detailTarget.storageGb ? `${detailTarget.storageGb}GB` : '—')}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">Display</dt><dd className="font-medium">{detailTarget.displayRaw || '—'} {detailTarget.isTouch ? '· Touch' : ''} {detailTarget.isX360 ? '· X360' : ''} {detailTarget.isOled ? '· OLED' : ''} {detailTarget.refreshHz ? `· ${detailTarget.refreshHz}Hz` : ''}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">Graphics (GPU)</dt><dd className="font-medium">{detailTarget.gpu || 'Integrated Graphics'}</dd></div>
              <div><dt className="text-slate-500">Detailed Condition</dt><dd className="font-medium">{detailTarget.detailedCondition || detailTarget.condition}</dd></div>
              <div><dt className="text-slate-500">Color</dt><dd className="font-medium">{detailTarget.color || '—'}</dd></div>
              <div><dt className="text-slate-500">Adapter / Charger</dt><dd className="font-medium">{detailTarget.adapter || '—'}</dd></div>
              <div><dt className="text-slate-500">Battery Backup</dt><dd className="font-medium">{detailTarget.batteryBackup || '—'}</dd></div>
              <div><dt className="text-slate-500">Operating System</dt><dd className="font-medium">{detailTarget.os || '—'}</dd></div>
              <div><dt className="text-slate-500">Entry Date</dt><dd className="font-mono">{detailTarget.entryDate || '—'}</dd></div>
              <div><dt className="text-slate-500">Location</dt><dd className="font-medium">{detailTarget.location || '—'}</dd></div>
              <div><dt className="text-slate-500">Serial / Warranty</dt><dd className="font-mono">{detailTarget.serialWarranty || '—'}</dd></div>
              {detailTarget.remarks && (
                <div className="col-span-2"><dt className="text-slate-500">Remarks</dt><dd className="font-medium">{detailTarget.remarks}</dd></div>
              )}
            </dl>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSaveAdjust}
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-teal-600" />
                <h3 className="font-display font-bold text-base">Adjust Branch Quantities</h3>
              </div>
              <button
                type="button"
                aria-label="Close stock adjustment"
                onClick={() => setEditTarget(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300">
              <strong>{editTarget.brand} {editTarget.model}</strong> · {editTarget.variant}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="adj-rg" className="block text-xs font-medium mb-1">1. RG (Rail Gate)</label>
                <input id="adj-rg" type="number" min={0} value={adjRg} onChange={(e) => setAdjRg(Number(e.target.value))} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              </div>
              <div>
                <label htmlFor="adj-nm" className="block text-xs font-medium mb-1">2. NM (New Market)</label>
                <input id="adj-nm" type="number" min={0} value={adjNm} onChange={(e) => setAdjNm(Number(e.target.value))} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              </div>
              <div>
                <label htmlFor="adj-jsm" className="block text-xs font-medium mb-1">3. JSM (Jamal Supermarket)</label>
                <input id="adj-jsm" type="number" min={0} value={adjJsm} onChange={(e) => setAdjJsm(Number(e.target.value))} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              </div>
              <div>
                <label htmlFor="adj-cc" className="block text-xs font-medium mb-1">4. CC (City Center)</label>
                <input id="adj-cc" type="number" min={0} value={adjCc} onChange={(e) => setAdjCc(Number(e.target.value))} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              </div>
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-500">
              New Total: <strong>{adjRg + adjNm + adjJsm + adjCc} units</strong>
            </div>
            {adjError && <p className="text-xs text-red-600">{adjError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditTarget(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold">
                {saving ? 'Saving...' : 'Save Stock Update'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
