import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  Download,
  Upload,
  RefreshCw,
  Trash2,
  X,
  Check,
  Copy,
  BarChart3,
  Database,
  Layers,
  AlertTriangle,
  Link as LinkIcon,
  Eye,
  EyeOff,
} from 'lucide-react';
import { BRANCHES, LAPTOP_CATEGORIES } from '../lib/types';
import type {
  BranchCode,
  DatasetSummary,
  LaptopCategory,
  LaptopCondition,
  LaptopRecord,
  RajshahiSyncStatus,
  UserPreferences,
  UserRole,
} from '../lib/types';
import { buildQuotationText, formatCurrency } from '../lib/formatters';
import {
  computeInventoryAnalytics,
  EMPTY_FILTERS,
  filterLaptops,
  getScopedStockStats,
  resolveEffectiveBranch,
  sortLaptops,
  type LaptopSortMode,
  type SearchFilterState,
} from '../lib/smartSearch';
import { api } from '../services/api';

interface LaptopFinderViewProps {
  operationalLaptops: LaptopRecord[];
  userRole: UserRole;
  preferences: UserPreferences;
  syncPulseVersion?: number;
  rajshahiSyncStatus?: RajshahiSyncStatus | null;
  onSyncStatusUpdated?: (status: RajshahiSyncStatus) => void;
  onOperationalRefresh: () => Promise<void>;
}

const EXAMPLE_QUERIES = [
  'Under 50k i5 11th Gen',
  'Border below 45k',
  'RTX Gaming',
  'Touch X360',
  'ThinkPad OLED',
  'Ryzen 7 16GB DDR5',
  'Above 60k Core Ultra 7',
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}

export const LaptopFinderView: React.FC<LaptopFinderViewProps> = ({
  operationalLaptops,
  userRole,
  preferences,
  syncPulseVersion = 0,
  rajshahiSyncStatus,
  onSyncStatusUpdated,
  onOperationalRefresh,
}) => {
  const canDeleteDatasets = userRole !== 'staff';
  const [subView, setSubView] = useState<'catalog' | 'analytics' | 'datasets'>('catalog');
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<string>('rajshahi_main');
  const [datasetLaptops, setDatasetLaptops] = useState<LaptopRecord[]>(operationalLaptops);
  const [loadingDataset, setLoadingDataset] = useState(false);
  const [datasetError, setDatasetError] = useState('');
  const [refreshingBar, setRefreshingBar] = useState(false);
  const [loaderStatus, setLoaderStatus] = useState('');

  // Search & Filter states
  const [filters, setFilters] = useState<SearchFilterState>(EMPTY_FILTERS);
  const [suppressedKeys, setSuppressedKeys] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sortMode, setSortMode] = useState<LaptopSortMode>('price_low_to_high');

  // Price Visibility Eye Toggles (any user)
  const [showAsking, setShowAsking] = useState(preferences.showAskingPrice);
  const [showDiscounted, setShowDiscounted] = useState(preferences.showDiscountedPrice ?? true);
  const [showBorder, setShowBorder] = useState(preferences.showBorderPrice);

  useEffect(() => {
    setShowAsking(preferences.showAskingPrice);
    setShowDiscounted(preferences.showDiscountedPrice ?? true);
    setShowBorder(preferences.showBorderPrice);
  }, [preferences.showAskingPrice, preferences.showDiscountedPrice, preferences.showBorderPrice]);

  // Selection, Detail Drawer & Copy List Price Modal
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailLaptop, setDetailLaptop] = useState<LaptopRecord | null>(null);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyPriceMode, setCopyPriceMode] = useState<'discounted' | 'asking'>('discounted');
  const [copySource, setCopySource] = useState<'selected' | 'filtered'>('selected');
  const [copiedMode, setCopiedMode] = useState<'discounted' | 'asking' | null>(null);

  // Dataset Import states
  const [importName, setImportName] = useState('');
  const [importBranch, setImportBranch] = useState<BranchCode>('RG');
  const [sheetImportName, setSheetImportName] = useState('');
  const [sheetImportUrl, setSheetImportUrl] = useState('');
  const [sheetImportBranch, setSheetImportBranch] = useState<BranchCode>('RG');
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');

  const loadDatasetsList = async () => {
    try {
      const res = await api.listDatasets();
      setDatasets(res.datasets);
    } catch (err) {
      setDatasetError((err as Error).message);
    }
  };

  useEffect(() => {
    loadDatasetsList();
  }, [syncPulseVersion]);

  useEffect(() => {
    if (activeDatasetId === 'rajshahi_main') {
      setDatasetLaptops(operationalLaptops);
    } else if (syncPulseVersion > 0) {
      if (activeDatasetId === 'outside_rajshahi') {
        api.getOutsideRajshahiLaptops().then((r) => setDatasetLaptops(r.laptops)).catch(() => {});
      } else {
        api.getDatasetLaptops(activeDatasetId).then((r) => setDatasetLaptops(r.laptops)).catch(() => {});
      }
    }
  }, [activeDatasetId, operationalLaptops, syncPulseVersion]);

  const handleSelectDataset = async (id: string) => {
    setActiveDatasetId(id);
    setSelectedIds(new Set());
    setDatasetError('');
    if (id === 'rajshahi_main') {
      setDatasetLaptops(operationalLaptops);
      return;
    }
    setLoadingDataset(true);
    try {
      if (id === 'outside_rajshahi') {
        const res = await api.getOutsideRajshahiLaptops();
        setDatasetLaptops(res.laptops);
      } else {
        const res = await api.getDatasetLaptops(id);
        setDatasetLaptops(res.laptops);
      }
    } catch (err) {
      setDatasetError((err as Error).message);
    } finally {
      setLoadingDataset(false);
    }
  };

  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId) ?? null,
    [datasets, activeDatasetId]
  );

  const { items: matchedLaptops, recognizedTags } = useMemo(
    () => filterLaptops(datasetLaptops, filters, suppressedKeys),
    [datasetLaptops, filters, suppressedKeys]
  );

  const filteredLaptops = useMemo(
    () => sortLaptops(matchedLaptops, sortMode, filters.priceField),
    [matchedLaptops, sortMode, filters.priceField]
  );

  const brandOptions = useMemo(
    () => Array.from(new Set(datasetLaptops.map((l) => l.brand.trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b)),
    [datasetLaptops]
  );

  const cpuGenerationOptions = useMemo(
    () => Array.from(new Set(datasetLaptops.map((l) => l.cpuGen).filter((value): value is number => Number.isFinite(value) && value > 0)))
      .sort((a, b) => a - b),
    [datasetLaptops]
  );

  const effectiveBranch = useMemo(
    () => resolveEffectiveBranch(filters, suppressedKeys),
    [filters, suppressedKeys]
  );

  const scopedStats = useMemo(
    () => getScopedStockStats(filteredLaptops, effectiveBranch),
    [filteredLaptops, effectiveBranch]
  );

  const analytics = useMemo(() => computeInventoryAnalytics(datasetLaptops), [datasetLaptops]);
  const maxBucketUnits = useMemo(
    () => Math.max(1, ...analytics.priceBuckets.map((b) => b.totalUnits)),
    [analytics]
  );

  const toggleDisplayFeature = (feat: 'touch' | 'x360' | 'oled' | '120hz+') => {
    setFilters((prev) => {
      const exists = prev.displayFeatures.includes(feat);
      return {
        ...prev,
        displayFeatures: exists
          ? prev.displayFeatures.filter((f) => f !== feat)
          : [...prev.displayFeatures, feat],
      };
    });
  };

  const handleQueryChange = (val: string) => {
    setFilters((prev) => ({ ...prev, query: val }));
    setSuppressedKeys(new Set());
  };

  const handleRemoveTag = (key: string) => {
    setSuppressedKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const handleResetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSuppressedKeys(new Set());
  };

  const toggleSelectLaptop = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    if (filteredLaptops.length === 0) return;
    const allSelected = filteredLaptops.every((l) => selectedIds.has(l.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLaptops.map((l) => l.id)));
    }
  };

  const copyLaptops = useMemo(() => {
    if (copySource === 'selected' && selectedIds.size > 0) {
      return filteredLaptops.filter((l) => selectedIds.has(l.id));
    }
    return filteredLaptops;
  }, [copySource, selectedIds, filteredLaptops]);

  const isOutsideRajshahi = activeDatasetId === 'outside_rajshahi';

  const copyPreviewText = useMemo(
    () =>
      buildQuotationText(
        copyLaptops,
        copyPriceMode,
        preferences.currencyFormat,
        isOutsideRajshahi
      ),
    [copyLaptops, copyPriceMode, preferences.currencyFormat, isOutsideRajshahi]
  );

  const handleCopyWithPriceMode = async (mode: 'discounted' | 'asking') => {
    if (copyLaptops.length === 0) return;
    setCopyPriceMode(mode);
    const text = buildQuotationText(
      copyLaptops,
      mode,
      preferences.currencyFormat,
      isOutsideRajshahi
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMode(mode);
      setTimeout(() => setCopiedMode(null), 2000);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handleDownloadListTxt = () => {
    const blob = new Blob([copyPreviewText], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kg-laptop-list-${copyPriceMode}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportFilteredCsv = () => {
    const headers = [
      'Brand',
      'Model',
      'Variant',
      'Category',
      'Processor',
      'RAM_GB',
      'RAM_Type',
      'Storage_GB',
      'Display',
      'GPU',
      'Condition',
      'Ask_Price',
      'Dis_Price',
      'Border_Price',
      'RG',
      'NM',
      'JSM',
      'CC',
      'Total',
      'Remarks',
    ];
    const lines = [headers.join(',')];
    for (const l of filteredLaptops) {
      const row = [
        l.brand,
        l.model,
        l.variant,
        l.category,
        l.processor,
        l.ramGb,
        l.ramType,
        l.storageGb,
        l.displayRaw,
        l.gpu,
        l.condition,
        l.askPrice,
        l.disPrice,
        l.borderPrice,
        l.rg,
        l.nm,
        l.jsm,
        l.cc,
        l.qty,
        l.remarks,
      ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`);
      lines.push(row.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `specledger-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileImport = async (file: File) => {
    setImportStatus('');
    setDatasetError('');
    setImporting(true);
    try {
      const base64 = await fileToBase64(file);
      const name = importName.trim() || file.name.replace(/\.[^.]+$/, '');
      const res = await api.importDatasetFile({
        name,
        filename: file.name,
        contentBase64: base64,
        defaultBranch: importBranch,
      });
      setImportName('');
      setImportStatus(`Imported "${name}" (${res.modelCount} models, ${res.totalUnits} units).`);
      await loadDatasetsList();
      await handleSelectDataset(res.datasetId);
    } catch (err) {
      setDatasetError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const handleSheetImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportStatus('');
    setDatasetError('');
    if (!sheetImportUrl.trim()) return;
    setImporting(true);
    try {
      const name = sheetImportName.trim() || 'Google Sheet Snapshot';
      const res = await api.importDatasetSheet({
        name,
        url: sheetImportUrl.trim(),
        defaultBranch: sheetImportBranch,
      });
      setSheetImportName('');
      setSheetImportUrl('');
      setImportStatus(`Imported Google Sheet "${name}" (${res.modelCount} models, ${res.totalUnits} units).`);
      await loadDatasetsList();
      await handleSelectDataset(res.datasetId);
    } catch (err) {
      setDatasetError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const handleRefreshGoogleDataset = async (id: string) => {
    setDatasetError('');
    setImportStatus('');
    setImporting(true);
    try {
      const res = await api.refreshDataset(id);
      setImportStatus(`Refreshed snapshot (${res.modelCount} models, ${res.totalUnits} units).`);
      await loadDatasetsList();
      if (activeDatasetId === id) {
        const listRes = await api.getDatasetLaptops(id);
        setDatasetLaptops(listRes.laptops);
      }
    } catch (err) {
      setDatasetError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteDataset = async (id: string) => {
    setDatasetError('');
    try {
      await api.deleteDataset(id);
      await loadDatasetsList();
      if (activeDatasetId === id) {
        await handleSelectDataset('rajshahi_main');
      }
    } catch (err) {
      setDatasetError((err as Error).message);
    }
  };

  const handleReloadBaseline = async () => {
    setImporting(true);
    setDatasetError('');
    try {
      const res = await api.reloadRajshahi();
      await onOperationalRefresh();
      await loadDatasetsList();
      setImportStatus(`Reloaded Rajshahi operational baseline (${res.modelCount} models, ${res.totalUnits} units).`);
      if (activeDatasetId === 'rajshahi_main') {
        const fresh = await api.getOperationalLaptops();
        setDatasetLaptops(fresh.laptops);
      }
    } catch (err) {
      setDatasetError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const handleRefreshActiveSheetBar = async () => {
    setDatasetError('');
    setLoaderStatus('');
    setRefreshingBar(true);
    try {
      if (activeDatasetId === 'rajshahi_main') {
        const res = await api.triggerRajshahiSync();
        onSyncStatusUpdated?.(res.status);
        await onOperationalRefresh();
        await loadDatasetsList();
        setLoaderStatus(res.changed ? `Rajshahi synced: ${res.summary}` : res.summary);
      } else if (activeDataset?.sourceType === 'google_sheet') {
        const res = await api.refreshDataset(activeDatasetId);
        await loadDatasetsList();
        const listRes = await api.getDatasetLaptops(activeDatasetId);
        setDatasetLaptops(listRes.laptops);
        setLoaderStatus(`Refreshed "${activeDataset.name}" (${res.modelCount} models, ${res.totalUnits} units).`);
      } else if (activeDatasetId === 'outside_rajshahi') {
        await loadDatasetsList();
        const res = await api.getOutsideRajshahiLaptops();
        setDatasetLaptops(res.laptops);
        setLoaderStatus(`Reloaded Outside Rajshahi (${res.laptops.length} models).`);
      } else {
        await loadDatasetsList();
        const res = await api.getDatasetLaptops(activeDatasetId);
        setDatasetLaptops(res.laptops);
        setLoaderStatus(`Reloaded sheet (${res.laptops.length} models).`);
      }
    } catch (err) {
      setDatasetError((err as Error).message);
    } finally {
      setRefreshingBar(false);
    }
  };

  const rowPadding = preferences.density === 'compact' ? 'py-1.5 px-2.5' : 'py-2.5 px-3';

  return (
    <div className="space-y-6">
      {/* Header Strip: Sub-View Tabs + Pre-Loaded Sheet Loader */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
              SpecLedger Smart Laptop Finder
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Natural-language spec search, pre-loaded branch sheets, Outside Rajshahi lookup &amp; direct customer list
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setSubView('catalog')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                subView === 'catalog'
                  ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Catalog</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('analytics')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                subView === 'analytics'
                  ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Analytics</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('datasets')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                subView === 'datasets'
                  ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Sheets &amp; Load</span>
            </button>
          </div>
        </div>

        {/* Sheet Loader Bar */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="finder-dataset-select" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Sheet Loader ({datasets.length} loaded sheets)
              </label>
              {rajshahiSyncStatus?.sheetUrl && (
                <span className="text-[11px] text-teal-700 dark:text-teal-400 font-medium">
                  · Live Auto-Scan {rajshahiSyncStatus.autoScanEnabled ? `(${rajshahiSyncStatus.intervalSeconds}s)` : 'Paused'}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="finder-dataset-select"
                value={activeDatasetId}
                onChange={(e) => handleSelectDataset(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.modelCount} models · {d.totalUnits} units)
                  </option>
                ))}
                <option value="outside_rajshahi">Outside Rajshahi (All Non-Rajshahi Sheets)</option>
              </select>
              <button
                type="button"
                disabled={refreshingBar || loadingDataset}
                onClick={handleRefreshActiveSheetBar}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshingBar ? 'animate-spin' : ''}`} />
                <span>{refreshingBar ? 'Refreshing...' : 'Refresh Sheet'}</span>
              </button>
            </div>
          </div>
          {loaderStatus && (
            <div className="text-[11px] font-medium text-teal-700 dark:text-teal-400">
              {loaderStatus}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {datasets.map((d) => {
              const isSelected = activeDatasetId === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => handleSelectDataset(d.id)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                    isSelected
                      ? 'border-teal-600 bg-teal-600 text-white'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:border-teal-500'
                  }`}
                >
                  <span>{d.name}</span>
                  <span className={`ml-1.5 font-mono text-[11px] tabular-nums ${isSelected ? 'text-teal-100' : 'text-slate-400'}`}>
                    {d.modelCount}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => handleSelectDataset('outside_rajshahi')}
              className={`px-3.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap ${
                activeDatasetId === 'outside_rajshahi'
                  ? 'border-amber-600 bg-amber-600 text-white'
                  : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50'
              }`}
            >
              Outside Rajshahi
            </button>
          </div>
        </div>
      </div>

      {datasetError && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
          {datasetError}
        </div>
      )}

      {/* SUBVIEW 1: CATALOG */}
      {subView === 'catalog' && (
        <div className="space-y-4">
          {/* Natural Language Search Bar + Actions */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[260px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  aria-label="Smart natural language laptop search"
                  placeholder="Try: Under 50k i5 11th Gen, Border below 45k, RTX Gaming, Touch X360, ThinkPad OLED..."
                  value={filters.query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  className="w-full pl-10 pr-9 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                {filters.query && (
                  <button
                    type="button"
                    aria-label="Clear search query"
                    onClick={() => handleQueryChange('')}
                    className="absolute right-2.5 top-2.5 p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <select
                aria-label="Filter by branch"
                value={filters.branch ?? ''}
                onChange={(e) => setFilters((p) => ({ ...p, branch: (e.target.value || null) as BranchCode | null }))}
                className="px-3 py-2.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="">All Branches</option>
                {BRANCHES.map((b) => (
                  <option key={b.code} value={b.code}>{b.code} · {b.name}</option>
                ))}
              </select>

              <select
                aria-label="Sort laptop results"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as LaptopSortMode)}
                className="px-3 py-2.5 text-xs font-semibold rounded-lg border border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 text-teal-800 dark:text-teal-200"
              >
                <option value="price_low_to_high">Price: Low to High</option>
                <option value="price_high_to_low">Price: High to Low</option>
                <option value="stock_high_to_low">Stock: High to Low</option>
                <option value="stock_low_to_high">Stock: Low to High</option>
                <option value="ram_high_to_low">RAM: High to Low</option>
                <option value="storage_high_to_low">Storage: High to Low</option>
                <option value="brand_a_to_z">Brand: A to Z</option>
                <option value="newest">Newest Entry</option>
              </select>

              <button
                type="button"
                onClick={() => setShowAdvanced((s) => !s)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  showAdvanced
                    ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300'
                    : 'border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Advanced Filters</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCopySource(selectedIds.size > 0 ? 'selected' : 'filtered');
                  setCopiedMode(null);
                  setCopyModalOpen(true);
                }}
                disabled={filteredLaptops.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>
                  {selectedIds.size > 0
                    ? `Copy List (${selectedIds.size})`
                    : `Copy List (${filteredLaptops.length})`}
                </span>
              </button>

              <button
                type="button"
                onClick={handleExportFilteredCsv}
                disabled={filteredLaptops.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            </div>

            {/* 3 Price Eye Visibility Toggles (Available to all users) */}
            <div className="flex flex-wrap items-center gap-2 text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
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

            {/* Example Smart Queries */}
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Examples:</span>
              {EXAMPLE_QUERIES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => handleQueryChange(ex)}
                  className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-teal-500 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>

            {/* Recognized Filter Tags (removable) */}
            {recognizedTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[11px] font-semibold text-teal-700 dark:text-teal-400">
                  Recognized Filters:
                </span>
                {recognizedTags.map((tag) => (
                  <button
                    key={tag.key}
                    type="button"
                    onClick={() => handleRemoveTag(tag.key)}
                    aria-label={`Remove filter ${tag.label}`}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 text-xs font-medium text-teal-800 dark:text-teal-200 hover:bg-teal-100 dark:hover:bg-teal-900/50"
                  >
                    <span>{tag.label}</span>
                    <X className="w-3 h-3" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 ml-auto"
                >
                  Reset All
                </button>
              </div>
            )}

            {/* Collapsible Advanced Filter Rail */}
            {showAdvanced && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
                  <div>
                    <label htmlFor="flt-price-field" className="block text-[11px] font-medium text-slate-500 mb-1">Price Basis</label>
                    <select
                      id="flt-price-field"
                      value={filters.priceField}
                      onChange={(e) => setFilters((p) => ({ ...p, priceField: e.target.value as SearchFilterState['priceField'] }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="discounted">Discounted Price</option>
                      <option value="asking">Asking Price</option>
                      <option value="border">Border Price</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="flt-min-price" className="block text-[11px] font-medium text-slate-500 mb-1">Min Price (৳)</label>
                    <input
                      id="flt-min-price"
                      type="number"
                      min={0}
                      placeholder="e.g. 30000"
                      value={filters.minPrice ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, minPrice: e.target.value ? Number(e.target.value) : null }))}
                      className="w-full px-2.5 py-1.5 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label htmlFor="flt-max-price" className="block text-[11px] font-medium text-slate-500 mb-1">Max Price (৳)</label>
                    <input
                      id="flt-max-price"
                      type="number"
                      min={0}
                      placeholder="e.g. 60000"
                      value={filters.maxPrice ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, maxPrice: e.target.value ? Number(e.target.value) : null }))}
                      className="w-full px-2.5 py-1.5 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label htmlFor="flt-ram" className="block text-[11px] font-medium text-slate-500 mb-1">RAM</label>
                    <select
                      id="flt-ram"
                      value={filters.ramGb ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, ramGb: e.target.value ? Number(e.target.value) : null }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">Any RAM</option>
                      <option value="4">4 GB</option>
                      <option value="8">8 GB</option>
                      <option value="16">16 GB</option>
                      <option value="32">32 GB</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="flt-min-ram" className="block text-[11px] font-medium text-slate-500 mb-1">Minimum RAM</label>
                    <select
                      id="flt-min-ram"
                      value={filters.minRamGb ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, minRamGb: e.target.value ? Number(e.target.value) : null }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">Any minimum</option>
                      <option value="8">8 GB or more</option>
                      <option value="16">16 GB or more</option>
                      <option value="24">24 GB or more</option>
                      <option value="32">32 GB or more</option>
                      <option value="64">64 GB or more</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="flt-storage" className="block text-[11px] font-medium text-slate-500 mb-1">Min Storage</label>
                    <select
                      id="flt-storage"
                      value={filters.minStorageGb ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, minStorageGb: e.target.value ? Number(e.target.value) : null }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">Any Storage</option>
                      <option value="128">128GB+</option>
                      <option value="256">256GB+</option>
                      <option value="512">512GB+</option>
                      <option value="1024">1TB+</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="flt-max-storage" className="block text-[11px] font-medium text-slate-500 mb-1">Maximum Storage</label>
                    <select
                      id="flt-max-storage"
                      value={filters.maxStorageGb ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, maxStorageGb: e.target.value ? Number(e.target.value) : null }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">No maximum</option>
                      <option value="256">Up to 256GB</option>
                      <option value="512">Up to 512GB</option>
                      <option value="1024">Up to 1TB</option>
                      <option value="2048">Up to 2TB</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="flt-mem" className="block text-[11px] font-medium text-slate-500 mb-1">Memory DDR</label>
                    <select
                      id="flt-mem"
                      value={filters.memoryType ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, memoryType: e.target.value || null }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">Any DDR</option>
                      <option value="DDR3">DDR3</option>
                      <option value="DDR4">DDR4</option>
                      <option value="DDR5">DDR5</option>
                      <option value="LPDDR">LPDDR</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="flt-cpu" className="block text-[11px] font-medium text-slate-500 mb-1">CPU Family</label>
                    <select
                      id="flt-cpu"
                      value={filters.cpuFamily ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, cpuFamily: e.target.value || null }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">Any CPU</option>
                      <option value="i3">Intel Core i3</option>
                      <option value="i5">Intel Core i5</option>
                      <option value="i7">Intel Core i7</option>
                      <option value="Core Ultra">Intel Core Ultra</option>
                      <option value="Ryzen">AMD Ryzen</option>
                      <option value="M">Apple Silicon</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="flt-cpu-gen" className="block text-[11px] font-medium text-slate-500 mb-1">CPU Generation</label>
                    <select
                      id="flt-cpu-gen"
                      value={filters.cpuGen ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, cpuGen: e.target.value ? Number(e.target.value) : null }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">Any generation</option>
                      {cpuGenerationOptions.map((gen) => <option key={gen} value={gen}>{gen}th Gen</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="flt-brand" className="block text-[11px] font-medium text-slate-500 mb-1">Brand</label>
                    <select
                      id="flt-brand"
                      value={filters.brand ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, brand: e.target.value || null }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">All brands</option>
                      {brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="flt-gpu" className="block text-[11px] font-medium text-slate-500 mb-1">Graphics</label>
                    <select
                      id="flt-gpu"
                      value={filters.gpuFilter}
                      onChange={(e) => setFilters((p) => ({ ...p, gpuFilter: e.target.value as SearchFilterState['gpuFilter'] }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="all">All GPUs</option>
                      <option value="dedicated">Dedicated Only</option>
                      <option value="rtx">NVIDIA RTX</option>
                      <option value="gtx">NVIDIA GTX</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="flt-cond" className="block text-[11px] font-medium text-slate-500 mb-1">Condition</label>
                    <select
                      id="flt-cond"
                      value={filters.condition ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, condition: (e.target.value || null) as LaptopCondition | null }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">All Conditions</option>
                      <option value="Intact">Intact</option>
                      <option value="Open Box">Open Box</option>
                      <option value="Used">Used</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="flt-branch" className="block text-[11px] font-medium text-slate-500 mb-1">Branch Stock</label>
                    <select
                      id="flt-branch"
                      value={filters.branch ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, branch: (e.target.value || null) as BranchCode | null }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">All Branches</option>
                      {BRANCHES.map((b) => (
                        <option key={b.code} value={b.code}>{b.code} · {b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label htmlFor="flt-cat" className="block text-[11px] font-medium text-slate-500 mb-1">Category</label>
                    <select
                      id="flt-cat"
                      value={filters.category ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, category: (e.target.value || null) as LaptopCategory | null }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="">All 7 Categories</option>
                      {LAPTOP_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Display & Special Checkboxes */}
                <div className="flex flex-wrap items-center gap-4 pt-2 text-xs">
                  {(['touch', 'x360', 'oled', '120hz+'] as const).map((feat) => (
                    <label key={feat} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.displayFeatures.includes(feat)}
                        onChange={() => toggleDisplayFeature(feat)}
                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                      />
                      <span className="uppercase font-medium">{feat}</span>
                    </label>
                  ))}
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.onlyDetachable}
                      onChange={(e) => setFilters((p) => ({ ...p, onlyDetachable: e.target.checked }))}
                      className="rounded border-slate-300 text-teal-600"
                    />
                    <span>Detachable Keyboard</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.onlySimLte}
                      onChange={(e) => setFilters((p) => ({ ...p, onlySimLte: e.target.checked }))}
                      className="rounded border-slate-300 text-teal-600"
                    />
                    <span>SIM / LTE</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.onlyNpu}
                      onChange={(e) => setFilters((p) => ({ ...p, onlyNpu: e.target.checked }))}
                      className="rounded border-slate-300 text-teal-600"
                    />
                    <span>NPU / AI</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.onlyClean}
                      onChange={(e) => setFilters((p) => ({ ...p, onlyClean: e.target.checked }))}
                      className="rounded border-slate-300 text-teal-600"
                    />
                    <span>Clean Condition</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.onlyInStock}
                      onChange={(e) => setFilters((p) => ({ ...p, onlyInStock: e.target.checked }))}
                      className="rounded border-slate-300 text-teal-600"
                    />
                    <span>In Stock Only (&gt;0)</span>
                  </label>

                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="ml-auto text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline"
                  >
                    Clear All Filters
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Results Summary Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400 px-1">
            <div className="font-mono tabular-nums" data-testid="finder-results-summary">
              Showing <strong className="text-slate-900 dark:text-slate-100">{scopedStats.modelCount}</strong> models ·{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {scopedStats.unitCount}
              </strong>{' '}
              physical units
              {effectiveBranch ? ` (in ${effectiveBranch} branch)` : ''}
              {loadingDataset && ' · Loading dataset...'}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="font-medium text-teal-700 dark:text-teal-400 hover:underline"
              >
                {filteredLaptops.length > 0 && filteredLaptops.every((l) => selectedIds.has(l.id))
                  ? 'Deselect All Filtered'
                  : 'Select All Filtered'}
              </button>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  Clear Selection ({selectedIds.size})
                </button>
              )}
            </div>
          </div>

          {/* Results View: Cards vs Table based on UserPreferences */}
          {preferences.layout === 'cards' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredLaptops.length === 0 ? (
                <div className="col-span-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center text-sm text-slate-500">
                  No laptops match your current search criteria.
                </div>
              ) : (
                filteredLaptops.map((l) => {
                  const checked = selectedIds.has(l.id);
                  return (
                    <div
                      key={l.id}
                      className={`bg-white dark:bg-slate-900 border rounded-xl p-4 flex flex-col justify-between gap-3 ${
                        checked
                          ? 'border-teal-600 dark:border-teal-500'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <label className="flex items-start gap-2.5 cursor-pointer min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelectLaptop(l.id)}
                              className="mt-1 rounded border-slate-300 text-teal-600"
                            />
                            <div className="min-w-0">
                              <div className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                                {l.brand} {l.model}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {l.category} · {l.condition}
                                {isOutsideRajshahi && l.datasetName ? ` · Sheet: ${l.datasetName}` : ''}
                              </div>
                            </div>
                          </label>
                          <div className="text-right shrink-0">
                            {showDiscounted && (
                              <div className="font-mono font-bold text-sm tabular-nums text-teal-700 dark:text-teal-400">
                                {l.disPrice > 0
                                  ? formatCurrency(l.disPrice, preferences.currencyFormat)
                                  : '—'}
                              </div>
                            )}
                            {showAsking && l.askPrice > 0 && (
                              <div className={`font-mono tabular-nums ${showDiscounted ? 'text-[11px] text-slate-400 line-through' : 'font-bold text-sm text-slate-900 dark:text-slate-100'}`}>
                                {formatCurrency(l.askPrice, preferences.currencyFormat)}
                              </div>
                            )}
                            {showBorder && l.borderPrice > 0 && (
                              <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                                Border: {formatCurrency(l.borderPrice, preferences.currencyFormat)}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800">
                          <div>{l.processor || l.variant}</div>
                          <div className="text-slate-500 dark:text-slate-400">
                            {l.ramGb ? `${l.ramGb}GB ${l.ramType}` : '—'} ·{' '}
                            {l.storageGb ? (l.storageGb >= 1024 ? `${l.storageGb / 1024}TB` : `${l.storageGb}GB`) : '—'} ·{' '}
                            {l.displayRaw || 'Standard Display'}
                          </div>
                          {l.gpu && <div className="text-slate-600 dark:text-slate-300 font-medium">GPU: {l.gpu}</div>}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                        {preferences.showBranchStock ? (
                          <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            RG:{l.rg} NM:{l.nm} JSM:{l.jsm} CC:{l.cc} · <strong>{l.qty}</strong>
                          </span>
                        ) : (
                          <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            Stock: <strong>{l.qty}</strong>
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setDetailLaptop(l)}
                          className="font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
                        >
                          Full Specs
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-500">
                      <th className="py-3 pl-4 pr-2 w-8">
                        <input
                          type="checkbox"
                          aria-label="Select all filtered laptops"
                          checked={filteredLaptops.length > 0 && filteredLaptops.every((l) => selectedIds.has(l.id))}
                          onChange={handleSelectAllFiltered}
                          className="rounded border-slate-300 text-teal-600"
                        />
                      </th>
                      <th className="py-3 px-3 font-semibold">Laptop &amp; Category</th>
                      <th className="py-3 px-3 font-semibold">Processor / RAM / Storage</th>
                      <th className="py-3 px-3 font-semibold">Display &amp; GPU</th>
                      <th className="py-3 px-3 font-semibold">Condition</th>
                      {showAsking && <th className="py-3 px-3 text-right font-semibold">Asking</th>}
                      {showDiscounted && <th className="py-3 px-3 text-right font-semibold">Discounted</th>}
                      {showBorder && <th className="py-3 px-3 text-right font-semibold">Border</th>}
                      {preferences.showBranchStock && (
                        <>
                          <th className="py-3 px-2 text-right font-semibold">RG</th>
                          <th className="py-3 px-2 text-right font-semibold">NM</th>
                          <th className="py-3 px-2 text-right font-semibold">JSM</th>
                          <th className="py-3 px-2 text-right font-semibold">CC</th>
                        </>
                      )}
                      <th className="py-3 px-3 text-right font-semibold">Qty</th>
                      <th className="py-3 px-4 text-right font-semibold">Specs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredLaptops.length === 0 ? (
                      <tr>
                        <td colSpan={14} className="py-10 text-center text-sm text-slate-500">
                          No laptops match your current search or filter criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredLaptops.map((l) => (
                        <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="pl-4 pr-2 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Select ${l.brand} ${l.model}`}
                              checked={selectedIds.has(l.id)}
                              onChange={() => toggleSelectLaptop(l.id)}
                              className="rounded border-slate-300 text-teal-600"
                            />
                          </td>
                          <td className={rowPadding}>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {l.brand} {l.model}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {l.category}
                              {isOutsideRajshahi && l.datasetName ? ` · Sheet: ${l.datasetName}` : ''}
                            </div>
                          </td>
                          <td className={rowPadding}>
                            <div className="text-slate-800 dark:text-slate-200">{l.processor || '—'}</div>
                            <div className="text-[11px] text-slate-500">
                              {l.ramGb ? `${l.ramGb}GB ${l.ramType}` : '—'} ·{' '}
                              {l.storageGb ? (l.storageGb >= 1024 ? `${l.storageGb / 1024}TB` : `${l.storageGb}GB`) : l.variant}
                            </div>
                          </td>
                          <td className={rowPadding}>
                            <div className="text-slate-700 dark:text-slate-300 max-w-[200px] truncate">{l.displayRaw || '—'}</div>
                            <div className="text-[11px] text-slate-500 max-w-[200px] truncate">{l.gpu || 'Integrated GPU'}</div>
                          </td>
                          <td className={rowPadding}>
                            <div className="font-medium text-slate-800 dark:text-slate-200">{l.condition}</div>
                            {!l.isCleanCondition && l.remarks && (
                              <div className="text-[11px] text-amber-600 dark:text-amber-400 truncate max-w-[140px]">
                                {l.remarks}
                              </div>
                            )}
                          </td>
                          {showAsking && (
                            <td className={`${rowPadding} text-right font-mono tabular-nums text-slate-500`}>
                              {l.askPrice > 0 ? formatCurrency(l.askPrice, preferences.currencyFormat) : '—'}
                            </td>
                          )}
                          {showDiscounted && (
                            <td className={`${rowPadding} text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100`}>
                              {l.disPrice > 0 ? formatCurrency(l.disPrice, preferences.currencyFormat) : '—'}
                            </td>
                          )}
                          {showBorder && (
                            <td className={`${rowPadding} text-right font-mono tabular-nums text-slate-500`}>
                              {l.borderPrice > 0 ? formatCurrency(l.borderPrice, preferences.currencyFormat) : '—'}
                            </td>
                          )}
                          {preferences.showBranchStock && (
                            <>
                              <td className={`py-2 px-2 text-right font-mono tabular-nums ${l.rg === 0 ? 'text-slate-400' : 'font-semibold'}`}>{l.rg}</td>
                              <td className={`py-2 px-2 text-right font-mono tabular-nums ${l.nm === 0 ? 'text-slate-400' : 'font-semibold'}`}>{l.nm}</td>
                              <td className={`py-2 px-2 text-right font-mono tabular-nums ${l.jsm === 0 ? 'text-slate-400' : 'font-semibold'}`}>{l.jsm}</td>
                              <td className={`py-2 px-2 text-right font-mono tabular-nums ${l.cc === 0 ? 'text-slate-400' : 'font-semibold'}`}>{l.cc}</td>
                            </>
                          )}
                          <td className={`${rowPadding} text-right font-mono tabular-nums font-bold`}>{l.qty}</td>
                          <td className="py-2 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => setDetailLaptop(l)}
                              className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium whitespace-nowrap"
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBVIEW 2: INVENTORY ANALYTICS */}
      {subView === 'analytics' && (
        <div className="space-y-6">
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
              <div key={b.code} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-500">{b.code} · {b.name}</div>
                <div className="font-mono text-xl font-bold tabular-nums mt-1">{analytics.branchTotals[b.code]}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Category Breakdown */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h3 className="font-display font-semibold text-sm pb-3 border-b border-slate-200 dark:border-slate-800">
                Automatic 7-Category Breakdown
              </h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <th className="py-2 pr-3 font-medium">Category</th>
                      <th className="py-2 px-3 text-right font-medium">Models</th>
                      <th className="py-2 px-3 text-right font-medium">Units</th>
                      <th className="py-2 pl-3 text-right font-medium">Price Range</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {analytics.categories.map((c) => (
                      <tr key={c.category}>
                        <td className="py-2.5 pr-3 font-medium">{c.category}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{c.modelCount}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">{c.totalUnits}</td>
                        <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-500">
                          {c.lowestPrice && c.highestPrice
                            ? `${formatCurrency(c.lowestPrice, preferences.currencyFormat)} – ${formatCurrency(c.highestPrice, preferences.currencyFormat)}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 5-Bucket Price Distribution */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h3 className="font-display font-semibold text-sm pb-3 border-b border-slate-200 dark:border-slate-800">
                5-Bucket Price Distribution
              </h3>
              <div className="mt-4 space-y-4">
                {analytics.priceBuckets.map((b) => {
                  const pct = Math.round((b.totalUnits / maxBucketUnits) * 100);
                  return (
                    <div key={b.label} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-800 dark:text-slate-200">{b.label}</span>
                        <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {b.modelCount} models · <strong className="text-slate-900 dark:text-slate-100">{b.totalUnits} units</strong>
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full bg-teal-600 dark:bg-teal-500 rounded" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Manufacturer Breakdown */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <h3 className="font-display font-semibold text-sm pb-3 border-b border-slate-200 dark:border-slate-800">
              Manufacturer Totals &amp; Starting Prices
            </h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2 pr-4 font-medium">Manufacturer</th>
                    <th className="py-2 px-4 text-right font-medium">Models</th>
                    <th className="py-2 px-4 text-right font-medium">Total Units</th>
                    <th className="py-2 pl-4 text-right font-medium">Starting Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {analytics.manufacturers.map((m) => (
                    <tr key={m.brand}>
                      <td className="py-2.5 pr-4 font-semibold">{m.brand}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">{m.modelCount}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">{m.totalUnits}</td>
                      <td className="py-2.5 pl-4 text-right font-mono tabular-nums text-teal-700 dark:text-teal-400">
                        {m.startingPrice ? formatCurrency(m.startingPrice, preferences.currencyFormat) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* SUBVIEW 3: DATASETS & IMPORT */}
      {subView === 'datasets' && (
        <div className="space-y-6">
          {importStatus && (
            <div role="status" className="p-3.5 rounded-xl bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 text-xs font-medium text-teal-800 dark:text-teal-200">
              {importStatus}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Local File Import (CSV, TSV, TXT, XLSX, XLS) */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                <Upload className="w-4 h-4 text-teal-600" />
                <h3 className="font-display font-semibold text-sm">Import Local Inventory File (CSV, TSV, TXT, XLSX, XLS)</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label htmlFor="imp-name" className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Dataset Name (Optional)
                  </label>
                  <input
                    id="imp-name"
                    type="text"
                    placeholder="e.g. Dhaka Snapshot April"
                    value={importName}
                    onChange={(e) => setImportName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="imp-branch" className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Default Branch (if single Qty column)
                  </label>
                  <select
                    id="imp-branch"
                    value={importBranch}
                    onChange={(e) => setImportBranch(e.target.value as BranchCode)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {BRANCHES.map((b) => (
                      <option key={b.code} value={b.code}>{b.code} · {b.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileImport(file);
                }}
                className={`border-2 border-dashed rounded-xl p-6 text-center space-y-2 transition-colors ${
                  dragOver
                    ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/20'
                    : 'border-slate-300 dark:border-slate-700'
                }`}
              >
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Drag and drop your `.xlsx`, `.xls`, `.csv`, `.tsv`, or `.txt` file here (reads first Excel worksheet automatically).
                </p>
                <label className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold cursor-pointer hover:opacity-90">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{importing ? 'Importing...' : 'Choose File'}</span>
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,.xlsx,.xls"
                    disabled={importing}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileImport(f);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                </label>
              </div>
            </section>

            {/* Google Sheet URL Import */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                <LinkIcon className="w-4 h-4 text-teal-600" />
                <h3 className="font-display font-semibold text-sm">Import Public Google Sheet Snapshot</h3>
              </div>

              <form onSubmit={handleSheetImportSubmit} className="space-y-3 text-xs">
                <div>
                  <label htmlFor="sheet-imp-url" className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Google Sheet Link *
                  </label>
                  <input
                    id="sheet-imp-url"
                    type="url"
                    required
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    value={sheetImportUrl}
                    onChange={(e) => setSheetImportUrl(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="sheet-imp-name" className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Dataset Name
                    </label>
                    <input
                      id="sheet-imp-name"
                      type="text"
                      placeholder="e.g. Bogura Live Snapshot"
                      value={sheetImportName}
                      onChange={(e) => setSheetImportName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label htmlFor="sheet-imp-branch" className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Default Branch
                    </label>
                    <select
                      id="sheet-imp-branch"
                      value={sheetImportBranch}
                      onChange={(e) => setSheetImportBranch(e.target.value as BranchCode)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      {BRANCHES.map((b) => (
                        <option key={b.code} value={b.code}>{b.code} · {b.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={importing}
                  className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
                >
                  {importing ? 'Fetching Sheet...' : 'Import & Cache Google Sheet'}
                </button>
              </form>
            </section>
          </div>

          {/* Saved Datasets List */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="font-display font-semibold text-sm">Saved Stock Datasets</h3>
                <p className="text-xs text-slate-500">Cached locally for offline browsing and branch comparison</p>
              </div>
              <button
                type="button"
                disabled={importing}
                onClick={handleReloadBaseline}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${importing ? 'animate-spin' : ''}`} />
                <span>Reload Rajshahi Baseline</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2 pr-4 font-medium">Dataset Name</th>
                    <th className="py-2 px-3 font-medium">Source</th>
                    <th className="py-2 px-3 text-right font-medium">Models</th>
                    <th className="py-2 px-3 text-right font-medium">Units</th>
                    <th className="py-2 px-3 font-medium">Last Imported</th>
                    <th className="py-2 pl-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {datasets.map((d) => {
                    const isActive = d.id === activeDatasetId;
                    return (
                      <tr key={d.id} className={isActive ? 'bg-teal-50/40 dark:bg-teal-950/20' : ''}>
                        <td className="py-2.5 pr-4 font-semibold text-slate-900 dark:text-slate-100">
                          {d.name} {d.isOperational && <span className="text-[11px] font-normal text-teal-700 dark:text-teal-400">· Operational</span>}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 uppercase font-mono text-[11px]">{d.sourceType}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{d.modelCount}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">{d.totalUnits}</td>
                        <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                          {new Date(d.importedAt).toLocaleString()}
                        </td>
                        <td className="py-2.5 pl-3 text-right whitespace-nowrap space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              handleSelectDataset(d.id);
                              setSubView('catalog');
                            }}
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {isActive ? 'Open Catalog' : 'Load'}
                          </button>
                          {(d.sourceType === 'google_sheet' || d.id === 'rajshahi_main') && (
                            <button
                              type="button"
                              disabled={importing}
                              onClick={() => handleRefreshGoogleDataset(d.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              aria-label={`Refresh ${d.name}`}
                            >
                              <RefreshCw className="w-3 h-3 inline" />
                              <span>Refresh</span>
                            </button>
                          )}
                          {canDeleteDatasets && !d.isOperational && d.sourceType !== 'builtin' && (
                            <button
                              type="button"
                              onClick={() => handleDeleteDataset(d.id)}
                              className="px-2 py-1 rounded border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                              aria-label={`Delete ${d.name}`}
                            >
                              <Trash2 className="w-3 h-3 inline" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* LAPTOP DETAIL DRAWER (20+ fields) */}
      {detailLaptop && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-slate-950/50" onClick={() => setDetailLaptop(null)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label={`Specs for ${detailLaptop.brand} ${detailLaptop.model}`}
            className="relative z-10 w-full max-w-lg bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full flex flex-col"
          >
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-mono text-teal-700 dark:text-teal-400">
                  {detailLaptop.category} · {detailLaptop.condition}
                </div>
                <h3 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100 mt-0.5">
                  {detailLaptop.brand} {detailLaptop.model}
                </h3>
                <p className="text-xs text-slate-500">{detailLaptop.variant}</p>
              </div>
              <button
                type="button"
                aria-label="Close spec drawer"
                onClick={() => setDetailLaptop(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              {/* Pricing Block */}
              {showAsking || showDiscounted || showBorder ? (
                <div className="grid grid-cols-3 gap-3 p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  {showDiscounted && (
                    <div>
                      <div className="text-slate-500">Discounted</div>
                      <div className="font-mono text-base font-bold tabular-nums text-teal-700 dark:text-teal-400">
                        {detailLaptop.disPrice > 0 ? formatCurrency(detailLaptop.disPrice, preferences.currencyFormat) : '—'}
                      </div>
                    </div>
                  )}
                  {showAsking && (
                    <div>
                      <div className="text-slate-500">Asking</div>
                      <div className="font-mono text-sm font-semibold tabular-nums">
                        {detailLaptop.askPrice > 0 ? formatCurrency(detailLaptop.askPrice, preferences.currencyFormat) : '—'}
                      </div>
                    </div>
                  )}
                  {showBorder && (
                    <div>
                      <div className="text-slate-500">Border</div>
                      <div className="font-mono text-sm font-semibold tabular-nums">
                        {detailLaptop.borderPrice > 0 ? formatCurrency(detailLaptop.borderPrice, preferences.currencyFormat) : '—'}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  All prices hidden via Price Visibility toggles.
                </div>
              )}

              {/* Inspection Warnings if any */}
              {(!detailLaptop.isCleanCondition || detailLaptop.remarks) && (
                <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 flex items-start gap-2.5 text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Inspection / Remarks</div>
                    <div className="mt-0.5">{detailLaptop.remarks || detailLaptop.detailedCondition}</div>
                  </div>
                </div>
              )}

              {/* Branch Stock Matrix (RG -> NM -> JSM -> CC) */}
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  Branch Availability (RG → NM → JSM → CC)
                </h4>
                <div className="grid grid-cols-5 gap-2 text-center font-mono tabular-nums">
                  <div className="p-2 rounded border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">RG</div>
                    <div className="font-bold text-sm">{detailLaptop.rg}</div>
                  </div>
                  <div className="p-2 rounded border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">NM</div>
                    <div className="font-bold text-sm">{detailLaptop.nm}</div>
                  </div>
                  <div className="p-2 rounded border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">JSM</div>
                    <div className="font-bold text-sm">{detailLaptop.jsm}</div>
                  </div>
                  <div className="p-2 rounded border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">CC</div>
                    <div className="font-bold text-sm">{detailLaptop.cc}</div>
                  </div>
                  <div className="p-2 rounded bg-slate-100 dark:bg-slate-800">
                    <div className="text-[10px] text-slate-500">TOTAL</div>
                    <div className="font-bold text-sm">{detailLaptop.qty}</div>
                  </div>
                </div>
              </div>

              {/* 20+ Technical Specification Grid */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200 dark:border-slate-800 pt-4">
                <div><dt className="text-slate-500">Processor</dt><dd className="font-medium">{detailLaptop.processor || '—'}</dd></div>
                <div><dt className="text-slate-500">CPU Gen / Cores</dt><dd className="font-medium">{detailLaptop.cpuGen ? `${detailLaptop.cpuGen}th Gen` : '—'} {detailLaptop.cpuCoresThreads}</dd></div>
                <div><dt className="text-slate-500">RAM</dt><dd className="font-medium">{detailLaptop.ramGb ? `${detailLaptop.ramGb} GB ${detailLaptop.ramType} ${detailLaptop.ramBus}` : '—'}</dd></div>
                <div><dt className="text-slate-500">Storage</dt><dd className="font-medium">{detailLaptop.storageConfig || (detailLaptop.storageGb ? `${detailLaptop.storageGb}GB` : '—')}</dd></div>
                <div className="col-span-2"><dt className="text-slate-500">Display</dt><dd className="font-medium">{detailLaptop.displayRaw || '—'} {detailLaptop.isTouch ? '· Touch' : ''} {detailLaptop.isX360 ? '· X360' : ''} {detailLaptop.isOled ? '· OLED' : ''} {detailLaptop.refreshHz ? `· ${detailLaptop.refreshHz}Hz` : ''}</dd></div>
                <div className="col-span-2"><dt className="text-slate-500">Graphics (GPU)</dt><dd className="font-medium">{detailLaptop.gpu || 'Integrated Graphics'}</dd></div>
                <div><dt className="text-slate-500">Detailed Condition</dt><dd className="font-medium">{detailLaptop.detailedCondition || detailLaptop.condition}</dd></div>
                <div><dt className="text-slate-500">Color</dt><dd className="font-medium">{detailLaptop.color || '—'}</dd></div>
                <div><dt className="text-slate-500">Adapter / Charger</dt><dd className="font-medium">{detailLaptop.adapter || '—'}</dd></div>
                <div><dt className="text-slate-500">Battery Backup</dt><dd className="font-medium">{detailLaptop.batteryBackup || '—'}</dd></div>
                <div><dt className="text-slate-500">Operating System</dt><dd className="font-medium">{detailLaptop.os || '—'}</dd></div>
                <div><dt className="text-slate-500">Entry Date</dt><dd className="font-mono">{detailLaptop.entryDate || '—'}</dd></div>
                <div><dt className="text-slate-500">Location</dt><dd className="font-medium">{detailLaptop.location || '—'}</dd></div>
                <div><dt className="text-slate-500">Total Stock Value</dt><dd className="font-mono font-semibold">{detailLaptop.totalValue > 0 ? formatCurrency(detailLaptop.totalValue, preferences.currencyFormat) : '—'}</dd></div>
                <div className="col-span-2"><dt className="text-slate-500">Serial / Warranty</dt><dd className="font-mono">{detailLaptop.serialWarranty || '—'}</dd></div>
                <div className="col-span-2"><dt className="text-slate-500">Capabilities</dt><dd>{[detailLaptop.hasDetachableKeyboard && 'Detachable Keyboard', detailLaptop.hasSimLte && 'SIM/LTE', detailLaptop.hasNpu && 'NPU/AI Ready'].filter(Boolean).join(' · ') || 'Standard Laptop'}</dd></div>
              </dl>
            </div>
          </div>
        </div>
      )}

      {/* COPY LIST PRICE CHOICE MODAL */}
      {copyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div
            role="dialog"
            aria-label="Copy Laptop List"
            className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="font-display font-bold text-base">Copy Laptop List</h3>
                <p className="text-xs text-slate-500">
                  Choose Discounted Price or Asking Price to copy {copyLaptops.length} laptop(s)
                </p>
              </div>
              <button
                type="button"
                aria-label="Close copy list modal"
                onClick={() => setCopyModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setCopyPriceMode('discounted')}
                  className={`px-3 py-1.5 rounded-md font-semibold ${
                    copyPriceMode === 'discounted'
                      ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Discounted Price
                </button>
                <button
                  type="button"
                  onClick={() => setCopyPriceMode('asking')}
                  className={`px-3 py-1.5 rounded-md font-semibold ${
                    copyPriceMode === 'asking'
                      ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Asking Price
                </button>
              </div>

              {selectedIds.size > 0 && (
                <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => setCopySource('selected')}
                    className={`px-3 py-1.5 rounded-md font-semibold ${
                      copySource === 'selected'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Selected ({selectedIds.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCopySource('filtered')}
                    className={`px-3 py-1.5 rounded-md font-semibold ${
                      copySource === 'filtered'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    All Filtered ({filteredLaptops.length})
                  </button>
                </div>
              )}
            </div>

            <textarea
              readOnly
              rows={11}
              aria-label="Direct laptop list preview"
              value={copyPreviewText}
              className="w-full p-3.5 text-xs font-mono leading-relaxed rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />

            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={handleDownloadListTxt}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .TXT</span>
              </button>
              <button
                type="button"
                onClick={() => handleCopyWithPriceMode('asking')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-teal-600 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40 text-xs font-semibold whitespace-nowrap"
              >
                {copiedMode === 'asking' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedMode === 'asking' ? 'Copied Asking!' : 'Copy Asking Price'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleCopyWithPriceMode('discounted')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap"
              >
                {copiedMode === 'discounted' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedMode === 'discounted' ? 'Copied Discounted!' : 'Copy Discounted Price'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
