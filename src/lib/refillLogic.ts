import { BRANCH_ORDER } from './types';
import type { BranchCode, LaptopRecord, RefillAlertRecord } from './types';

export interface RefillEvaluationResult {
  toTrigger: Array<{
    laptopId: string;
    brand: string;
    model: string;
    variant: string;
    exhaustedBranch: BranchCode;
    rg: number;
    nm: number;
    jsm: number;
    cc: number;
    otherBranchesQty: number;
  }>;
  toUpdateCounts: Array<{
    alertId: number;
    rg: number;
    nm: number;
    jsm: number;
    cc: number;
    otherBranchesQty: number;
  }>;
  toResolveIds: number[];
}

export function getBranchStock(laptop: Pick<LaptopRecord, 'rg' | 'nm' | 'jsm' | 'cc'>, branch: BranchCode): number {
  if (branch === 'RG') return laptop.rg;
  if (branch === 'NM') return laptop.nm;
  if (branch === 'JSM') return laptop.jsm;
  return laptop.cc;
}

/**
 * Evaluates the cross-branch refill rule for a laptop:
 * - When one branch runs out (0 units) and the other branches collectively have > 1 unit (>= 2 units),
 *   trigger an alert if no active unresolved alert already exists for that (laptopId, branch).
 * - Never repeat an alert for the same unresolved stock-out event.
 * - Re-arm automatically by resolving active alerts when the exhausted branch is restocked (> 0)
 *   so that if it runs out again later, a fresh alert fires.
 */
export function evaluateRefillForLaptop(
  laptop: LaptopRecord,
  existingAlerts: RefillAlertRecord[]
): RefillEvaluationResult {
  const toTrigger: RefillEvaluationResult['toTrigger'] = [];
  const toUpdateCounts: RefillEvaluationResult['toUpdateCounts'] = [];
  const toResolveIds: number[] = [];

  for (const branch of BRANCH_ORDER) {
    const branchQty = getBranchStock(laptop, branch);
    const otherQty = BRANCH_ORDER.filter((b) => b !== branch).reduce(
      (sum, b) => sum + getBranchStock(laptop, b),
      0
    );

    const activeAlert = existingAlerts.find(
      (a) => a.laptopId === laptop.id && a.exhaustedBranch === branch && a.status === 'active'
    );

    if (branchQty === 0 && otherQty > 1) {
      if (!activeAlert) {
        toTrigger.push({
          laptopId: laptop.id,
          brand: laptop.brand,
          model: laptop.model,
          variant: laptop.variant,
          exhaustedBranch: branch,
          rg: laptop.rg,
          nm: laptop.nm,
          jsm: laptop.jsm,
          cc: laptop.cc,
          otherBranchesQty: otherQty,
        });
      } else {
        toUpdateCounts.push({
          alertId: activeAlert.id,
          rg: laptop.rg,
          nm: laptop.nm,
          jsm: laptop.jsm,
          cc: laptop.cc,
          otherBranchesQty: otherQty,
        });
      }
    } else if (branchQty > 0 && activeAlert) {
      // Restocked -> resolve & re-arm for any future stock-out
      toResolveIds.push(activeAlert.id);
    }
  }

  return { toTrigger, toUpdateCounts, toResolveIds };
}
