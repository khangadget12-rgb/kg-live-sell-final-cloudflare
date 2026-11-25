import React, { useMemo, useState } from 'react';
import { Search, Ban, Eye, X, Copy, Check, Trash2 } from 'lucide-react';
import { BRANCHES } from '../lib/types';
import type { BranchCode, SaleRecord, UserPreferences, UserRole } from '../lib/types';
import { formatCurrency } from '../lib/formatters';
import { api } from '../services/api';

interface SalesLedgerViewProps {
  sales: SaleRecord[];
  userRole: UserRole;
  preferences: UserPreferences;
  onRefresh: () => Promise<void>;
}

export const SalesLedgerView: React.FC<SalesLedgerViewProps> = ({ sales, userRole, preferences, onRefresh }) => {
  const canVoid = userRole !== 'staff';
  const canDelete = userRole === 'super_admin';
  const [branchFilter, setBranchFilter] = useState<BranchCode | 'ALL'>('ALL');
  const [query, setQuery] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedSale, setSelectedSale] = useState<SaleRecord | null>(null);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [voidTarget, setVoidTarget] = useState<SaleRecord | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SaleRecord | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const employees = useMemo(
    () => Array.from(new Set(sales.map((s) => s.employeeName))).sort(),
    [sales]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sales.filter((s) => {
      if (branchFilter !== 'ALL' && s.branch !== branchFilter) return false;
      if (employeeFilter && s.employeeName !== employeeFilter) return false;
      const day = s.soldAt.slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (q) {
        const hay = `${s.invoiceNo} ${s.brand} ${s.model} ${s.variant} ${s.serialNumber} ${s.customerName} ${s.customerPhone} ${s.customerLocation || ''} ${s.employeeName} ${s.remarks} ${s.sheetName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sales, branchFilter, employeeFilter, dateFrom, dateTo, query]);

  const handleVoidSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget) return;
    setVoidError('');
    if (!voidReason.trim()) {
      setVoidError('Enter a reason for voiding this sale.');
      return;
    }
    setSubmitting(true);
    try {
      await api.voidSale(voidTarget.id, voidReason.trim());
      setVoidTarget(null);
      setVoidReason('');
      setSelectedSale(null);
      await onRefresh();
    } catch (err) {
      setVoidError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteTarget || !canDelete) return;
    if (deleteConfirmation.trim() !== 'DELETE') {
      setDeleteError('Type DELETE exactly to confirm permanent removal.');
      return;
    }
    setDeleteError('');
    setSubmitting(true);
    try {
      await api.deleteSale(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteConfirmation('');
      if (selectedSale?.id === deleteTarget.id) setSelectedSale(null);
      await onRefresh();
    } catch (err) {
      setDeleteError((err as Error).message || 'Unable to delete this sale.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setBranchFilter('ALL')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                branchFilter === 'ALL'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              All Branches
            </button>
            {BRANCHES.map((b) => (
              <button
                key={b.code}
                type="button"
                onClick={() => setBranchFilter(b.code)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  branchFilter === b.code
                    ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {b.code}
              </button>
            ))}
          </div>

          <div className="text-xs font-mono tabular-nums text-slate-500">
            Showing {filtered.length} of {sales.length} transactions
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              aria-label="Search sales ledger"
              placeholder="Invoice, laptop, customer, remarks..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>

          <select
            aria-label="Filter by employee"
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            <option value="">All Employees</option>
            {employees.map((emp) => (
              <option key={emp} value={emp}>
                {emp}
              </option>
            ))}
          </select>

          <input
            type="date"
            aria-label="Date from"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          />

          <input
            type="date"
            aria-label="Date to"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-slate-500">
                <th className="py-3 px-4 font-semibold">Invoice &amp; Time</th>
                <th className="py-3 px-3 font-semibold">Branch</th>
                <th className="py-3 px-3 font-semibold">Laptop</th>
                <th className="py-3 px-3 font-semibold">Employee</th>
                <th className="py-3 px-3 font-semibold">Sheet</th>
                <th className="py-3 px-3 font-semibold">Looking</th>
                <th className="py-3 px-3 font-semibold">Remarks</th>
                <th className="py-3 px-3 text-right font-semibold">Sale Price</th>
                <th className="py-3 px-4 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-sm text-slate-500">
                    No matching sales transactions found.
                  </td>
                </tr>
              ) : (
                filtered.map((s) => (
                  <tr key={s.id} className={s.status === 'voided' ? 'opacity-60 bg-red-50/30 dark:bg-red-950/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}>
                    <td className="py-3 px-4">
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{s.invoiceNo}</div>
                      <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                        {new Date(s.soldAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono font-semibold">{s.branch}</td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{s.brand} {s.model}</div>
                      <div className="text-[11px] text-slate-500">{s.variant}</div>
                    </td>
                    <td className="py-3 px-3">{s.employeeName}</td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300">{s.sheetName}</td>
                    <td className="py-3 px-3 font-mono">{s.lookingPct || '—'}</td>
                    <td className="py-3 px-3 max-w-[180px] truncate text-slate-600 dark:text-slate-400">{s.remarks || '—'}</td>
                    <td className="py-3 px-3 text-right font-mono font-semibold tabular-nums">
                      <div>{formatCurrency(s.salePrice, preferences.currencyFormat)}</div>
                      {s.status === 'voided' && (
                        <div className="text-[10px] font-bold text-red-600 dark:text-red-400">VOIDED</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCopiedMsg(false);
                            setSelectedSale(s);
                          }}
                          aria-label={`View ${s.invoiceNo}`}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {canVoid && s.status === 'completed' && (
                          <button
                            type="button"
                            onClick={() => {
                              setVoidTarget(s);
                              setVoidReason('');
                              setVoidError('');
                            }}
                            aria-label={`Void ${s.invoiceNo}`}
                            title="Void sale (Admin / Super Admin)"
                            className="p-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => { setDeleteTarget(s); setDeleteConfirmation(''); setDeleteError(''); }}
                            aria-label={`Permanently delete ${s.invoiceNo}`}
                            title="Permanently delete sale (Super Admin only)"
                            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-rose-300 dark:border-rose-900 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span className="text-[11px] font-semibold">Delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transaction Detail Modal */}
      {selectedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-display font-bold text-base">Transaction {selectedSale.invoiceNo}</h3>
              <button
                type="button"
                aria-label="Close transaction detail"
                onClick={() => setSelectedSale(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-slate-500">Branch</dt><dd className="font-semibold font-mono">{selectedSale.branch}</dd></div>
              <div><dt className="text-slate-500">Status</dt><dd className="font-semibold uppercase">{selectedSale.status}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">Laptop</dt><dd className="font-semibold">{selectedSale.brand} {selectedSale.model} ({selectedSale.variant})</dd></div>
              <div><dt className="text-slate-500">Sale Price</dt><dd className="font-mono font-semibold">{formatCurrency(selectedSale.salePrice, preferences.currencyFormat)}</dd></div>
              <div><dt className="text-slate-500">Discount</dt><dd className="font-mono">{formatCurrency(selectedSale.discountAmount, preferences.currencyFormat)}</dd></div>
              <div><dt className="text-slate-500">Looking %</dt><dd className="font-mono">{selectedSale.lookingPct || '—'}</dd></div>
              <div><dt className="text-slate-500">Serial Number</dt><dd className="font-mono">{selectedSale.serialNumber || '—'}</dd></div>
              <div><dt className="text-slate-500">Customer</dt><dd>{selectedSale.customerName || 'Walk-in'} {selectedSale.customerPhone}</dd></div>
              <div><dt className="text-slate-500">Customer Location</dt><dd>{selectedSale.customerLocation || '—'}</dd></div>
              <div><dt className="text-slate-500">Employee</dt><dd>{selectedSale.employeeName}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">Selected Google Sheet</dt><dd>{selectedSale.sheetName}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">Remarks</dt><dd>{selectedSale.remarks || '—'}</dd></div>
              {selectedSale.status === 'voided' && (
                <div className="col-span-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
                  <div className="font-semibold text-red-700 dark:text-red-300">Voided by {selectedSale.voidedBy}</div>
                  <div className="text-red-600 dark:text-red-400 mt-0.5">Reason: {selectedSale.voidReason}</div>
                </div>
              )}
            </dl>
            {selectedSale.liveSellMessage && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Live Sell Message</span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(selectedSale.liveSellMessage || '');
                        setCopiedMsg(true);
                        setTimeout(() => setCopiedMsg(false), 2000);
                      } catch {
                        // ignore
                      }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-teal-600 text-teal-700 dark:text-teal-300 text-xs font-semibold whitespace-nowrap"
                  >
                    {copiedMsg ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedMsg ? 'Copied!' : 'Copy Live Sell'}</span>
                  </button>
                </div>
                <pre className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[11px] font-mono leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto">
                  {selectedSale.liveSellMessage}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Void Confirmation Modal */}
      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleVoidSubmit}
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
          >
            <h3 className="font-display font-bold text-base text-red-600 dark:text-red-400">
              Void Sale {voidTarget.invoiceNo}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Voiding restores 1 unit of <strong>{voidTarget.brand} {voidTarget.model}</strong> back to <strong>{voidTarget.branch}</strong> and preserves full audit history.
            </p>
            <div>
              <label htmlFor="void-reason" className="block text-xs font-medium mb-1">
                Void Reason (Required)
              </label>
              <textarea
                id="void-reason"
                required
                rows={2}
                placeholder="e.g. Wrong branch selected or customer cancelled..."
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            {voidError && <p className="text-xs text-red-600">{voidError}</p>}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
              >
                {submitting ? 'Voiding...' : 'Confirm Void'}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && canDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4">
          <form onSubmit={handleDeleteSale} className="w-full max-w-md bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
              <Trash2 className="w-5 h-5" />
              <h3 className="font-display font-bold text-base">Permanently Delete Sale</h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Delete invoice <strong>{deleteTarget.invoiceNo}</strong> for <strong>{deleteTarget.brand} {deleteTarget.model}</strong>?
              This removes the ledger entry permanently. {deleteTarget.status === 'completed'
                ? `One unit will be restored to ${deleteTarget.branch} stock.`
                : 'This sale was already voided, so stock will not be restored again.'}
            </p>
            <div>
              <label htmlFor="delete-sale-confirm" className="block text-xs font-semibold mb-1">Type DELETE to confirm</label>
              <input id="delete-sale-confirm" autoComplete="off" value={deleteConfirmation} onChange={(e) => setDeleteConfirmation(e.target.value)} placeholder="DELETE" className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </div>
            {deleteError && <p role="alert" className="text-xs text-red-600">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold">Cancel</button>
              <button type="submit" disabled={submitting || deleteConfirmation !== 'DELETE'} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-50">{submitting ? 'Deleting…' : 'Delete Permanently'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
