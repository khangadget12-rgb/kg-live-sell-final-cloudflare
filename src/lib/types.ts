export type BranchCode = 'RG' | 'NM' | 'JSM' | 'CC';

export interface BranchInfo {
  code: BranchCode;
  name: string;
}

export const BRANCHES: readonly BranchInfo[] = [
  { code: 'RG', name: 'Rail Gate' },
  { code: 'NM', name: 'New Market' },
  { code: 'JSM', name: 'Jamal Supermarket' },
  { code: 'CC', name: 'City Center' },
] as const;

export const BRANCH_ORDER: readonly BranchCode[] = ['RG', 'NM', 'JSM', 'CC'] as const;

export type UserRole = 'super_admin' | 'admin' | 'staff';

export type LaptopCondition = 'Intact' | 'Open Box' | 'Used';

export type LaptopCategory =
  | 'Business Pro'
  | 'Ultrabook & AI'
  | 'Gaming & RTX'
  | '2-in-1 / Convertible'
  | 'Workstation & Creator'
  | 'Budget & Everyday'
  | 'Tablet & Other';

export const LAPTOP_CATEGORIES: readonly LaptopCategory[] = [
  'Business Pro',
  'Ultrabook & AI',
  'Gaming & RTX',
  '2-in-1 / Convertible',
  'Workstation & Creator',
  'Budget & Everyday',
  'Tablet & Other',
] as const;

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  layout: 'table' | 'cards';
  density: 'comfortable' | 'compact';
  showAskingPrice: boolean;
  showDiscountedPrice: boolean;
  showBorderPrice: boolean;
  showBranchStock: boolean;
  currencyFormat: 'south_asian' | 'international';
  soundEnabled: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: 'light',
  layout: 'table',
  density: 'comfortable',
  showAskingPrice: true,
  showDiscountedPrice: true,
  showBorderPrice: true,
  showBranchStock: true,
  currencyFormat: 'south_asian',
  soundEnabled: true,
};

export interface UserAccount {
  id: number;
  username: string;
  fullName: string;
  email: string;
  role: UserRole;
  assignedBranch: BranchCode | 'ALL';
  isActive: boolean;
  receiveNotifications: boolean;
  preferredSheetId: number | null;
  preferences: UserPreferences;
  createdAt: string;
}

export interface LaptopRecord {
  id: string;
  datasetId: string;
  rowNo: number;
  brand: string;
  model: string;
  variant: string;
  category: LaptopCategory;
  processor: string;
  cpuGen: number | null;
  cpuCoresThreads: string;
  ramGb: number;
  ramType: string;
  ramBus: string;
  storageGb: number;
  storageConfig: string;
  displayRaw: string;
  displayInches: number | null;
  resolution: string;
  isTouch: boolean;
  isX360: boolean;
  isOled: boolean;
  refreshHz: number | null;
  gpu: string;
  isDedicatedGpu: boolean;
  condition: LaptopCondition;
  detailedCondition: string;
  askPrice: number;
  disPrice: number;
  borderPrice: number;
  rg: number;
  nm: number;
  jsm: number;
  cc: number;
  qty: number;
  totalValue: number;
  color: string;
  adapter: string;
  batteryBackup: string;
  os: string;
  entryDate: string;
  location: string;
  serialWarranty: string;
  remarks: string;
  hasDetachableKeyboard: boolean;
  hasSimLte: boolean;
  hasNpu: boolean;
  isCleanCondition: boolean;
  datasetName?: string;
}

export interface DatasetSummary {
  id: string;
  name: string;
  sourceType: 'builtin' | 'file' | 'google_sheet';
  sourceUrl: string | null;
  modelCount: number;
  totalUnits: number;
  isOperational: boolean;
  importedAt: string;
}

export type AccessoryCategory = 'RAM' | 'SSD' | 'Adapter' | 'Bag' | 'Accessory';

export interface AccessoryRecord {
  id: number;
  brand: string;
  name: string;
  category: AccessoryCategory;
  spec: string;
  unitPrice: number;
  rg: number;
  nm: number;
  jsm: number;
  cc: number;
  qty: number;
  updatedAt: string;
}

export interface GoogleSheetRecord {
  id: number;
  name: string;
  branchLabel: string;
  url: string;
  isAvailable: boolean;
  sortOrder: number;
}

export interface SaleRecord {
  id: number;
  invoiceNo: string;
  branch: BranchCode;
  laptopId: string;
  brand: string;
  model: string;
  variant: string;
  serialNumber: string;
  salePrice: number;
  discountAmount: number;
  lookingPct: string;
  customerName: string;
  customerPhone: string;
  remarks: string;
  liveSellMessage?: string;
  sheetId: number | null;
  sheetName: string;
  employeeId: number;
  employeeName: string;
  soldAt: string;
  status: 'completed' | 'voided';
  voidReason: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
}

export type MonthlyBranchSalesCounts = Record<BranchCode, number>;

export interface SessionLogRecord {
  id: number;
  userId: number;
  username: string;
  fullName: string;
  role: UserRole;
  loginAt: string;
  lastSeenAt: string;
  logoutAt: string | null;
  activeSeconds: number;
  userAgent: string;
  ipAddress: string;
  status: 'active' | 'ended' | 'expired';
}

export interface UserSessionSummary {
  userId: number;
  username: string;
  fullName: string;
  role: UserRole;
  sessionCount: number;
  totalActiveSeconds: number;
  lastLoginAt: string;
  lastSeenAt: string;
  isOnline: boolean;
}

export interface NotificationRecord {
  id: number;
  recipientUserId: number;
  type: 'sale_sheet_reminder' | 'refill_alert' | 'system';
  title: string;
  message: string;
  branch: BranchCode | null;
  laptopModel: string | null;
  employeeName: string | null;
  sheetName: string | null;
  sheetUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface RefillAlertRecord {
  id: number;
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
  status: 'active' | 'resolved';
  triggeredAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface AuditLogRecord {
  id: number;
  actorName: string;
  actorRole: UserRole;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  createdAt: string;
}

export type AppTab =
  | 'dashboard'
  | 'live-sell'
  | 'sales-ledger'
  | 'stock-sheet'
  | 'laptop-finder'
  | 'accessories'
  | 'refill-reminder'
  | 'reports'
  | 'settings';

export interface RajshahiSyncStatus {
  sheetUrl: string;
  autoScanEnabled: boolean;
  intervalSeconds: number;
  scanning: boolean;
  lastScanAt: string | null;
  lastSyncedAt: string | null;
  lastChangeSummary: string | null;
  lastError: string | null;
  syncVersion: number;
}

export interface RealtimeSyncEvent {
  type: 'connected' | 'inventory_updated' | 'datasets_updated' | 'sync_status_updated';
  reason?: string;
  summary?: string;
  syncVersion?: number;
  changedAt?: string;
}

