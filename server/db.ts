import crypto from 'node:crypto';
import { createCloudflareSqliteCompat } from './cloudflare-sqlite.ts';
import { parseDelimitedRows, parseRowsToLaptops } from '../src/lib/specParser.ts';
import { evaluateRefillForLaptop } from '../src/lib/refillLogic.ts';
import { sanitizeSheetUrl } from '../src/lib/formatters.ts';
import type {
  AccessoryRecord,
  AuditLogRecord,
  BranchCode,
  DatasetSummary,
  GoogleSheetRecord,
  LaptopRecord,
  NotificationRecord,
  RefillAlertRecord,
  SaleRecord,
  UserAccount,
  UserPreferences,
  UserRole,
} from '../src/lib/types.ts';
import { DEFAULT_USER_PREFERENCES } from '../src/lib/types.ts';

const runtime = globalThis as typeof globalThis & {
  __KG_SQL_STORAGE__?: {
    exec(query: string, ...bindings: unknown[]): {
      toArray(): Array<Record<string, unknown>>;
      rowsWritten?: number;
    };
    transactionSync<T>(callback: () => T): T;
  };
  __KG_BUILTIN_ASSETS__?: Record<string, string>;
};

if (!runtime.__KG_SQL_STORAGE__) {
  throw new Error('Cloudflare SQLite storage was not initialized before loading the database module.');
}

export const db = createCloudflareSqliteCompat(() => {
  const current = runtime.__KG_SQL_STORAGE__;
  if (!current) throw new Error('Cloudflare SQLite storage is not currently attached to this Durable Object.');
  return current;
});

export function getBuiltinInventoryAsset(fileName: string): string {
  return runtime.__KG_BUILTIN_ASSETS__?.[fileName] || '';
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set<number>(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version)
  );

  if (!applied.has(1)) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL DEFAULT '',
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('super_admin', 'admin', 'staff')),
          assigned_branch TEXT NOT NULL DEFAULT 'ALL' CHECK(assigned_branch IN ('ALL', 'RG', 'NM', 'JSM', 'CC')),
          is_active INTEGER NOT NULL DEFAULT 1,
          receive_notifications INTEGER NOT NULL DEFAULT 0,
          preferred_sheet_id INTEGER,
          preferences_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS datasets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          source_type TEXT NOT NULL CHECK(source_type IN ('builtin', 'file', 'google_sheet')),
          source_url TEXT,
          model_count INTEGER NOT NULL DEFAULT 0,
          total_units INTEGER NOT NULL DEFAULT 0,
          is_operational INTEGER NOT NULL DEFAULT 0,
          imported_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS laptops (
          id TEXT PRIMARY KEY,
          dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
          row_no INTEGER NOT NULL DEFAULT 0,
          brand TEXT NOT NULL,
          model TEXT NOT NULL,
          variant TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL,
          processor TEXT NOT NULL DEFAULT '',
          cpu_gen INTEGER,
          cpu_cores_threads TEXT NOT NULL DEFAULT '',
          ram_gb INTEGER NOT NULL DEFAULT 0,
          ram_type TEXT NOT NULL DEFAULT '',
          ram_bus TEXT NOT NULL DEFAULT '',
          storage_gb INTEGER NOT NULL DEFAULT 0,
          storage_config TEXT NOT NULL DEFAULT '',
          display_raw TEXT NOT NULL DEFAULT '',
          display_inches REAL,
          resolution TEXT NOT NULL DEFAULT '',
          is_touch INTEGER NOT NULL DEFAULT 0,
          is_x360 INTEGER NOT NULL DEFAULT 0,
          is_oled INTEGER NOT NULL DEFAULT 0,
          refresh_hz INTEGER,
          gpu TEXT NOT NULL DEFAULT '',
          is_dedicated_gpu INTEGER NOT NULL DEFAULT 0,
          condition TEXT NOT NULL DEFAULT 'Used',
          detailed_condition TEXT NOT NULL DEFAULT '',
          ask_price INTEGER NOT NULL DEFAULT 0,
          dis_price INTEGER NOT NULL DEFAULT 0,
          border_price INTEGER NOT NULL DEFAULT 0,
          rg INTEGER NOT NULL DEFAULT 0,
          nm INTEGER NOT NULL DEFAULT 0,
          jsm INTEGER NOT NULL DEFAULT 0,
          cc INTEGER NOT NULL DEFAULT 0,
          qty INTEGER NOT NULL DEFAULT 0,
          total_value INTEGER NOT NULL DEFAULT 0,
          color TEXT NOT NULL DEFAULT '',
          adapter TEXT NOT NULL DEFAULT '',
          battery_backup TEXT NOT NULL DEFAULT '',
          os TEXT NOT NULL DEFAULT '',
          entry_date TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL DEFAULT '',
          serial_warranty TEXT NOT NULL DEFAULT '',
          remarks TEXT NOT NULL DEFAULT '',
          has_detachable_keyboard INTEGER NOT NULL DEFAULT 0,
          has_sim_lte INTEGER NOT NULL DEFAULT 0,
          has_npu INTEGER NOT NULL DEFAULT 0,
          is_clean_condition INTEGER NOT NULL DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_laptops_dataset ON laptops(dataset_id);
        CREATE INDEX IF NOT EXISTS idx_laptops_brand ON laptops(brand);

        CREATE TABLE IF NOT EXISTS accessories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          brand TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL CHECK(category IN ('RAM', 'SSD', 'Adapter', 'Bag', 'Accessory')),
          spec TEXT NOT NULL DEFAULT '',
          unit_price INTEGER NOT NULL DEFAULT 0,
          rg INTEGER NOT NULL DEFAULT 0,
          nm INTEGER NOT NULL DEFAULT 0,
          jsm INTEGER NOT NULL DEFAULT 0,
          cc INTEGER NOT NULL DEFAULT 0,
          qty INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS google_sheets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          branch_label TEXT NOT NULL,
          url TEXT NOT NULL,
          is_available INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS sales (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_no TEXT NOT NULL UNIQUE,
          branch TEXT NOT NULL CHECK(branch IN ('RG', 'NM', 'JSM', 'CC')),
          laptop_id TEXT NOT NULL,
          brand TEXT NOT NULL,
          model TEXT NOT NULL,
          variant TEXT NOT NULL DEFAULT '',
          serial_number TEXT NOT NULL DEFAULT '',
          sale_price INTEGER NOT NULL,
          discount_amount INTEGER NOT NULL DEFAULT 0,
          looking_pct TEXT NOT NULL DEFAULT '',
          customer_name TEXT NOT NULL DEFAULT '',
          customer_phone TEXT NOT NULL DEFAULT '',
          remarks TEXT NOT NULL DEFAULT '',
          sheet_id INTEGER,
          sheet_name TEXT NOT NULL DEFAULT '',
          employee_id INTEGER NOT NULL,
          employee_name TEXT NOT NULL,
          sold_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'voided')),
          void_reason TEXT,
          voided_by TEXT,
          voided_at TEXT,
          idempotency_key TEXT UNIQUE
        );

        CREATE INDEX IF NOT EXISTS idx_sales_branch_date ON sales(branch, sold_at);

        CREATE TABLE IF NOT EXISTS refill_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          laptop_id TEXT NOT NULL,
          brand TEXT NOT NULL,
          model TEXT NOT NULL,
          variant TEXT NOT NULL DEFAULT '',
          exhausted_branch TEXT NOT NULL CHECK(exhausted_branch IN ('RG', 'NM', 'JSM', 'CC')),
          rg INTEGER NOT NULL,
          nm INTEGER NOT NULL,
          jsm INTEGER NOT NULL,
          cc INTEGER NOT NULL,
          other_branches_qty INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'resolved')),
          triggered_at TEXT NOT NULL,
          resolved_at TEXT,
          resolved_by TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_refill_active ON refill_alerts(laptop_id, exhausted_branch, status);

        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN ('sale_sheet_reminder', 'refill_alert', 'system')),
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          branch TEXT,
          laptop_model TEXT,
          employee_name TEXT,
          sheet_name TEXT,
          sheet_url TEXT,
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(recipient_user_id, is_read, created_at);

        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_name TEXT NOT NULL,
          actor_role TEXT NOT NULL,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          details TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS backups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL,
          reason TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
      `);

      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        1,
        'initial_schema',
        new Date().toISOString()
      );
    })();
  }

  if (!applied.has(2)) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_session_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token_hash TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          username TEXT NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL,
          login_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          logout_at TEXT,
          active_seconds INTEGER NOT NULL DEFAULT 0,
          user_agent TEXT NOT NULL DEFAULT '',
          ip_address TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended', 'expired'))
        );

        CREATE INDEX IF NOT EXISTS idx_session_logs_user ON user_session_logs(user_id, login_at);
      `);

      const salesCols = db.prepare('PRAGMA table_info(sales)').all() as Array<{ name: string }>;
      if (!salesCols.some((c) => c.name === 'live_sell_message')) {
        db.exec("ALTER TABLE sales ADD COLUMN live_sell_message TEXT NOT NULL DEFAULT ''");
      }

      // Staff members must not be locked to a single branch
      db.prepare("UPDATE users SET assigned_branch = 'ALL' WHERE role = 'staff'").run();

      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        2,
        'session_viewer_and_live_sell_msg',
        new Date().toISOString()
      );
    })();
  }

  if (!applied.has(3)) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      db.prepare(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('refill_notifications_enabled', '1')"
      ).run();
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        3,
        'app_settings_refill_notifications',
        new Date().toISOString()
      );
    })();
  }

  if (!applied.has(4)) {
    db.transaction(() => {
      const defaults: Array<[string, string]> = [
        ['rajshahi_live_sheet_url', ''],
        ['rajshahi_auto_scan_enabled', '1'],
        ['rajshahi_scan_interval_sec', '10'],
        ['rajshahi_last_sync_hash', ''],
        ['rajshahi_last_sync_at', ''],
        ['rajshahi_last_change_summary', ''],
      ];
      const stmt = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
      for (const [k, v] of defaults) {
        stmt.run(k, v);
      }
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        4,
        'rajshahi_live_sync_settings',
        new Date().toISOString()
      );
    })();
  }

  if (!applied.has(5)) {
    db.transaction(() => {
      const salesCols = db.prepare('PRAGMA table_info(sales)').all() as Array<{ name: string }>;
      if (!salesCols.some((column) => column.name === 'customer_location')) {
        db.exec("ALTER TABLE sales ADD COLUMN customer_location TEXT NOT NULL DEFAULT ''");
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS monthly_branch_sales_calibrations (
          month_key TEXT NOT NULL,
          time_zone TEXT NOT NULL DEFAULT 'UTC',
          branch TEXT NOT NULL CHECK(branch IN ('RG', 'NM', 'JSM', 'CC')),
          count_offset INTEGER NOT NULL DEFAULT 0,
          calibrated_at TEXT NOT NULL,
          calibrated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          PRIMARY KEY (month_key, time_zone, branch)
        );
        CREATE INDEX IF NOT EXISTS idx_sales_calibration_month ON monthly_branch_sales_calibrations(month_key, time_zone);
      `);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        5,
        'monthly_branch_sales_calibration',
        new Date().toISOString()
      );
    })();
  }

  // Defensive reconciliation for the monthly calibration schema. This also
  // repairs installations where the migration marker exists but the table was
  // not created (for example, after an interrupted/manual partial deployment).
  const reconciledSalesCols = db.prepare('PRAGMA table_info(sales)').all() as Array<{ name: string }>;
  if (!reconciledSalesCols.some((column) => column.name === 'customer_location')) {
    db.exec("ALTER TABLE sales ADD COLUMN customer_location TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS monthly_branch_sales_calibrations (
      month_key TEXT NOT NULL,
      time_zone TEXT NOT NULL DEFAULT 'UTC',
      branch TEXT NOT NULL CHECK(branch IN ('RG', 'NM', 'JSM', 'CC')),
      count_offset INTEGER NOT NULL DEFAULT 0,
      calibrated_at TEXT NOT NULL,
      calibrated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      PRIMARY KEY (month_key, time_zone, branch)
    );
    CREATE INDEX IF NOT EXISTS idx_sales_calibration_month
      ON monthly_branch_sales_calibrations(month_key, time_zone);
  `);

  if (!applied.has(6)) {
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      6,
      'monthly_branch_sales_calibration_schema_reconciliation',
      new Date().toISOString()
    );
  }

  // Store exported backup snapshots in the same SQLite-backed Durable Object.
  // Chunking keeps each individual SQL row well below the platform's row-size limit.
  db.exec(`
    CREATE TABLE IF NOT EXISTS backup_objects (
      filename TEXT NOT NULL,
      part_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (filename, part_index)
    );
    CREATE INDEX IF NOT EXISTS idx_backup_objects_filename ON backup_objects(filename, part_index);
  `);
}

export function getAppSetting(key: string, defaultValue = ''): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? String(row.value) : defaultValue;
}

export function setAppSetting(key: string, value: string): void {
  db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function isRefillNotificationsEnabled(): boolean {
  return getAppSetting('refill_notifications_enabled', '1') === '1';
}

export function insertLaptopsBatch(laptops: LaptopRecord[]): void {
  const stmt = db.prepare(`
    INSERT INTO laptops (
      id, dataset_id, row_no, brand, model, variant, category,
      processor, cpu_gen, cpu_cores_threads, ram_gb, ram_type, ram_bus,
      storage_gb, storage_config, display_raw, display_inches, resolution,
      is_touch, is_x360, is_oled, refresh_hz, gpu, is_dedicated_gpu,
      condition, detailed_condition, ask_price, dis_price, border_price,
      rg, nm, jsm, cc, qty, total_value, color, adapter, battery_backup,
      os, entry_date, location, serial_warranty, remarks,
      has_detachable_keyboard, has_sim_lte, has_npu, is_clean_condition
    ) VALUES (
      @id, @datasetId, @rowNo, @brand, @model, @variant, @category,
      @processor, @cpuGen, @cpuCoresThreads, @ramGb, @ramType, @ramBus,
      @storageGb, @storageConfig, @displayRaw, @displayInches, @resolution,
      @isTouch, @isX360, @isOled, @refreshHz, @gpu, @isDedicatedGpu,
      @condition, @detailedCondition, @askPrice, @disPrice, @borderPrice,
      @rg, @nm, @jsm, @cc, @qty, @totalValue, @color, @adapter, @batteryBackup,
      @os, @entryDate, @location, @serialWarranty, @remarks,
      @hasDetachableKeyboard, @hasSimLte, @hasNpu, @isCleanCondition
    )
  `);

  const tx = db.transaction((items: LaptopRecord[]) => {
    for (const l of items) {
      stmt.run({
        id: l.id,
        datasetId: l.datasetId,
        rowNo: l.rowNo,
        brand: l.brand,
        model: l.model,
        variant: l.variant,
        category: l.category,
        processor: l.processor,
        cpuGen: l.cpuGen,
        cpuCoresThreads: l.cpuCoresThreads,
        ramGb: l.ramGb,
        ramType: l.ramType,
        ramBus: l.ramBus,
        storageGb: l.storageGb,
        storageConfig: l.storageConfig,
        displayRaw: l.displayRaw,
        displayInches: l.displayInches,
        resolution: l.resolution,
        isTouch: l.isTouch ? 1 : 0,
        isX360: l.isX360 ? 1 : 0,
        isOled: l.isOled ? 1 : 0,
        refreshHz: l.refreshHz,
        gpu: l.gpu,
        isDedicatedGpu: l.isDedicatedGpu ? 1 : 0,
        condition: l.condition,
        detailedCondition: l.detailedCondition,
        askPrice: l.askPrice,
        disPrice: l.disPrice,
        borderPrice: l.borderPrice,
        rg: l.rg,
        nm: l.nm,
        jsm: l.jsm,
        cc: l.cc,
        qty: l.qty,
        totalValue: l.totalValue,
        color: l.color,
        adapter: l.adapter,
        batteryBackup: l.batteryBackup,
        os: l.os,
        entryDate: l.entryDate,
        location: l.location,
        serialWarranty: l.serialWarranty,
        remarks: l.remarks,
        hasDetachableKeyboard: l.hasDetachableKeyboard ? 1 : 0,
        hasSimLte: l.hasSimLte ? 1 : 0,
        hasNpu: l.hasNpu ? 1 : 0,
        isCleanCondition: l.isCleanCondition ? 1 : 0,
      });
    }
  });
  tx(laptops);
}

export function seedInitialData(): void {
  const sheetCount = (db.prepare('SELECT COUNT(*) as c FROM google_sheets').get() as { c: number }).c;
  if (sheetCount === 0) {
    const defaultSheets = [
      { name: 'Rajshahi Sheet', branchLabel: 'Rajshahi (RG / NM / JSM / CC)', url: 'https://docs.google.com/spreadsheets/', sortOrder: 1 },
      { name: 'Bogura Branch Sheet', branchLabel: 'Bogura Branch', url: 'https://docs.google.com/spreadsheets/', sortOrder: 2 },
      { name: 'Rangpur Sheet', branchLabel: 'Rangpur Branch', url: 'https://docs.google.com/spreadsheets/', sortOrder: 3 },
      { name: 'Dhaka Multiplan Sheet', branchLabel: 'Dhaka Multiplan', url: 'https://docs.google.com/spreadsheets/', sortOrder: 4 },
      { name: 'Dhaka Bashundhara Sheet', branchLabel: 'Dhaka Bashundhara City', url: 'https://docs.google.com/spreadsheets/', sortOrder: 5 },
      { name: 'Mymensingh Branch Sheet', branchLabel: 'Mymensingh Branch', url: 'https://docs.google.com/spreadsheets/', sortOrder: 6 },
      { name: 'Sylhet Branch Sheet', branchLabel: 'Sylhet Branch', url: 'https://docs.google.com/spreadsheets/', sortOrder: 7 },
    ];
    const insertSheet = db.prepare(
      'INSERT INTO google_sheets (name, branch_label, url, is_available, sort_order) VALUES (?, ?, ?, 1, ?)'
    );
    db.transaction(() => {
      for (const s of defaultSheets) {
        insertSheet.run(s.name, s.branchLabel, sanitizeSheetUrl(s.url), s.sortOrder);
      }
    })();
  }

  const datasetCount = (db.prepare('SELECT COUNT(*) as c FROM datasets').get() as { c: number }).c;
  if (datasetCount === 0) {
    const builtinDatasets: Array<{
      id: string;
      name: string;
      file: string;
      isOperational: boolean;
      defaultBranch: BranchCode | null;
    }> = [
      { id: 'rajshahi_main', name: 'Rajshahi Inventory (Main)', file: 'KG_Stock__Rajshahi_dcce8414', isOperational: true, defaultBranch: null },
      { id: 'bogura_snap', name: 'Bogura Branch Stock', file: 'Bogura_5732320b', isOperational: false, defaultBranch: 'RG' },
      { id: 'rangpur_snap', name: 'Rangpur Branch Stock', file: 'Rangpur_082285aa', isOperational: false, defaultBranch: 'RG' },
      { id: 'multiplan_snap', name: 'Dhaka Multiplan Stock', file: 'Multiplan_ed47830a', isOperational: false, defaultBranch: 'RG' },
      { id: 'basundhara_snap', name: 'Dhaka Basundhara City Stock', file: 'Basundhara_City_890cbcc9', isOperational: false, defaultBranch: 'RG' },
      { id: 'mymensingh_snap', name: 'Mymensingh Branch Stock', file: 'Mymensingh_dca747a2', isOperational: false, defaultBranch: 'RG' },
      { id: 'sylhet_snap', name: 'Sylhet Branch Stock', file: 'Sylhet_51adc23d', isOperational: false, defaultBranch: 'RG' },
    ];

    const insertDataset = db.prepare(`
      INSERT INTO datasets (id, name, source_type, source_url, model_count, total_units, is_operational, imported_at)
      VALUES (?, ?, 'builtin', NULL, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const ds of builtinDatasets) {
      const raw = getBuiltinInventoryAsset(ds.file);
      if (!raw) continue;
      const rows = parseDelimitedRows(raw);
      const laptops = parseRowsToLaptops(rows, { datasetId: ds.id, defaultBranch: ds.defaultBranch });
      const totalUnits = laptops.reduce((sum, l) => sum + l.qty, 0);
      insertDataset.run(ds.id, ds.name, laptops.length, totalUnits, ds.isOperational ? 1 : 0, now);
      insertLaptopsBatch(laptops);
    }

    // Seed initial refill alerts for operational Rajshahi inventory
    const mainLaptops = getLaptopsByDataset('rajshahi_main');
    const existingAlerts = getAllRefillAlerts();
    const insertAlert = db.prepare(`
      INSERT INTO refill_alerts (
        laptop_id, brand, model, variant, exhausted_branch,
        rg, nm, jsm, cc, other_branches_qty, status, triggered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `);
    db.transaction(() => {
      for (const laptop of mainLaptops) {
        const evalResult = evaluateRefillForLaptop(laptop, existingAlerts);
        for (const trig of evalResult.toTrigger) {
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
            now
          );
        }
      }
    })();
  }

  const accCount = (db.prepare('SELECT COUNT(*) as c FROM accessories').get() as { c: number }).c;
  if (accCount === 0) {
    const now = new Date().toISOString();
    const seedAcc = [
      { brand: 'Samsung', name: 'DDR4 3200MHz Laptop RAM', category: 'RAM', spec: '16GB SO-DIMM DDR4-3200', unitPrice: 4200, rg: 6, nm: 3, jsm: 2, cc: 2 },
      { brand: 'Crucial', name: 'DDR5 4800MHz Laptop RAM', category: 'RAM', spec: '16GB SO-DIMM DDR5-4800', unitPrice: 5800, rg: 4, nm: 2, jsm: 2, cc: 1 },
      { brand: 'Kingston', name: 'NV2 M.2 PCIe 4.0 SSD', category: 'SSD', spec: '512GB NVMe M.2 2280', unitPrice: 4900, rg: 8, nm: 4, jsm: 3, cc: 2 },
      { brand: 'Samsung', name: '980 PRO NVMe SSD', category: 'SSD', spec: '1TB PCIe 4.0 M.2', unitPrice: 10500, rg: 3, nm: 2, jsm: 1, cc: 1 },
      { brand: 'Dell', name: 'Original 65W USB-C Adapter', category: 'Adapter', spec: '65W Type-C Original', unitPrice: 2400, rg: 10, nm: 4, jsm: 3, cc: 3 },
      { brand: 'HP', name: 'Original 65W Blue Pin Adapter', category: 'Adapter', spec: '65W 4.5mm Blue Tip', unitPrice: 1950, rg: 9, nm: 3, jsm: 3, cc: 2 },
      { brand: 'Lenovo', name: 'Original 65W Type-C Charger', category: 'Adapter', spec: '65W USB-C Original', unitPrice: 2300, rg: 7, nm: 3, jsm: 2, cc: 2 },
      { brand: 'Khan Gadget', name: 'Protective Laptop Backpack', category: 'Bag', spec: '15.6" Water-Resistant', unitPrice: 1450, rg: 15, nm: 6, jsm: 5, cc: 4 },
    ];
    const stmt = db.prepare(`
      INSERT INTO accessories (brand, name, category, spec, unit_price, rg, nm, jsm, cc, qty, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (const a of seedAcc) {
        stmt.run(a.brand, a.name, a.category, a.spec, a.unitPrice, a.rg, a.nm, a.jsm, a.cc, a.rg + a.nm + a.jsm + a.cc, now);
      }
    })();
  }
}

export function mapUserRow(row: Record<string, unknown>): UserAccount {
  let prefs = { ...DEFAULT_USER_PREFERENCES };
  try {
    prefs = { ...DEFAULT_USER_PREFERENCES, ...JSON.parse(String(row.preferences_json || '{}')) };
  } catch {
    prefs = { ...DEFAULT_USER_PREFERENCES };
  }
  return {
    id: Number(row.id),
    username: String(row.username),
    fullName: String(row.full_name),
    email: String(row.email || ''),
    role: row.role as UserRole,
    assignedBranch: row.assigned_branch as BranchCode | 'ALL',
    isActive: Boolean(row.is_active),
    receiveNotifications: Boolean(row.receive_notifications),
    preferredSheetId: row.preferred_sheet_id === null || row.preferred_sheet_id === undefined ? null : Number(row.preferred_sheet_id),
    preferences: prefs,
    createdAt: String(row.created_at),
  };
}

export function mapLaptopRow(row: Record<string, unknown>): LaptopRecord {
  return {
    id: String(row.id),
    datasetId: String(row.dataset_id),
    rowNo: Number(row.row_no),
    brand: String(row.brand),
    model: String(row.model),
    variant: String(row.variant),
    category: row.category as LaptopRecord['category'],
    processor: String(row.processor),
    cpuGen: row.cpu_gen === null ? null : Number(row.cpu_gen),
    cpuCoresThreads: String(row.cpu_cores_threads),
    ramGb: Number(row.ram_gb),
    ramType: String(row.ram_type),
    ramBus: String(row.ram_bus),
    storageGb: Number(row.storage_gb),
    storageConfig: String(row.storage_config),
    displayRaw: String(row.display_raw),
    displayInches: row.display_inches === null ? null : Number(row.display_inches),
    resolution: String(row.resolution),
    isTouch: Boolean(row.is_touch),
    isX360: Boolean(row.is_x360),
    isOled: Boolean(row.is_oled),
    refreshHz: row.refresh_hz === null ? null : Number(row.refresh_hz),
    gpu: String(row.gpu),
    isDedicatedGpu: Boolean(row.is_dedicated_gpu),
    condition: row.condition as LaptopRecord['condition'],
    detailedCondition: String(row.detailed_condition),
    askPrice: Number(row.ask_price),
    disPrice: Number(row.dis_price),
    borderPrice: Number(row.border_price),
    rg: Number(row.rg),
    nm: Number(row.nm),
    jsm: Number(row.jsm),
    cc: Number(row.cc),
    qty: Number(row.qty),
    totalValue: Number(row.total_value),
    color: String(row.color),
    adapter: String(row.adapter),
    batteryBackup: String(row.battery_backup),
    os: String(row.os),
    entryDate: String(row.entry_date),
    location: String(row.location),
    serialWarranty: String(row.serial_warranty),
    remarks: String(row.remarks),
    hasDetachableKeyboard: Boolean(row.has_detachable_keyboard),
    hasSimLte: Boolean(row.has_sim_lte),
    hasNpu: Boolean(row.has_npu),
    isCleanCondition: Boolean(row.is_clean_condition),
  };
}

export function getLaptopsByDataset(datasetId: string): LaptopRecord[] {
  const rows = db.prepare('SELECT * FROM laptops WHERE dataset_id = ? ORDER BY row_no ASC, id ASC').all(datasetId) as Record<string, unknown>[];
  return rows.map(mapLaptopRow);
}

export function getAllRefillAlerts(): RefillAlertRecord[] {
  const rows = db.prepare('SELECT * FROM refill_alerts ORDER BY id DESC').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    laptopId: String(r.laptop_id),
    brand: String(r.brand),
    model: String(r.model),
    variant: String(r.variant),
    exhaustedBranch: r.exhausted_branch as BranchCode,
    rg: Number(r.rg),
    nm: Number(r.nm),
    jsm: Number(r.jsm),
    cc: Number(r.cc),
    otherBranchesQty: Number(r.other_branches_qty),
    status: r.status as 'active' | 'resolved',
    triggeredAt: String(r.triggered_at),
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
    resolvedBy: r.resolved_by ? String(r.resolved_by) : null,
  }));
}

export function logAudit(
  actorName: string,
  actorRole: UserRole,
  action: string,
  entityType: string,
  entityId: string,
  details: string
): void {
  db.prepare(
    'INSERT INTO audit_logs (actor_name, actor_role, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(actorName, actorRole, action, entityType, entityId, details, new Date().toISOString());
}

const BACKUP_TABLES = [
  'datasets',
  'laptops',
  'accessories',
  'google_sheets',
  'sales',
  'refill_alerts',
] as const;

const BACKUP_CHUNK_SIZE = 500_000;

export async function createDatabaseBackup(reason: string): Promise<{ id: number; filename: string; sizeBytes: number; createdAt: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `kg_live_sell_${stamp}.json`;
  const createdAt = new Date().toISOString();
  const tables: Record<string, unknown[]> = {};

  for (const table of BACKUP_TABLES) {
    tables[table] = db.prepare(`SELECT * FROM ${table}`).all() as unknown[];
  }

  const payload = JSON.stringify({
    format: 'kg-live-sell-cloudflare-backup-v1',
    createdAt,
    tables,
  });
  const sizeBytes = new TextEncoder().encode(payload).byteLength;

  // Store one bounded-size SQL value per chunk to avoid a single oversized row.
  const insertChunk = db.prepare(
    'INSERT INTO backup_objects (filename, part_index, content) VALUES (?, ?, ?)'
  );
  const tx = db.transaction(() => {
    for (let offset = 0, part = 0; offset < payload.length; offset += BACKUP_CHUNK_SIZE, part += 1) {
      insertChunk.run(filename, part, payload.slice(offset, offset + BACKUP_CHUNK_SIZE));
    }
    return db
      .prepare('INSERT INTO backups (filename, reason, size_bytes, created_at) VALUES (?, ?, ?, ?)')
      .run(filename, reason, sizeBytes, createdAt);
  });
  const info = tx();

  return {
    id: Number(info.lastInsertRowid),
    filename,
    sizeBytes,
    createdAt,
  };
}

export async function getDatabaseBackupContent(filename: string): Promise<string | null> {
  // Only generated backup names are accepted; do not allow arbitrary keys.
  if (!/^kg_live_sell_[0-9TZ-]+\.json$/.test(filename)) return null;
  const chunks = db
    .prepare('SELECT content FROM backup_objects WHERE filename = ? ORDER BY part_index ASC')
    .all(filename) as Array<{ content: string }>;
  if (!chunks.length) return null;
  return chunks.map((chunk) => String(chunk.content)).join('');
}

export async function restoreDatabaseBackup(filename: string): Promise<void> {
  const content = await getDatabaseBackupContent(filename);
  if (!content) throw new Error('Backup file not found in the Cloudflare database.');

  const snapshot = JSON.parse(content) as {
    format?: string;
    tables?: Record<string, Array<Record<string, unknown>>>;
  };
  if (snapshot.format !== 'kg-live-sell-cloudflare-backup-v1' || !snapshot.tables) {
    throw new Error('This backup file is not a supported KG Live Sell Cloudflare backup.');
  }

  const rowsByTable = snapshot.tables;
  const deleteOrder = ['refill_alerts', 'sales', 'laptops', 'accessories', 'datasets', 'google_sheets'] as const;
  const insertOrder = ['datasets', 'google_sheets', 'laptops', 'accessories', 'sales', 'refill_alerts'] as const;

  db.transaction(() => {
    for (const table of deleteOrder) {
      db.prepare(`DELETE FROM ${table}`).run();
    }

    for (const table of insertOrder) {
      const rows = rowsByTable[table] || [];
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.length) continue;
        const quotedColumns = columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        db.prepare(`INSERT INTO ${table} (${quotedColumns}) VALUES (${placeholders})`)
          .run(...columns.map((column) => row[column] ?? null));
      }
    }
  })();
}
