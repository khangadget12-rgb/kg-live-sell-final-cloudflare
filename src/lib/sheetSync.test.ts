import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLaptopSnapshots, normalizeCsvContent } from './sheetSync';
import type { LaptopRecord } from './types';

function makeLaptop(overrides: Partial<LaptopRecord> = {}): LaptopRecord {
  return {
    id: 'l-1',
    datasetId: 'rajshahi_main',
    rowNo: 1,
    brand: 'Dell',
    model: 'XPS 13 9310',
    variant: 'Core i5-1135G7 256/8',
    category: 'Ultrabook & AI',
    processor: 'Core i5-1135G7',
    cpuGen: 11,
    cpuCoresThreads: '4C/8T',
    ramGb: 8,
    ramType: 'LPDDR4x',
    ramBus: '4266MHz',
    storageGb: 256,
    storageConfig: '256GB NVMe',
    displayRaw: '13.4" FHD+',
    displayInches: 13.4,
    resolution: '1920x1200',
    isTouch: false,
    isX360: false,
    isOled: false,
    refreshHz: 60,
    gpu: 'Intel Iris Xe',
    isDedicatedGpu: false,
    condition: 'Used',
    detailedCondition: 'Mint',
    askPrice: 52000,
    disPrice: 49999,
    borderPrice: 45000,
    rg: 1,
    nm: 1,
    jsm: 0,
    cc: 0,
    qty: 2,
    totalValue: 99998,
    color: 'Silver',
    adapter: 'Dell 65W T-C Adapter',
    batteryBackup: '5h',
    os: 'Windows 11',
    entryDate: '10 November 2026',
    location: 'Rajshahi',
    serialWarranty: '',
    remarks: '',
    hasDetachableKeyboard: false,
    hasSimLte: false,
    hasNpu: false,
    isCleanCondition: true,
    ...overrides,
  };
}

test('normalizeCsvContent ignores CRLF vs LF and trailing whitespace', () => {
  const a = 'Model,RG,NM\r\nDell XPS,1,2  \r\n\r\n';
  const b = 'Model,RG,NM\nDell XPS,1,2\n';
  assert.equal(normalizeCsvContent(a), normalizeCsvContent(b));
});

test('diffLaptopSnapshots reports no changes for identical snapshots', () => {
  const prev = [makeLaptop()];
  const next = [makeLaptop({ id: 'new-id-from-reparse' })];
  const diff = diffLaptopSnapshots(prev, next);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.summary, 'No changes detected');
});

test('diffLaptopSnapshots detects branch stock and price number changes', () => {
  const prev = [makeLaptop({ rg: 2, nm: 1, qty: 3, disPrice: 49999 })];
  const next = [makeLaptop({ rg: 1, nm: 1, qty: 2, disPrice: 47999 })];
  const diff = diffLaptopSnapshots(prev, next);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.updatedCount, 1);
  assert.equal(diff.unitDelta, -1);
});

test('diffLaptopSnapshots detects added and removed models', () => {
  const prev = [makeLaptop({ model: 'XPS 13 9310', qty: 2 })];
  const next = [
    makeLaptop({ model: 'XPS 13 9310', qty: 2 }),
    makeLaptop({ model: 'Latitude 7420', rg: 3, nm: 0, jsm: 0, cc: 0, qty: 3 }),
  ];
  const diffAdded = diffLaptopSnapshots(prev, next);
  assert.equal(diffAdded.hasChanges, true);
  assert.equal(diffAdded.addedCount, 1);
  assert.equal(diffAdded.unitDelta, 3);

  const diffRemoved = diffLaptopSnapshots(next, prev);
  assert.equal(diffRemoved.hasChanges, true);
  assert.equal(diffRemoved.removedCount, 1);
  assert.equal(diffRemoved.unitDelta, -3);
});
