import type { LaptopRecord } from './types';

export interface SheetDiffResult {
  hasChanges: boolean;
  addedCount: number;
  removedCount: number;
  updatedCount: number;
  prevModels: number;
  nextModels: number;
  prevUnits: number;
  nextUnits: number;
  unitDelta: number;
  summary: string;
}

/**
 * Normalize CSV/TSV text so line-ending differences (CRLF vs LF) or trailing blank lines
 * do not trigger unnecessary database rewrites, while any cell value change produces a new string.
 */
export function normalizeCsvContent(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line, idx, arr) => line.length > 0 || idx < arr.length - 1)
    .join('\n')
    .trim();
}

function buildOccurrenceKeys(laptops: LaptopRecord[]): Map<string, LaptopRecord> {
  const counts = new Map<string, number>();
  const map = new Map<string, LaptopRecord>();

  for (const item of laptops) {
    const base = `${item.brand}|${item.model}|${item.variant}|${item.processor}|${item.ramGb}|${item.storageGb}`
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    const occ = (counts.get(base) || 0) + 1;
    counts.set(base, occ);
    map.set(`${base}#${occ}`, item);
  }
  return map;
}

function didLaptopChange(a: LaptopRecord, b: LaptopRecord): boolean {
  return (
    a.askPrice !== b.askPrice ||
    a.disPrice !== b.disPrice ||
    a.borderPrice !== b.borderPrice ||
    a.rg !== b.rg ||
    a.nm !== b.nm ||
    a.jsm !== b.jsm ||
    a.cc !== b.cc ||
    a.qty !== b.qty ||
    a.adapter !== b.adapter ||
    a.entryDate !== b.entryDate ||
    a.remarks !== b.remarks ||
    a.condition !== b.condition ||
    a.detailedCondition !== b.detailedCondition ||
    a.location !== b.location
  );
}

/**
 * Compare two parsed snapshots of a sheet to detect any numeric (stock/price)
 * or model (added/removed/edited) changes.
 */
export function diffLaptopSnapshots(previous: LaptopRecord[], next: LaptopRecord[]): SheetDiffResult {
  const prevMap = buildOccurrenceKeys(previous);
  const nextMap = buildOccurrenceKeys(next);

  let addedCount = 0;
  let removedCount = 0;
  let updatedCount = 0;

  for (const [key, nextItem] of nextMap.entries()) {
    const prevItem = prevMap.get(key);
    if (!prevItem) {
      addedCount += 1;
    } else if (didLaptopChange(prevItem, nextItem)) {
      updatedCount += 1;
    }
  }

  for (const key of prevMap.keys()) {
    if (!nextMap.has(key)) {
      removedCount += 1;
    }
  }

  const prevUnits = previous.reduce((sum, l) => sum + l.qty, 0);
  const nextUnits = next.reduce((sum, l) => sum + l.qty, 0);
  const unitDelta = nextUnits - prevUnits;
  const hasChanges = addedCount > 0 || removedCount > 0 || updatedCount > 0;

  const parts: string[] = [];
  if (updatedCount > 0) parts.push(`${updatedCount} updated`);
  if (addedCount > 0) parts.push(`${addedCount} added`);
  if (removedCount > 0) parts.push(`${removedCount} removed`);
  if (unitDelta !== 0) parts.push(`${unitDelta > 0 ? `+${unitDelta}` : unitDelta} units`);

  return {
    hasChanges,
    addedCount,
    removedCount,
    updatedCount,
    prevModels: previous.length,
    nextModels: next.length,
    prevUnits,
    nextUnits,
    unitDelta,
    summary: parts.length > 0 ? parts.join(' · ') : 'No changes detected',
  };
}
