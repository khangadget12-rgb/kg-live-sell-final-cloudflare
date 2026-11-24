import React from 'react';
import { ArrowRight, AlertTriangle, Boxes, ShoppingBag, ReceiptText } from 'lucide-react';
import { BRANCHES } from '../lib/types';
import type { AppTab, LaptopRecord, RefillAlertRecord, SaleRecord, UserPreferences } from '../lib/types';
import { formatCurrency } from '../lib/formatters';
import { computeInventoryAnalytics } from '../lib/smartSearch';

interface DashboardViewProps {
  laptops: LaptopRecord[];
  sales: SaleRecord[];
  refillAlerts: RefillAlertRecord[];
  preferences: UserPreferences;
  onNavigate: (tab: AppTab) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  laptops,
  sales,
  refillAlerts,
  preferences,
  onNavigate,
}) => {
  const analytics = computeInventoryAnalytics(laptops);
  const completedSales = sales.filter((s) => s.status === 'completed');
  const totalSalesRevenue = completedSales.reduce((sum, s) => sum + s.salePrice, 0);
  const activeAlerts = refillAlerts.filter((a) => a.status === 'active');

  const today = new Date().toISOString().slice(0, 10);
  const todaySales = completedSales.filter((s) => s.soldAt.slice(0, 10) === today);
  const todayRevenue = todaySales.reduce((sum, s) => sum + s.salePrice, 0);

  return (
    <div className="space-y-8">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Laptop Models (Variants)</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {analytics.totalModels}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Across 7 automatic categories
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Physical Units</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {analytics.totalUnits}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Ready across RG · NM · JSM · CC
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Completed Laptop Sales</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totalSalesRevenue, preferences.currencyFormat)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {completedSales.length} sold total · {todaySales.length} today ({formatCurrency(todayRevenue, preferences.currencyFormat)})
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Refill Alerts</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {activeAlerts.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Branch exhausted with cross-branch stock
          </div>
        </div>
      </div>

      {/* Exact Branch Order: RG -> NM -> JSM -> CC */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="font-display font-semibold text-base text-slate-900 dark:text-slate-100">
              Branch Overview (RG → NM → JSM → CC)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Live laptop stock units and sales performance ordered across all four Khan Gadget branches
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('stock-sheet')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
          >
            <span>Open Stock Sheet</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {BRANCHES.map((branch, idx) => {
            const units = analytics.branchTotals[branch.code];
            const branchSales = completedSales.filter((s) => s.branch === branch.code);
            const branchRev = branchSales.reduce((sum, s) => sum + s.salePrice, 0);
            const branchAlerts = activeAlerts.filter((a) => a.exhaustedBranch === branch.code).length;

            return (
              <div
                key={branch.code}
                className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-teal-700 dark:text-teal-400">
                    0{idx + 1} · {branch.code}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{branch.name}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">In Stock</div>
                    <div className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {units} units
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Sales</div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                      {branchSales.length} ({formatCurrency(branchRev, preferences.currencyFormat)})
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                  <span>Refill Alerts</span>
                  <span className={`font-mono tabular-nums font-semibold ${branchAlerts > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                    {branchAlerts}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Two-Column Split: Categories & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="font-display font-semibold text-base">Stock by Laptop Category</h3>
            <button
              type="button"
              onClick={() => onNavigate('laptop-finder')}
              className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
            >
              SpecLedger Finder
            </button>
          </div>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {analytics.categories.map((cat) => (
              <div key={cat.category} className="py-2.5 flex items-center justify-between gap-4 text-sm">
                <span className="font-medium text-slate-800 dark:text-slate-200">{cat.category}</span>
                <div className="flex items-center gap-4 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">
                  <span>{cat.modelCount} models</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 w-16 text-right">
                    {cat.totalUnits} units
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="font-display font-semibold text-base">Recent Laptop Sales</h3>
            <button
              type="button"
              onClick={() => onNavigate('sales-ledger')}
              className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
            >
              View Ledger
            </button>
          </div>

          {sales.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
              <ReceiptText className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No laptop sales logged yet</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Submit a laptop-only sale from Live Sell to update branch stock and trigger reminders.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('live-sell')}
                className="mt-4 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold"
              >
                Go to Live Sell
              </button>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
              {sales.slice(0, 6).map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {s.brand} {s.model}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {s.branch} · {s.employeeName} · {s.invoiceNo}
                      {s.status === 'voided' ? ' · VOIDED' : ''}
                    </div>
                  </div>
                  <div className="font-mono text-sm font-semibold tabular-nums shrink-0 text-slate-900 dark:text-slate-100">
                    {formatCurrency(s.salePrice, preferences.currencyFormat)}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-auto pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate('live-sell')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium whitespace-nowrap"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Live Sell</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('refill-reminder')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span>Refill Reminders ({activeAlerts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('stock-sheet')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Boxes className="w-3.5 h-3.5 text-slate-500" />
              <span>Stock Sheet</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
