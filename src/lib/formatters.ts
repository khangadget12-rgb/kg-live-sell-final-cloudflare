import type { BranchCode, LaptopRecord, MonthlyBranchSalesCounts } from './types';

export function formatCurrency(
  amount: number | null | undefined,
  mode: 'south_asian' | 'international' = 'south_asian'
): string {
  const num = Number.isFinite(Number(amount)) ? Math.round(Number(amount)) : 0;
  const locale = mode === 'south_asian' ? 'en-IN' : 'en-US';
  const sign = num < 0 ? '-' : '';
  return `${sign}৳${Math.abs(num).toLocaleString(locale)}`;
}

/**
 * Formats Looking percentage input so entering "15" becomes "15%",
 * without ever duplicating "%" symbols (e.g. "15%%" -> "15%").
 */
export function formatLookingPercentage(raw: string): string {
  const cleaned = raw.replace(/%/g, '').trim();
  if (!cleaned) return '';
  const match = cleaned.match(/^-?\d+(?:\.\d{0,2})?/);
  if (!match) return '';
  const num = parseFloat(match[0]);
  if (!Number.isFinite(num)) return '';
  const clamped = Math.max(0, Math.min(100, num));
  return `${clamped}%`;
}

export function normalizeLookingWhileTyping(raw: string): string {
  const withoutPercent = raw.replace(/%/g, '');
  const digitsOnly = withoutPercent.replace(/[^\d.]/g, '');
  const parts = digitsOnly.split('.');
  const normalized = parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}` : parts[0];
  if (!normalized) return '';
  return `${normalized}%`;
}

/**
 * Strips ChatGPT / UTM tracking parameters from Google Sheets URLs
 * and ensures only safe http/https URLs are stored or opened.
 */
export function sanitizeSheetUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    const keysToDelete: string[] = [];
    parsed.searchParams.forEach((_val, key) => {
      if (key.toLowerCase().startsWith('utm_') || key.toLowerCase() === 'ref') {
        keysToDelete.push(key);
      }
    });
    for (const k of keysToDelete) {
      parsed.searchParams.delete(k);
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function extractGoogleSheetCsvUrl(rawUrl: string): string | null {
  const clean = sanitizeSheetUrl(rawUrl);
  if (!clean) return null;
  try {
    const parsed = new URL(clean);
    if (!parsed.hostname.endsWith('google.com')) return null;

    if (clean.includes('output=csv') || clean.includes('/export?format=csv') || clean.includes('tqx=out:csv')) {
      return clean;
    }

    const match = parsed.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return null;
    const sheetId = match[1];
    let gid = '0';
    const gidQuery = parsed.searchParams.get('gid');
    if (gidQuery && /^\d+$/.test(gidQuery)) {
      gid = gidQuery;
    } else if (parsed.hash) {
      const gidHash = parsed.hash.match(/gid=(\d+)/);
      if (gidHash) gid = gidHash[1];
    }
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  } catch {
    return null;
  }
}

export function formatLaptopTitle(brand: string, model: string): string {
  const b = (brand || '').trim();
  const m = (model || '').trim();
  if (!b) return m;
  if (!m) return b;
  if (m.toLowerCase().startsWith(b.toLowerCase())) {
    return m;
  }
  return `${b} ${m}`;
}

export function formatQuotationLine(
  index: number,
  laptop: LaptopRecord,
  priceMode: 'discounted' | 'asking',
  currencyMode: 'south_asian' | 'international' = 'south_asian',
  includeSourceSheet = false
): string {
  const price = priceMode === 'asking' ? (laptop.askPrice || laptop.disPrice) : (laptop.disPrice || laptop.askPrice);
  const priceStr = formatCurrency(price, currencyMode);

  const parts: string[] = [
    `${index}.`,
    formatLaptopTitle(laptop.brand, laptop.model),
    laptop.processor,
    laptop.storageConfig && laptop.ramGb ? `${laptop.storageConfig}/${laptop.ramGb}` : laptop.variant,
    laptop.displayRaw,
  ];

  if (laptop.gpu) {
    parts.push(laptop.gpu);
  }
  if (laptop.hasDetachableKeyboard && !laptop.remarks.toLowerCase().includes('detachable')) {
    parts.push('With Detachable Keyboard');
  } else if (laptop.remarks && laptop.remarks.length <= 40 && !laptop.remarks.toLowerCase().includes('cycle')) {
    parts.push(laptop.remarks);
  }

  parts.push(priceStr);
  parts.push(laptop.condition);

  if (includeSourceSheet && laptop.datasetName) {
    parts.push(`[${laptop.datasetName}]`);
  }

  return parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildQuotationText(
  laptops: LaptopRecord[],
  priceMode: 'discounted' | 'asking',
  currencyMode: 'south_asian' | 'international' = 'south_asian',
  includeSourceSheet = false
): string {
  return laptops
    .map((l, idx) => formatQuotationLine(idx + 1, l, priceMode, currencyMode, includeSourceSheet))
    .join('\n');
}

export function formatAdapterKitLabel(rawAdapter: string): string {
  const clean = (rawAdapter || '').replace(/\s+/g, ' ').trim();
  if (!clean) {
    return 'Original Adapter, 3 Pin Cord & Bag';
  }
  const lower = clean.toLowerCase();
  if (lower.includes('inside boxed') || lower.includes('inside_boxed')) {
    return `${clean.replace(/_/g, ' ')} & Bag`;
  }
  if (lower.includes('bag') || lower.includes('3 pin cord')) {
    return clean;
  }
  if (lower.includes('adapter') || lower.includes('charger')) {
    return `${clean}, 3 Pin Cord & Bag`;
  }
  return `${clean} Adapter, 3 Pin Cord & Bag`;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function pad2(n: number): string {
  const num = Math.max(0, Math.floor(n));
  return num < 10 ? `0${num}` : String(num);
}

export function formatLiveSellDateTime(isoOrDate: string | Date, timeZone?: string): {
  dateLine: string;
  monthName: string;
} {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;

  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).formatToParts(valid);
      const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
      const monthIdx = Math.max(0, Math.min(11, Number(get('month')) - 1));
      const day = get('day');
      const year = get('year');
      const hour = get('hour');
      const minute = get('minute');
      const dayPeriod = get('dayPeriod').toUpperCase();
      return {
        dateLine: `${day} ${SHORT_MONTHS[monthIdx]} ${year} | Time: ${hour}:${minute} ${dayPeriod}`,
        monthName: FULL_MONTHS[monthIdx],
      };
    } catch {
      // Fallback below
    }
  }

  const day = valid.getDate();
  const monthIdx = valid.getMonth();
  const year = valid.getFullYear();
  let hours = valid.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const mins = pad2(valid.getMinutes());
  return {
    dateLine: `${day} ${SHORT_MONTHS[monthIdx]} ${year} | Time: ${hours}:${mins} ${ampm}`,
    monthName: FULL_MONTHS[monthIdx],
  };
}

function formatDealTimeLabel(raw: string | undefined): string {
  const clean = (raw || '').trim();
  if (!clean) return '';
  if (/\bmin/i.test(clean)) return clean;
  return `${clean} Min.`;
}

export function buildLiveSellMessage(params: {
  branch: BranchCode;
  soldAt: string;
  laptop: LaptopRecord;
  adapterNote?: string;
  discountPrice?: number;
  sellingPrice: number;
  lookingPct?: string;
  sourceName?: string;
  dealBy?: string;
  assistBy?: string;
  picVideoStatus?: string;
  memoPicStatus?: string;
  dealTime?: string;
  remarks?: string;
  remainingRajshahiQty: number;
  remainingBranchStock?: Partial<Record<BranchCode, number>>;
  monthlyBranchCounts: MonthlyBranchSalesCounts;
  currencyMode?: 'south_asian' | 'international';
  timeZone?: string;
}): string {
  const {
    branch,
    soldAt,
    laptop,
    adapterNote,
    discountPrice,
    sellingPrice,
    lookingPct,
    sourceName,
    dealBy,
    assistBy,
    picVideoStatus,
    memoPicStatus,
    dealTime,
    remarks,
    remainingRajshahiQty,
    remainingBranchStock,
    monthlyBranchCounts,
    currencyMode = 'south_asian',
    timeZone,
  } = params;

  const { dateLine, monthName } = formatLiveSellDateTime(soldAt, timeZone);

  const specParts: string[] = [formatLaptopTitle(laptop.brand, laptop.model)];
  if (laptop.processor) specParts.push(laptop.processor);
  if (laptop.storageConfig && laptop.ramGb) {
    specParts.push(`${laptop.storageConfig}/${laptop.ramGb}`);
  } else if (laptop.variant) {
    specParts.push(laptop.variant);
  }
  if (laptop.displayRaw) {
    specParts.push(laptop.displayRaw);
  }
  const specTextLower = specParts.join(' ').toLowerCase();
  const displayExtras: string[] = [];
  if (laptop.isX360 && !specTextLower.includes('x360')) displayExtras.push('X360');
  if (laptop.isTouch && !specTextLower.includes('touch')) displayExtras.push('G.Touch');
  if (laptop.isOled && !specTextLower.includes('oled')) displayExtras.push('OLED');
  if (displayExtras.length > 0) {
    specParts.push(displayExtras.join(' | '));
  }
  if (laptop.gpu && !specTextLower.includes(laptop.gpu.toLowerCase())) {
    specParts.push(laptop.gpu);
  }
  const specLine = specParts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  const adapterText = (adapterNote || '').trim() || formatAdapterKitLabel(laptop.adapter);
  const withLine = adapterText.toLowerCase().startsWith('with ') ? adapterText : `With ${adapterText}`;

  const effectiveDisPrice = discountPrice && discountPrice > 0
    ? discountPrice
    : laptop.disPrice > 0
    ? laptop.disPrice
    : sellingPrice;

  const disPriceStr = `${formatCurrency(effectiveDisPrice, currencyMode)}/=`;
  const sellPriceStr = `${formatCurrency(sellingPrice, currencyMode)}/=`;
  const entryStr = (laptop.entryDate || '').trim() || 'N/A';
  const locationStr = (laptop.location || '').trim() || 'Rajshahi';

  const safeRemaining = Math.max(0, remainingRajshahiQty);
  const branchParts: string[] = [];
  if (safeRemaining > 0 && remainingBranchStock) {
    const order: BranchCode[] = ['RG', 'NM', 'JSM', 'CC'];
    for (const code of order) {
      const qty = Math.max(0, Number(remainingBranchStock[code] ?? 0));
      if (qty > 0) branchParts.push(`${code}-${qty}`);
    }
  }
  const availableLine =
    branchParts.length > 0
      ? `Available In Rajshahi : ${safeRemaining} Pcs (${branchParts.join(', ')})`
      : `Available In Rajshahi : ${safeRemaining} Pcs`;

  const ccCount = monthlyBranchCounts.CC ?? 0;
  const jsmCount = monthlyBranchCounts.JSM ?? 0;
  const nmCount = monthlyBranchCounts.NM ?? 0;
  const rgCount = monthlyBranchCounts.RG ?? 0;
  const totalMonth = ccCount + jsmCount + nmCount + rgCount;

  const lines: string[] = [
    `Live Sell: ${branch}`,
    dateLine,
    specLine,
    withLine,
    `Discount Price: ${disPriceStr}`,
    `Selling Price: ${sellPriceStr}`,
  ];

  const lookingClean = (lookingPct || '').trim();
  if (lookingClean) lines.push(`Looking : ${lookingClean}`);

  const sourceClean = (sourceName || '').trim();
  if (sourceClean) lines.push(`Source : ${sourceClean}`);

  const dealClean = (dealBy || '').trim();
  if (dealClean) lines.push(`Deal : ${dealClean}`);

  const assistClean = (assistBy || '').trim();
  if (assistClean) lines.push(`Assist : ${assistClean}`);

  const picClean = (picVideoStatus || '').trim();
  if (picClean) lines.push(`Pic & Video : ${picClean}`);

  const memoClean = (memoPicStatus || '').trim();
  if (memoClean) lines.push(`Memo Pic : ${memoClean}`);

  const dealTimeClean = formatDealTimeLabel(dealTime);
  if (dealTimeClean) lines.push(`Deal Time : ${dealTimeClean}`);

  const remarksClean = (remarks || '').trim();
  if (remarksClean) lines.push(`Remarks : ${remarksClean}`);

  lines.push(`Location : ${locationStr}`);
  lines.push(`Entry Date : ${entryStr}`);
  lines.push(availableLine);
  lines.push(`CC Sell: ${pad2(ccCount)} Pcs`);
  lines.push(`JSM Sell: ${pad2(jsmCount)} Pcs`);
  lines.push(`NM Sell: ${pad2(nmCount)} Pcs`);
  lines.push(`RG Sell: ${pad2(rgCount)} Pcs`);
  lines.push(`${monthName} Total Sell Till Now: ${totalMonth} Pcs`);

  return lines.join('\n\n');
}

export function formatDurationShort(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  const remSecs = sec % 60;
  if (hrs > 0) {
    return `${hrs}h ${remMins}m`;
  }
  return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
}
