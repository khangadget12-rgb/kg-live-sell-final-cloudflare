import { BRANCH_ORDER, LAPTOP_CATEGORIES } from './types';
import type { BranchCode, LaptopCategory, LaptopCondition, LaptopRecord } from './types';

export interface SearchFilterState {
  query: string;
  priceField: 'discounted' | 'asking' | 'border';
  minPrice: number | null;
  maxPrice: number | null;
  ramGb: number | null;
  minStorageGb: number | null;
  cpuFamily: string | null;
  cpuGen: number | null;
  memoryType: string | null;
  displayFeatures: ('touch' | 'x360' | 'oled' | '120hz+')[];
  gpuFilter: 'all' | 'dedicated' | 'rtx' | 'gtx';
  condition: LaptopCondition | null;
  branch: BranchCode | null;
  category: LaptopCategory | null;
  brand: string | null;
  onlyDetachable: boolean;
  onlySimLte: boolean;
  onlyNpu: boolean;
  onlyClean: boolean;
  onlyInStock: boolean;
}

export const EMPTY_FILTERS: SearchFilterState = {
  query: '',
  priceField: 'discounted',
  minPrice: null,
  maxPrice: null,
  ramGb: null,
  minStorageGb: null,
  cpuFamily: null,
  cpuGen: null,
  memoryType: null,
  displayFeatures: [],
  gpuFilter: 'all',
  condition: null,
  branch: null,
  category: null,
  brand: null,
  onlyDetachable: false,
  onlySimLte: false,
  onlyNpu: false,
  onlyClean: false,
  onlyInStock: false,
};

export interface RecognizedTag {
  key: string;
  label: string;
  clear: (state: SearchFilterState) => SearchFilterState;
}

export interface ParsedNaturalQuery {
  parsedFilters: Partial<SearchFilterState>;
  tags: RecognizedTag[];
  residualTokens: string[];
}

function parseKAmount(numStr: string, hasK: boolean): number {
  const num = parseFloat(numStr.replace(/,/g, ''));
  if (!Number.isFinite(num)) return 0;
  return hasK || num < 1000 ? Math.round(num * 1000) : Math.round(num);
}

/**
 * Parses natural-language laptop queries like:
 * - "Under 50k i5 11th Gen"
 * - "16GB RAM 512GB SSD"
 * - "RTX Gaming"
 * - "Touch X360"
 * - "ThinkPad OLED"
 * - "Border below 45k"
 * - "Ryzen 7 16GB DDR5"
 * - "Above 60k Core Ultra 7"
 */
export function parseNaturalQuery(rawQuery: string): ParsedNaturalQuery {
  const q = rawQuery.trim();
  if (!q) {
    return { parsedFilters: {}, tags: [], residualTokens: [] };
  }

  let working = q;
  const parsed: Partial<SearchFilterState> = {};
  const tags: RecognizedTag[] = [];

  const consume = (pattern: RegExp) => {
    working = working.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
  };

  // Price field detection (Border / Asking)
  if (/\bborder\b/i.test(working)) {
    parsed.priceField = 'border';
    consume(/\bborder\b/i);
  } else if (/\basking\b/i.test(working)) {
    parsed.priceField = 'asking';
    consume(/\basking\b/i);
  }

  // Price under / below
  const underMatch = working.match(/\b(?:under|below|max|upto|up\s+to|<=?)\s*৳?\s*(\d+(?:\.\d+)?)\s*(k)?\b/i);
  if (underMatch) {
    const val = parseKAmount(underMatch[1], Boolean(underMatch[2]));
    parsed.maxPrice = val;
    const fieldLabel = parsed.priceField === 'border' ? 'Border' : parsed.priceField === 'asking' ? 'Asking' : 'Price';
    tags.push({
      key: 'maxPrice',
      label: `${fieldLabel} <= ৳${val.toLocaleString('en-IN')}`,
      clear: (s) => ({ ...s, maxPrice: null }),
    });
    consume(new RegExp(underMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  // Price above / over
  const aboveMatch = working.match(/\b(?:above|over|min|from|>=?)\s*৳?\s*(\d+(?:\.\d+)?)\s*(k)?\b/i);
  if (aboveMatch) {
    const val = parseKAmount(aboveMatch[1], Boolean(aboveMatch[2]));
    parsed.minPrice = val;
    const fieldLabel = parsed.priceField === 'border' ? 'Border' : parsed.priceField === 'asking' ? 'Asking' : 'Price';
    tags.push({
      key: 'minPrice',
      label: `${fieldLabel} >= ৳${val.toLocaleString('en-IN')}`,
      clear: (s) => ({ ...s, minPrice: null }),
    });
    consume(new RegExp(aboveMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  // Price range e.g. 30k-50k
  const rangeMatch = working.match(/\b(\d+(?:\.\d+)?)(k)?\s*[-–to]+\s*(\d+(?:\.\d+)?)(k)?\b/i);
  if (rangeMatch && (rangeMatch[2] || rangeMatch[4])) {
    const minVal = parseKAmount(rangeMatch[1], Boolean(rangeMatch[2] || rangeMatch[4]));
    const maxVal = parseKAmount(rangeMatch[3], Boolean(rangeMatch[4]));
    parsed.minPrice = minVal;
    parsed.maxPrice = maxVal;
    tags.push({
      key: 'priceRange',
      label: `৳${minVal.toLocaleString('en-IN')}–৳${maxVal.toLocaleString('en-IN')}`,
      clear: (s) => ({ ...s, minPrice: null, maxPrice: null }),
    });
    consume(new RegExp(rangeMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  // CPU Gen e.g. 11th Gen, 14th gen
  const genMatch = working.match(/\b(\d{1,2})(?:th|st|nd|rd)\s*gen\b/i);
  if (genMatch) {
    const gen = parseInt(genMatch[1], 10);
    parsed.cpuGen = gen;
    tags.push({
      key: 'cpuGen',
      label: `${gen}th Gen`,
      clear: (s) => ({ ...s, cpuGen: null }),
    });
    consume(/\b\d{1,2}(?:th|st|nd|rd)\s*gen\b/i);
  }

  // CPU family
  const cpuChecks: [RegExp, string, string][] = [
    [/\bcore\s*ultra\s*([579])\b/i, 'Core Ultra', 'Core Ultra'],
    [/\bcore\s*ultra\b/i, 'Core Ultra', 'Core Ultra'],
    [/\bryzen\s*ai\s*([579])?\b/i, 'Ryzen AI', 'Ryzen AI'],
    [/\bryzen\s*([3579])\b/i, 'Ryzen', 'Ryzen'],
    [/\b(?:core\s*)?(i[3579])\b/i, 'Intel', 'Intel'],
    [/\bapple\s*m([1234])\b|\b(m[1234])\b/i, 'Apple M', 'Apple Silicon'],
    [/\bsnapdragon\b/i, 'Snapdragon', 'Snapdragon'],
    [/\bceleron\b/i, 'Celeron', 'Celeron'],
  ];
  for (const [regex, family, labelPrefix] of cpuChecks) {
    const m = working.match(regex);
    if (m) {
      const exact = m[0].trim();
      parsed.cpuFamily = exact;
      tags.push({
        key: 'cpuFamily',
        label: `CPU: ${labelPrefix === 'Intel' || labelPrefix === 'Ryzen' ? exact.toUpperCase() : exact}`,
        clear: (s) => ({ ...s, cpuFamily: null }),
      });
      consume(regex);
      break;
    }
  }

  // Memory DDR type
  const memMatch = working.match(/\b(lpddr5x|lpddr5|lpddr4|lpddr3|lpddr|ddr5|ddr4|ddr3)\b/i);
  if (memMatch) {
    const mem = memMatch[1].toUpperCase();
    parsed.memoryType = mem;
    tags.push({
      key: 'memoryType',
      label: `Memory: ${mem}`,
      clear: (s) => ({ ...s, memoryType: null }),
    });
    consume(/\b(lpddr5x|lpddr5|lpddr4|lpddr3|lpddr|ddr5|ddr4|ddr3)\b/i);
  }

  // Storage (128GB, 256GB, 512GB, 1TB, optionally followed by SSD/NVMe)
  const storageMatch = working.match(/\b(128|256|512)\s*gb(?:\s*(?:ssd|nvme|storage))?\b|\b(1|2)\s*tb(?:\s*(?:ssd|hdd|nvme|storage))?\b/i);
  if (storageMatch) {
    const gb = storageMatch[1] ? parseInt(storageMatch[1], 10) : parseInt(storageMatch[2], 10) * 1024;
    parsed.minStorageGb = gb;
    tags.push({
      key: 'minStorageGb',
      label: `Storage >= ${gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`}`,
      clear: (s) => ({ ...s, minStorageGb: null }),
    });
    consume(new RegExp(storageMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  // RAM (4GB, 8GB, 12GB, 16GB, 24GB, 32GB)
  const ramMatch = working.match(/\b(4|8|12|16|24|32|64)\s*gb(?:\s*ram)?\b/i);
  if (ramMatch) {
    const ram = parseInt(ramMatch[1], 10);
    parsed.ramGb = ram;
    tags.push({
      key: 'ramGb',
      label: `RAM: ${ram}GB`,
      clear: (s) => ({ ...s, ramGb: null }),
    });
    consume(new RegExp(ramMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  // Display features
  const displayList: ('touch' | 'x360' | 'oled' | '120hz+')[] = [];
  if (/\bx360\b|\bconvertible\b|\b2-in-1\b/i.test(working)) {
    displayList.push('x360');
    consume(/\bx360\b|\bconvertible\b|\b2-in-1\b/gi);
  }
  if (/\boled\b/i.test(working)) {
    displayList.push('oled');
    consume(/\boled\b/gi);
  }
  if (/\btouch(?:screen)?\b/i.test(working)) {
    displayList.push('touch');
    consume(/\btouch(?:screen)?\b/gi);
  }
  if (/\b(?:120|144|165|180)\s*hz\+?\b/i.test(working)) {
    displayList.push('120hz+');
    consume(/\b(?:120|144|165|180)\s*hz\+?\b/gi);
  }
  if (displayList.length > 0) {
    parsed.displayFeatures = displayList;
    for (const feat of displayList) {
      tags.push({
        key: `display_${feat}`,
        label: `Display: ${feat.toUpperCase()}`,
        clear: (s) => ({ ...s, displayFeatures: s.displayFeatures.filter((f) => f !== feat) }),
      });
    }
  }

  // GPU
  if (/\brtx\b/i.test(working)) {
    parsed.gpuFilter = 'rtx';
    tags.push({ key: 'gpu', label: 'GPU: NVIDIA RTX', clear: (s) => ({ ...s, gpuFilter: 'all' }) });
    consume(/\brtx\b/gi);
  } else if (/\bgtx\b/i.test(working)) {
    parsed.gpuFilter = 'gtx';
    tags.push({ key: 'gpu', label: 'GPU: NVIDIA GTX', clear: (s) => ({ ...s, gpuFilter: 'all' }) });
    consume(/\bgtx\b/gi);
  } else if (/\bdedicated(?:\s*gpu)?\b/i.test(working)) {
    parsed.gpuFilter = 'dedicated';
    tags.push({ key: 'gpu', label: 'Dedicated GPU', clear: (s) => ({ ...s, gpuFilter: 'all' }) });
    consume(/\bdedicated(?:\s*gpu)?\b/gi);
  }

  // Condition
  if (/\bintact\b/i.test(working)) {
    parsed.condition = 'Intact';
    tags.push({ key: 'condition', label: 'Condition: Intact', clear: (s) => ({ ...s, condition: null }) });
    consume(/\bintact\b/gi);
  } else if (/\bopen\s*box\b/i.test(working)) {
    parsed.condition = 'Open Box';
    tags.push({ key: 'condition', label: 'Condition: Open Box', clear: (s) => ({ ...s, condition: null }) });
    consume(/\bopen\s*box\b/gi);
  } else if (/\bused\b/i.test(working)) {
    parsed.condition = 'Used';
    tags.push({ key: 'condition', label: 'Condition: Used', clear: (s) => ({ ...s, condition: null }) });
    consume(/\bused\b/gi);
  }

  // Branch
  const branchAliases: [RegExp, BranchCode][] = [
    [/\b(?:rg|rail\s*gate)\b/i, 'RG'],
    [/\b(?:nm|new\s*market)\b/i, 'NM'],
    [/\b(?:jsm|jamal(?:\s*supermarket)?)\b/i, 'JSM'],
    [/\b(?:cc|city\s*center)\b/i, 'CC'],
  ];
  for (const [reg, code] of branchAliases) {
    if (reg.test(working)) {
      parsed.branch = code;
      tags.push({ key: 'branch', label: `Branch: ${code}`, clear: (s) => ({ ...s, branch: null }) });
      consume(reg);
      break;
    }
  }

  // Special capabilities
  if (/\bdetachable\b/i.test(working)) {
    parsed.onlyDetachable = true;
    tags.push({ key: 'detachable', label: 'Detachable Keyboard', clear: (s) => ({ ...s, onlyDetachable: false }) });
    consume(/\bdetachable\b/gi);
  }
  if (/\b(?:lte|sim|esim)\b/i.test(working)) {
    parsed.onlySimLte = true;
    tags.push({ key: 'sim', label: 'SIM / LTE / eSIM', clear: (s) => ({ ...s, onlySimLte: false }) });
    consume(/\b(?:lte|sim|esim)\b/gi);
  }
  if (/\b(?:npu|ai\s+capable|copilot)\b/i.test(working)) {
    parsed.onlyNpu = true;
    tags.push({ key: 'npu', label: 'NPU / AI Capable', clear: (s) => ({ ...s, onlyNpu: false }) });
    consume(/\b(?:npu|ai\s+capable|copilot)\b/gi);
  }
  if (/\b(?:clean|fresh)\b/i.test(working)) {
    parsed.onlyClean = true;
    tags.push({ key: 'clean', label: 'Clean Condition', clear: (s) => ({ ...s, onlyClean: false }) });
    consume(/\b(?:clean|fresh)\b/gi);
  }

  // Brand recognition
  const knownBrands = ['Apple', 'Asus', 'Dell', 'HP', 'Lenovo', 'Microsoft', 'LG', 'Acer', 'MSI', 'Toshiba', 'Xiaomi', 'Huawei'];
  for (const b of knownBrands) {
    const reg = new RegExp(`\\b${b}\\b`, 'i');
    if (reg.test(working)) {
      parsed.brand = b;
      tags.push({ key: 'brand', label: `Brand: ${b}`, clear: (s) => ({ ...s, brand: null }) });
      consume(reg);
      break;
    }
  }

  const residualTokens = working
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  return { parsedFilters: parsed, tags, residualTokens };
}

export function filterLaptops(
  laptops: LaptopRecord[],
  state: SearchFilterState,
  suppressedKeys: Set<string> = new Set()
): { items: LaptopRecord[]; recognizedTags: RecognizedTag[] } {
  const nl = parseNaturalQuery(state.query);
  const activeTags = nl.tags.filter((t) => !suppressedKeys.has(t.key));

  // Merge natural query parsed filters (unless suppressed) with explicit UI filters (explicit wins if set)
  const effective: SearchFilterState = {
    ...state,
    priceField: state.priceField !== 'discounted' ? state.priceField : (nl.parsedFilters.priceField ?? state.priceField),
    minPrice: state.minPrice ?? (!suppressedKeys.has('minPrice') && !suppressedKeys.has('priceRange') ? nl.parsedFilters.minPrice ?? null : null),
    maxPrice: state.maxPrice ?? (!suppressedKeys.has('maxPrice') && !suppressedKeys.has('priceRange') ? nl.parsedFilters.maxPrice ?? null : null),
    ramGb: state.ramGb ?? (!suppressedKeys.has('ramGb') ? nl.parsedFilters.ramGb ?? null : null),
    minStorageGb: state.minStorageGb ?? (!suppressedKeys.has('minStorageGb') ? nl.parsedFilters.minStorageGb ?? null : null),
    cpuFamily: state.cpuFamily ?? (!suppressedKeys.has('cpuFamily') ? nl.parsedFilters.cpuFamily ?? null : null),
    cpuGen: state.cpuGen ?? (!suppressedKeys.has('cpuGen') ? nl.parsedFilters.cpuGen ?? null : null),
    memoryType: state.memoryType ?? (!suppressedKeys.has('memoryType') ? nl.parsedFilters.memoryType ?? null : null),
    displayFeatures: Array.from(
      new Set([
        ...state.displayFeatures,
        ...(nl.parsedFilters.displayFeatures ?? []).filter((f) => !suppressedKeys.has(`display_${f}`)),
      ])
    ),
    gpuFilter: state.gpuFilter !== 'all' ? state.gpuFilter : (!suppressedKeys.has('gpu') ? nl.parsedFilters.gpuFilter ?? 'all' : 'all'),
    condition: state.condition ?? (!suppressedKeys.has('condition') ? nl.parsedFilters.condition ?? null : null),
    branch: state.branch ?? (!suppressedKeys.has('branch') ? nl.parsedFilters.branch ?? null : null),
    brand: state.brand ?? (!suppressedKeys.has('brand') ? nl.parsedFilters.brand ?? null : null),
    onlyDetachable: state.onlyDetachable || (!suppressedKeys.has('detachable') && Boolean(nl.parsedFilters.onlyDetachable)),
    onlySimLte: state.onlySimLte || (!suppressedKeys.has('sim') && Boolean(nl.parsedFilters.onlySimLte)),
    onlyNpu: state.onlyNpu || (!suppressedKeys.has('npu') && Boolean(nl.parsedFilters.onlyNpu)),
    onlyClean: state.onlyClean || (!suppressedKeys.has('clean') && Boolean(nl.parsedFilters.onlyClean)),
  };

  const items = laptops.filter((l) => {
    const targetPrice =
      effective.priceField === 'asking'
        ? l.askPrice
        : effective.priceField === 'border'
        ? l.borderPrice
        : l.disPrice || l.askPrice;

    if (effective.minPrice !== null && (targetPrice <= 0 || targetPrice < effective.minPrice)) return false;
    if (effective.maxPrice !== null && (targetPrice <= 0 || targetPrice > effective.maxPrice)) return false;
    if (effective.ramGb !== null && l.ramGb !== effective.ramGb) return false;
    if (effective.minStorageGb !== null && l.storageGb < effective.minStorageGb) return false;
    if (effective.cpuGen !== null && l.cpuGen !== effective.cpuGen) return false;

    if (effective.cpuFamily) {
      const fam = effective.cpuFamily.toLowerCase();
      if (!l.processor.toLowerCase().includes(fam)) return false;
    }

    if (effective.memoryType) {
      const mt = effective.memoryType.toUpperCase();
      if (!l.ramType.toUpperCase().includes(mt) && !l.ramBus.toUpperCase().includes(mt)) return false;
    }

    for (const df of effective.displayFeatures) {
      if (df === 'touch' && !l.isTouch) return false;
      if (df === 'x360' && !l.isX360) return false;
      if (df === 'oled' && !l.isOled) return false;
      if (df === '120hz+' && (!l.refreshHz || l.refreshHz < 120)) return false;
    }

    if (effective.gpuFilter === 'dedicated' && !l.isDedicatedGpu) return false;
    if (effective.gpuFilter === 'rtx' && !/rtx/i.test(l.gpu)) return false;
    if (effective.gpuFilter === 'gtx' && !/gtx/i.test(l.gpu)) return false;

    if (effective.condition && l.condition !== effective.condition) return false;
    if (effective.category && l.category !== effective.category) return false;
    if (effective.brand && l.brand.toLowerCase() !== effective.brand.toLowerCase()) return false;

    if (effective.branch) {
      const bQty = effective.branch === 'RG' ? l.rg : effective.branch === 'NM' ? l.nm : effective.branch === 'JSM' ? l.jsm : l.cc;
      if (bQty <= 0) return false;
    }

    if (effective.onlyInStock && l.qty <= 0) return false;
    if (effective.onlyDetachable && !l.hasDetachableKeyboard) return false;
    if (effective.onlySimLte && !l.hasSimLte) return false;
    if (effective.onlyNpu && !l.hasNpu) return false;
    if (effective.onlyClean && !l.isCleanCondition) return false;

    if (nl.residualTokens.length > 0) {
      const haystack = `${l.brand} ${l.model} ${l.processor} ${l.gpu} ${l.displayRaw} ${l.category} ${l.remarks} ${l.detailedCondition} ${l.color} ${l.serialWarranty}`.toLowerCase();
      for (const tok of nl.residualTokens) {
        if (!haystack.includes(tok.toLowerCase())) return false;
      }
    }

    return true;
  });

  return { items, recognizedTags: activeTags };
}

export interface CategoryAnalyticsItem {
  category: LaptopCategory;
  modelCount: number;
  totalUnits: number;
  lowestPrice: number | null;
  highestPrice: number | null;
}

export interface BrandAnalyticsItem {
  brand: string;
  modelCount: number;
  totalUnits: number;
  startingPrice: number | null;
}

export interface PriceBucketItem {
  label: string;
  min: number;
  max: number | null;
  modelCount: number;
  totalUnits: number;
}

export interface InventoryAnalytics {
  totalModels: number;
  totalUnits: number;
  branchTotals: Record<BranchCode, number>;
  categories: CategoryAnalyticsItem[];
  manufacturers: BrandAnalyticsItem[];
  priceBuckets: PriceBucketItem[];
}

export function computeInventoryAnalytics(laptops: LaptopRecord[]): InventoryAnalytics {
  const branchTotals: Record<BranchCode, number> = { RG: 0, NM: 0, JSM: 0, CC: 0 };
  let totalUnits = 0;

  const catMap = new Map<LaptopCategory, { models: number; units: number; prices: number[] }>();
  for (const cat of LAPTOP_CATEGORIES) {
    catMap.set(cat, { models: 0, units: 0, prices: [] });
  }

  const brandMap = new Map<string, { models: number; units: number; prices: number[] }>();

  const buckets: PriceBucketItem[] = [
    { label: 'Under ৳30,000', min: 0, max: 29999, modelCount: 0, totalUnits: 0 },
    { label: '৳30,000–৳50,000', min: 30000, max: 50000, modelCount: 0, totalUnits: 0 },
    { label: '৳50,000–৳80,000', min: 50001, max: 80000, modelCount: 0, totalUnits: 0 },
    { label: '৳80,000–৳130,000', min: 80001, max: 130000, modelCount: 0, totalUnits: 0 },
    { label: 'Above ৳130,000', min: 130001, max: null, modelCount: 0, totalUnits: 0 },
  ];

  for (const l of laptops) {
    totalUnits += l.qty;
    for (const b of BRANCH_ORDER) {
      if (b === 'RG') branchTotals.RG += l.rg;
      if (b === 'NM') branchTotals.NM += l.nm;
      if (b === 'JSM') branchTotals.JSM += l.jsm;
      if (b === 'CC') branchTotals.CC += l.cc;
    }

    const price = l.disPrice > 0 ? l.disPrice : l.askPrice;

    const cEntry = catMap.get(l.category)!;
    cEntry.models += 1;
    cEntry.units += l.qty;
    if (price > 0) cEntry.prices.push(price);

    const bKey = l.brand.trim() || 'Other';
    if (!brandMap.has(bKey)) brandMap.set(bKey, { models: 0, units: 0, prices: [] });
    const bEntry = brandMap.get(bKey)!;
    bEntry.models += 1;
    bEntry.units += l.qty;
    if (price > 0) bEntry.prices.push(price);

    if (price > 0) {
      const bucket = buckets.find((b) => price >= b.min && (b.max === null || price <= b.max));
      if (bucket) {
        bucket.modelCount += 1;
        bucket.totalUnits += l.qty;
      }
    }
  }

  const categories: CategoryAnalyticsItem[] = LAPTOP_CATEGORIES.map((category) => {
    const data = catMap.get(category)!;
    return {
      category,
      modelCount: data.models,
      totalUnits: data.units,
      lowestPrice: data.prices.length ? Math.min(...data.prices) : null,
      highestPrice: data.prices.length ? Math.max(...data.prices) : null,
    };
  });

  const manufacturers: BrandAnalyticsItem[] = Array.from(brandMap.entries())
    .map(([brand, data]) => ({
      brand,
      modelCount: data.models,
      totalUnits: data.units,
      startingPrice: data.prices.length ? Math.min(...data.prices) : null,
    }))
    .sort((a, b) => b.totalUnits - a.totalUnits || b.modelCount - a.modelCount);

  return {
    totalModels: laptops.length,
    totalUnits,
    branchTotals,
    categories,
    manufacturers,
    priceBuckets: buckets,
  };
}

export function resolveEffectiveBranch(
  state: SearchFilterState,
  suppressedKeys: Set<string> = new Set()
): BranchCode | null {
  if (state.branch) return state.branch;
  if (suppressedKeys.has('branch')) return null;
  const nl = parseNaturalQuery(state.query);
  return nl.parsedFilters.branch ?? null;
}

export function getLaptopBranchUnitCount(laptop: LaptopRecord, branch: BranchCode | null): number {
  if (!branch) return laptop.qty;
  if (branch === 'RG') return laptop.rg;
  if (branch === 'NM') return laptop.nm;
  if (branch === 'JSM') return laptop.jsm;
  return laptop.cc;
}

export function getScopedStockStats(
  items: LaptopRecord[],
  activeBranch: BranchCode | null
): { modelCount: number; unitCount: number } {
  let unitCount = 0;
  for (const l of items) {
    unitCount += getLaptopBranchUnitCount(l, activeBranch);
  }
  return {
    modelCount: items.length,
    unitCount,
  };
}

export interface BranchBrandSummary {
  branch: BranchCode | 'ALL';
  totalModels: number;
  totalUnits: number;
  brands: Array<{ brand: string; modelCount: number; unitCount: number }>;
}

export function computeBranchBrandBreakdown(
  laptops: LaptopRecord[],
  branch: BranchCode | 'ALL'
): BranchBrandSummary {
  const brandMap = new Map<string, { models: number; units: number }>();
  let totalModels = 0;
  let totalUnits = 0;

  for (const l of laptops) {
    const qty = branch === 'ALL' ? l.qty : getLaptopBranchUnitCount(l, branch);
    if (qty <= 0) continue;
    totalModels += 1;
    totalUnits += qty;
    const brandName = (l.brand || '').trim() || 'Other';
    const existing = brandMap.get(brandName) || { models: 0, units: 0 };
    existing.models += 1;
    existing.units += qty;
    brandMap.set(brandName, existing);
  }

  const brands = Array.from(brandMap.entries())
    .map(([brand, data]) => ({ brand, modelCount: data.models, unitCount: data.units }))
    .sort((a, b) => b.unitCount - a.unitCount || b.modelCount - a.modelCount || a.brand.localeCompare(b.brand));

  return { branch, totalModels, totalUnits, brands };
}

