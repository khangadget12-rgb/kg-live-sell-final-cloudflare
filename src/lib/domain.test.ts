import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatCurrency,
  formatLookingPercentage,
  normalizeLookingWhileTyping,
  sanitizeSheetUrl,
  formatQuotationLine,
  buildQuotationText,
  buildLiveSellMessage,
  formatDurationShort,
} from './formatters';
import { parseDelimitedRows, parseRowsToLaptops } from './specParser';
import {
  EMPTY_FILTERS,
  filterLaptops,
  computeInventoryAnalytics,
  resolveEffectiveBranch,
  getScopedStockStats,
  computeBranchBrandBreakdown,
} from './smartSearch';
import { evaluateRefillForLaptop } from './refillLogic';
import { BRANCH_ORDER } from './types';
import type { RefillAlertRecord } from './types';

test('branch order is strictly RG -> NM -> JSM -> CC', () => {
  assert.deepEqual(BRANCH_ORDER, ['RG', 'NM', 'JSM', 'CC']);
});

test('currency formatting supports South Asian and International groupings', () => {
  assert.equal(formatCurrency(150000, 'south_asian'), '৳1,50,000');
  assert.equal(formatCurrency(150000, 'international'), '৳150,000');
  assert.equal(formatCurrency(58999, 'south_asian'), '৳58,999');
});

test('looking percentage auto-formats cleanly without duplicate % symbols', () => {
  assert.equal(formatLookingPercentage('15'), '15%');
  assert.equal(formatLookingPercentage('15%'), '15%');
  assert.equal(formatLookingPercentage('15%%'), '15%');
  assert.equal(normalizeLookingWhileTyping('15%'), '15%');
  assert.equal(normalizeLookingWhileTyping('15%%'), '15%');
  assert.equal(formatLookingPercentage(''), '');
});

test('sanitizeSheetUrl strips chatgpt tracking parameters cleanly', () => {
  const dirty = 'https://docs.google.com/spreadsheets/d/abc123/edit?gid=0&utm_source=chatgpt.com#gid=0';
  const clean = sanitizeSheetUrl(dirty);
  assert.equal(clean.includes('utm_source'), false);
  assert.equal(clean.startsWith('https://docs.google.com/spreadsheets/d/abc123/edit'), true);
});

test('specParser accurately parses real Rajshahi stock sheet with exact totals', () => {
  const csvPath = path.resolve(process.cwd(), 'public/assets/aistudio/KG_Stock__Rajshahi_dcce8414');
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parseDelimitedRows(raw);
  const laptops = parseRowsToLaptops(rows, { datasetId: 'rajshahi' });

  assert.equal(laptops.length, 164);
  const analytics = computeInventoryAnalytics(laptops);
  assert.equal(analytics.totalUnits, 288);
  assert.equal(analytics.branchTotals.RG, 168);
  assert.equal(analytics.branchTotals.NM, 43);
  assert.equal(analytics.branchTotals.JSM, 44);
  assert.equal(analytics.branchTotals.CC, 33);
  assert.equal(analytics.categories.length, 7);
});

test('smart natural-language search parses price, cpu gen, ram, storage, gpu, and display queries', () => {
  const csvPath = path.resolve(process.cwd(), 'public/assets/aistudio/KG_Stock__Rajshahi_dcce8414');
  const laptops = parseRowsToLaptops(parseDelimitedRows(fs.readFileSync(csvPath, 'utf8')), { datasetId: 'rajshahi' });

  const q1 = filterLaptops(laptops, { ...EMPTY_FILTERS, query: 'Under 50k i5 11th Gen' });
  assert.ok(q1.items.length > 0);
  assert.ok(q1.items.every((l) => l.disPrice <= 50000 && l.cpuGen === 11 && l.processor.toLowerCase().includes('i5')));
  assert.ok(q1.recognizedTags.length >= 3);

  const q2 = filterLaptops(laptops, { ...EMPTY_FILTERS, query: 'RTX Gaming' });
  assert.ok(q2.items.length > 0);
  assert.ok(q2.items.every((l) => l.gpu.toLowerCase().includes('rtx')));

  const q3 = filterLaptops(laptops, { ...EMPTY_FILTERS, query: 'Border below 45k' });
  assert.ok(q3.items.length > 0);
  assert.ok(q3.items.every((l) => l.borderPrice > 0 && l.borderPrice <= 45000));

  const q4 = filterLaptops(laptops, { ...EMPTY_FILTERS, query: 'Above 60k Core Ultra 7' });
  assert.ok(q4.items.length > 0);
  assert.ok(q4.items.every((l) => l.disPrice >= 60000 && l.processor.toLowerCase().includes('core ultra 7')));
});

test('advanced finder filters narrow by minimum RAM, CPU generation, display size, OS, and brand', () => {
  const csvPath = path.resolve(process.cwd(), 'public/assets/aistudio/KG_Stock__Rajshahi_dcce8414');
  const laptops = parseRowsToLaptops(parseDelimitedRows(fs.readFileSync(csvPath, 'utf8')), { datasetId: 'rajshahi' });
  const base = laptops[0];
  assert.ok(base);
  const match = { ...base, id: 'advanced-match', brand: 'Dell', ramGb: 16, cpuGen: 11, displayInches: 14, os: 'Windows 11' };
  const wrongBrand = { ...match, id: 'wrong-brand', brand: 'HP' };
  const wrongSpecs = { ...match, id: 'wrong-specs', ramGb: 8, cpuGen: 10, displayInches: 13, os: 'Linux' };
  const result = filterLaptops([match, wrongBrand, wrongSpecs], {
    ...EMPTY_FILTERS,
    brand: 'Dell',
    minRamGb: 16,
    minCpuGen: 11,
    minDisplayInches: 14,
    operatingSystem: 'Windows',
  });
  assert.deepEqual(result.items.map((laptop) => laptop.id), ['advanced-match']);
});

test('branch-scoped stock stats and brand breakdown count only selected branch units', () => {
  const csvPath = path.resolve(process.cwd(), 'public/assets/aistudio/KG_Stock__Rajshahi_dcce8414');
  const laptops = parseRowsToLaptops(parseDelimitedRows(fs.readFileSync(csvPath, 'utf8')), { datasetId: 'rajshahi' });

  const rgState = { ...EMPTY_FILTERS, branch: 'RG' as const };
  const filteredRg = filterLaptops(laptops, rgState);
  const effectiveBranch = resolveEffectiveBranch(rgState);
  assert.equal(effectiveBranch, 'RG');
  const scoped = getScopedStockStats(filteredRg.items, effectiveBranch);
  assert.equal(scoped.unitCount, 168);
  assert.equal(scoped.modelCount, filteredRg.items.length);

  // Natural language branch tag also scopes unit count accurately
  const nlState = { ...EMPTY_FILTERS, query: 'CC' };
  const filteredCc = filterLaptops(laptops, nlState);
  const ccBranch = resolveEffectiveBranch(nlState);
  assert.equal(ccBranch, 'CC');
  const ccScoped = getScopedStockStats(filteredCc.items, ccBranch);
  assert.equal(ccScoped.unitCount, 33);

  // Brand breakdown sums exactly to branch total
  const ccBreakdown = computeBranchBrandBreakdown(laptops, 'CC');
  assert.equal(ccBreakdown.totalUnits, 33);
  assert.equal(
    ccBreakdown.brands.reduce((s, b) => s + b.unitCount, 0),
    33
  );
});

test('quotation formatter outputs direct numbered lines without banner header or === divider', () => {
  const csvPath = path.resolve(process.cwd(), 'public/assets/aistudio/KG_Stock__Rajshahi_dcce8414');
  const laptops = parseRowsToLaptops(parseDelimitedRows(fs.readFileSync(csvPath, 'utf8')), { datasetId: 'rajshahi' });
  const thinkpad = laptops.find((l) => l.model.includes('ThinkPad E590'));
  assert.ok(thinkpad);
  const line = formatQuotationLine(1, thinkpad, 'discounted', 'south_asian');
  assert.ok(line.startsWith('1. Lenovo ThinkPad E590'));
  assert.ok(line.includes('৳26,999'));
  assert.ok(line.includes('Used'));

  const directQuote = buildQuotationText([thinkpad], 'discounted', 'south_asian');
  assert.equal(directQuote.startsWith('1. Lenovo ThinkPad E590'), true);
  assert.equal(directQuote.includes('Customer Quotation'), false);
  assert.equal(directQuote.includes('====='), false);
});

test('live sell formatter outputs exact branch codename, composer fields, location, rajshahi stock breakdown, and monthly branch totals', () => {
  const sampleLaptop = {
    id: 'l-xps',
    datasetId: 'rajshahi_main',
    rowNo: 1,
    brand: 'Dell',
    model: 'XPS 13 9310 - (Silver_Metal)',
    variant: '256/8',
    category: 'Ultrabook & AI' as const,
    processor: 'Core i5-1135G7',
    cpuGen: 11,
    cpuCoresThreads: '4/8',
    ramGb: 8,
    ramType: 'LPDDR4x',
    ramBus: 'LPDDR4x',
    storageGb: 256,
    storageConfig: '256',
    displayRaw: '13.4" (1920x1200)',
    displayInches: 13.4,
    resolution: '1920x1200',
    isTouch: false,
    isX360: false,
    isOled: false,
    refreshHz: 60,
    gpu: '',
    isDedicatedGpu: false,
    condition: 'Used' as const,
    detailedCondition: '',
    askPrice: 55000,
    disPrice: 49999,
    borderPrice: 46000,
    rg: 1,
    nm: 1,
    jsm: 0,
    cc: 0,
    qty: 2,
    totalValue: 99998,
    color: 'Silver_Metal',
    adapter: 'Dell 65W T-C Adapter, 3 Pin Cord, 14" KB Protective & Bag',
    batteryBackup: '',
    os: '',
    entryDate: '10 November 2026',
    location: 'Rajshahi',
    serialWarranty: '',
    remarks: '',
    hasDetachableKeyboard: false,
    hasSimLte: false,
    hasNpu: false,
    isCleanCondition: true,
  };

  const msg = buildLiveSellMessage({
    branch: 'CC',
    soldAt: '2026-11-21T15:00:00.000Z',
    timeZone: 'Asia/Dhaka',
    laptop: sampleLaptop,
    discountPrice: 49999,
    sellingPrice: 50000,
    lookingPct: '90%',
    sourceName: 'Pre Cust Reffer',
    customerLocation: 'Shaheb Bazar, Rajshahi',
    dealBy: 'Sozib',
    picVideoStatus: 'Sent',
    memoPicStatus: 'Sent',
    dealTime: '110',
    remainingRajshahiQty: 2,
    remainingBranchStock: { RG: 1, NM: 1, JSM: 0, CC: 0 },
    monthlyBranchCounts: { CC: 2, JSM: 6, NM: 22, RG: 83 },
    currencyMode: 'international',
  });

  const expected = [
    'Live Sell: CC',
    '21 Nov 2026 | Time: 9:00 PM',
    'Dell XPS 13 9310 - (Silver_Metal) Core i5-1135G7 256/8 13.4" (1920x1200)',
    'With Dell 65W T-C Adapter, 3 Pin Cord, 14" KB Protective & Bag',
    'Discount Price: ৳49,999/=',
    'Selling Price: ৳50,000/=',
    'Looking : 90%',
    'Source : Pre Cust Reffer',
    'Deal : Sozib',
    'Pic & Video : Sent',
    'Memo Pic : Sent',
    'Deal Time : 110 Min.',
    'Customer Location : Shaheb Bazar, Rajshahi',
    'Location : Rajshahi',
    'Entry Date : 10 November 2026',
    'Available In Rajshahi : 2 Pcs (RG-1, NM-1)',
    'CC Sell: 02 Pcs',
    'JSM Sell: 06 Pcs',
    'NM Sell: 22 Pcs',
    'RG Sell: 83 Pcs',
    'November Total Sell Till Now: 113 Pcs',
  ].join('\n\n');

  assert.equal(msg, expected);
  assert.equal(formatDurationShort(3725), '1h 2m');
});

test('refill alert triggers when branch hits 0 and others > 1, suppresses duplicates, and re-arms on restock', () => {
  const baseLaptop = {
    id: 'l-1',
    datasetId: 'main',
    rowNo: 1,
    brand: 'Dell',
    model: 'Latitude 5420',
    variant: 'i5 / 16GB',
    category: 'Business Pro' as const,
    processor: 'Core i5-1145G7',
    cpuGen: 11,
    cpuCoresThreads: '4/8',
    ramGb: 16,
    ramType: 'DDR4',
    ramBus: 'DDR4-3200',
    storageGb: 256,
    storageConfig: '256',
    displayRaw: '14" (1920x1080)',
    displayInches: 14,
    resolution: '1920x1080',
    isTouch: false,
    isX360: false,
    isOled: false,
    refreshHz: 60,
    gpu: '',
    isDedicatedGpu: false,
    condition: 'Used' as const,
    detailedCondition: '',
    askPrice: 43000,
    disPrice: 42000,
    borderPrice: 40000,
    rg: 0,
    nm: 2,
    jsm: 1,
    cc: 0,
    qty: 3,
    totalValue: 126000,
    color: '',
    adapter: '',
    batteryBackup: '',
    os: '',
    entryDate: '',
    location: '',
    serialWarranty: '',
    remarks: '',
    hasDetachableKeyboard: false,
    hasSimLte: false,
    hasNpu: false,
    isCleanCondition: true,
  };

  // Initial stock-out at RG (0) while others have 3 (>1). Note CC is also 0 while others have 3!
  const eval1 = evaluateRefillForLaptop(baseLaptop, []);
  assert.equal(eval1.toTrigger.length, 2); // RG and CC both have 0 while others have 3

  // When an active alert already exists for RG and CC, no repeated alert is triggered
  const existingAlerts: RefillAlertRecord[] = eval1.toTrigger.map((t, idx) => ({
    id: idx + 1,
    ...t,
    status: 'active',
    triggeredAt: '2026-11-21T09:00:00Z',
    resolvedAt: null,
    resolvedBy: null,
  }));
  const eval2 = evaluateRefillForLaptop(baseLaptop, existingAlerts);
  assert.equal(eval2.toTrigger.length, 0);

  // Restock RG to 1 -> RG alert resolves (re-arms)
  const restocked = { ...baseLaptop, rg: 1, qty: 4 };
  const eval3 = evaluateRefillForLaptop(restocked, existingAlerts);
  assert.equal(eval3.toResolveIds.length, 1);
  assert.equal(eval3.toResolveIds[0], 1);

  // RG runs out again after being resolved -> triggers fresh alert
  const afterResolve: RefillAlertRecord[] = existingAlerts.map((a) =>
    a.id === 1 ? { ...a, status: 'resolved', resolvedAt: '2026-11-21T10:00:00Z' } : a
  );
  const eval4 = evaluateRefillForLaptop(baseLaptop, afterResolve);
  assert.equal(eval4.toTrigger.length, 1);
  assert.equal(eval4.toTrigger[0].exhaustedBranch, 'RG');
});
