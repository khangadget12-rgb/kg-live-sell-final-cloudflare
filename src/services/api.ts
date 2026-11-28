import type {
  AccessoryCategory,
  AccessoryRecord,
  AuditLogRecord,
  BranchCode,
  DatasetSummary,
  GoogleSheetRecord,
  LaptopRecord,
  MonthlyBranchSalesCounts,
  NotificationRecord,
  RajshahiSyncStatus,
  RealtimeSyncEvent,
  RefillAlertRecord,
  SaleRecord,
  SessionLogRecord,
  UserAccount,
  UserPreferences,
  UserRole,
  UserSessionSummary,
} from '../lib/types';

// In-memory Bearer token (never persisted in localStorage/sessionStorage)
let memoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

const OFFLINE_DATASETS_KEY = 'kg_offline_datasets_v1';
const OFFLINE_LAPTOPS_PREFIX = 'kg_offline_laptops_v1_';

export function cacheDatasetsOffline(datasets: DatasetSummary[]): void {
  try {
    localStorage.setItem(OFFLINE_DATASETS_KEY, JSON.stringify(datasets));
  } catch {
    // Ignore storage quota errors
  }
}

export function getOfflineDatasets(): DatasetSummary[] {
  try {
    const raw = localStorage.getItem(OFFLINE_DATASETS_KEY);
    return raw ? (JSON.parse(raw) as DatasetSummary[]) : [];
  } catch {
    return [];
  }
}

export function cacheLaptopsOffline(datasetId: string, laptops: LaptopRecord[]): void {
  try {
    localStorage.setItem(`${OFFLINE_LAPTOPS_PREFIX}${datasetId}`, JSON.stringify(laptops));
  } catch {
    // Ignore storage quota errors
  }
}

export function getOfflineLaptops(datasetId: string): LaptopRecord[] {
  try {
    const raw = localStorage.getItem(`${OFFLINE_LAPTOPS_PREFIX}${datasetId}`);
    return raw ? (JSON.parse(raw) as LaptopRecord[]) : [];
  } catch {
    return [];
  }
}

async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Requested-With', 'KG-Live-Sell');
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getSyncVersion: () => apiFetch<{ syncVersion: number }>('/api/sync/version'),

  bootstrapStatus: () => apiFetch<{ needsSetup: boolean; hasEnvOverride: boolean }>('/api/auth/bootstrap-status'),

  session: () => apiFetch<{ user: UserAccount | null; needsSetup: boolean; hasEnvOverride: boolean }>('/api/auth/session'),

  setupSuperAdmin: (payload: { fullName: string; username: string; email: string; password: string }) =>
    apiFetch<{ token: string; user: UserAccount }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (identifier: string, password: string) =>
    apiFetch<{ token: string; user: UserAccount }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),

  logout: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  heartbeat: (isActive: boolean) =>
    apiFetch<{ ok: boolean }>('/api/auth/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ isActive }),
      keepalive: true,
    }),

  me: () => apiFetch<{ user: UserAccount }>('/api/auth/me'),

  updateMyPreferences: (payload: { preferences?: Partial<UserPreferences>; preferredSheetId?: number | null }) =>
    apiFetch<{ user: UserAccount }>('/api/users/me/preferences', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  listUsers: () => apiFetch<{ users: UserAccount[] }>('/api/users'),

  createUser: (payload: {
    username: string;
    password: string;
    role: UserRole;
    fullName?: string;
    email?: string;
    assignedBranch?: BranchCode | 'ALL';
    receiveNotifications?: boolean;
  }) =>
    apiFetch<{ user: UserAccount }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateUser: (
    id: number,
    payload: Partial<{
      fullName: string;
      email: string;
      role: UserRole;
      assignedBranch: BranchCode | 'ALL';
      isActive: boolean;
      receiveNotifications: boolean;
      password: string;
    }>
  ) =>
    apiFetch<{ user: UserAccount }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteUser: (id: number) => apiFetch<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),

  listSheets: () => apiFetch<{ sheets: GoogleSheetRecord[] }>('/api/sheets'),

  createSheet: (payload: { name: string; branchLabel: string; url: string; isAvailable: boolean }) =>
    apiFetch<{ id: number }>('/api/sheets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSheet: (id: number, payload: Partial<GoogleSheetRecord>) =>
    apiFetch<{ ok: boolean }>(`/api/sheets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteSheet: (id: number) => apiFetch<{ ok: boolean }>(`/api/sheets/${id}`, { method: 'DELETE' }),

  getOperationalLaptops: async () => {
    try {
      const res = await apiFetch<{ datasetId: string; laptops: LaptopRecord[] }>('/api/laptops/operational');
      cacheLaptopsOffline(res.datasetId, res.laptops);
      return res;
    } catch (err) {
      if (!navigator.onLine) {
        const cached = getOfflineLaptops('rajshahi_main');
        if (cached.length > 0) return { datasetId: 'rajshahi_main', laptops: cached };
      }
      throw err;
    }
  },

  adjustStock: (payload: { laptopId: string; rg: number; nm: number; jsm: number; cc: number }) =>
    apiFetch<{ laptop: LaptopRecord; triggeredRefills: Array<{ exhaustedBranch: BranchCode; otherBranchesQty: number }> }>(
      '/api/inventory/adjust',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  listDatasets: async () => {
    try {
      const res = await apiFetch<{ datasets: DatasetSummary[] }>('/api/datasets');
      cacheDatasetsOffline(res.datasets);
      return res;
    } catch (err) {
      if (!navigator.onLine) {
        const cached = getOfflineDatasets();
        if (cached.length > 0) return { datasets: cached };
      }
      throw err;
    }
  },

  getOutsideRajshahiLaptops: async () => {
    try {
      const res = await apiFetch<{ laptops: LaptopRecord[] }>('/api/datasets/outside-rajshahi');
      cacheLaptopsOffline('outside_rajshahi', res.laptops);
      return res;
    } catch (err) {
      if (!navigator.onLine) {
        const cached = getOfflineLaptops('outside_rajshahi');
        if (cached.length > 0) return { laptops: cached };
      }
      throw err;
    }
  },

  getDatasetLaptops: async (datasetId: string) => {
    try {
      const res = await apiFetch<{ laptops: LaptopRecord[] }>(`/api/datasets/${encodeURIComponent(datasetId)}/laptops`);
      cacheLaptopsOffline(datasetId, res.laptops);
      return res;
    } catch (err) {
      if (!navigator.onLine) {
        const cached = getOfflineLaptops(datasetId);
        if (cached.length > 0) return { laptops: cached };
      }
      throw err;
    }
  },

  importDatasetFile: (payload: { name: string; filename: string; contentBase64: string; defaultBranch: BranchCode }) =>
    apiFetch<{ datasetId: string; modelCount: number; totalUnits: number }>('/api/datasets/import-file', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  importDatasetSheet: (payload: { name: string; url: string; defaultBranch: BranchCode }) =>
    apiFetch<{ datasetId: string; modelCount: number; totalUnits: number }>('/api/datasets/import-sheet', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  refreshDataset: (id: string) =>
    apiFetch<{ modelCount: number; totalUnits: number; importedAt: string; summary?: string; changed?: boolean }>(
      `/api/datasets/${encodeURIComponent(id)}/refresh`,
      { method: 'POST' }
    ),

  reloadRajshahi: () =>
    apiFetch<{ modelCount: number; totalUnits: number }>('/api/datasets/reload-rajshahi', { method: 'POST' }),

  deleteDataset: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/datasets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getRajshahiSyncStatus: () => apiFetch<{ status: RajshahiSyncStatus }>('/api/sheets/rajshahi-sync'),

  updateRajshahiSyncConfig: (payload: {
    sheetUrl?: string;
    autoScanEnabled?: boolean;
    intervalSeconds?: number;
    scanNow?: boolean;
  }) =>
    apiFetch<{
      status: RajshahiSyncStatus;
      syncResult: {
        changed: boolean;
        status: RajshahiSyncStatus;
        modelCount: number;
        totalUnits: number;
        summary: string;
      } | null;
    }>('/api/sheets/rajshahi-sync/config', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  triggerRajshahiSync: () =>
    apiFetch<{
      changed: boolean;
      status: RajshahiSyncStatus;
      modelCount: number;
      totalUnits: number;
      summary: string;
    }>('/api/sheets/rajshahi-sync/trigger', { method: 'POST' }),

  getMonthlyBranchCounts: (soldAt?: string, timeZone?: string) => {
    const sp = new URLSearchParams();
    if (soldAt) sp.set('soldAt', soldAt);
    if (timeZone) sp.set('timeZone', timeZone);
    const qs = sp.toString();
    return apiFetch<{ counts: MonthlyBranchSalesCounts }>(`/api/sales/monthly-counts${qs ? `?${qs}` : ''}`);
  },

  calibrateMonthlyBranchCounts: (payload: {
    soldAt?: string;
    timeZone?: string;
    counts: MonthlyBranchSalesCounts;
  }) =>
    apiFetch<{ monthKey: string; timeZone: string; counts: MonthlyBranchSalesCounts }>(
      '/api/sales/monthly-counts/calibrate',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  createSale: (payload: {
    branch: BranchCode;
    laptopId: string;
    serialNumber?: string;
    salePrice: number;
    discountAmount?: number;
    lookingPct?: string;
    customerName?: string;
    customerPhone?: string;
    customerLocation?: string;
    sourceName?: string;
    dealBy?: string;
    assistBy?: string;
    picVideoStatus?: string;
    memoPicStatus?: string;
    dealTime?: string;
    remarks?: string;
    adapterNote?: string;
    timeZone?: string;
    sheetId?: number | null;
    soldAt?: string;
    idempotencyKey: string;
  }) =>
    apiFetch<{
      saleId: number;
      invoiceNo: string;
      liveSellMessage: string;
      remainingRajshahiQty: number;
      monthlyBranchCounts: MonthlyBranchSalesCounts;
      triggeredRefills: Array<{ exhaustedBranch: BranchCode; otherBranchesQty: number }>;
      sheetReminder: {
        title: string;
        message: string;
        sheetName: string;
        sheetUrl: string | null;
      };
    }>('/api/sales', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listMySales: () => apiFetch<{ sales: SaleRecord[] }>('/api/sales/my'),

  listSales: (params?: { branch?: string; q?: string; dateFrom?: string; dateTo?: string; employee?: string }) => {
    const sp = new URLSearchParams();
    if (params?.branch) sp.set('branch', params.branch);
    if (params?.q) sp.set('q', params.q);
    if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
    if (params?.dateTo) sp.set('dateTo', params.dateTo);
    if (params?.employee) sp.set('employee', params.employee);
    const qs = sp.toString();
    return apiFetch<{ sales: SaleRecord[] }>(`/api/sales${qs ? `?${qs}` : ''}`);
  },

  voidSale: (id: number, reason: string) =>
    apiFetch<{ ok: boolean }>(`/api/sales/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  listAccessories: () => apiFetch<{ accessories: AccessoryRecord[] }>('/api/accessories'),

  createAccessory: (payload: {
    brand: string;
    name: string;
    category: AccessoryCategory;
    spec: string;
    unitPrice: number;
    rg: number;
    nm: number;
    jsm: number;
    cc: number;
  }) =>
    apiFetch<{ id: number }>('/api/accessories', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAccessory: (id: number, payload: { unitPrice: number; rg: number; nm: number; jsm: number; cc: number }) =>
    apiFetch<{ ok: boolean }>(`/api/accessories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteAccessory: (id: number) => apiFetch<{ ok: boolean }>(`/api/accessories/${id}`, { method: 'DELETE' }),

  listRefillAlerts: () => apiFetch<{ alerts: RefillAlertRecord[] }>('/api/refill-alerts'),

  resolveRefillAlert: (id: number) => apiFetch<{ ok: boolean }>(`/api/refill-alerts/${id}/resolve`, { method: 'POST' }),

  resolveAllRefillAlerts: () =>
    apiFetch<{ ok: boolean; resolvedCount: number }>('/api/refill-alerts/resolve-all', { method: 'POST' }),

  getRefillNotificationSetting: () => apiFetch<{ enabled: boolean }>('/api/settings/refill-notifications'),

  setRefillNotificationSetting: (enabled: boolean) =>
    apiFetch<{ enabled: boolean }>('/api/settings/refill-notifications', {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),

  listNotifications: () => apiFetch<{ notifications: NotificationRecord[]; unreadCount: number }>('/api/notifications'),

  markNotificationRead: (id: number) => apiFetch<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: 'POST' }),

  markAllNotificationsRead: () => apiFetch<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' }),

  getReports: (params?: { dateFrom?: string; dateTo?: string }) => {
    const sp = new URLSearchParams();
    if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
    if (params?.dateTo) sp.set('dateTo', params.dateTo);
    const qs = sp.toString();
    return apiFetch<{
      summary: { totalUnitsSold: number; totalRevenue: number; totalDiscount: number };
      branchTotals: Array<{ branch: BranchCode; count: number; revenue: number; discount: number }>;
      employeeSales: Array<{ employeeName: string; count: number; revenue: number }>;
      modelSales: Array<{ brand: string; model: string; count: number; revenue: number }>;
      dailySales: Array<{ date: string; count: number; revenue: number }>;
      monthlySales: Array<{ month: string; count: number; revenue: number }>;
      transactions: SaleRecord[];
    }>(`/api/reports${qs ? `?${qs}` : ''}`);
  },

  listAuditLogs: () => apiFetch<{ logs: AuditLogRecord[] }>('/api/audit-logs'),

  listSessionLogs: (role?: string) => {
    const qs = role ? `?role=${encodeURIComponent(role)}` : '';
    return apiFetch<{ sessions: SessionLogRecord[]; summaries: UserSessionSummary[] }>(`/api/session-logs${qs}`);
  },

  listBackups: () =>
    apiFetch<{ backups: Array<{ id: number; filename: string; reason: string; sizeBytes: number; createdAt: string }> }>(
      '/api/backups'
    ),

  createBackup: (reason?: string) =>
    apiFetch<{ backup: { id: number; filename: string; reason: string; sizeBytes: number; createdAt: string } }>(
      '/api/backups',
      { method: 'POST', body: JSON.stringify({ reason }) }
    ),

  restoreBackup: (id: number) => apiFetch<{ ok: boolean }>(`/api/backups/${id}/restore`, { method: 'POST' }),
};

export function subscribeRealtimeEvents(onEvent: (event: RealtimeSyncEvent) => void): () => void {
  const qs = memoryToken ? `?token=${encodeURIComponent(memoryToken)}` : '';
  const source = new EventSource(`/api/events/stream${qs}`, { withCredentials: true });
  source.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data) as RealtimeSyncEvent;
      onEvent(parsed);
    } catch {
      // ignore malformed keepalive payloads
    }
  };
  return () => {
    source.close();
  };
}

