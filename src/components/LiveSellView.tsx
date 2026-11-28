import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Search, Copy, Check, Settings2, Save, RefreshCw } from 'lucide-react';
import { BRANCHES, BRANCH_ORDER } from '../lib/types';
import type {
  BranchCode,
  GoogleSheetRecord,
  LaptopRecord,
  MonthlyBranchSalesCounts,
  SaleRecord,
  UserAccount,
} from '../lib/types';
import {
  buildLiveSellMessage,
  formatAdapterKitLabel,
  formatCurrency,
  formatLookingPercentage,
  normalizeLookingWhileTyping,
} from '../lib/formatters';
import { getBranchStock } from '../lib/refillLogic';
import { api } from '../services/api';

function toLocalDatetimeInputValue(date = new Date()): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}


function getSalesMonthKey(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  return `${year}-${month}`;
}

function formatRajshahiBreakdown(laptop: LaptopRecord): string {
  const parts: string[] = [];
  if (laptop.rg > 0) parts.push(`RG-${laptop.rg}`);
  if (laptop.nm > 0) parts.push(`NM-${laptop.nm}`);
  if (laptop.jsm > 0) parts.push(`JSM-${laptop.jsm}`);
  if (laptop.cc > 0) parts.push(`CC-${laptop.cc}`);
  return parts.length > 0 ? `${laptop.qty} Pcs (${parts.join(', ')})` : `${laptop.qty} Pcs`;
}

interface LiveSellViewProps {
  user: UserAccount;
  laptops: LaptopRecord[];
  sheets?: GoogleSheetRecord[];
  onSaleCompleted: () => Promise<void>;
  onUserUpdated?: (user: UserAccount) => void;
}

export const LiveSellView: React.FC<LiveSellViewProps> = ({
  user,
  laptops,
  onSaleCompleted,
}) => {
  const defaultBranch: BranchCode =
    user.role !== 'staff' && user.assignedBranch !== 'ALL' ? user.assignedBranch : 'RG';
  const [branch, setBranch] = useState<BranchCode>(defaultBranch);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLaptopId, setSelectedLaptopId] = useState('');

  // Composer Fields
  const [salePrice, setSalePrice] = useState('');
  const [lookingPct, setLookingPct] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [dealBy, setDealBy] = useState('');
  const [assistBy, setAssistBy] = useState('');
  const [picVideoStatus, setPicVideoStatus] = useState('Sent');
  const [memoPicStatus, setMemoPicStatus] = useState('Sent');
  const [dealTime, setDealTime] = useState('');
  const [adapterNote, setAdapterNote] = useState('');
  const [remarks, setRemarks] = useState('');
  const [customerLocation, setCustomerLocation] = useState('');
  const [saleTimestamp, setSaleTimestamp] = useState(() => toLocalDatetimeInputValue());
  const [saleTimestampManuallySet, setSaleTimestampManuallySet] = useState(false);

  const [monthlyCounts, setMonthlyCounts] = useState<MonthlyBranchSalesCounts>({
    RG: 0,
    NM: 0,
    JSM: 0,
    CC: 0,
  });
  const [calibrationCounts, setCalibrationCounts] = useState<MonthlyBranchSalesCounts>({
    RG: 0,
    NM: 0,
    JSM: 0,
    CC: 0,
  });
  const calibrationDirtyRef = useRef(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibrationSaving, setCalibrationSaving] = useState(false);
  const [monthlyCountsLoading, setMonthlyCountsLoading] = useState(true);
  const [calibrationNotice, setCalibrationNotice] = useState('');
  const canCalibrateCounts = user.role === 'admin' || user.role === 'super_admin';
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [mySales, setMySales] = useState<SaleRecord[]>([]);
  const [copiedLiveSell, setCopiedLiveSell] = useState(false);
  const [saleSuccess, setSaleSuccess] = useState<{
    invoiceNo: string;
    liveSellMessage: string;
    autoCopied: boolean;
    triggeredRefills: Array<{ exhaustedBranch: BranchCode; otherBranchesQty: number }>;
  } | null>(null);

  const clientTimeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (user.role !== 'staff' && user.assignedBranch !== 'ALL') {
      setBranch(user.assignedBranch);
    }
  }, [user.role, user.assignedBranch]);

  useEffect(() => {
    api.listMySales().then((r) => setMySales(r.sales)).catch(() => {});
  }, []);

  useEffect(() => {
    const refreshMonthlyCounts = (preferCurrentCutoff = false) => {
      const selectedDate = saleTimestamp ? new Date(saleTimestamp) : new Date();
      const safeSelectedDate = Number.isNaN(selectedDate.getTime()) ? new Date() : selectedDate;
      const now = new Date();
      // An idle tab's datetime-local value becomes stale. When another user records
      // a sale, refresh through now if the selected date is in the current month.
      const queryDate = preferCurrentCutoff && !saleTimestampManuallySet &&
        getSalesMonthKey(safeSelectedDate, clientTimeZone) === getSalesMonthKey(now, clientTimeZone)
        ? now
        : safeSelectedDate;
      setMonthlyCountsLoading(true);
      api
        .getMonthlyBranchCounts(queryDate.toISOString(), clientTimeZone)
        .then((r) => {
          setMonthlyCounts(r.counts);
          if (!calibrationDirtyRef.current) setCalibrationCounts(r.counts);
        })
        .catch((err) => {
          setCalibrationNotice(`Could not load monthly branch counts: ${(err as Error).message || 'Unknown API error'}`);
        })
        .finally(() => setMonthlyCountsLoading(false));
    };
    const onCountsUpdated = () => refreshMonthlyCounts(true);
    refreshMonthlyCounts();
    window.addEventListener('kg-sales-counts-updated', onCountsUpdated);
    return () => window.removeEventListener('kg-sales-counts-updated', onCountsUpdated);
  }, [saleTimestamp, saleTimestampManuallySet, clientTimeZone]);

  const handleSaveCalibration = async () => {
    setCalibrationSaving(true);
    setCalibrationNotice('');
    try {
      const soldAtIso = saleTimestamp ? new Date(saleTimestamp).toISOString() : new Date().toISOString();
      const result = await api.calibrateMonthlyBranchCounts({
        soldAt: soldAtIso,
        timeZone: clientTimeZone,
        counts: calibrationCounts,
      });
      setMonthlyCounts(result.counts);
      setCalibrationCounts(result.counts);
      calibrationDirtyRef.current = false;
      setCalibrationNotice(result.auditLogged === false
        ? `Saved ${result.monthKey} branch counts, but audit logging reported: ${result.auditWarning || 'unknown error'}. New sales will continue increasing these values.`
        : `Saved ${result.monthKey} branch counts. New sales will continue increasing these values.`);
    } catch (err) {
      const message = (err as Error).message || 'Could not save branch counts.';
      if (/404|not found/i.test(message)) {
        try {
          const health = await api.getHealth();
          if (health.version !== '2.5.6' || health.features?.monthlyBranchCalibration !== true) {
            setCalibrationNotice(`The backend Worker is not updated for calibration (reported version: ${health.version || 'unknown'}). Deploy the complete 2.5.6 project to the existing Worker, then reload this page.`);
          } else {
            setCalibrationNotice('The Worker reports calibration support but returned 404. Confirm this domain is connected to the same 2.5.6 Worker, then hard-refresh the app.');
          }
        } catch {
          setCalibrationNotice(`${message}. The backend version could not be checked; deploy the complete 2.5.6 project to the existing Worker.`);
        }
      } else {
        setCalibrationNotice(message);
      }
    } finally {
      setCalibrationSaving(false);
    }
  };

  // Auto-suggest all available devices across Rajshahi (not branchwise)
  const availableRajshahiLaptops = useMemo(() => {
    const inStock = laptops.filter((l) => l.qty > 0);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return inStock;
    const tokens = q.split(/\s+/).filter(Boolean);
    return inStock.filter((l) => {
      const hay = `${l.brand} ${l.model} ${l.processor} ${l.variant} ${l.color} ${l.displayRaw}`.toLowerCase();
      return tokens.every((tok) => hay.includes(tok));
    });
  }, [laptops, searchQuery]);

  const selectedLaptop = useMemo(
    () => laptops.find((l) => l.id === selectedLaptopId) ?? null,
    [laptops, selectedLaptopId]
  );

  const branchStock = selectedLaptop ? getBranchStock(selectedLaptop, branch) : 0;

  const livePreviewMessage = useMemo(() => {
    if (!selectedLaptop) return '';
    const numericPrice = Number(salePrice);
    const effectiveSellPrice =
      Number.isFinite(numericPrice) && numericPrice > 0
        ? numericPrice
        : selectedLaptop.disPrice || selectedLaptop.askPrice || 0;
    const previewCounts: MonthlyBranchSalesCounts = {
      ...monthlyCounts,
      [branch]: (monthlyCounts[branch] || 0) + 1,
    };
    const nextBranchStock = {
      RG: branch === 'RG' ? Math.max(0, selectedLaptop.rg - 1) : selectedLaptop.rg,
      NM: branch === 'NM' ? Math.max(0, selectedLaptop.nm - 1) : selectedLaptop.nm,
      JSM: branch === 'JSM' ? Math.max(0, selectedLaptop.jsm - 1) : selectedLaptop.jsm,
      CC: branch === 'CC' ? Math.max(0, selectedLaptop.cc - 1) : selectedLaptop.cc,
    };
    const nextTotal = nextBranchStock.RG + nextBranchStock.NM + nextBranchStock.JSM + nextBranchStock.CC;
    const soldAtIso = saleTimestamp ? new Date(saleTimestamp).toISOString() : new Date().toISOString();

    return buildLiveSellMessage({
      branch,
      soldAt: soldAtIso,
      laptop: selectedLaptop,
      adapterNote,
      discountPrice: selectedLaptop.disPrice > 0 ? selectedLaptop.disPrice : effectiveSellPrice,
      sellingPrice: effectiveSellPrice,
      lookingPct: formatLookingPercentage(lookingPct),
      sourceName,
      dealBy,
      assistBy,
      picVideoStatus,
      memoPicStatus,
      dealTime,
      remarks,
      customerLocation,
      remainingRajshahiQty: nextTotal,
      remainingBranchStock: nextBranchStock,
      monthlyBranchCounts: previewCounts,
      currencyMode: user.preferences.currencyFormat,
      timeZone: clientTimeZone,
    });
  }, [
    selectedLaptop,
    salePrice,
    monthlyCounts,
    branch,
    saleTimestamp,
    adapterNote,
    lookingPct,
    sourceName,
    dealBy,
    assistBy,
    picVideoStatus,
    memoPicStatus,
    dealTime,
    remarks,
    customerLocation,
    user.preferences.currencyFormat,
    clientTimeZone,
  ]);

  const handleSelectLaptop = (laptop: LaptopRecord) => {
    setSelectedLaptopId(laptop.id);
    const defaultPrice = laptop.disPrice > 0 ? laptop.disPrice : laptop.askPrice;
    setSalePrice(defaultPrice > 0 ? String(defaultPrice) : '');
    setAdapterNote(formatAdapterKitLabel(laptop.adapter));
    setError('');
    const isBranchLocked = user.role !== 'staff' && user.assignedBranch !== 'ALL';
    if (!isBranchLocked && getBranchStock(laptop, branch) < 1) {
      const firstAvail = BRANCH_ORDER.find((b) => getBranchStock(laptop, b) > 0);
      if (firstAvail) setBranch(firstAvail);
    }
  };

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedLaptop) {
      setError('Please select a laptop from the Rajshahi inventory list.');
      return;
    }
    if (branchStock < 1) {
      setError(`${selectedLaptop.brand} ${selectedLaptop.model} has 0 units at ${branch}. Choose a branch with stock.`);
      return;
    }
    const priceNum = Number(salePrice);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError('Enter a valid positive selling price.');
      return;
    }
    setConfirmOpen(true);
  };

  const handleCopyText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLiveSell(true);
      setTimeout(() => setCopiedLiveSell(false), 2500);
      return true;
    } catch {
      return false;
    }
  };

  const handleConfirmSubmit = async () => {
    if (!selectedLaptop) return;
    setSubmitting(true);
    setError('');
    try {
      const basePrice = selectedLaptop.askPrice || selectedLaptop.disPrice;
      const numericSale = Number(salePrice);
      const computedDiscount = basePrice > 0 && numericSale < basePrice ? basePrice - numericSale : 0;

      const res = await api.createSale({
        branch,
        laptopId: selectedLaptop.id,
        salePrice: numericSale,
        discountAmount: computedDiscount,
        lookingPct: formatLookingPercentage(lookingPct),
        sourceName: sourceName.trim(),
        dealBy: dealBy.trim(),
        assistBy: assistBy.trim(),
        picVideoStatus: picVideoStatus.trim(),
        memoPicStatus: memoPicStatus.trim(),
        dealTime: dealTime.trim(),
        remarks: remarks.trim(),
        customerLocation: customerLocation.trim(),
        adapterNote: adapterNote.trim(),
        timeZone: clientTimeZone,
        soldAt: saleTimestamp ? new Date(saleTimestamp).toISOString() : undefined,
        idempotencyKey: crypto.randomUUID(),
      });

      const autoCopied = await handleCopyText(res.liveSellMessage);

      setSaleSuccess({
        invoiceNo: res.invoiceNo,
        liveSellMessage: res.liveSellMessage,
        autoCopied,
        triggeredRefills: res.triggeredRefills,
      });
      setMonthlyCounts(res.monthlyBranchCounts);
      setConfirmOpen(false);

      // Reset composer for next entry
      setSelectedLaptopId('');
      setSalePrice('');
      setLookingPct('');
      setSourceName('');
      setDealBy('');
      setAssistBy('');
      setPicVideoStatus('Sent');
      setMemoPicStatus('Sent');
      setDealTime('');
      setAdapterNote('');
      setRemarks('');
      setCustomerLocation('');
      setCalibrationCounts(res.monthlyBranchCounts);
      calibrationDirtyRef.current = false;
      setSaleTimestamp(toLocalDatetimeInputValue());
      setSaleTimestampManuallySet(false);

      await onSaleCompleted();
      const myRes = await api.listMySales();
      setMySales(myRes.sales);
    } catch (err) {
      setError((err as Error).message);
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {saleSuccess && (
        <div
          role="status"
          className="bg-white dark:bg-slate-900 border border-teal-300 dark:border-teal-800 rounded-xl p-5 space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Sale Recorded · Invoice {saleSuccess.invoiceNo}
                </h3>
                <p className="text-xs text-teal-700 dark:text-teal-300 font-medium mt-1">
                  {saleSuccess.autoCopied
                    ? 'Formatted Live Sell post copied to clipboard automatically.'
                    : 'Sale recorded. Use the Copy Live Sell button to copy the formatted text.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopyText(saleSuccess.liveSellMessage)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap shrink-0"
            >
              {copiedLiveSell ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedLiveSell ? 'Copied Live Sell!' : 'Copy Live Sell'}</span>
            </button>
          </div>

          <pre
            aria-label="Formatted Live Sell output"
            className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-mono leading-relaxed whitespace-pre-wrap text-slate-900 dark:text-slate-100"
          >
            {saleSuccess.liveSellMessage}
          </pre>

          {saleSuccess.triggeredRefills.length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-xs text-amber-700 dark:text-amber-300">
              Refill alert triggered: {saleSuccess.triggeredRefills.map((t) => `${t.exhaustedBranch} hit 0 units (other branches have ${t.otherBranchesQty})`).join(', ')}.
            </div>
          )}
        </div>
      )}

      {canCalibrateCounts && (
        <section className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/70 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Settings2 className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Branch Sell Count Calibration</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Admin and Super Admin adjustment for the month selected in the sale date. Existing sale records are not changed.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCalibrationOpen((open) => !open)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-800 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
            >
              {calibrationOpen ? 'Hide Calibration' : 'Adjust Branch Counts'}
            </button>
          </div>
          {calibrationOpen && (
            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {BRANCHES.map((item) => (
                  <div key={item.code}>
                    <label htmlFor={`calibrate-${item.code}`} className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      {item.code} · {item.name}
                    </label>
                    <input
                      id={`calibrate-${item.code}`}
                      type="number"
                      min={0}
                      max={1000000}
                      step={1}
                      inputMode="numeric"
                      value={calibrationCounts[item.code]}
                      onChange={(event) => {
                        const next = event.target.value === '' ? 0 : Math.max(0, Math.min(1000000, Math.floor(Number(event.target.value) || 0)));
                        setCalibrationCounts((previous) => ({ ...previous, [item.code]: next }));
                        calibrationDirtyRef.current = true;
                        setCalibrationNotice('');
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-sm"
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Values are saved as a monthly baseline plus an adjustment, so each new completed sale still increments the branch count.
                </p>
                <button
                  type="button"
                  onClick={handleSaveCalibration}
                  disabled={calibrationSaving || monthlyCountsLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-60"
                >
                  {calibrationSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {monthlyCountsLoading ? 'Loading Counts…' : calibrationSaving ? 'Saving…' : 'Save Branch Counts'}
                </button>
              </div>
              {calibrationNotice && (
                <p role="status" className="text-xs text-slate-700 dark:text-slate-300">{calibrationNotice}</p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: All Rajshahi Available Laptops Auto-Suggest */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display font-semibold text-base text-slate-900 dark:text-slate-100">
                1. Select Laptop (Rajshahi Stock)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Auto-suggesting all {laptops.filter((l) => l.qty > 0).length} available Rajshahi models across RG, NM, JSM &amp; CC
              </p>
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              aria-label="Search Rajshahi laptops"
              placeholder="Search brand, model, processor, RAM/storage, or color..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
            {availableRajshahiLaptops.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No matching available laptops found in Rajshahi inventory.
              </div>
            ) : (
              availableRajshahiLaptops.map((laptop) => {
                const isSelected = laptop.id === selectedLaptopId;
                return (
                  <button
                    key={laptop.id}
                    type="button"
                    onClick={() => handleSelectLaptop(laptop)}
                    className={`w-full text-left px-4 py-3 flex items-center justify-between gap-4 transition-colors ${
                      isSelected
                        ? 'bg-teal-50 dark:bg-teal-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {laptop.brand} {laptop.model}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {laptop.processor || laptop.variant} · {laptop.variant} · {laptop.condition}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {(laptop.disPrice || laptop.askPrice) > 0
                          ? formatCurrency(laptop.disPrice || laptop.askPrice, user.preferences.currencyFormat)
                          : 'Price TBD'}
                      </div>
                      <div className="font-mono text-xs tabular-nums text-teal-700 dark:text-teal-400">
                        {formatRajshahiBreakdown(laptop)}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right: Live Sell Composer */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="font-display font-semibold text-base text-slate-900 dark:text-slate-100">
              2. Live Sell Composer
            </h3>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800" role="group" aria-label="Selling branch">
              {BRANCHES.map((b) => {
                const locked = user.role !== 'staff' && user.assignedBranch !== 'ALL' && user.assignedBranch !== b.code;
                return (
                  <button
                    key={b.code}
                    type="button"
                    disabled={locked}
                    onClick={() => setBranch(b.code)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      branch === b.code
                        ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
                    } disabled:opacity-40`}
                  >
                    {b.code}
                  </button>
                );
              })}
            </div>
          </div>

          <form onSubmit={handleOpenConfirm} className="mt-4 space-y-4">
            {/* Auto-fetched Sheet Info Card */}
            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
              {selectedLaptop ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {selectedLaptop.brand} {selectedLaptop.model}
                    </div>
                    <span
                      className={`font-mono text-xs font-semibold tabular-nums whitespace-nowrap ${
                        branchStock > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {branch}: {branchStock} Pcs
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      Discount Price:{' '}
                      <strong className="font-mono tabular-nums">
                        {selectedLaptop.disPrice > 0
                          ? formatCurrency(selectedLaptop.disPrice, user.preferences.currencyFormat)
                          : '—'}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Entry Date: <strong className="font-mono">{selectedLaptop.entryDate || 'N/A'}</strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Location: <strong>{selectedLaptop.location || 'Rajshahi'}</strong>
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    Available In Rajshahi: {formatRajshahiBreakdown(selectedLaptop)}
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-500">
                  Select a laptop from the Rajshahi list on the left to auto-fill discount price, entry date, and adapter kit.
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sale-price" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Selling Price (৳) *
                </label>
                <input
                  id="sale-price"
                  type="number"
                  min={1}
                  required
                  placeholder="e.g. 50000"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="sale-looking" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Looking (%)
                </label>
                <input
                  id="sale-looking"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 90"
                  value={lookingPct}
                  onChange={(e) => setLookingPct(normalizeLookingWhileTyping(e.target.value))}
                  onBlur={() => setLookingPct((prev) => formatLookingPercentage(prev))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sale-source" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Source
                </label>
                <input
                  id="sale-source"
                  type="text"
                  placeholder="e.g. Pre Cust Reffer"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="sale-deal" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Deal (Salesperson)
                </label>
                <input
                  id="sale-deal"
                  type="text"
                  placeholder="e.g. Sozib"
                  value={dealBy}
                  onChange={(e) => setDealBy(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sale-assist" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Assist
                </label>
                <input
                  id="sale-assist"
                  type="text"
                  placeholder="Optional assist name"
                  value={assistBy}
                  onChange={(e) => setAssistBy(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="sale-deal-time" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Deal Time (Minutes)
                </label>
                <input
                  id="sale-deal-time"
                  type="text"
                  placeholder="e.g. 110"
                  value={dealTime}
                  onChange={(e) => setDealTime(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="sale-pic-video" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Pic &amp; Video
                </label>
                <input
                  id="sale-pic-video"
                  type="text"
                  value={picVideoStatus}
                  onChange={(e) => setPicVideoStatus(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="sale-memo-pic" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Memo Pic
                </label>
                <input
                  id="sale-memo-pic"
                  type="text"
                  value={memoPicStatus}
                  onChange={(e) => setMemoPicStatus(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="sale-datetime" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Date &amp; Time
                </label>
                <input
                  id="sale-datetime"
                  type="datetime-local"
                  value={saleTimestamp}
                  onChange={(e) => { setSaleTimestamp(e.target.value); setSaleTimestampManuallySet(true); calibrationDirtyRef.current = false; }}
                  className="w-full px-2.5 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div>
              <label htmlFor="sale-customer-location" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Customer Location (Optional)
              </label>
              <input
                id="sale-customer-location"
                type="text"
                maxLength={240}
                placeholder="Enter the customer's area / city / delivery location"
                value={customerLocation}
                onChange={(e) => setCustomerLocation(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <div>
              <label htmlFor="sale-adapter-kit" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Adapter, Charger &amp; Bag (Auto-fetched from sheet)
              </label>
              <input
                id="sale-adapter-kit"
                type="text"
                placeholder="Auto-filled from selected model"
                value={adapterNote}
                onChange={(e) => setAdapterNote(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <div>
              <label htmlFor="sale-remarks" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Remarks (Optional)
              </label>
              <textarea
                id="sale-remarks"
                rows={2}
                placeholder="Optional remarks..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            {livePreviewMessage && (
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Live Sell Post Preview
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyText(livePreviewMessage)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
                  >
                    {copiedLiveSell ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedLiveSell ? 'Copied!' : 'Copy Preview'}</span>
                  </button>
                </div>
                <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-300 max-h-64 overflow-y-auto">
                  {livePreviewMessage}
                </pre>
              </div>
            )}

            {error && (
              <div role="alert" className="flex items-center gap-2 text-xs font-medium text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!selectedLaptop || branchStock < 1}
              className="w-full py-2.5 px-4 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              Confirm Laptop Sale
            </button>
          </form>
        </section>
      </div>

      {/* User Personal Recent Sales */}
      {mySales.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100 mb-3">
            Your Recent Submitted Laptop Sales
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2 pr-4 font-medium">Invoice</th>
                  <th className="py-2 pr-4 font-medium">Branch</th>
                  <th className="py-2 pr-4 font-medium">Laptop</th>
                  <th className="py-2 pr-4 font-medium">Looking</th>
                  <th className="py-2 pr-4 font-medium">Remarks</th>
                  <th className="py-2 text-right font-medium">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {mySales.slice(0, 10).map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 pr-4 font-mono">{s.invoiceNo}</td>
                    <td className="py-2.5 pr-4 font-mono font-semibold">{s.branch}</td>
                    <td className="py-2.5 pr-4 font-medium">{s.brand} {s.model}</td>
                    <td className="py-2.5 pr-4 font-mono">{s.lookingPct || '—'}</td>
                    <td className="py-2.5 pr-4 text-slate-500">{s.remarks || '—'}</td>
                    <td className="py-2.5 text-right font-mono font-semibold tabular-nums">
                      {formatCurrency(s.salePrice, user.preferences.currencyFormat)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Confirmation Dialog */}
      {confirmOpen && selectedLaptop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div
            role="dialog"
            aria-label="Confirm Laptop Sale"
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
          >
            <h3 className="font-display font-bold text-base">Confirm Laptop Sale</h3>
            <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
              <div><strong>Branch:</strong> {branch}</div>
              <div><strong>Laptop:</strong> {selectedLaptop.brand} {selectedLaptop.model} ({selectedLaptop.variant})</div>
              <div><strong>Selling Price:</strong> {formatCurrency(Number(salePrice), user.preferences.currencyFormat)}</div>
              {lookingPct && <div><strong>Looking:</strong> {formatLookingPercentage(lookingPct)}</div>}
              {sourceName && <div><strong>Source:</strong> {sourceName}</div>}
              {dealBy && <div><strong>Deal:</strong> {dealBy}</div>}
              {assistBy && <div><strong>Assist:</strong> {assistBy}</div>}
              {dealTime && <div><strong>Deal Time:</strong> {dealTime} Min.</div>}
              {remarks && <div><strong>Remarks:</strong> {remarks}</div>}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Submitting deducts 1 unit from {branch} in Rajshahi stock and copies the formatted Live Sell text automatically.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmSubmit}
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold disabled:opacity-60"
              >
                {submitting ? 'Submitting...' : 'Confirm & Copy Live Sell'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
