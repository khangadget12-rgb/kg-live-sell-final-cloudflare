import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { BRANCHES } from '../lib/types';
import type { BranchCode, SaleRecord, UserPreferences } from '../lib/types';
import { formatCurrency } from '../lib/formatters';
import { api } from '../services/api';

interface ReportsViewProps {
  preferences: UserPreferences;
}

interface ReportData {
  summary: { totalUnitsSold: number; totalRevenue: number; totalDiscount: number };
  branchTotals: Array<{ branch: BranchCode; count: number; revenue: number; discount: number }>;
  employeeSales: Array<{ employeeName: string; count: number; revenue: number }>;
  modelSales: Array<{ brand: string; model: string; count: number; revenue: number }>;
  dailySales: Array<{ date: string; count: number; revenue: number }>;
  monthlySales: Array<{ month: string; count: number; revenue: number }>;
  transactions: SaleRecord[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({ preferences }) => {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (from = dateFrom, to = dateTo) => {
    setLoading(true);
    try {
      const data = await api.getReports({ dateFrom: from || undefined, dateTo: to || undefined });
      setReport(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleExportCsv = () => {
    if (!report) return;
    const headers = ['Invoice', 'Date', 'Branch', 'Brand', 'Model', 'Employee', 'Sale Price', 'Discount', 'Looking %', 'Sheet', 'Remarks'];
    const lines = [headers.join(',')];
    for (const t of report.transactions) {
      lines.push(
        [
          t.invoiceNo,
          t.soldAt,
          t.branch,
          t.brand,
          t.model,
          t.employeeName,
          t.salePrice,
          t.discountAmount,
          t.lookingPct,
          t.sheetName,
          t.remarks,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kg-sales-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !report) {
    return <div className="p-8 text-sm text-slate-500">Loading sales reports...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Filter Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="rep-from" className="sr-only">From date</label>
            <input
              id="rep-from"
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                load(e.target.value, dateTo);
              }}
              className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <span className="text-xs text-slate-400">to</span>
          <div>
            <label htmlFor="rep-to" className="sr-only">To date</label>
            <input
              id="rep-to"
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                load(dateFrom, e.target.value);
              }}
              className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setDateFrom('');
                setDateTo('');
                load('', '');
              }}
              className="text-xs text-teal-700 dark:text-teal-400 hover:underline"
            >
              Reset Dates
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Report CSV</span>
        </button>
      </div>

      {report && (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <div className="text-xs text-slate-500">Total Laptops Sold</div>
              <div className="font-mono text-2xl font-bold tabular-nums mt-1">{report.summary.totalUnitsSold}</div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <div className="text-xs text-slate-500">Total Sales Revenue</div>
              <div className="font-mono text-2xl font-bold tabular-nums mt-1 text-teal-700 dark:text-teal-400">
                {formatCurrency(report.summary.totalRevenue, preferences.currencyFormat)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <div className="text-xs text-slate-500">Total Discounts Given</div>
              <div className="font-mono text-2xl font-bold tabular-nums mt-1">
                {formatCurrency(report.summary.totalDiscount, preferences.currencyFormat)}
              </div>
            </div>
          </div>

          {/* Branch-wise Totals in Strict Order RG -> NM -> JSM -> CC */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <h3 className="font-display font-semibold text-base mb-4">Branch-Wise Totals (RG → NM → JSM → CC)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 pr-4">Branch</th>
                    <th className="py-2 px-4 text-right">Laptops Sold</th>
                    <th className="py-2 px-4 text-right">Discounts</th>
                    <th className="py-2 pl-4 text-right">Total Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {BRANCHES.map((b) => {
                    const row = report.branchTotals.find((bt) => bt.branch === b.code) ?? { count: 0, revenue: 0, discount: 0 };
                    return (
                      <tr key={b.code}>
                        <td className="py-2.5 pr-4 font-semibold">{b.code} — {b.name}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{row.count}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{formatCurrency(row.discount, preferences.currencyFormat)}</td>
                        <td className="py-2.5 pl-4 text-right font-mono tabular-nums font-bold">{formatCurrency(row.revenue, preferences.currencyFormat)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Daily / Monthly / Employee / Model Grids */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h3 className="font-display font-semibold text-base mb-3">Employee-Wise Sales</h3>
              {report.employeeSales.length === 0 ? (
                <p className="text-xs text-slate-500">No completed sales in range.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {report.employeeSales.map((e) => (
                    <div key={e.employeeName} className="py-2.5 flex items-center justify-between">
                      <span className="font-medium">{e.employeeName}</span>
                      <span className="font-mono tabular-nums">{e.count} sold · <strong>{formatCurrency(e.revenue, preferences.currencyFormat)}</strong></span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h3 className="font-display font-semibold text-base mb-3">Laptop Model Sales</h3>
              {report.modelSales.length === 0 ? (
                <p className="text-xs text-slate-500">No completed sales in range.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {report.modelSales.slice(0, 12).map((m) => (
                    <div key={`${m.brand}-${m.model}`} className="py-2.5 flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{m.brand} {m.model}</span>
                      <span className="font-mono tabular-nums shrink-0">{m.count} units · <strong>{formatCurrency(m.revenue, preferences.currencyFormat)}</strong></span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h3 className="font-display font-semibold text-base mb-3">Daily Sales Breakdown</h3>
              {report.dailySales.length === 0 ? (
                <p className="text-xs text-slate-500">No daily records yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {report.dailySales.slice(0, 14).map((d) => (
                    <div key={d.date} className="py-2 flex items-center justify-between font-mono tabular-nums">
                      <span>{d.date}</span>
                      <span>{d.count} sold · <strong>{formatCurrency(d.revenue, preferences.currencyFormat)}</strong></span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h3 className="font-display font-semibold text-base mb-3">Monthly Sales Breakdown</h3>
              {report.monthlySales.length === 0 ? (
                <p className="text-xs text-slate-500">No monthly records yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {report.monthlySales.map((m) => (
                    <div key={m.month} className="py-2 flex items-center justify-between font-mono tabular-nums">
                      <span>{m.month}</span>
                      <span>{m.count} sold · <strong>{formatCurrency(m.revenue, preferences.currencyFormat)}</strong></span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
};
