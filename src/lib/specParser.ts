import type { BranchCode, LaptopCategory, LaptopCondition, LaptopRecord } from './types';

/**
 * Parses CSV or TSV text into a 2D array of trimmed strings, handling quoted cells and newlines.
 */
export function parseDelimitedRows(text: string, delimiter?: ',' | '\t'): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const detectedDelimiter = delimiter ?? detectDelimiter(clean);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === detectedDelimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows;
}

function detectDelimiter(sample: string): ',' | '\t' {
  const firstLine = sample.split(/\r?\n/)[0] ?? '';
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  return tabCount > commaCount ? '\t' : ',';
}

export function parsePrice(raw: string | number | undefined): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : 0;
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[৳,\s]/g, '').replace(/[^\d.-]/g, '');
  if (!cleaned) return 0;
  const val = parseFloat(cleaned);
  return Number.isFinite(val) && val >= 0 ? Math.round(val) : 0;
}

export function parseBorderPrice(raw: string | number | undefined): number {
  if (!raw && raw !== 0) return 0;
  const cleaned = String(raw).replace(/[৳,\s]/g, '').replace(/[^\d.]/g, '');
  if (!cleaned) return 0;
  const val = parseFloat(cleaned);
  if (!Number.isFinite(val) || val <= 0) return 0;
  // Sheets store Border in thousands (e.g. 58 = ৳58,000; 22.5 = ৳22,500)
  return val < 1000 ? Math.round(val * 1000) : Math.round(val);
}

export function parseStorageAndRam(romRamRaw: string): {
  storageGb: number;
  storageConfig: string;
  ramGb: number;
} {
  const raw = (romRamRaw ?? '').trim();
  if (!raw) return { storageGb: 0, storageConfig: '', ramGb: 0 };

  const tokens = raw.split('/').map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return { storageGb: 0, storageConfig: '', ramGb: 0 };

  const parseTokenGb = (tok: string): number => {
    const upper = tok.toUpperCase();
    const num = parseFloat(upper.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(num)) return 0;
    if (upper.includes('TB')) return Math.round(num * 1024);
    return Math.round(num);
  };

  if (tokens.length === 1) {
    const val = parseTokenGb(tokens[0]);
    return { storageGb: val, storageConfig: tokens[0], ramGb: 0 };
  }

  const ramGb = parseTokenGb(tokens[tokens.length - 1]);
  const storageTokens = tokens.slice(0, -1);
  const storageGb = storageTokens.reduce((acc, tok) => acc + parseTokenGb(tok), 0);
  const storageConfig = storageTokens.join('+');

  return { storageGb, storageConfig, ramGb };
}

export function extractCpuGeneration(processor: string): number | null {
  const p = processor ?? '';
  const explicitGen = p.match(/(\d{1,2})(?:th|st|nd|rd)\s*gen/i);
  if (explicitGen) return parseInt(explicitGen[1], 10);

  // Intel Core Ultra 1xx = 14th, 2xx = 15th, 3xx = 16th
  const ultra = p.match(/Core\s+Ultra\s+\d\s+(\d)\d{2}/i);
  if (ultra) {
    const series = parseInt(ultra[1], 10);
    if (series === 1) return 14;
    if (series === 2) return 15;
    if (series === 3) return 16;
  }

  // Core 5 120U / Core 5 210H / Core 7 240H
  const coreSeries = p.match(/Core\s+[3579]\s+(\d)\d{2}/i);
  if (coreSeries) {
    const series = parseInt(coreSeries[1], 10);
    return 13 + series;
  }

  // Intel Core i3/i5/i7/i9-1135G7 or 1335U or 10210U or 8665U
  const intel = p.match(/i[3579][-\s]?(\d{4,5})/i);
  if (intel) {
    const code = intel[1];
    if (/^(10|11|12|13|14|15)/.test(code)) return parseInt(code.slice(0, 2), 10);
    return parseInt(code.slice(0, 1), 10);
  }

  // AMD Ryzen X-5650U / 7535U / 8940HX
  const ryzen = p.match(/Ryzen\s+(?:AI\s+)?\d(?:\s+Pro)?[-\s]+(\d)\d{3}/i);
  if (ryzen) {
    return parseInt(ryzen[1], 10);
  }

  return null;
}

export function parseDisplaySpecs(displayRaw: string): {
  displayInches: number | null;
  resolution: string;
  isTouch: boolean;
  isX360: boolean;
  isOled: boolean;
  refreshHz: number | null;
} {
  const raw = displayRaw ?? '';
  const sizeMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:""|"|''|”|inch)/i);
  const displayInches = sizeMatch ? parseFloat(sizeMatch[1]) : null;
  const resMatch = raw.match(/(\d{3,4}\s*[x×]\s*\d{3,4})/i);
  const resolution = resMatch ? resMatch[1].replace(/\s+/g, '').replace('×', 'x') : '';
  const lower = raw.toLowerCase();
  const isTouch = lower.includes('touch') || lower.includes('g.touch') || lower.includes('x360');
  const isX360 = lower.includes('x360');
  const isOled = lower.includes('oled');
  const hzMatch = raw.match(/(\d{2,3})\s*hz/i);
  const refreshHz = hzMatch ? parseInt(hzMatch[1], 10) : null;

  return { displayInches, resolution, isTouch, isX360, isOled, refreshHz };
}

export function parseRamBus(ramBusRaw: string): { ramType: string; ramBus: string } {
  const raw = (ramBusRaw ?? '').trim();
  if (!raw || raw === '-') return { ramType: '', ramBus: '' };
  const upper = raw.toUpperCase();
  let ramType = '';
  if (upper.includes('LPDDR5X')) ramType = 'LPDDR5X';
  else if (upper.includes('LPDDR5')) ramType = 'LPDDR5';
  else if (upper.includes('LPDDR4')) ramType = 'LPDDR4';
  else if (upper.includes('LPDDR3')) ramType = 'LPDDR3';
  else if (upper.includes('DDR5') || upper.includes('DRR5')) ramType = 'DDR5';
  else if (upper.includes('DDR4')) ramType = 'DDR4';
  else if (upper.includes('DDR3')) ramType = 'DDR3';

  return { ramType, ramBus: raw };
}

export function extractColorFromModel(model: string): { cleanModel: string; color: string } {
  const m = (model ?? '').trim();
  const parenMatches = [...m.matchAll(/\(([^)]+)\)/g)];
  if (parenMatches.length > 0) {
    const last = parenMatches[parenMatches.length - 1];
    const candidate = last[1].trim();
    if (!/^(2-in-1|\d{4}|fabric|gen\s*\d+)/i.test(candidate)) {
      return { cleanModel: m, color: candidate.replace(/_/g, ' ') };
    }
  }
  return { cleanModel: m, color: '' };
}

export function normalizeCondition(raw: string): LaptopCondition {
  const lower = (raw ?? '').trim().toLowerCase();
  if (lower.includes('intact') || lower.includes('brand new')) return 'Intact';
  if (lower.includes('open') || lower.includes('opend')) return 'Open Box';
  return 'Used';
}

export function categorizeLaptop(params: {
  brand: string;
  model: string;
  processor: string;
  gpu: string;
  displayRaw: string;
  remarks: string;
  disPrice: number;
  hasNpu: boolean;
  hasDetachableKeyboard: boolean;
  isX360: boolean;
}): LaptopCategory {
  const combined = `${params.brand} ${params.model} ${params.processor} ${params.gpu} ${params.displayRaw} ${params.remarks}`.toLowerCase();

  if (
    combined.includes('tablet') ||
    combined.includes('thinksmart') ||
    combined.includes('imac') ||
    combined.includes('surface pro') ||
    combined.includes('surface go') ||
    combined.includes('ideapad d330') ||
    params.hasDetachableKeyboard
  ) {
    if (combined.includes('surface book') || combined.includes('2-in-1')) {
      return '2-in-1 / Convertible';
    }
    return 'Tablet & Other';
  }

  if (
    combined.includes('rtx') ||
    combined.includes('gtx') ||
    combined.includes('rog') ||
    combined.includes('tuf') ||
    combined.includes('omen') ||
    combined.includes('legion') ||
    combined.includes('loq') ||
    combined.includes('nitro') ||
    combined.includes('cyborg') ||
    combined.includes('alienware') ||
    combined.includes('pavilion gaming') ||
    combined.includes('dell g7')
  ) {
    return 'Gaming & RTX';
  }

  if (
    combined.includes('workstation') ||
    combined.includes('zbook') ||
    combined.includes('precision') ||
    combined.includes('quadro') ||
    combined.includes('t1200') ||
    combined.includes('t1000') ||
    combined.includes('t500') ||
    combined.includes('radeon pro') ||
    combined.includes('macbook pro')
  ) {
    return 'Workstation & Creator';
  }

  if (
    params.isX360 ||
    combined.includes('2-in-1') ||
    combined.includes('yoga') ||
    combined.includes('flip') ||
    combined.includes('dragonfly') ||
    combined.includes('x360')
  ) {
    return '2-in-1 / Convertible';
  }

  if (
    params.hasNpu ||
    combined.includes('core ultra') ||
    combined.includes('ryzen ai') ||
    combined.includes('omnibook') ||
    combined.includes('zenbook') ||
    combined.includes('xps') ||
    combined.includes('gram') ||
    combined.includes('macbook air') ||
    combined.includes('x1 carbon') ||
    combined.includes('x1 nano') ||
    combined.includes('surface laptop') ||
    combined.includes('matebook') ||
    combined.includes('redmibook') ||
    combined.includes('pavilion aero')
  ) {
    return 'Ultrabook & AI';
  }

  if (
    combined.includes('celeron') ||
    combined.includes('pentium') ||
    combined.includes('i3-') ||
    combined.includes('ryzen 3') ||
    (params.disPrice > 0 && params.disPrice < 32000)
  ) {
    return 'Budget & Everyday';
  }

  return 'Business Pro';
}

export interface SheetParseOptions {
  datasetId: string;
  defaultBranch?: BranchCode | null;
}

/**
 * Automatically recognizes columns from Khan Gadget CSV/TSV/XLSX sheets
 * and parses them into normalized LaptopRecord objects.
 */
export function parseRowsToLaptops(
  rows: string[][],
  options: SheetParseOptions
): LaptopRecord[] {
  if (rows.length < 2) return [];

  // Find header row (looks for Brand and Model columns)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const lowerRow = rows[i].map((c) => c.toLowerCase());
    if (lowerRow.some((c) => c === 'brand') && lowerRow.some((c) => c === 'model')) {
      headerIdx = i;
      break;
    }
  }

  const headers = rows[headerIdx].map((h) => h.trim().toLowerCase());
  const findCol = (...candidates: string[]): number => {
    for (const cand of candidates) {
      const idx = headers.findIndex((h) => h === cand || h.includes(cand));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const colNo = findCol('no');
  const colBrand = findCol('brand');
  const colModel = findCol('model');
  const colProc = findCol('processor', 'cpu');
  const colRomRam = findCol('rom/ram', 'storage', 'ram');
  const colDisplay = findCol('display');
  const colGpu = findCol('dedicated graphics', 'graphics', 'gpu');
  const colRemarks = findCol('remarks');
  const colAsk = findCol('ask. price', 'asking', 'ask');
  const colDis = findCol('dis. price', 'discounted', 'dis');
  const colBorder = findCol('border');
  const colRg = headers.findIndex((h) => h === 'rg');
  const colNm = headers.findIndex((h) => h === 'nm');
  const colJsm = headers.findIndex((h) => h === 'jsm');
  const colCc = headers.findIndex((h) => h === 'cc');
  const colQty = findCol('qty', 'quantity');
  const colCond = headers.findIndex((h) => h === 'condition');
  const colDetailCond = findCol('detailed condition');
  const colEntry = findCol('entry');
  const colLocation = findCol('location');
  const colRamBus = findCol('ram/bus', 'ram bus');
  const colTotalValue = findCol('total value');
  const colBattery = findCol('battery backup', 'battery');
  const colCores = findCol('base-turbo', 'core/thread');
  const colAdapter = findCol('adapter');
  const colRough = findCol('rough');

  const hasFourBranchCols = colRg !== -1 && colNm !== -1 && colJsm !== -1 && colCc !== -1;

  const results: LaptopRecord[] = [];
  let seq = 1;

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const brand = (colBrand !== -1 ? row[colBrand] : '')?.trim() ?? '';
    const model = (colModel !== -1 ? row[colModel] : '')?.trim() ?? '';
    if (!brand || !model) continue;
    if (brand.toLowerCase() === 'total' || model.toLowerCase().startsWith('total')) continue;

    const rowNoRaw = colNo !== -1 ? parseInt(row[colNo] ?? '', 10) : NaN;
    const rowNo = Number.isFinite(rowNoRaw) ? rowNoRaw : seq;

    const processor = (colProc !== -1 ? row[colProc] : '')?.trim() ?? '';
    const romRamRaw = (colRomRam !== -1 ? row[colRomRam] : '')?.trim() ?? '';
    const displayRaw = (colDisplay !== -1 ? row[colDisplay] : '')?.trim() ?? '';
    const gpu = (colGpu !== -1 ? row[colGpu] : '')?.trim() ?? '';
    const remarks = (colRemarks !== -1 ? row[colRemarks] : '')?.trim() ?? '';
    const askPrice = parsePrice(colAsk !== -1 ? row[colAsk] : '');
    const disPrice = parsePrice(colDis !== -1 ? row[colDis] : '');
    const borderPrice = parseBorderPrice(colBorder !== -1 ? row[colBorder] : '');
    const condition = normalizeCondition(colCond !== -1 ? row[colCond] ?? '' : 'Used');
    const detailedCondition = (colDetailCond !== -1 ? row[colDetailCond] : '')?.trim() ?? '';
    const entryDate = (colEntry !== -1 ? row[colEntry] : '')?.trim() ?? '';
    const location = (colLocation !== -1 ? row[colLocation] : '')?.trim() ?? '';
    const ramBusRaw = (colRamBus !== -1 ? row[colRamBus] : '')?.trim() ?? '';
    const batteryBackup = (colBattery !== -1 ? row[colBattery] : '')?.trim() ?? '';
    const cpuCoresThreads = (colCores !== -1 ? row[colCores] : '')?.trim() ?? '';
    const adapter = (colAdapter !== -1 ? row[colAdapter] : '')?.trim() ?? '';
    const serialWarranty = (colRough !== -1 ? row[colRough] : '')?.trim() ?? '';

    const parseIntSafe = (val: string | undefined): number => {
      const n = parseInt((val ?? '').replace(/[^\d-]/g, ''), 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    let rg = 0;
    let nm = 0;
    let jsm = 0;
    let cc = 0;
    let qty = parseIntSafe(colQty !== -1 ? row[colQty] : '0');

    if (hasFourBranchCols) {
      rg = parseIntSafe(row[colRg]);
      nm = parseIntSafe(row[colNm]);
      jsm = parseIntSafe(row[colJsm]);
      cc = parseIntSafe(row[colCc]);
      const branchSum = rg + nm + jsm + cc;
      if (qty === 0 && branchSum > 0) qty = branchSum;
      else if (branchSum > 0) qty = branchSum;
    } else {
      const def = options.defaultBranch ?? 'RG';
      if (def === 'RG') rg = qty;
      if (def === 'NM') nm = qty;
      if (def === 'JSM') jsm = qty;
      if (def === 'CC') cc = qty;
    }

    const totalValueRaw = parsePrice(colTotalValue !== -1 ? row[colTotalValue] : '');
    const totalValue = totalValueRaw > 0 ? totalValueRaw : (disPrice || askPrice) * qty;

    const { storageGb, storageConfig, ramGb } = parseStorageAndRam(romRamRaw);
    const cpuGen = extractCpuGeneration(processor);
    const { displayInches, resolution, isTouch, isX360, isOled, refreshHz } = parseDisplaySpecs(displayRaw);
    const { ramType, ramBus } = parseRamBus(ramBusRaw);
    const { cleanModel, color } = extractColorFromModel(model);

    const combinedText = `${model} ${processor} ${gpu} ${remarks} ${detailedCondition}`.toLowerCase();
    const hasDetachableKeyboard = combinedText.includes('detachable');
    const hasSimLte = combinedText.includes('sim') || combinedText.includes('lte') || combinedText.includes('esim');
    const hasNpu = combinedText.includes('npu') || combinedText.includes('ai') || combinedText.includes('core ultra') || combinedText.includes('copilot');
    const isCleanCondition = detailedCondition.length === 0 || (!/scratch|dent|fungus|crack|spot|issue|broken|fade|unfresh|dot|missing|pixel|fata|nosto/i.test(detailedCondition));
    const isDedicatedGpu = Boolean(gpu && /nvidia|rtx|gtx|radeon|quadro|t1200|t1000|t500|mx\d+|940mx/i.test(gpu));

    const category = categorizeLaptop({
      brand,
      model: cleanModel,
      processor,
      gpu,
      displayRaw,
      remarks,
      disPrice: disPrice || askPrice,
      hasNpu,
      hasDetachableKeyboard,
      isX360,
    });

    const variantParts = [
      processor ? processor.split('(')[0].trim() : '',
      ramGb ? `${ramGb}GB` : '',
      storageConfig ? `${storageConfig}` : '',
    ].filter(Boolean);
    const variant = variantParts.join(' / ');

    results.push({
      id: `${options.datasetId}__${seq}`,
      datasetId: options.datasetId,
      rowNo,
      brand: brand.trim(),
      model: cleanModel.replace(/\s+/g, ' ').trim(),
      variant,
      category,
      processor,
      cpuGen,
      cpuCoresThreads,
      ramGb,
      ramType,
      ramBus,
      storageGb,
      storageConfig,
      displayRaw,
      displayInches,
      resolution,
      isTouch,
      isX360,
      isOled,
      refreshHz,
      gpu,
      isDedicatedGpu,
      condition,
      detailedCondition,
      askPrice,
      disPrice,
      borderPrice,
      rg,
      nm,
      jsm,
      cc,
      qty,
      totalValue,
      color,
      adapter,
      batteryBackup,
      os: /win-?11/i.test(serialWarranty) ? 'Windows 11' : /without os|no os/i.test(serialWarranty) ? 'No OS' : /android/i.test(detailedCondition) ? 'Android' : /macbook|imac/i.test(cleanModel) ? 'macOS' : '',
      entryDate,
      location,
      serialWarranty,
      remarks,
      hasDetachableKeyboard,
      hasSimLte,
      hasNpu,
      isCleanCondition,
    });
    seq++;
  }

  return results;
}
