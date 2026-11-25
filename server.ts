import express, { type NextFunction, type Request, type Response } from 'express';
import { httpServerHandler } from 'cloudflare:node';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import {
  createDatabaseBackup,
  db,
  getAllRefillAlerts,
  getAppSetting,
  getLaptopsByDataset,
  getBuiltinInventoryAsset,
  getDatabaseBackupContent,
  restoreDatabaseBackup,
  hashPassword,
  insertLaptopsBatch,
  isRefillNotificationsEnabled,
  logAudit,
  mapLaptopRow,
  mapUserRow,
  runMigrations,
  seedInitialData,
  setAppSetting,
  verifyPassword,
} from './server/db.ts';
import {
  buildLiveSellMessage,
  extractGoogleSheetCsvUrl,
  formatLookingPercentage,
  sanitizeSheetUrl,
} from './src/lib/formatters.ts';
import { evaluateRefillForLaptop } from './src/lib/refillLogic.ts';
import { diffLaptopSnapshots, normalizeCsvContent } from './src/lib/sheetSync.ts';
import { parseDelimitedRows, parseRowsToLaptops, validateRajshahiSheetRows } from './src/lib/specParser.ts';
import { BRANCH_ORDER } from './src/lib/types.ts';
import type {
  AccessoryCategory,
  AccessoryRecord,
  BranchCode,
  LaptopRecord,
  MonthlyBranchSalesCounts,
  RajshahiSyncStatus,
  RealtimeSyncEvent,
  SessionLogRecord,
  UserAccount,
  UserPreferences,
  UserRole,
  UserSessionSummary,
} from './src/lib/types.ts';
import { DEFAULT_USER_PREFERENCES } from './src/lib/types.ts';

const PORT = 3000;
function getSuperAdminPasscode(): string {
  return String((globalThis as any).__KG_SUPER_ADMIN_PASSCODE__ || '').trim();
}
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'kg_session';

// Initialize SQLite schema & real seed data
runMigrations();
seedInitialData();

interface AuthedRequest extends Request {
  user?: UserAccount;
  usedCookieAuth?: boolean;
  tokenHash?: string;
}

function sha256(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function getClientIp(req?: Request): string {
  if (!req) return '';
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (fwd || req.ip || '').slice(0, 64);
}

function createSessionForUser(user: UserAccount, req?: Request): string {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    tokenHash,
    user.id,
    expiresAt,
    nowIso
  );
  const ua = String(req?.headers['user-agent'] || '').slice(0, 180);
  const ip = getClientIp(req);
  db.prepare(`
    INSERT INTO user_session_logs (
      token_hash, user_id, username, full_name, role,
      login_at, last_seen_at, logout_at, active_seconds, user_agent, ip_address, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, 'active')
  `).run(tokenHash, user.id, user.username, user.fullName, user.role, nowIso, nowIso, ua, ip);
  return token;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token = '';
  let usedCookie = false;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[COOKIE_NAME]) {
      token = cookies[COOKIE_NAME];
      usedCookie = true;
    }
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // CSRF defense on cookie-authenticated mutations
  if (usedCookie && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    const xrw = req.headers['x-requested-with'];
    const origin = req.headers.origin;
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    let originOk = false;
    if (origin && host) {
      try {
        originOk = new URL(origin).host === host;
      } catch {
        originOk = false;
      }
    }
    if (!originOk && xrw !== 'KG-Live-Sell') {
      res.status(403).json({ error: 'Cross-origin request blocked' });
      return;
    }
  }

  const tokenHash = sha256(token);
  const sessionRow = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as { user_id: number; expires_at: string } | undefined;

  if (!sessionRow || Date.parse(sessionRow.expires_at) < Date.now()) {
    if (sessionRow) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      db.prepare("UPDATE user_session_logs SET status = 'expired', logout_at = COALESCE(logout_at, ?) WHERE token_hash = ?").run(
        new Date().toISOString(),
        tokenHash
      );
    }
    res.status(401).json({ error: 'Session expired or invalid' });
    return;
  }

  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(sessionRow.user_id) as Record<string, unknown> | undefined;
  if (!userRow || !userRow.is_active) {
    res.status(403).json({ error: 'Account is disabled or unavailable' });
    return;
  }

  req.user = mapUserRow(userRow);
  req.usedCookieAuth = usedCookie;
  req.tokenHash = tokenHash;
  next();
}

function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: `Insufficient permissions for role '${req.user.role}'` });
      return;
    }
    next();
  };
}

function isBranchCode(val: unknown): val is BranchCode {
  return val === 'RG' || val === 'NM' || val === 'JSM' || val === 'CC';
}

function getYearMonthKey(isoString: string, timeZone?: string): string {
  const d = new Date(isoString);
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
      }).formatToParts(valid);
      const y = parts.find((p) => p.type === 'year')?.value;
      const m = parts.find((p) => p.type === 'month')?.value;
      if (y && m) return `${y}-${m}`;
    } catch {
      // Fallback below
    }
  }
  return `${valid.getFullYear()}-${String(valid.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthlyBranchCounts(soldAtIso: string, timeZone?: string): MonthlyBranchSalesCounts {
  const counts: MonthlyBranchSalesCounts = { RG: 0, NM: 0, JSM: 0, CC: 0 };
  const targetYm = getYearMonthKey(soldAtIso, timeZone);
  const targetMs = Date.parse(soldAtIso) || Date.now();
  const rows = db
    .prepare("SELECT branch, sold_at FROM sales WHERE status = 'completed'")
    .all() as Array<{ branch: BranchCode; sold_at: string }>;
  for (const r of rows) {
    const rowMs = Date.parse(r.sold_at);
    if (Number.isFinite(rowMs) && rowMs > targetMs) continue;
    if (getYearMonthKey(r.sold_at, timeZone) === targetYm && isBranchCode(r.branch)) {
      counts[r.branch] += 1;
    }
  }
  return counts;
}

function syncRefillAlertsForLaptop(laptop: LaptopRecord, nowIso: string): Array<{
  exhaustedBranch: BranchCode;
  otherBranchesQty: number;
}> {
  const existingAlerts = getAllRefillAlerts();
  const evalRes = evaluateRefillForLaptop(laptop, existingAlerts);

  const insertAlert = db.prepare(`
    INSERT INTO refill_alerts (
      laptop_id, brand, model, variant, exhausted_branch,
      rg, nm, jsm, cc, other_branches_qty, status, triggered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `);
  const updateCounts = db.prepare(`
    UPDATE refill_alerts SET rg = ?, nm = ?, jsm = ?, cc = ?, other_branches_qty = ? WHERE id = ?
  `);
  const resolveAlert = db.prepare(`
    UPDATE refill_alerts SET status = 'resolved', resolved_at = ?, resolved_by = 'System (Restocked)' WHERE id = ?
  `);

  for (const trig of evalRes.toTrigger) {
    insertAlert.run(
      trig.laptopId,
      trig.brand,
      trig.model,
      trig.variant,
      trig.exhaustedBranch,
      trig.rg,
      trig.nm,
      trig.jsm,
      trig.cc,
      trig.otherBranchesQty,
      nowIso
    );
  }
  for (const upd of evalRes.toUpdateCounts) {
    updateCounts.run(upd.rg, upd.nm, upd.jsm, upd.cc, upd.otherBranchesQty, upd.alertId);
  }
  for (const id of evalRes.toResolveIds) {
    resolveAlert.run(nowIso, id);
  }

  return evalRes.toTrigger.map((t) => ({
    exhaustedBranch: t.exhaustedBranch,
    otherBranchesQty: t.otherBranchesQty,
  }));
}

function getNotificationRecipients(): number[] {
  const rows = db
    .prepare('SELECT id FROM users WHERE is_active = 1 AND receive_notifications = 1')
    .all() as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

function updateDatasetCounts(datasetId: string): void {
  const stats = db
    .prepare('SELECT COUNT(*) as models, COALESCE(SUM(qty), 0) as units FROM laptops WHERE dataset_id = ?')
    .get(datasetId) as { models: number; units: number };
  db.prepare('UPDATE datasets SET model_count = ?, total_units = ? WHERE id = ?').run(
    stats.models,
    stats.units,
    datasetId
  );
}

function isAllowedGoogleSheetsUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    const allowedHosts = ['docs.google.com', 'sheets.googleapis.com'];
    if (!allowedHosts.includes(host)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ==========================================
// REAL-TIME SSE BROADCAST & RAJSHAHI SHEET SCANNER
// ==========================================
const sseClients = new Set<Response>();
let syncVersionCounter = 1;
let isScanningRajshahi = false;
let lastScanAt: string | null = null;
let lastSyncError: string | null = null;
let inFlightRajshahiSync: Promise<{
  changed: boolean;
  status: RajshahiSyncStatus;
  modelCount: number;
  totalUnits: number;
  summary: string;
}> | null = null;
let rajshahiScanTimer: NodeJS.Timeout | null = null;

function broadcastRealtimeEvent(
  type: RealtimeSyncEvent['type'],
  payload: Omit<RealtimeSyncEvent, 'type'> = {},
  bumpInventoryVersion = true
): void {
  if (bumpInventoryVersion) syncVersionCounter += 1;
  const eventPayload: RealtimeSyncEvent = {
    type,
    syncVersion: syncVersionCounter,
    changedAt: new Date().toISOString(),
    ...payload,
  };
  const serialized = `data: ${JSON.stringify(eventPayload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(serialized);
    } catch {
      sseClients.delete(client);
    }
  }
}

function getConfiguredRajshahiSheetUrl(): string {
  const fromSetting = getAppSetting('rajshahi_live_sheet_url', '').trim();
  if (fromSetting) return fromSetting;
  const sheetRow = db
    .prepare("SELECT url FROM google_sheets WHERE LOWER(name) LIKE '%rajshahi%' ORDER BY sort_order ASC, id ASC LIMIT 1")
    .get() as { url?: string } | undefined;
  if (sheetRow?.url && extractGoogleSheetCsvUrl(sheetRow.url)) return String(sheetRow.url);
  return '';
}

function getRajshahiSyncStatus(): RajshahiSyncStatus {
  const intervalRaw = Number(getAppSetting('rajshahi_scan_interval_sec', '30'));
  const intervalSeconds = Number.isFinite(intervalRaw) ? Math.min(300, Math.max(15, Math.round(intervalRaw))) : 30;
  const lastScanSetting = getAppSetting('rajshahi_last_scan_at', '');
  const lastErrorSetting = getAppSetting('rajshahi_last_scan_error', '');
  const modelCount = Number(getAppSetting('rajshahi_last_scan_models', '0')) || 0;
  const totalUnits = Number(getAppSetting('rajshahi_last_scan_units', '0')) || 0;
  const branchSummary = getAppSetting('rajshahi_last_scan_branches', '');
  return {
    sheetUrl: getConfiguredRajshahiSheetUrl(),
    autoScanEnabled: getAppSetting('rajshahi_auto_scan_enabled', '1') === '1',
    intervalSeconds,
    scanning: isScanningRajshahi,
    lastScanAt: lastScanSetting || lastScanAt,
    lastSyncedAt: getAppSetting('rajshahi_last_sync_at', '') || null,
    lastChangeSummary: getAppSetting('rajshahi_last_change_summary', '') || null,
    lastError: lastErrorSetting || lastSyncError,
    lastScanSummary: getAppSetting('rajshahi_last_scan_summary', '') || null,
    nextScanAt: getAppSetting('rajshahi_next_scan_at', '') || null,
    lastScanModelCount: modelCount,
    lastScanTotalUnits: totalUnits,
    lastScanBranchSummary: branchSummary || null,
    syncVersion: syncVersionCounter,
  };
}

function summarizeRajshahiBranchUnits(laptops: LaptopRecord[]): string {
  const totals = laptops.reduce((sum, laptop) => {
    sum.RG += Number(laptop.rg) || 0;
    sum.NM += Number(laptop.nm) || 0;
    sum.JSM += Number(laptop.jsm) || 0;
    sum.CC += Number(laptop.cc) || 0;
    return sum;
  }, { RG: 0, NM: 0, JSM: 0, CC: 0 });
  return `RG ${totals.RG} · NM ${totals.NM} · JSM ${totals.JSM} · CC ${totals.CC}`;
}

function buildCacheBustedSheetUrl(csvUrl: string): string {
  const parsed = new URL(csvUrl);
  parsed.searchParams.set('_kg_live_scan', `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`);
  return parsed.toString();
}

async function fetchRajshahiCsv(csvUrl: string): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18_000);
    try {
      const response = await fetch(buildCacheBustedSheetUrl(csvUrl), {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'text/csv,application/csv,text/plain;q=0.9,*/*;q=0.1',
          'Cache-Control': 'no-cache, no-store, max-age=0',
          Pragma: 'no-cache',
        },
      });
      if (!response.ok) {
        const error = new Error(`Google Sheets returned HTTP ${response.status}. Check that the Rajshahi sheet is published to the web or shared with viewers.`);
        if (attempt === 0 && response.status >= 500) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 700));
          continue;
        }
        throw error;
      }
      const text = await response.text();
      const trimmed = text.trimStart().toLowerCase();
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/html') || trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
        throw new Error('Google returned an HTML page instead of CSV. Publish the Rajshahi tab as CSV and enable automatic republishing.');
      }
      if (!text.trim()) throw new Error('Google returned an empty CSV. Existing inventory was kept unchanged.');
      return text;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Failed to download Rajshahi Google Sheet.');
      if (attempt === 0 && (lastError.name === 'AbortError' || /fetch|network|timeout|HTTP 5\d\d/i.test(lastError.message))) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('Could not fetch the Rajshahi Google Sheet.');
}

async function syncRajshahiSheetNow(actorName?: string): Promise<{
  changed: boolean;
  status: RajshahiSyncStatus;
  modelCount: number;
  totalUnits: number;
  summary: string;
}> {
  if (inFlightRajshahiSync) return inFlightRajshahiSync;

  const task = (async () => {
    let changed = false;
    let modelCount = 0;
    let totalUnits = 0;
    let summary = '';
    let branchSummary = '';
    let scanError: string | null = null;
    isScanningRajshahi = true;
    broadcastRealtimeEvent('sync_status_updated', { reason: 'rajshahi_scan_started' }, false);

    try {
      const sheetUrl = getConfiguredRajshahiSheetUrl();

      if (!sheetUrl) {
        // No recurring scan is scheduled without a sheet URL. Keep the manual
        // status accurate by reading inventory once in this non-scanning path.
        const currentLaptops = getLaptopsByDataset('rajshahi_main');
        modelCount = currentLaptops.length;
        totalUnits = currentLaptops.reduce((sum, laptop) => sum + laptop.qty, 0);
        branchSummary = summarizeRajshahiBranchUnits(currentLaptops);
        summary = 'No Rajshahi live Google Sheet URL is configured. Existing inventory is unchanged.';
      } else {
        const csvUrl = extractGoogleSheetCsvUrl(sheetUrl);
        if (!csvUrl || !isAllowedGoogleSheetsUrl(csvUrl)) {
          throw new Error('Invalid Rajshahi Google Sheets URL. Use a public docs.google.com spreadsheet URL.');
        }

        const csvText = await fetchRajshahiCsv(csvUrl);
        const rows = parseDelimitedRows(csvText);
        const validation = validateRajshahiSheetRows(rows);
        if (!validation.valid) {
          const missing = validation.missingColumns.length ? ` Missing branch columns: ${validation.missingColumns.join(', ')}.` : '';
          throw new Error(`Rajshahi sheet validation failed: ${validation.dataRowCount} valid laptop rows found.${missing} Required headers are Brand, Model, RG, NM, JSM and CC. Existing inventory was kept unchanged.`);
        }

        const normalized = normalizeCsvContent(csvText);
        const nextHash = sha256(normalized);
        const previousHash = getAppSetting('rajshahi_last_sync_hash', '');

        // The scanner runs frequently, but the live sheet usually stays the
        // same between checks. Read the small dataset summary first; when the
        // validated sheet hash is unchanged, do not load every laptop row.
        // This avoids consuming thousands of Durable Object SQLite row reads
        // on every no-change scan.
        const inventoryMeta = db
          .prepare('SELECT model_count, total_units FROM datasets WHERE id = ?')
          .get('rajshahi_main') as { model_count: number; total_units: number } | undefined;
        const hasInventory = Boolean(
          db.prepare('SELECT 1 AS present FROM laptops WHERE dataset_id = ? LIMIT 1').get('rajshahi_main')
        );

        if (previousHash && previousHash === nextHash && inventoryMeta && Number(inventoryMeta.model_count) > 0 && hasInventory) {
          modelCount = Number(inventoryMeta.model_count) || 0;
          totalUnits = Number(inventoryMeta.total_units) || 0;
          branchSummary = getAppSetting('rajshahi_last_scan_branches', '');
          summary = `Checked successfully: ${modelCount} models, ${totalUnits} units. No sheet changes detected.`;
          setAppSetting('rajshahi_last_scan_hash', nextHash);
        } else {
          // Only convert rows and read the full inventory when the sheet has
          // changed (or when this is the first scan / the dataset was not seeded).
          const nextLaptops = parseRowsToLaptops(rows, { datasetId: 'rajshahi_main' });
          if (nextLaptops.length === 0) {
            throw new Error('Rajshahi sheet contained no valid laptop rows. Existing inventory was kept unchanged.');
          }

          const previousLaptops = getLaptopsByDataset('rajshahi_main');
          const diff = diffLaptopSnapshots(previousLaptops, nextLaptops);
          modelCount = nextLaptops.length;
          totalUnits = diff.nextUnits;
          branchSummary = summarizeRajshahiBranchUnits(nextLaptops);

          if (previousHash === nextHash && previousLaptops.length > 0) {
            // The metadata row may have been missing/stale. Preserve the same
            // no-change behavior as the original scanner.
            summary = `Checked successfully: ${modelCount} models, ${totalUnits} units. No sheet changes detected.`;
            setAppSetting('rajshahi_last_scan_hash', nextHash);
          } else if (!diff.hasChanges && previousLaptops.length > 0) {
            setAppSetting('rajshahi_last_sync_hash', nextHash);
            summary = `Checked successfully: ${modelCount} models, ${totalUnits} units. No stock or specification changes detected.`;
          } else {
            const nowIso = new Date().toISOString();
            const previousActiveKeys = new Set(
              getAllRefillAlerts()
                .filter((alert) => alert.status === 'active')
                .map((alert) => `${alert.brand}|${alert.model}|${alert.variant}|${alert.exhaustedBranch}`.toLowerCase())
            );

            db.transaction(() => {
              db.prepare('DELETE FROM laptops WHERE dataset_id = ?').run('rajshahi_main');
              insertLaptopsBatch(nextLaptops);
              db.prepare(
                'UPDATE datasets SET source_url = ?, model_count = ?, total_units = ?, imported_at = ? WHERE id = ?'
              ).run(sheetUrl, nextLaptops.length, totalUnits, nowIso, 'rajshahi_main');

              db.prepare("UPDATE refill_alerts SET status = 'resolved', resolved_at = ?, resolved_by = 'System (Sheet Synced)' WHERE status = 'active'")
                .run(nowIso);
              const recipients = getNotificationRecipients();
              const insertNotification = db.prepare(`
                INSERT INTO notifications (recipient_user_id, type, title, message, branch, laptop_model, created_at)
                VALUES (?, 'refill_alert', ?, ?, ?, ?, ?)
              `);
              for (const laptop of nextLaptops) {
                const triggers = syncRefillAlertsForLaptop(laptop, nowIso);
                if (triggers.length > 0 && isRefillNotificationsEnabled()) {
                  for (const trigger of triggers) {
                    const key = `${laptop.brand}|${laptop.model}|${laptop.variant}|${trigger.exhaustedBranch}`.toLowerCase();
                    if (previousActiveKeys.has(key)) continue;
                    for (const userId of recipients) {
                      insertNotification.run(
                        userId,
                        `Refill Reminder: ${laptop.brand} ${laptop.model}`,
                        `${trigger.exhaustedBranch} branch is out of stock (0 units) while other branches hold ${trigger.otherBranchesQty} units.`,
                        trigger.exhaustedBranch,
                        `${laptop.brand} ${laptop.model}`,
                        nowIso
                      );
                    }
                  }
                }
              }
            })();

            changed = true;
            summary = diff.hasChanges
              ? diff.summary
              : `Loaded ${nextLaptops.length} Rajshahi models (${totalUnits} units).`;
            setAppSetting('rajshahi_last_sync_hash', nextHash);
            setAppSetting('rajshahi_last_sync_at', nowIso);
            setAppSetting('rajshahi_last_change_summary', summary);
            logAudit(
              actorName || 'Live Sheet Scanner',
              actorName ? 'staff' : 'super_admin',
              'SYNC_RAJSHAHI_SHEET',
              'dataset',
              'rajshahi_main',
              summary
            );
            broadcastRealtimeEvent('inventory_updated', { reason: 'rajshahi_sheet_sync', summary });
          }
        }

        // A successful unchanged scan is still a successful sync check.
        setAppSetting('rajshahi_last_sync_at', new Date().toISOString());
        setAppSetting('rajshahi_last_scan_hash', nextHash);
        if (!changed) setAppSetting('rajshahi_last_change_summary', summary);
      }
    } catch (error) {
      scanError = error instanceof Error ? error.message : 'Failed to fetch Rajshahi Google Sheet.';
      summary = scanError;
      // Deliberately do not replace existing stock on fetch, permission, header or parse failures.
    } finally {
      const completedAt = new Date().toISOString();
      isScanningRajshahi = false;
      lastScanAt = completedAt;
      lastSyncError = scanError;
      try {
        setAppSetting('rajshahi_last_scan_at', completedAt);
        setAppSetting('rajshahi_last_scan_error', scanError || '');
        setAppSetting('rajshahi_last_scan_summary', summary);
        setAppSetting('rajshahi_last_scan_models', String(modelCount));
        setAppSetting('rajshahi_last_scan_units', String(totalUnits));
        if (branchSummary) setAppSetting('rajshahi_last_scan_branches', branchSummary);
      } catch (persistError) {
        console.error('Could not persist Rajshahi scan status:', persistError);
      }
      broadcastRealtimeEvent('sync_status_updated', { reason: 'rajshahi_scan_completed', summary }, false);
    }

    return {
      changed,
      status: getRajshahiSyncStatus(),
      modelCount,
      totalUnits,
      summary,
    };
  })();

  inFlightRajshahiSync = task.finally(() => {
    inFlightRajshahiSync = null;
  });
  return inFlightRajshahiSync;
}

async function scheduleNextRajshahiScan(): Promise<void> {
  if (rajshahiScanTimer) {
    clearTimeout(rajshahiScanTimer);
    rajshahiScanTimer = null;
  }
  const status = getRajshahiSyncStatus();
  const scheduleCloudflareAlarm = (globalThis as any).__KG_SCHEDULE_ALARM__ as ((delayMs: number) => Promise<void> | void) | undefined;
  const deleteCloudflareAlarm = (globalThis as any).__KG_DELETE_ALARM__ as (() => Promise<void> | void) | undefined;

  if (!status.autoScanEnabled || !status.sheetUrl) {
    setAppSetting('rajshahi_next_scan_at', '');
    if (deleteCloudflareAlarm) {
      try {
        await deleteCloudflareAlarm();
      } catch (error) {
        console.error('Could not clear Rajshahi scan alarm:', error);
      }
    }
    return;
  }

  const delayMs = Math.max(15_000, status.intervalSeconds * 1000);
  const nextAt = new Date(Date.now() + delayMs).toISOString();
  setAppSetting('rajshahi_next_scan_at', nextAt);
  if (scheduleCloudflareAlarm) {
    try {
      // Await Durable Object storage so the alarm is persisted before the
      // current Worker request/alarm event is allowed to finish.
      await scheduleCloudflareAlarm(delayMs);
      return;
    } catch (error) {
      lastSyncError = `Could not schedule next background scan: ${error instanceof Error ? error.message : String(error)}`;
      setAppSetting('rajshahi_last_scan_error', lastSyncError);
      console.error('Could not schedule Rajshahi Durable Object alarm:', error);
      broadcastRealtimeEvent('sync_status_updated', { reason: 'rajshahi_alarm_schedule_failed' }, false);
      // Make one slower retry rather than silently abandoning continuous scan.
      try {
        await scheduleCloudflareAlarm(60_000);
        setAppSetting('rajshahi_next_scan_at', new Date(Date.now() + 60_000).toISOString());
      } catch (retryError) {
        console.error('Rajshahi alarm retry failed:', retryError);
      }
      return;
    }
  }

  rajshahiScanTimer = setTimeout(async () => {
    try {
      const current = getRajshahiSyncStatus();
      if (current.autoScanEnabled && current.sheetUrl) await syncRajshahiSheetNow();
    } catch (error) {
      console.error('Rajshahi background scan failed:', error);
    } finally {
      await scheduleNextRajshahiScan();
    }
  }, delayMs);
  rajshahiScanTimer.unref?.();
}

export async function runScheduledRajshahiSync(): Promise<void> {
  try {
    const status = getRajshahiSyncStatus();
    if (status.autoScanEnabled && status.sheetUrl) await syncRajshahiSheetNow();
  } finally {
    await scheduleNextRajshahiScan();
  }
}

export async function startServer(options: { cloudflare?: boolean } = {}) {
  const app = express();
  app.set('trust proxy', 1);

  // Cloudflare Workers currently has a compatibility gap in the lazy
  // Express/body-parser JSON parser dependency chain (raw-body -> iconv-lite).
  // Avoid express.json() entirely and parse JSON from the Node HTTP bridge
  // request stream using Workers-supported TextDecoder APIs.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const contentType = String(req.headers['content-type'] || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    const isJson = contentType === 'application/json' || contentType.endsWith('+json');

    if (!isJson || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
      (req as Request & { body?: unknown }).body = {};
      next();
      return;
    }

    const maxBytes = 15 * 1024 * 1024;
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let tooLarge = false;
    let completed = false;

    req.on('data', (chunk: unknown) => {
      if (tooLarge) return;
      let bytes: Uint8Array;
      if (typeof chunk === 'string') {
        bytes = new TextEncoder().encode(chunk);
      } else if (chunk instanceof Uint8Array) {
        bytes = chunk;
      } else {
        bytes = new TextEncoder().encode(String(chunk ?? ''));
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(bytes);
    });

    req.on('error', (error: Error) => {
      if (completed) return;
      completed = true;
      next(error);
    });

    req.on('end', () => {
      if (completed) return;
      completed = true;
      if (tooLarge) {
        res.status(413).json({ error: 'JSON request body exceeds the 15 MB limit' });
        return;
      }

      const merged = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const raw = new TextDecoder('utf-8', { fatal: false }).decode(merged);
      if (!raw.trim()) {
        (req as Request & { body?: unknown }).body = {};
        next();
        return;
      }
      try {
        (req as Request & { body?: unknown }).body = JSON.parse(raw);
        next();
      } catch {
        res.status(400).json({ error: 'Invalid JSON request body' });
      }
    });
  });

  // Health endpoint for Cloudflare / Docker / uptime checks
  app.get('/api/health', (_req, res) => {
    const sync = getRajshahiSyncStatus();
    res.json({
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      db: 'connected',
      syncVersion: sync.syncVersion,
      autoScanEnabled: sync.autoScanEnabled,
      lastScanAt: sync.lastScanAt,
    });
  });

  // Lightweight authenticated sync-version check used as a 5-second fallback
  // when a browser misses an SSE event or temporarily loses its connection.
  app.get('/api/sync/version', requireAuth, (_req, res) => {
    res.json({ syncVersion: syncVersionCounter });
  });

  // Real-time Server-Sent Events stream (supports cookie or ?token= auth)
  app.get('/api/events/stream', (req, res) => {
    const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    const authHeader = req.headers.authorization;
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (queryToken) {
      token = queryToken;
    } else {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies[COOKIE_NAME]) token = cookies[COOKIE_NAME];
    }

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const tokenHash = sha256(token);
    const sessionRow = db
      .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
      .get(tokenHash) as { user_id: number; expires_at: string } | undefined;
    if (!sessionRow || Date.parse(sessionRow.expires_at) < Date.now()) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const hello: RealtimeSyncEvent = {
      type: 'connected',
      syncVersion: syncVersionCounter,
      changedAt: new Date().toISOString(),
    };
    res.write(`data: ${JSON.stringify(hello)}\n\n`);
    sseClients.add(res);

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
        sseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  // ==========================================
  // AUTH & FIRST-RUN BOOTSTRAP ROUTES
  // ==========================================
  app.get('/api/auth/bootstrap-status', (_req, res) => {
    const adminCount = (
      db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'super_admin'").get() as { c: number }
    ).c;
    const envPasscode = getSuperAdminPasscode();
    res.json({
      needsSetup: adminCount === 0 && !envPasscode,
      hasEnvOverride: Boolean(envPasscode),
    });
  });

  app.get('/api/auth/session', (req, res) => {
    const adminCount = (
      db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'super_admin'").get() as { c: number }
    ).c;
    const envPasscode = getSuperAdminPasscode();
    const needsSetup = adminCount === 0 && !envPasscode;

    const authHeader = req.headers.authorization;
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies[COOKIE_NAME]) token = cookies[COOKIE_NAME];
    }

    let user: UserAccount | null = null;
    if (token) {
      const sessionRow = db
        .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
        .get(sha256(token)) as { user_id: number; expires_at: string } | undefined;
      if (sessionRow && Date.parse(sessionRow.expires_at) >= Date.now()) {
        const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(sessionRow.user_id) as Record<string, unknown> | undefined;
        if (userRow && userRow.is_active) {
          user = mapUserRow(userRow);
        }
      }
    }

    res.json({
      user,
      needsSetup,
      hasEnvOverride: Boolean(envPasscode),
    });
  });

  app.post('/api/auth/setup', (req, res) => {
    const envPasscode = getSuperAdminPasscode();
    const adminCount = (
      db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'super_admin'").get() as { c: number }
    ).c;

    if (adminCount > 0 || envPasscode) {
      res.status(409).json({ error: 'Super Admin account has already been configured' });
      return;
    }

    const fullName = String(req.body?.fullName || '').trim();
    const username = String(req.body?.username || '').trim().toLowerCase();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!fullName || !username || password.length < 6) {
      res.status(400).json({ error: 'Full name, username, and a password of at least 6 characters are required' });
      return;
    }

    const firstSheet = db.prepare('SELECT id FROM google_sheets ORDER BY sort_order ASC LIMIT 1').get() as
      | { id: number }
      | undefined;

    const now = new Date().toISOString();
    const info = db
      .prepare(`
        INSERT INTO users (
          username, full_name, email, password_hash, role, assigned_branch,
          is_active, receive_notifications, preferred_sheet_id, preferences_json, created_at
        ) VALUES (?, ?, ?, ?, 'super_admin', 'ALL', 1, 1, ?, ?, ?)
      `)
      .run(
        username,
        fullName,
        email,
        hashPassword(password),
        firstSheet?.id ?? null,
        JSON.stringify(DEFAULT_USER_PREFERENCES),
        now
      );

    const userId = Number(info.lastInsertRowid);
    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
    const user = mapUserRow(userRow);
    const token = createSessionForUser(user, req);
    setSessionCookie(req, res, token);
    logAudit(user.fullName, user.role, 'BOOTSTRAP_SETUP', 'user', String(userId), 'Initial Super Admin claimed');

    res.status(201).json({ token, user });
  });

  app.post('/api/auth/login', (req, res) => {
    const identifier = String(req.body?.identifier || req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!identifier || !password) {
      res.status(400).json({ error: 'Username/email and password are required' });
      return;
    }

    // The Worker secret can bootstrap the first Super Admin only. Once an
    // account exists, normal stored-password verification takes over so the
    // secret does not remain a permanent login backdoor after password change.
    const envPasscode = getSuperAdminPasscode();
    if (envPasscode && (identifier === 'superadmin' || identifier === 'owner' || identifier === 'admin') && password === envPasscode) {
      let row = db.prepare("SELECT * FROM users WHERE role = 'super_admin' ORDER BY id ASC LIMIT 1").get() as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        const firstSheet = db.prepare('SELECT id FROM google_sheets ORDER BY sort_order ASC LIMIT 1').get() as { id: number } | undefined;
        const info = db
          .prepare(`
            INSERT INTO users (username, full_name, email, password_hash, role, assigned_branch, is_active, receive_notifications, preferred_sheet_id, preferences_json, created_at)
            VALUES ('superadmin', 'Super Admin', '', ?, 'super_admin', 'ALL', 1, 1, ?, ?, ?)
          `)
          .run(hashPassword(envPasscode), firstSheet?.id ?? null, JSON.stringify(DEFAULT_USER_PREFERENCES), new Date().toISOString());
        row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as Record<string, unknown>;
      }
      if (row && verifyPassword(password, String(row.password_hash))) {
        const user = mapUserRow(row);
        const token = createSessionForUser(user, req);
        setSessionCookie(req, res, token);
        res.json({ token, user });
        return;
      }
      // The passcode no longer matches the account password: continue to the
      // regular username/password check below rather than bypassing it.
    }

    const row = db
      .prepare('SELECT * FROM users WHERE LOWER(username) = ? OR (email != \'\' AND LOWER(email) = ?)')
      .get(identifier, identifier) as Record<string, unknown> | undefined;

    if (!row || !verifyPassword(password, String(row.password_hash))) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (!row.is_active) {
      res.status(403).json({ error: 'Your account has been deactivated by an administrator' });
      return;
    }

    const user = mapUserRow(row);
    const token = createSessionForUser(user, req);
    setSessionCookie(req, res, token);
    res.json({ token, user });
  });

  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    const cookies = parseCookies(req.headers.cookie);
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : cookies[COOKIE_NAME] || '';
    if (token) {
      const tokenHash = sha256(token);
      const nowIso = new Date().toISOString();
      db.prepare("UPDATE user_session_logs SET status = 'ended', logout_at = ?, last_seen_at = ? WHERE token_hash = ?").run(
        nowIso,
        nowIso,
        tokenHash
      );
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/auth/heartbeat', requireAuth, (req: AuthedRequest, res) => {
    const tokenHash = req.tokenHash;
    if (!tokenHash) {
      res.json({ ok: true });
      return;
    }
    const isActive = req.body?.isActive !== false;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const existing = db
      .prepare('SELECT last_seen_at, active_seconds FROM user_session_logs WHERE token_hash = ?')
      .get(tokenHash) as { last_seen_at: string; active_seconds: number } | undefined;
    if (existing) {
      const prevMs = Date.parse(existing.last_seen_at) || nowMs;
      const elapsedSec = Math.max(0, Math.round((nowMs - prevMs) / 1000));
      const increment = isActive ? Math.min(120, elapsedSec) : 0;
      db.prepare(`
        UPDATE user_session_logs
        SET last_seen_at = ?, active_seconds = active_seconds + ?, status = 'active'
        WHERE token_hash = ?
      `).run(nowIso, increment, tokenHash);
    }
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  // ==========================================
  // PERSONAL PREFERENCES & USER MANAGEMENT
  // ==========================================
  app.put('/api/users/me/preferences', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const nextPrefs: UserPreferences = {
      ...user.preferences,
      ...(req.body?.preferences || {}),
    };
    let nextSheetId = user.preferredSheetId;
    if (req.body?.preferredSheetId !== undefined) {
      nextSheetId = req.body.preferredSheetId === null ? null : Number(req.body.preferredSheetId);
    }

    const receiveNotifications = req.body?.receiveNotifications !== undefined
      ? (req.body.receiveNotifications ? 1 : 0)
      : (user.receiveNotifications ? 1 : 0);

    db.prepare('UPDATE users SET preferences_json = ?, preferred_sheet_id = ?, receive_notifications = ? WHERE id = ?').run(
      JSON.stringify(nextPrefs),
      nextSheetId,
      receiveNotifications,
      user.id
    );

    const updated = mapUserRow(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as Record<string, unknown>);
    res.json({ user: updated });
  });

  app.get('/api/users', requireAuth, requireRole('super_admin', 'admin'), (_req: AuthedRequest, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY id ASC').all() as Record<string, unknown>[];
    res.json({ users: rows.map(mapUserRow) });
  });

  app.post('/api/users', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const actor = req.user!;
    const username = String(req.body?.username || '').trim().toLowerCase();
    const fullName = String(req.body?.fullName || '').trim() || username;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const role = String(req.body?.role || 'staff') as UserRole;
    const rawBranch = String(req.body?.assignedBranch || 'ALL') as BranchCode | 'ALL';
    const assignedBranch: BranchCode | 'ALL' = role === 'staff' ? 'ALL' : rawBranch;
    const receiveNotifications = req.body?.receiveNotifications === undefined ? true : Boolean(req.body.receiveNotifications);

    if (!['super_admin', 'admin', 'staff'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
    if (!['ALL', ...BRANCH_ORDER].includes(assignedBranch)) {
      res.status(400).json({ error: 'Invalid assigned branch' });
      return;
    }
    if (!username || password.length < 6) {
      res.status(400).json({ error: 'Username and password (min 6 chars) are required' });
      return;
    }

    const exists = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(username);
    if (exists) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    const firstSheet = db.prepare('SELECT id FROM google_sheets ORDER BY sort_order ASC LIMIT 1').get() as { id: number } | undefined;
    const info = db
      .prepare(`
        INSERT INTO users (
          username, full_name, email, password_hash, role, assigned_branch,
          is_active, receive_notifications, preferred_sheet_id, preferences_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `)
      .run(
        username,
        fullName,
        email,
        hashPassword(password),
        role,
        assignedBranch,
        receiveNotifications ? 1 : 0,
        firstSheet?.id ?? null,
        JSON.stringify(DEFAULT_USER_PREFERENCES),
        new Date().toISOString()
      );

    const created = mapUserRow(
      db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as Record<string, unknown>
    );
    logAudit(actor.fullName, actor.role, 'CREATE_USER', 'user', String(created.id), `Created ${role} ${username}`);
    res.status(201).json({ user: created });
  });

  app.patch('/api/users/:id', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const actor = req.user!;
    const targetId = Number(req.params.id);
    const targetRow = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as Record<string, unknown> | undefined;
    if (!targetRow) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const target = mapUserRow(targetRow);

    const nextRole = (req.body?.role ?? target.role) as UserRole;
    if (!['super_admin', 'admin', 'staff'].includes(nextRole)) {
      res.status(400).json({ error: 'Invalid account role' });
      return;
    }
    if (target.id === actor.id && req.body?.isActive === false) {
      res.status(400).json({ error: 'You cannot deactivate your own active account' });
      return;
    }
    if (req.body?.password !== undefined && String(req.body.password).length > 0 && String(req.body.password).length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const fullName = req.body?.fullName !== undefined ? String(req.body.fullName).trim() : target.fullName;
    const email = req.body?.email !== undefined ? String(req.body.email).trim().toLowerCase() : target.email;
    const rawAssigned = req.body?.assignedBranch !== undefined ? String(req.body.assignedBranch) : target.assignedBranch;
    const assignedBranch = nextRole === 'staff' ? 'ALL' : rawAssigned;
    const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : target.isActive;
    if (
      target.role === 'super_admin' &&
      (nextRole !== 'super_admin' || !isActive)
    ) {
      const activeSuperAdmins = (
        db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'super_admin' AND is_active = 1").get() as { c: number }
      ).c;
      if (activeSuperAdmins <= 1) {
        res.status(400).json({ error: 'Cannot demote or deactivate the last active Super Admin account' });
        return;
      }
    }
    const receiveNotifications =
      actor.role === 'super_admin' && req.body?.receiveNotifications !== undefined
        ? Boolean(req.body.receiveNotifications)
        : target.receiveNotifications;

    db.prepare(`
      UPDATE users
      SET full_name = ?, email = ?, role = ?, assigned_branch = ?, is_active = ?, receive_notifications = ?
      WHERE id = ?
    `).run(fullName, email, nextRole, assignedBranch, isActive ? 1 : 0, receiveNotifications ? 1 : 0, targetId);

    if (req.body?.password && String(req.body.password).length >= 6) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(req.body.password)), targetId);
    }

    const updated = mapUserRow(db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as Record<string, unknown>);
    logAudit(actor.fullName, actor.role, 'UPDATE_USER', 'user', String(targetId), `Updated user ${updated.username}`);
    res.json({ user: updated });
  });

  app.delete('/api/users/:id', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const actor = req.user!;
    const targetId = Number(req.params.id);
    if (targetId === actor.id) {
      res.status(400).json({ error: 'You cannot delete your own active account' });
      return;
    }
    const targetRow = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as Record<string, unknown> | undefined;
    if (!targetRow) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const target = mapUserRow(targetRow);
    if (target.role === 'super_admin') {
      const saCount = (
        db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'super_admin' AND is_active = 1").get() as { c: number }
      ).c;
      if (saCount <= 1) {
        res.status(400).json({ error: 'Cannot delete the last active Super Admin account' });
        return;
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    logAudit(actor.fullName, actor.role, 'DELETE_USER', 'user', String(targetId), `Deleted ${target.role} ${target.username}`);
    res.json({ ok: true });
  });

  // ==========================================
  // GOOGLE SHEETS DIRECT LINKS
  // ==========================================
  app.get('/api/sheets', requireAuth, (_req, res) => {
    const rows = db.prepare('SELECT * FROM google_sheets ORDER BY sort_order ASC, id ASC').all() as Record<string, unknown>[];
    res.json({
      sheets: rows.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        branchLabel: String(r.branch_label),
        url: String(r.url),
        isAvailable: Boolean(r.is_available),
        sortOrder: Number(r.sort_order),
      })),
    });
  });

  app.post('/api/sheets', requireAuth, requireRole('super_admin'), (req: AuthedRequest, res) => {
    const name = String(req.body?.name || '').trim();
    const branchLabel = String(req.body?.branchLabel || '').trim();
    const url = sanitizeSheetUrl(String(req.body?.url || ''));
    const isAvailable = req.body?.isAvailable !== false;
    if (!name || !url) {
      res.status(400).json({ error: 'Valid sheet name and Google Sheets URL are required' });
      return;
    }
    const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM google_sheets').get() as { m: number }).m;
    const info = db
      .prepare('INSERT INTO google_sheets (name, branch_label, url, is_available, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(name, branchLabel || name, url, isAvailable ? 1 : 0, maxOrder + 1);
    logAudit(req.user!.fullName, req.user!.role, 'CREATE_SHEET', 'google_sheet', String(info.lastInsertRowid), name);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.put('/api/sheets/:id', requireAuth, requireRole('super_admin'), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM google_sheets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Google Sheet entry not found' });
      return;
    }
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : String(existing.name);
    const branchLabel = req.body?.branchLabel !== undefined ? String(req.body.branchLabel).trim() : String(existing.branch_label);
    const url = req.body?.url !== undefined ? sanitizeSheetUrl(String(req.body.url)) : String(existing.url);
    const isAvailable = req.body?.isAvailable !== undefined ? Boolean(req.body.isAvailable) : Boolean(existing.is_available);
    if (!name || !url) {
      res.status(400).json({ error: 'Valid name and URL are required' });
      return;
    }
    db.prepare('UPDATE google_sheets SET name = ?, branch_label = ?, url = ?, is_available = ? WHERE id = ?').run(
      name,
      branchLabel,
      url,
      isAvailable ? 1 : 0,
      id
    );
    if (name.toLowerCase().includes('rajshahi') && extractGoogleSheetCsvUrl(url)) {
      setAppSetting('rajshahi_live_sheet_url', url);
      broadcastRealtimeEvent('sync_status_updated', { reason: 'rajshahi_url_updated' });
    }
    logAudit(req.user!.fullName, req.user!.role, 'UPDATE_SHEET', 'google_sheet', String(id), `${name} -> ${url}`);
    res.json({ ok: true });
  });

  app.delete('/api/sheets/:id', requireAuth, requireRole('super_admin'), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM google_sheets WHERE id = ?').run(id);
    logAudit(req.user!.fullName, req.user!.role, 'DELETE_SHEET', 'google_sheet', String(id), 'Removed Google Sheet link');
    res.json({ ok: true });
  });

  // ==========================================
  // RAJSHAHI LIVE SHEET AUTO-SCANNER ROUTES
  // ==========================================
  app.get('/api/sheets/rajshahi-sync', requireAuth, (_req, res) => {
    res.json({ status: getRajshahiSyncStatus() });
  });

  app.patch('/api/sheets/rajshahi-sync/config', requireAuth, requireRole('super_admin', 'admin'), async (req: AuthedRequest, res) => {
    const rawUrl = req.body?.sheetUrl !== undefined ? String(req.body.sheetUrl).trim() : undefined;
    const autoScanEnabled = req.body?.autoScanEnabled !== undefined ? Boolean(req.body.autoScanEnabled) : undefined;
    const intervalRaw = req.body?.intervalSeconds !== undefined ? Number(req.body.intervalSeconds) : undefined;

    if (rawUrl !== undefined) {
      if (rawUrl === '') {
        setAppSetting('rajshahi_live_sheet_url', '');
        lastSyncError = null;
      } else {
        const sanitized = sanitizeSheetUrl(rawUrl);
        const csvUrl = extractGoogleSheetCsvUrl(sanitized);
        if (!sanitized || !csvUrl || !isAllowedGoogleSheetsUrl(csvUrl)) {
          res.status(400).json({ error: 'Enter a valid public https://docs.google.com/spreadsheets/d/... link' });
          return;
        }
        setAppSetting('rajshahi_live_sheet_url', sanitized);
        // Keep the built-in Rajshahi Sheet link in google_sheets synced too
        db.prepare("UPDATE google_sheets SET url = ? WHERE LOWER(name) LIKE '%rajshahi%'").run(sanitized);
      }
    }

    if (autoScanEnabled !== undefined) {
      setAppSetting('rajshahi_auto_scan_enabled', autoScanEnabled ? '1' : '0');
    }

    if (intervalRaw !== undefined && Number.isFinite(intervalRaw)) {
      const clamped = Math.min(300, Math.max(15, Math.round(intervalRaw)));
      setAppSetting('rajshahi_scan_interval_sec', String(clamped));
    }

    await scheduleNextRajshahiScan();
    logAudit(
      req.user!.fullName,
      req.user!.role,
      'CONFIGURE_RAJSHAHI_SYNC',
      'app_setting',
      'rajshahi_live_sheet',
      `URL=${getConfiguredRajshahiSheetUrl() ? 'set' : 'cleared'}, autoScan=${getAppSetting('rajshahi_auto_scan_enabled', '1')}, interval=${getAppSetting('rajshahi_scan_interval_sec', '30')}s`
    );
    broadcastRealtimeEvent('sync_status_updated', { reason: 'rajshahi_sync_configured' });

    const syncResult =
      getConfiguredRajshahiSheetUrl() && req.body?.scanNow !== false
        ? await syncRajshahiSheetNow(req.user!.fullName)
        : null;

    res.json({
      status: getRajshahiSyncStatus(),
      syncResult,
    });
  });

  // Any authenticated user (including Staff) can trigger a live sheet scan/refresh manually
  app.post('/api/sheets/rajshahi-sync/trigger', requireAuth, async (req: AuthedRequest, res) => {
    const result = await syncRajshahiSheetNow(req.user!.fullName);
    res.json(result);
  });

  // ==========================================
  // INVENTORY & SPECLEGER DATASETS
  // ==========================================
  app.get('/api/laptops/operational', requireAuth, (_req, res) => {
    const opDs = db.prepare('SELECT id FROM datasets WHERE is_operational = 1 LIMIT 1').get() as { id: string } | undefined;
    const datasetId = opDs?.id || 'rajshahi_main';
    const laptops = getLaptopsByDataset(datasetId);
    res.json({ datasetId, laptops });
  });

  app.post('/api/inventory/adjust', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const laptopId = String(req.body?.laptopId || '');
    const rg = Number(req.body?.rg);
    const nm = Number(req.body?.nm);
    const jsm = Number(req.body?.jsm);
    const cc = Number(req.body?.cc);

    if (!laptopId || [rg, nm, jsm, cc].some((n) => !Number.isInteger(n) || n < 0)) {
      res.status(400).json({ error: 'Branch quantities must be non-negative whole numbers' });
      return;
    }

    const row = db.prepare('SELECT * FROM laptops WHERE id = ?').get(laptopId) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Laptop variant not found' });
      return;
    }
    const before = mapLaptopRow(row);
    const qty = rg + nm + jsm + cc;
    const unitPrice = before.disPrice || before.askPrice;
    const totalValue = unitPrice * qty;
    const nowIso = new Date().toISOString();

    const triggered = db.transaction(() => {
      db.prepare('UPDATE laptops SET rg = ?, nm = ?, jsm = ?, cc = ?, qty = ?, total_value = ? WHERE id = ?').run(
        rg,
        nm,
        jsm,
        cc,
        qty,
        totalValue,
        laptopId
      );
      updateDatasetCounts(before.datasetId);

      const updated = mapLaptopRow(db.prepare('SELECT * FROM laptops WHERE id = ?').get(laptopId) as Record<string, unknown>);
      const newTriggers = before.datasetId === 'rajshahi_main' ? syncRefillAlertsForLaptop(updated, nowIso) : [];

      if (newTriggers.length > 0 && isRefillNotificationsEnabled()) {
        const recipients = getNotificationRecipients();
        const insertNotif = db.prepare(`
          INSERT INTO notifications (recipient_user_id, type, title, message, branch, laptop_model, created_at)
          VALUES (?, 'refill_alert', ?, ?, ?, ?, ?)
        `);
        for (const trig of newTriggers) {
          for (const uid of recipients) {
            insertNotif.run(
              uid,
              `Refill Reminder: ${updated.brand} ${updated.model}`,
              `${trig.exhaustedBranch} branch is out of stock (0 units) while other branches hold ${trig.otherBranchesQty} units.`,
              trig.exhaustedBranch,
              `${updated.brand} ${updated.model}`,
              nowIso
            );
          }
        }
      }

      logAudit(
        req.user!.fullName,
        req.user!.role,
        'ADJUST_STOCK',
        'laptop',
        laptopId,
        `${before.brand} ${before.model}: RG ${before.rg}->${rg}, NM ${before.nm}->${nm}, JSM ${before.jsm}->${jsm}, CC ${before.cc}->${cc}`
      );
      return { updated, newTriggers };
    })();

    res.json({ laptop: triggered.updated, triggeredRefills: triggered.newTriggers });
    broadcastRealtimeEvent('inventory_updated', { reason: 'manual_stock_adjust', summary: `${before.brand} ${before.model}` });
  });

  app.get('/api/datasets', requireAuth, (_req, res) => {
    const rows = db.prepare('SELECT * FROM datasets ORDER BY is_operational DESC, imported_at DESC').all() as Record<string, unknown>[];
    res.json({
      datasets: rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        sourceType: r.source_type,
        sourceUrl: r.source_url ? String(r.source_url) : null,
        modelCount: Number(r.model_count),
        totalUnits: Number(r.total_units),
        isOperational: Boolean(r.is_operational),
        importedAt: String(r.imported_at),
      })),
    });
  });

  app.get('/api/datasets/outside-rajshahi', requireAuth, (_req, res) => {
    const rows = db
      .prepare(`
        SELECT l.*, d.name as dataset_name
        FROM laptops l
        JOIN datasets d ON d.id = l.dataset_id
        WHERE l.dataset_id != 'rajshahi_main'
        ORDER BY d.name ASC, l.row_no ASC, l.id ASC
      `)
      .all() as Record<string, unknown>[];
    const laptops = rows.map((r) => ({
      ...mapLaptopRow(r),
      datasetName: String(r.dataset_name || r.dataset_id),
    }));
    res.json({ laptops });
  });

  app.get('/api/datasets/:id/laptops', requireAuth, (req, res) => {
    const id = String(req.params.id);
    const ds = db.prepare('SELECT id, name FROM datasets WHERE id = ?').get(id) as { id: string; name: string } | undefined;
    if (!ds) {
      res.status(404).json({ error: 'Dataset not found' });
      return;
    }
    const laptops = getLaptopsByDataset(id).map((l) => ({ ...l, datasetName: ds.name }));
    res.json({ laptops });
  });

  app.post('/api/datasets/import-file', requireAuth, async (req: AuthedRequest, res) => {
    const name = String(req.body?.name || '').trim();
    const filename = String(req.body?.filename || '').trim().toLowerCase();
    const contentBase64 = String(req.body?.contentBase64 || '');
    const defaultBranch = isBranchCode(req.body?.defaultBranch) ? req.body.defaultBranch : 'RG';

    if (!name || !filename || !contentBase64) {
      res.status(400).json({ error: 'Dataset name, filename, and file content are required' });
      return;
    }

    let rows: string[][] = [];
    const buf = Buffer.from(contentBase64, 'base64');

    if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      const workbook = XLSX.read(buf, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        res.status(400).json({ error: 'Spreadsheet contains no worksheets' });
        return;
      }
      const worksheet = workbook.Sheets[firstSheetName];
      const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false, defval: '' });
      rows = rawMatrix.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []));
    } else {
      const text = buf.toString('utf8');
      rows = parseDelimitedRows(text, filename.endsWith('.tsv') ? '\t' : undefined);
    }

    const datasetId = `ds_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const laptops = parseRowsToLaptops(rows, { datasetId, defaultBranch });
    if (laptops.length === 0) {
      res.status(400).json({ error: 'No valid laptop records could be recognized in the uploaded file' });
      return;
    }

    await createDatabaseBackup(`Pre-import backup (${name})`);
    const totalUnits = laptops.reduce((sum, l) => sum + l.qty, 0);
    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare(`
        INSERT INTO datasets (id, name, source_type, source_url, model_count, total_units, is_operational, imported_at)
        VALUES (?, ?, 'file', NULL, ?, ?, 0, ?)
      `).run(datasetId, name, laptops.length, totalUnits, now);
      insertLaptopsBatch(laptops);
    })();

    logAudit(req.user!.fullName, req.user!.role, 'IMPORT_DATASET_FILE', 'dataset', datasetId, `${name} (${laptops.length} models)`);
    broadcastRealtimeEvent('datasets_updated', { reason: 'import_file', summary: name });
    res.status(201).json({ datasetId, modelCount: laptops.length, totalUnits });
  });

  app.post('/api/datasets/import-sheet', requireAuth, async (req: AuthedRequest, res) => {
    const name = String(req.body?.name || '').trim();
    const rawUrl = sanitizeSheetUrl(String(req.body?.url || ''));
    const defaultBranch = isBranchCode(req.body?.defaultBranch) ? req.body.defaultBranch : 'RG';

    if (!name || !rawUrl) {
      res.status(400).json({ error: 'Dataset name and Google Sheets URL are required' });
      return;
    }

    const csvUrl = extractGoogleSheetCsvUrl(rawUrl);
    if (!csvUrl || !isAllowedGoogleSheetsUrl(csvUrl)) {
      res.status(400).json({ error: 'Only public HTTPS docs.google.com spreadsheet URLs are allowed' });
      return;
    }

    try {
      const resp = await fetch(buildCacheBustedSheetUrl(csvUrl), {
        redirect: 'follow',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!resp.ok) {
        res.status(422).json({ error: `Failed to fetch Google Sheet (${resp.status}). Ensure the sheet is published or shared publicly.` });
        return;
      }
      const csvText = await resp.text();
      if (csvText.trim().startsWith('<!DOCTYPE html') || csvText.trim().startsWith('<html')) {
        res.status(422).json({ error: 'Google returned an HTML sign-in page. Make sure the sheet is published to web or shared publicly.' });
        return;
      }
      const rows = parseDelimitedRows(csvText);
      const datasetId = `gs_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const laptops = parseRowsToLaptops(rows, { datasetId, defaultBranch });
      if (laptops.length === 0) {
        res.status(400).json({ error: 'No valid laptop records found in the Google Sheet' });
        return;
      }

      const totalUnits = laptops.reduce((sum, l) => sum + l.qty, 0);
      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(`
          INSERT INTO datasets (id, name, source_type, source_url, model_count, total_units, is_operational, imported_at)
          VALUES (?, ?, 'google_sheet', ?, ?, ?, 0, ?)
        `).run(datasetId, name, rawUrl, laptops.length, totalUnits, now);
        insertLaptopsBatch(laptops);
      })();

      logAudit(req.user!.fullName, req.user!.role, 'IMPORT_DATASET_SHEET', 'dataset', datasetId, `${name} (${laptops.length} models)`);
      broadcastRealtimeEvent('datasets_updated', { reason: 'import_sheet', summary: name });
      res.status(201).json({ datasetId, modelCount: laptops.length, totalUnits });
    } catch (err) {
      res.status(502).json({ error: `Unable to fetch Google Sheet: ${(err as Error).message}` });
    }
  });

  app.post('/api/datasets/:id/refresh', requireAuth, async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    if (id === 'rajshahi_main') {
      if (getConfiguredRajshahiSheetUrl()) {
        const syncRes = await syncRajshahiSheetNow(req.user!.fullName);
        if (syncRes.status.lastError) {
          res.status(422).json({ error: syncRes.status.lastError });
          return;
        }
        res.json({
          modelCount: syncRes.modelCount,
          totalUnits: syncRes.totalUnits,
          importedAt: syncRes.status.lastSyncedAt || new Date().toISOString(),
          summary: syncRes.summary,
          changed: syncRes.changed,
        });
        return;
      }
      const existing = getLaptopsByDataset('rajshahi_main');
      res.json({
        modelCount: existing.length,
        totalUnits: existing.reduce((sum, l) => sum + l.qty, 0),
        importedAt: new Date().toISOString(),
        summary: 'Rajshahi operational inventory refreshed',
        changed: false,
      });
      return;
    }

    const ds = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!ds || ds.source_type !== 'google_sheet' || !ds.source_url) {
      res.status(400).json({ error: 'Only Google Sheet datasets with a saved URL can be refreshed' });
      return;
    }

    const csvUrl = extractGoogleSheetCsvUrl(String(ds.source_url));
    if (!csvUrl || !isAllowedGoogleSheetsUrl(csvUrl)) {
      res.status(400).json({ error: 'Invalid Google Sheets source URL' });
      return;
    }

    try {
      const resp = await fetch(buildCacheBustedSheetUrl(csvUrl), {
        redirect: 'follow',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!resp.ok) {
        res.status(422).json({ error: `Refresh failed (${resp.status})` });
        return;
      }
      const csvText = await resp.text();
      if (csvText.trim().startsWith('<!DOCTYPE html') || csvText.trim().startsWith('<html')) {
        res.status(422).json({ error: 'Google returned an HTML sign-in page. Make sure the sheet is published or shared publicly.' });
        return;
      }
      const laptops = parseRowsToLaptops(parseDelimitedRows(csvText), { datasetId: id, defaultBranch: 'RG' });
      if (laptops.length === 0) {
        res.status(400).json({ error: 'Refreshed sheet contained 0 recognizable laptop records; existing snapshot kept safe.' });
        return;
      }

      const totalUnits = laptops.reduce((sum, l) => sum + l.qty, 0);
      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare('DELETE FROM laptops WHERE dataset_id = ?').run(id);
        insertLaptopsBatch(laptops);
        db.prepare('UPDATE datasets SET model_count = ?, total_units = ?, imported_at = ? WHERE id = ?').run(
          laptops.length,
          totalUnits,
          now,
          id
        );
      })();

      logAudit(req.user!.fullName, req.user!.role, 'REFRESH_DATASET_SHEET', 'dataset', id, `${String(ds.name)} (${laptops.length} models)`);
      broadcastRealtimeEvent('datasets_updated', { reason: 'refresh_dataset', summary: String(ds.name) });
      res.json({ modelCount: laptops.length, totalUnits, importedAt: now });
    } catch (err) {
      res.status(502).json({ error: `Refresh error: ${(err as Error).message}` });
    }
  });

  app.post('/api/datasets/reload-rajshahi', requireAuth, async (req: AuthedRequest, res) => {
    const raw = getBuiltinInventoryAsset('KG_Stock__Rajshahi_dcce8414');
    if (!raw) {
      res.status(404).json({ error: 'Built-in Rajshahi inventory file missing from Worker assets' });
      return;
    }
    await createDatabaseBackup('Pre-reload Rajshahi inventory backup');
    const laptops = parseRowsToLaptops(parseDelimitedRows(raw), { datasetId: 'rajshahi_main' });
    const totalUnits = laptops.reduce((sum, l) => sum + l.qty, 0);
    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare('DELETE FROM laptops WHERE dataset_id = ?').run('rajshahi_main');
      insertLaptopsBatch(laptops);
      db.prepare('UPDATE datasets SET model_count = ?, total_units = ?, imported_at = ? WHERE id = ?').run(
        laptops.length,
        totalUnits,
        now,
        'rajshahi_main'
      );
    })();
    setAppSetting('rajshahi_last_sync_hash', '');
    setAppSetting('rajshahi_last_sync_at', now);
    setAppSetting('rajshahi_last_change_summary', 'Reloaded built-in Rajshahi baseline');

    logAudit(req.user!.fullName, req.user!.role, 'RELOAD_RAJSHAHI', 'dataset', 'rajshahi_main', 'Reloaded built-in Rajshahi stock');
    broadcastRealtimeEvent('inventory_updated', { reason: 'reload_rajshahi_baseline' });
    res.json({ modelCount: laptops.length, totalUnits });
  });

  app.delete('/api/datasets/:id', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    if (id === 'rajshahi_main') {
      res.status(400).json({ error: 'The primary operational Rajshahi dataset cannot be deleted' });
      return;
    }
    db.prepare('DELETE FROM datasets WHERE id = ?').run(id);
    logAudit(req.user!.fullName, req.user!.role, 'DELETE_DATASET', 'dataset', id, 'Deleted SpecLedger dataset');
    broadcastRealtimeEvent('datasets_updated', { reason: 'delete_dataset' });
    res.json({ ok: true });
  });

  // ==========================================
  // LIVE SELL (LAPTOP-ONLY) & SALES LEDGER
  // ==========================================
  app.get('/api/sales/monthly-counts', requireAuth, (req, res) => {
    const rawSoldAt = String(req.query.soldAt || '').trim();
    const parsedSoldAt = rawSoldAt ? Date.parse(rawSoldAt) : NaN;
    const soldAtIso = Number.isFinite(parsedSoldAt) ? new Date(parsedSoldAt).toISOString() : new Date().toISOString();
    const timeZone = req.query.timeZone ? String(req.query.timeZone) : undefined;
    res.json({ counts: getMonthlyBranchCounts(soldAtIso, timeZone) });
  });

  app.post('/api/sales', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const branch = String(req.body?.branch || '').toUpperCase();
    const laptopId = String(req.body?.laptopId || '');
    const serialNumber = String(req.body?.serialNumber || '').trim();
    const salePrice = Number(req.body?.salePrice);
    const discountAmount = Math.max(0, Number(req.body?.discountAmount || 0));
    const lookingPct = formatLookingPercentage(String(req.body?.lookingPct || ''));
    const customerName = String(req.body?.customerName || '').trim();
    const customerPhone = String(req.body?.customerPhone || '').trim();
    const customerLocation = String(req.body?.customerLocation || '').trim().slice(0, 240);
    const liveSellMessageOverride = String(req.body?.liveSellMessageOverride || '').trim().slice(0, 12000);
    const sourceName = String(req.body?.sourceName || '').trim();
    const dealBy = String(req.body?.dealBy || '').trim();
    const assistBy = String(req.body?.assistBy || '').trim();
    const picVideoStatus = String(req.body?.picVideoStatus || '').trim();
    const memoPicStatus = String(req.body?.memoPicStatus || '').trim();
    const dealTime = String(req.body?.dealTime || '').trim();
    const remarks = String(req.body?.remarks || '').trim();
    const adapterNote = String(req.body?.adapterNote || '').trim();
    const timeZone = req.body?.timeZone ? String(req.body.timeZone) : undefined;
    const sheetId = req.body?.sheetId ? Number(req.body.sheetId) : user.preferredSheetId;
    const idempotencyKey = String(req.body?.idempotencyKey || crypto.randomUUID());

    if (!isBranchCode(branch)) {
      res.status(400).json({ error: 'Valid branch (RG, NM, JSM, CC) is required' });
      return;
    }
    if (user.role !== 'staff' && user.assignedBranch !== 'ALL' && user.assignedBranch !== branch) {
      res.status(403).json({ error: `Your account is assigned to ${user.assignedBranch} and cannot log sales for ${branch}` });
      return;
    }
    if (!laptopId || !Number.isFinite(salePrice) || salePrice <= 0) {
      res.status(400).json({ error: 'Valid laptop selection and positive sale price are required' });
      return;
    }

    // Duplicate-sale protection
    const existingSale = db.prepare('SELECT id, invoice_no FROM sales WHERE idempotency_key = ?').get(idempotencyKey) as
      | { id: number; invoice_no: string }
      | undefined;
    if (existingSale) {
      res.status(409).json({ error: `Duplicate sale prevented (Invoice ${existingSale.invoice_no})` });
      return;
    }

    const sheetRow = sheetId
      ? (db.prepare('SELECT id, name, url FROM google_sheets WHERE id = ?').get(sheetId) as
          | { id: number; name: string; url: string }
          | undefined)
      : (db.prepare("SELECT id, name, url FROM google_sheets WHERE name LIKE '%Rajshahi%' ORDER BY sort_order ASC LIMIT 1").get() as
          | { id: number; name: string; url: string }
          | undefined);

    const rawSoldAt = String(req.body?.soldAt || '').trim();
    const parsedSoldAt = rawSoldAt ? Date.parse(rawSoldAt) : NaN;
    const soldAtIso = Number.isFinite(parsedSoldAt) ? new Date(parsedSoldAt).toISOString() : new Date().toISOString();
    const nowIso = new Date().toISOString();

    try {
      const result = db.transaction(() => {
        const laptopRow = db.prepare('SELECT * FROM laptops WHERE id = ?').get(laptopId) as Record<string, unknown> | undefined;
        if (!laptopRow) {
          throw { status: 404, message: 'Selected laptop model not found in operational stock' };
        }
        const laptop = mapLaptopRow(laptopRow);
        if (laptop.datasetId !== 'rajshahi_main') {
          throw { status: 400, message: 'Live Sell only accepts laptops from operational Rajshahi inventory' };
        }

        const currentBranchQty = branch === 'RG' ? laptop.rg : branch === 'NM' ? laptop.nm : branch === 'JSM' ? laptop.jsm : laptop.cc;
        if (currentBranchQty < 1) {
          throw { status: 409, message: `${laptop.brand} ${laptop.model} is out of stock at ${branch}` };
        }

        const nextRg = branch === 'RG' ? laptop.rg - 1 : laptop.rg;
        const nextNm = branch === 'NM' ? laptop.nm - 1 : laptop.nm;
        const nextJsm = branch === 'JSM' ? laptop.jsm - 1 : laptop.jsm;
        const nextCc = branch === 'CC' ? laptop.cc - 1 : laptop.cc;
        const nextQty = nextRg + nextNm + nextJsm + nextCc;
        const nextTotalVal = (laptop.disPrice || laptop.askPrice) * nextQty;

        db.prepare('UPDATE laptops SET rg = ?, nm = ?, jsm = ?, cc = ?, qty = ?, total_value = ? WHERE id = ?').run(
          nextRg,
          nextNm,
          nextJsm,
          nextCc,
          nextQty,
          nextTotalVal,
          laptop.id
        );
        updateDatasetCounts(laptop.datasetId);

        const priorCounts = getMonthlyBranchCounts(soldAtIso, timeZone);
        const monthlyBranchCounts: MonthlyBranchSalesCounts = {
          ...priorCounts,
          [branch]: (priorCounts[branch] || 0) + 1,
        };
        const liveSellMessage = buildLiveSellMessage({
          branch,
          soldAt: soldAtIso,
          laptop,
          adapterNote,
          discountPrice: laptop.disPrice > 0 ? laptop.disPrice : Math.round(salePrice),
          sellingPrice: Math.round(salePrice),
          lookingPct,
          sourceName,
          dealBy,
          assistBy,
          picVideoStatus,
          memoPicStatus,
          dealTime,
          remarks,
          customerLocation,
          remainingRajshahiQty: nextQty,
          remainingBranchStock: { RG: nextRg, NM: nextNm, JSM: nextJsm, CC: nextCc },
          monthlyBranchCounts,
          currencyMode: user.preferences.currencyFormat,
          timeZone,
        });
        // A user may optionally calibrate the generated customer-facing post in the composer.
        const finalLiveSellMessage = liveSellMessageOverride || liveSellMessage;

        const invoiceNo = `KG-${branch}-${Date.now().toString().slice(-6)}`;
        const saleInfo = db
          .prepare(`
            INSERT INTO sales (
              invoice_no, branch, laptop_id, brand, model, variant, serial_number,
              sale_price, discount_amount, looking_pct, customer_name, customer_phone, customer_location,
              remarks, live_sell_message, sheet_id, sheet_name, employee_id, employee_name, sold_at,
              status, idempotency_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
          `)
          .run(
            invoiceNo,
            branch,
            laptop.id,
            laptop.brand,
            laptop.model,
            laptop.variant,
            serialNumber,
            Math.round(salePrice),
            Math.round(discountAmount),
            lookingPct,
            customerName,
            customerPhone,
            customerLocation,
            remarks,
            finalLiveSellMessage,
            sheetRow?.id ?? null,
            sheetRow?.name ?? 'Rajshahi Sheet',
            user.id,
            user.fullName,
            soldAtIso,
            idempotencyKey
          );

        const saleId = Number(saleInfo.lastInsertRowid);

        // Notify selected Admins: Manual Google Sheet Stock Update Reminder
        const recipients = getNotificationRecipients();
        const insertNotif = db.prepare(`
          INSERT INTO notifications (
            recipient_user_id, type, title, message, branch, laptop_model,
            employee_name, sheet_name, sheet_url, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const sheetLabel = sheetRow?.name ?? 'Rajshahi Sheet';
        for (const uid of recipients) {
          insertNotif.run(
            uid,
            'sale_sheet_reminder',
            `Stock update required · ${branch} sale`,
            `Action needed: ${laptop.brand} ${laptop.model} was sold by ${user.fullName} at ${branch}. Please open ${sheetLabel} and manually remove or update the laptop from its stock list.`,
            branch,
            `${laptop.brand} ${laptop.model}`,
            user.fullName,
            sheetLabel,
            sheetRow?.url ?? null,
            nowIso
          );
        }

        // Evaluate Cross-Branch Refill Alert Rule
        const updatedLaptop = mapLaptopRow(
          db.prepare('SELECT * FROM laptops WHERE id = ?').get(laptop.id) as Record<string, unknown>
        );
        const triggeredRefills = syncRefillAlertsForLaptop(updatedLaptop, nowIso);
        if (triggeredRefills.length > 0 && isRefillNotificationsEnabled()) {
          for (const trig of triggeredRefills) {
            for (const uid of recipients) {
              insertNotif.run(
                uid,
                'refill_alert',
                `Refill needed · ${updatedLaptop.brand} ${updatedLaptop.model}`,
                `${trig.exhaustedBranch} stock exhausted (0 units) while other branches hold ${trig.otherBranchesQty} units. Please investigate stock transfer/refill.`,
                trig.exhaustedBranch,
                `${updatedLaptop.brand} ${updatedLaptop.model}`,
                user.fullName,
                null,
                null,
                nowIso
              );
            }
          }
        }

        logAudit(
          user.fullName,
          user.role,
          'CREATE_SALE',
          'sale',
          String(saleId),
          `${invoiceNo} · ${branch} · ${laptop.brand} ${laptop.model} · ৳${Math.round(salePrice)} · Sheet: ${sheetLabel}`
        );

        return {
          saleId,
          invoiceNo,
          liveSellMessage: finalLiveSellMessage,
          remainingRajshahiQty: nextQty,
          monthlyBranchCounts,
          triggeredRefills,
          sheetReminder: {
            title: 'Stock update required',
            message: `Action needed: A laptop has been sold. Please open ${sheetLabel} and manually remove or update the laptop from its stock list.`,
            sheetName: sheetLabel,
            sheetUrl: sheetRow?.url ?? null,
          },
        };
      })();

      broadcastRealtimeEvent('inventory_updated', { reason: 'sale_recorded', summary: result.invoiceNo });
      res.status(201).json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 500).json({ error: e.message || 'Failed to record sale' });
    }
  });

  app.get('/api/sales/my', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM sales WHERE employee_id = ? ORDER BY id DESC LIMIT 50')
      .all(req.user!.id) as Record<string, unknown>[];
    res.json({ sales: rows.map(mapSaleRow) });
  });

  app.get('/api/sales', requireAuth, requireRole('super_admin', 'admin', 'staff'), (req: AuthedRequest, res) => {
    const branch = String(req.query.branch || '').toUpperCase();
    const q = String(req.query.q || '').trim().toLowerCase();
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();
    const employee = String(req.query.employee || '').trim().toLowerCase();

    let rows = db.prepare('SELECT * FROM sales ORDER BY id DESC').all() as Record<string, unknown>[];
    if (isBranchCode(branch)) {
      rows = rows.filter((r) => r.branch === branch);
    }
    if (dateFrom) {
      rows = rows.filter((r) => String(r.sold_at).slice(0, 10) >= dateFrom);
    }
    if (dateTo) {
      rows = rows.filter((r) => String(r.sold_at).slice(0, 10) <= dateTo);
    }
    if (employee) {
      rows = rows.filter((r) => String(r.employee_name).toLowerCase().includes(employee));
    }
    if (q) {
      rows = rows.filter((r) => {
        const hay = `${r.invoice_no} ${r.brand} ${r.model} ${r.variant} ${r.serial_number} ${r.customer_name} ${r.customer_phone} ${r.customer_location || ''} ${r.employee_name} ${r.remarks}`.toLowerCase();
        return hay.includes(q);
      });
    }

    res.json({ sales: rows.map(mapSaleRow) });
  });

  app.post('/api/sales/:id/void', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      res.status(400).json({ error: 'A void reason is required to preserve audit history' });
      return;
    }

    const saleRow = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!saleRow) {
      res.status(404).json({ error: 'Sale transaction not found' });
      return;
    }
    if (saleRow.status === 'voided') {
      res.status(409).json({ error: 'Transaction is already voided' });
      return;
    }

    const nowIso = new Date().toISOString();
    const branch = String(saleRow.branch) as BranchCode;
    const laptopId = String(saleRow.laptop_id);

    db.transaction(() => {
      db.prepare("UPDATE sales SET status = 'voided', void_reason = ?, voided_by = ?, voided_at = ? WHERE id = ?").run(
        reason,
        req.user!.fullName,
        nowIso,
        id
      );

      const laptopRow = db.prepare('SELECT * FROM laptops WHERE id = ?').get(laptopId) as Record<string, unknown> | undefined;
      if (laptopRow) {
        const l = mapLaptopRow(laptopRow);
        const nextRg = branch === 'RG' ? l.rg + 1 : l.rg;
        const nextNm = branch === 'NM' ? l.nm + 1 : l.nm;
        const nextJsm = branch === 'JSM' ? l.jsm + 1 : l.jsm;
        const nextCc = branch === 'CC' ? l.cc + 1 : l.cc;
        const nextQty = nextRg + nextNm + nextJsm + nextCc;
        const nextTotalVal = (l.disPrice || l.askPrice) * nextQty;

        db.prepare('UPDATE laptops SET rg = ?, nm = ?, jsm = ?, cc = ?, qty = ?, total_value = ? WHERE id = ?').run(
          nextRg,
          nextNm,
          nextJsm,
          nextCc,
          nextQty,
          nextTotalVal,
          laptopId
        );
        updateDatasetCounts(l.datasetId);
        const updated = mapLaptopRow(db.prepare('SELECT * FROM laptops WHERE id = ?').get(laptopId) as Record<string, unknown>);
        syncRefillAlertsForLaptop(updated, nowIso);
      }

      logAudit(
        req.user!.fullName,
        req.user!.role,
        'VOID_SALE',
        'sale',
        String(id),
        `Voided ${String(saleRow.invoice_no)} (${branch} · ${String(saleRow.brand)} ${String(saleRow.model)}). Reason: ${reason}`
      );
    })();

    broadcastRealtimeEvent('inventory_updated', { reason: 'sale_voided', summary: String(saleRow.invoice_no) });
    res.json({ ok: true });
  });

  // Permanent sale deletion is reserved exclusively for Super Admin.
  // Both DELETE and POST aliases are supported so browser/proxy layers that
  // interfere with DELETE still have a reliable same-origin mutation path.
  const permanentlyDeleteSale = (req: AuthedRequest, res: Response): void => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid sale ID' });
      return;
    }

    try {
      const result = db.transaction(() => {
        const saleRow = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!saleRow) throw Object.assign(new Error('Sale transaction not found'), { status: 404 });

        const branch = String(saleRow.branch) as BranchCode;
        const laptopId = String(saleRow.laptop_id || '');
        let inventoryRestored = false;

        // A completed sale consumed one physical unit. Restore exactly one unit
        // before removing the ledger row. A voided sale was already restocked.
        if (saleRow.status === 'completed' && laptopId) {
          const laptopRow = db.prepare('SELECT * FROM laptops WHERE id = ?').get(laptopId) as Record<string, unknown> | undefined;
          if (laptopRow) {
            const laptop = mapLaptopRow(laptopRow);
            const nextRg = branch === 'RG' ? laptop.rg + 1 : laptop.rg;
            const nextNm = branch === 'NM' ? laptop.nm + 1 : laptop.nm;
            const nextJsm = branch === 'JSM' ? laptop.jsm + 1 : laptop.jsm;
            const nextCc = branch === 'CC' ? laptop.cc + 1 : laptop.cc;
            const nextQty = nextRg + nextNm + nextJsm + nextCc;
            db.prepare('UPDATE laptops SET rg = ?, nm = ?, jsm = ?, cc = ?, qty = ?, total_value = ? WHERE id = ?').run(
              nextRg, nextNm, nextJsm, nextCc, nextQty, (laptop.disPrice || laptop.askPrice) * nextQty, laptopId
            );
            updateDatasetCounts(laptop.datasetId);
            const updatedRow = db.prepare('SELECT * FROM laptops WHERE id = ?').get(laptopId) as Record<string, unknown> | undefined;
            if (updatedRow) syncRefillAlertsForLaptop(mapLaptopRow(updatedRow), new Date().toISOString());
            inventoryRestored = true;
          }
        }

        // Record the irreversible action inside the same transaction as deletion.
        logAudit(
          req.user!.fullName,
          req.user!.role,
          'DELETE_SALE',
          'sale',
          String(id),
          `Permanently deleted ${String(saleRow.invoice_no)} (${branch} · ${String(saleRow.brand)} ${String(saleRow.model)}). Inventory restored: ${inventoryRestored ? 'yes' : 'no (already voided or laptop unavailable)'}.`
        );
        db.prepare('DELETE FROM sales WHERE id = ?').run(id);
        return { inventoryRestored, invoiceNo: String(saleRow.invoice_no) };
      })();

      broadcastRealtimeEvent('inventory_updated', { reason: 'sale_deleted', summary: result.invoiceNo });
      res.json({ ok: true, inventoryRestored: result.inventoryRestored, invoiceNo: result.invoiceNo });
    } catch (error) {
      const e = error as { status?: number; message?: string };
      console.error('Permanent sale deletion failed:', { saleId: id, message: e.message || String(error) });
      res.status(e.status || 500).json({ error: e.message || 'Failed to delete sale' });
    }
  };

  app.delete('/api/sales/:id', requireAuth, requireRole('super_admin'), permanentlyDeleteSale);
  app.post('/api/sales/:id/delete', requireAuth, requireRole('super_admin'), permanentlyDeleteSale);

  // ==========================================
  // ACCESSORIES & RAM/SSD (SEPARATE FROM LIVE SELL)
  // ==========================================
  app.get('/api/accessories', requireAuth, requireRole('super_admin', 'admin', 'staff'), (_req, res) => {
    const rows = db.prepare('SELECT * FROM accessories ORDER BY category ASC, brand ASC, name ASC').all() as Record<string, unknown>[];
    res.json({ accessories: rows.map(mapAccessoryRow) });
  });

  app.post('/api/accessories', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const brand = String(req.body?.brand || '').trim();
    const name = String(req.body?.name || '').trim();
    const category = String(req.body?.category || 'Accessory') as AccessoryCategory;
    const spec = String(req.body?.spec || '').trim();
    const unitPrice = Math.max(0, Number(req.body?.unitPrice || 0));
    const rg = Math.max(0, Math.floor(Number(req.body?.rg || 0)));
    const nm = Math.max(0, Math.floor(Number(req.body?.nm || 0)));
    const jsm = Math.max(0, Math.floor(Number(req.body?.jsm || 0)));
    const cc = Math.max(0, Math.floor(Number(req.body?.cc || 0)));
    const qty = rg + nm + jsm + cc;

    if (!brand || !name) {
      res.status(400).json({ error: 'Brand and item name are required' });
      return;
    }

    const info = db
      .prepare(`
        INSERT INTO accessories (brand, name, category, spec, unit_price, rg, nm, jsm, cc, qty, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(brand, name, category, spec, Math.round(unitPrice), rg, nm, jsm, cc, qty, new Date().toISOString());

    logAudit(req.user!.fullName, req.user!.role, 'CREATE_ACCESSORY', 'accessory', String(info.lastInsertRowid), `${brand} ${name}`);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.put('/api/accessories/:id', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const rg = Math.max(0, Math.floor(Number(req.body?.rg || 0)));
    const nm = Math.max(0, Math.floor(Number(req.body?.nm || 0)));
    const jsm = Math.max(0, Math.floor(Number(req.body?.jsm || 0)));
    const cc = Math.max(0, Math.floor(Number(req.body?.cc || 0)));
    const unitPrice = Math.max(0, Math.round(Number(req.body?.unitPrice || 0)));
    const qty = rg + nm + jsm + cc;

    db.prepare('UPDATE accessories SET unit_price = ?, rg = ?, nm = ?, jsm = ?, cc = ?, qty = ?, updated_at = ? WHERE id = ?').run(
      unitPrice,
      rg,
      nm,
      jsm,
      cc,
      qty,
      new Date().toISOString(),
      id
    );
    logAudit(req.user!.fullName, req.user!.role, 'UPDATE_ACCESSORY', 'accessory', String(id), `Updated qty=${qty}`);
    res.json({ ok: true });
  });

  app.delete('/api/accessories/:id', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM accessories WHERE id = ?').run(id);
    logAudit(req.user!.fullName, req.user!.role, 'DELETE_ACCESSORY', 'accessory', String(id), 'Deleted accessory item');
    res.json({ ok: true });
  });

  // ==========================================
  // REFILL REMINDERS & NOTIFICATIONS
  // ==========================================
  app.get('/api/refill-alerts', requireAuth, requireRole('super_admin', 'admin', 'staff'), (_req, res) => {
    res.json({ alerts: getAllRefillAlerts() });
  });

  app.post('/api/refill-alerts/resolve-all', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const nowIso = new Date().toISOString();
    const info = db
      .prepare("UPDATE refill_alerts SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE status = 'active'")
      .run(nowIso, req.user!.fullName);
    db.prepare("UPDATE notifications SET is_read = 1 WHERE type = 'refill_alert'").run();
    logAudit(
      req.user!.fullName,
      req.user!.role,
      'RESOLVE_ALL_REFILLS',
      'refill_alert',
      'all',
      `Resolved ${info.changes} active refill alert(s)`
    );
    broadcastRealtimeEvent('inventory_updated', { reason: 'refills_resolved_all' });
    res.json({ ok: true, resolvedCount: info.changes });
  });

  app.post('/api/refill-alerts/:id/resolve', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    db.prepare("UPDATE refill_alerts SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE id = ?").run(
      new Date().toISOString(),
      req.user!.fullName,
      id
    );
    logAudit(req.user!.fullName, req.user!.role, 'RESOLVE_REFILL', 'refill_alert', String(id), 'Marked refill alert resolved');
    broadcastRealtimeEvent('inventory_updated', { reason: 'refill_resolved' });
    res.json({ ok: true });
  });

  app.get('/api/settings/refill-notifications', requireAuth, (_req, res) => {
    res.json({ enabled: isRefillNotificationsEnabled() });
  });

  app.patch('/api/settings/refill-notifications', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const enabled = Boolean(req.body?.enabled);
    setAppSetting('refill_notifications_enabled', enabled ? '1' : '0');
    logAudit(
      req.user!.fullName,
      req.user!.role,
      'TOGGLE_REFILL_NOTIFICATIONS',
      'app_setting',
      'refill_notifications_enabled',
      `Set refill stock notifications to ${enabled ? 'enabled' : 'disabled'}`
    );
    res.json({ enabled });
  });

  app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM notifications WHERE recipient_user_id = ? ORDER BY id DESC LIMIT 100')
      .all(req.user!.id) as Record<string, unknown>[];
    const notifications = rows.map((r) => ({
      id: Number(r.id),
      recipientUserId: Number(r.recipient_user_id),
      type: r.type,
      title: String(r.title),
      message: String(r.message),
      branch: r.branch ? (String(r.branch) as BranchCode) : null,
      laptopModel: r.laptop_model ? String(r.laptop_model) : null,
      employeeName: r.employee_name ? String(r.employee_name) : null,
      sheetName: r.sheet_name ? String(r.sheet_name) : null,
      sheetUrl: r.sheet_url ? String(r.sheet_url) : null,
      isRead: Boolean(r.is_read),
      createdAt: String(r.created_at),
    }));
    const unreadCount = notifications.filter((n) => !n.isRead).length;
    res.json({ notifications, unreadCount });
  });

  app.post('/api/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_user_id = ?').run(
      Number(req.params.id),
      req.user!.id
    );
    res.json({ ok: true });
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE recipient_user_id = ?').run(req.user!.id);
    res.json({ ok: true });
  });

  // ==========================================
  // REPORTS & AUDIT LOGS
  // ==========================================
  app.get('/api/reports', requireAuth, requireRole('super_admin', 'admin', 'staff'), (req: AuthedRequest, res) => {
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();
    const rows = (db.prepare("SELECT * FROM sales WHERE status = 'completed' ORDER BY id DESC").all() as Record<string, unknown>[])
      .map(mapSaleRow)
      .filter((s) => {
        const day = s.soldAt.slice(0, 10);
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
        return true;
      });

    const totalRevenue = rows.reduce((sum, s) => sum + s.salePrice, 0);
    const totalDiscount = rows.reduce((sum, s) => sum + s.discountAmount, 0);

    const branchTotals = BRANCH_ORDER.map((branch) => {
      const items = rows.filter((s) => s.branch === branch);
      return {
        branch,
        count: items.length,
        revenue: items.reduce((sum, s) => sum + s.salePrice, 0),
        discount: items.reduce((sum, s) => sum + s.discountAmount, 0),
      };
    });

    const empMap = new Map<string, { employeeName: string; count: number; revenue: number }>();
    const modelMap = new Map<string, { brand: string; model: string; count: number; revenue: number }>();
    const dailyMap = new Map<string, { date: string; count: number; revenue: number }>();
    const monthlyMap = new Map<string, { month: string; count: number; revenue: number }>();

    for (const s of rows) {
      const emp = empMap.get(s.employeeName) || { employeeName: s.employeeName, count: 0, revenue: 0 };
      emp.count += 1;
      emp.revenue += s.salePrice;
      empMap.set(s.employeeName, emp);

      const mKey = `${s.brand} ${s.model}`;
      const mod = modelMap.get(mKey) || { brand: s.brand, model: s.model, count: 0, revenue: 0 };
      mod.count += 1;
      mod.revenue += s.salePrice;
      modelMap.set(mKey, mod);

      const day = s.soldAt.slice(0, 10);
      const d = dailyMap.get(day) || { date: day, count: 0, revenue: 0 };
      d.count += 1;
      d.revenue += s.salePrice;
      dailyMap.set(day, d);

      const mon = s.soldAt.slice(0, 7);
      const m = monthlyMap.get(mon) || { month: mon, count: 0, revenue: 0 };
      m.count += 1;
      m.revenue += s.salePrice;
      monthlyMap.set(mon, m);
    }

    res.json({
      summary: {
        totalUnitsSold: rows.length,
        totalRevenue,
        totalDiscount,
      },
      branchTotals,
      employeeSales: Array.from(empMap.values()).sort((a, b) => b.revenue - a.revenue),
      modelSales: Array.from(modelMap.values()).sort((a, b) => b.count - a.count || b.revenue - a.revenue),
      dailySales: Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date)),
      monthlySales: Array.from(monthlyMap.values()).sort((a, b) => b.month.localeCompare(a.month)),
      transactions: rows,
    });
  });

  app.get('/api/audit-logs', requireAuth, requireRole('super_admin', 'admin'), (_req, res) => {
    const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 150').all() as Record<string, unknown>[];
    res.json({
      logs: rows.map((r) => ({
        id: Number(r.id),
        actorName: String(r.actor_name),
        actorRole: r.actor_role,
        action: String(r.action),
        entityType: String(r.entity_type),
        entityId: String(r.entity_id),
        details: String(r.details),
        createdAt: String(r.created_at),
      })),
    });
  });

  // ==========================================
  // STAFF & USER SESSION VIEWER (ADMIN & SUPER ADMIN)
  // ==========================================
  app.get('/api/session-logs', requireAuth, requireRole('super_admin', 'admin'), (req: AuthedRequest, res) => {
    const nowIso = new Date().toISOString();
    // Mark logs whose active session expired
    db.prepare(`
      UPDATE user_session_logs
      SET status = 'expired', logout_at = COALESCE(logout_at, last_seen_at)
      WHERE status = 'active'
        AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE expires_at >= ?)
    `).run(nowIso);

    const roleFilter = String(req.query.role || '').trim();
    let rows = db.prepare('SELECT * FROM user_session_logs ORDER BY id DESC LIMIT 250').all() as Record<string, unknown>[];
    if (roleFilter && ['super_admin', 'admin', 'staff'].includes(roleFilter)) {
      rows = rows.filter((r) => r.role === roleFilter);
    }

    const twoMinsAgo = Date.now() - 2 * 60 * 1000;
    const sessions: SessionLogRecord[] = rows.map((r) => ({
      id: Number(r.id),
      userId: Number(r.user_id),
      username: String(r.username),
      fullName: String(r.full_name),
      role: r.role as UserRole,
      loginAt: String(r.login_at),
      lastSeenAt: String(r.last_seen_at),
      logoutAt: r.logout_at ? String(r.logout_at) : null,
      activeSeconds: Number(r.active_seconds || 0),
      userAgent: String(r.user_agent || ''),
      ipAddress: String(r.ip_address || ''),
      status: r.status as SessionLogRecord['status'],
    }));

    const summaryMap = new Map<number, UserSessionSummary>();
    for (const s of sessions) {
      const isOnlineNow = s.status === 'active' && (Date.parse(s.lastSeenAt) || 0) >= twoMinsAgo;
      const existing = summaryMap.get(s.userId);
      if (!existing) {
        summaryMap.set(s.userId, {
          userId: s.userId,
          username: s.username,
          fullName: s.fullName,
          role: s.role,
          sessionCount: 1,
          totalActiveSeconds: s.activeSeconds,
          lastLoginAt: s.loginAt,
          lastSeenAt: s.lastSeenAt,
          isOnline: isOnlineNow,
        });
      } else {
        existing.sessionCount += 1;
        existing.totalActiveSeconds += s.activeSeconds;
        if (s.loginAt > existing.lastLoginAt) existing.lastLoginAt = s.loginAt;
        if (s.lastSeenAt > existing.lastSeenAt) existing.lastSeenAt = s.lastSeenAt;
        if (isOnlineNow) existing.isOnline = true;
      }
    }

    res.json({
      sessions,
      summaries: Array.from(summaryMap.values()).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
    });
  });

  // ==========================================
  // DATABASE BACKUPS & SUPER ADMIN RESTORE
  // ==========================================
  app.get('/api/backups', requireAuth, requireRole('super_admin', 'admin'), (_req, res) => {
    const rows = db.prepare('SELECT * FROM backups ORDER BY id DESC LIMIT 50').all() as Record<string, unknown>[];
    res.json({
      backups: rows.map((r) => ({
        id: Number(r.id),
        filename: String(r.filename),
        reason: String(r.reason),
        sizeBytes: Number(r.size_bytes),
        createdAt: String(r.created_at),
      })),
    });
  });

  app.post('/api/backups', requireAuth, requireRole('super_admin', 'admin'), async (req: AuthedRequest, res) => {
    const reason = String(req.body?.reason || `Manual backup by ${req.user!.fullName}`);
    const backup = await createDatabaseBackup(reason);
    logAudit(req.user!.fullName, req.user!.role, 'CREATE_BACKUP', 'backup', String(backup.id), backup.filename);
    res.status(201).json({ backup });
  });

  app.get('/api/backups/:id/download', requireAuth, requireRole('super_admin'), async (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(Number(req.params.id)) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Backup not found' });
      return;
    }
    const content = await getDatabaseBackupContent(String(row.filename));
    if (!content) {
      res.status(404).json({ error: 'Backup data unavailable in the Cloudflare database' });
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${String(row.filename)}"`);
    res.send(content);
  });

  app.post('/api/backups/:id/restore', requireAuth, requireRole('super_admin'), async (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(Number(req.params.id)) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Backup not found' });
      return;
    }

    await createDatabaseBackup('Pre-restore safety snapshot');
    await restoreDatabaseBackup(String(row.filename));
    logAudit(req.user!.fullName, req.user!.role, 'RESTORE_BACKUP', 'backup', String(row.id), `Restored ${String(row.filename)}`);
    res.json({ ok: true });
  });

  // The Cloudflare Worker serves the Vite build through its Assets binding.
  // Express is kept as the API router and exposed through Cloudflare's Node HTTP bridge.
  if (!options.cloudflare) {
    throw new Error('This cloud-hosted edition must be started by cloudflare-worker.ts.');
  }

  try {
    const latest = db.prepare('SELECT created_at FROM backups ORDER BY id DESC LIMIT 1').get() as { created_at: string } | undefined;
    if (!latest) await createDatabaseBackup('Automatic first-start backup');
  } catch (error) {
    console.error('Initial Cloudflare backup skipped:', error);
  }

  const nodeServer = app.listen(PORT);
  await new Promise<void>((resolve, reject) => {
    nodeServer.once('listening', () => resolve());
    nodeServer.once('error', reject);
  });
  console.log(`Khan Gadget | KG Live Sell API ready on Cloudflare (port ${PORT})`);
  await scheduleNextRajshahiScan();

  return httpServerHandler({ port: PORT });

}

function mapSaleRow(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    invoiceNo: String(r.invoice_no),
    branch: r.branch as BranchCode,
    laptopId: String(r.laptop_id),
    brand: String(r.brand),
    model: String(r.model),
    variant: String(r.variant),
    serialNumber: String(r.serial_number),
    salePrice: Number(r.sale_price),
    discountAmount: Number(r.discount_amount),
    lookingPct: String(r.looking_pct),
    customerName: String(r.customer_name),
    customerPhone: String(r.customer_phone),
    customerLocation: String(r.customer_location || ''),
    remarks: String(r.remarks),
    liveSellMessage: String(r.live_sell_message || ''),
    sheetId: r.sheet_id === null ? null : Number(r.sheet_id),
    sheetName: String(r.sheet_name),
    employeeId: Number(r.employee_id),
    employeeName: String(r.employee_name),
    soldAt: String(r.sold_at),
    status: r.status as 'completed' | 'voided',
    voidReason: r.void_reason ? String(r.void_reason) : null,
    voidedBy: r.voided_by ? String(r.voided_by) : null,
    voidedAt: r.voided_at ? String(r.voided_at) : null,
  };
}

function mapAccessoryRow(r: Record<string, unknown>): AccessoryRecord {
  return {
    id: Number(r.id),
    brand: String(r.brand),
    name: String(r.name),
    category: r.category as AccessoryCategory,
    spec: String(r.spec),
    unitPrice: Number(r.unit_price),
    rg: Number(r.rg),
    nm: Number(r.nm),
    jsm: Number(r.jsm),
    cc: Number(r.cc),
    qty: Number(r.qty),
    updatedAt: String(r.updated_at),
  };
}

