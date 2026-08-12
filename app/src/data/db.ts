/**
 * Local store. SQLite on the phone - the whole approved record lives here so
 * the safety path never needs a radio.
 *
 * Identity note: every phone mints a device id on first launch. It is not
 * decoration. Two phones on one site previously produced colliding NCR numbers
 * and colliding sync keys, and the server silently discarded one of them - a
 * nonconformance could vanish with no error anywhere. Everything that leaves
 * this device is now namespaced by that id.
 */
import * as SQLite from 'expo-sqlite';
import { getAdapter } from './adapter';
import type { RecordSnapshot, Ncr, Resolution, Zone } from '../engine/types';
import {
  installIdFor, ncrIdFor, reportIdFor,
  SQL_ZONE_COVERAGE, SQL_SUPERSEDE_OUTBOX, SQL_ZONE_REPORTS,
} from './sql';

export { installIdFor, ncrIdFor, reportIdFor };

let _db: SQLite.SQLiteDatabase | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL, lng REAL
);
CREATE TABLE IF NOT EXISTS units (
  serial TEXT PRIMARY KEY, sku TEXT NOT NULL, rev TEXT NOT NULL, manufactured_date TEXT
);
CREATE TABLE IF NOT EXISTS submittals (
  id TEXT PRIMARY KEY, sku TEXT NOT NULL, description TEXT, discipline TEXT,
  zone_id TEXT NOT NULL, approved_rev TEXT NOT NULL, approved_date TEXT, doc_ref TEXT
);
CREATE TABLE IF NOT EXISTS revisions (
  sku TEXT NOT NULL, rev TEXT NOT NULL, superseded_by TEXT,
  approved_date TEXT, change_note TEXT, PRIMARY KEY (sku, rev)
);
CREATE TABLE IF NOT EXISTS ncrs (
  id TEXT PRIMARY KEY, serial TEXT, sku TEXT, zone_id TEXT,
  installed_rev TEXT, approved_rev TEXT, created_at TEXT,
  confirmed_by TEXT, narrative TEXT, status TEXT
);
CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY, serial TEXT, sku TEXT, zone_id TEXT,
  installed_at TEXT, verified_by TEXT, status TEXT
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, serial TEXT, sku TEXT, zone_id TEXT,
  kind TEXT NOT NULL, note TEXT, reported_by TEXT,
  created_at TEXT NOT NULL, status TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL,
  payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT NOT NULL,
  payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
  synced_at TEXT, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sub_sku_zone ON submittals (sku, zone_id);
CREATE INDEX IF NOT EXISTS idx_ncr_sku_zone ON ncrs (sku, zone_id);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox (synced_at);
`;

export async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('witness.db');
  await _db.execAsync(SCHEMA);
  return _db;
}

async function getMeta(key: string): Promise<string | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = ?`, key,
  );
  return row?.value ?? null;
}

async function setMeta(key: string, value: string): Promise<void> {
  const db = await openDb();
  await db.runAsync(`INSERT OR REPLACE INTO meta VALUES (?,?)`, key, value);
}

/**
 * Stable per-install identifier. Short, readable, and good enough to namespace
 * ids across the handful of phones on one site.
 */
export async function deviceId(): Promise<string> {
  let id = await getMeta('device_id');
  if (!id) {
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const t = Date.now().toString(36).slice(-4).toUpperCase();
    id = `D${t}${rand}`;
    await setMeta('device_id', id);
  }
  return id;
}

/** Who is holding the phone. Attribution on a QA record is the whole point. */
export async function getWorker(): Promise<string | null> {
  return getMeta('worker');
}
export async function setWorker(name: string): Promise<void> {
  await setMeta('worker', name.trim());
}

/**
 * Cheap, stable fingerprint of the approved record.
 *
 * Not cryptographic — it only has to change when the record changes.
 */
function fingerprint(snap: RecordSnapshot): string {
  const shape = JSON.stringify({
    u: snap.units.map(u => `${u.serial}:${u.rev}`).sort(),
    s: snap.submittals.map(x => `${x.id}:${x.sku}:${x.zone_id}:${x.approved_rev}`).sort(),
    r: snap.revisions.map(r => `${r.sku}:${r.rev}:${r.superseded_by}`).sort(),
    n: snap.ncrs.map(n => n.id).sort(),
    i: ((snap as any).installs ?? []).map((i: any) => `${i.id}:${i.status}`).sort(),
    z: (snap.zones ?? []).map(z => z.id).sort(),
  });
  let h = 5381;
  for (let i = 0; i < shape.length; i++) h = ((h * 33) ^ shape.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}-${shape.length.toString(36)}`;
}

/**
 * Idempotent. Loads the approved record into SQLite on first launch.
 *
 * The sync timestamp is stamped at INSTALL time, not baked into the seed file.
 * A hardcoded date meant that every demo filmed more than 24h after the seed was
 * generated silently downgraded every verdict to ADVISORY - correct behaviour
 * for the wrong reason, and invisible until it ruined a take.
 */
export async function ensureSeeded(force = false): Promise<void> {
  const db = await openDb();
  const snap = await getAdapter().fetch();
  const fp = fingerprint(snap);

  // Seeding used to happen exactly once, ever. So a device seeded from an older
  // build kept that record forever — showing numbers that no longer matched the
  // data everyone else had, with nothing on screen to explain it. Now the
  // record carries a fingerprint, and a changed record re-seeds itself.
  if (!force && (await getMeta('seeded')) && (await getMeta('seed_fingerprint')) === fp) {
    return;
  }
  const reseeding = Boolean(await getMeta('seeded'));
  await db.withTransactionAsync(async () => {
    // A refreshed record replaces the old one wholesale. Keeping half of each
    // is what produces numbers nobody can account for.
    if (force || reseeding) {
      for (const t of ['units', 'submittals', 'revisions', 'ncrs', 'installs', 'reports', 'events', 'outbox', 'zones']) {
        await db.runAsync(`DELETE FROM ${t}`);
      }
    }
    for (const z of snap.zones ?? []) {
      await db.runAsync(`INSERT OR REPLACE INTO zones VALUES (?,?,?,?)`,
        z.id, z.name, z.lat ?? null, z.lng ?? null);
    }
    for (const u of snap.units) {
      await db.runAsync(`INSERT OR REPLACE INTO units VALUES (?,?,?,?)`,
        u.serial, u.sku, u.rev, u.manufactured_date ?? null);
    }
    for (const s of snap.submittals) {
      await db.runAsync(`INSERT OR REPLACE INTO submittals VALUES (?,?,?,?,?,?,?,?)`,
        s.id, s.sku, s.description, s.discipline ?? null, s.zone_id,
        s.approved_rev, s.approved_date, s.doc_ref ?? null);
    }
    for (const r of snap.revisions) {
      await db.runAsync(`INSERT OR REPLACE INTO revisions VALUES (?,?,?,?,?)`,
        r.sku, r.rev, r.superseded_by, r.approved_date, r.change_note ?? null);
    }
    for (const n of snap.ncrs) {
      await db.runAsync(`INSERT OR REPLACE INTO ncrs VALUES (?,?,?,?,?,?,?,?,?,?)`,
        n.id, n.serial, n.sku, n.zone_id, n.installed_rev, n.approved_rev,
        n.created_at, n.confirmed_by ?? null, n.narrative ?? null, n.status ?? 'OPEN');
    }
    for (const i of (snap as any).installs ?? []) {
      await db.runAsync(`INSERT OR REPLACE INTO installs VALUES (?,?,?,?,?,?,?)`,
        i.id, i.serial, i.sku, i.zone_id, i.installed_at, i.verified_by ?? null, i.status);
    }
    // Stamped now, so the record is fresh the moment it lands on the device.
    await db.runAsync(`INSERT OR REPLACE INTO meta VALUES ('record_synced_at', ?)`,
      new Date().toISOString());
    await db.runAsync(`INSERT OR REPLACE INTO meta VALUES ('seeded', '1')`);
    await db.runAsync(`INSERT OR REPLACE INTO meta VALUES ('seed_fingerprint', ?)`, fp);
  });
  if (reseeding) await logEvent('RECORD_REFRESHED', { fingerprint: fp });
}

/** Wipe local state and reload the record. Used by the reset gesture. */
export async function resetAll(): Promise<void> {
  await ensureSeeded(true);
}

/** Mark the record as freshly synced - what a real pull from Kaya would do. */
export async function touchSync(): Promise<void> {
  await setMeta('record_synced_at', new Date().toISOString());
}

/**
 * Read the whole record into memory for the engine.
 *
 * Yes, in memory. The record is ~120 units and ~35 submittals - tens of
 * kilobytes. Loading it once means a scan resolves with zero I/O, which is why
 * the verdict lands in well under a second. Call it again after any write, or
 * the engine keeps ruling on a stale copy.
 */
export async function loadSnapshot(): Promise<RecordSnapshot> {
  const db = await openDb();
  const [units, submittals, revisions, ncrs, zones, synced] = await Promise.all([
    db.getAllAsync<any>(`SELECT * FROM units`),
    db.getAllAsync<any>(`SELECT * FROM submittals`),
    db.getAllAsync<any>(`SELECT * FROM revisions`),
    db.getAllAsync<any>(`SELECT * FROM ncrs`),
    db.getAllAsync<any>(`SELECT * FROM zones ORDER BY id`),
    getMeta('record_synced_at'),
  ]);
  return {
    units, submittals, revisions, ncrs, zones: zones as Zone[],
    record_synced_at: synced ?? new Date(0).toISOString(),
  };
}

export async function logEvent(type: string, payload: unknown): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO events (type, payload_json, created_at) VALUES (?,?,?)`,
    type, JSON.stringify(payload), new Date().toISOString(),
  );
}

/**
 * Queue a write for the server. Returns immediately - never blocks the worker.
 *
 * Supersedes any unsent row for the same record. Since ids are derived from the
 * thing rather than the moment, re-scanning a part produces an identical
 * payload; without this, twenty rehearsal scans of one tag became twenty queued
 * rows and the header read "20 queued" while the data was perfectly correct.
 */
export async function enqueue(endpoint: string, payload: any): Promise<void> {
  const db = await openDb();
  const id = payload?.id ?? null;
  if (id) {
    // json_extract needs SQLite's JSON1 extension. It is present in every build
    // expo-sqlite ships, but a failure here would break the scan flow itself —
    // and de-duplicating the queue is a nicety, not a correctness requirement.
    // Worst case we queue a duplicate; the server dedupes by id anyway.
    try {
      await db.runAsync(SQL_SUPERSEDE_OUTBOX, endpoint, id);
    } catch {
      // ignore - superseding is best-effort
    }
  }
  await db.runAsync(
    `INSERT INTO outbox (endpoint, payload_json, created_at) VALUES (?,?,?)`,
    endpoint, JSON.stringify(payload), new Date().toISOString(),
  );
}

export async function pendingCount(): Promise<number> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM outbox WHERE synced_at IS NULL`,
  );
  return row?.n ?? 0;
}


/** A human confirmed the flag. Only now does it become a real NCR. */
export async function commitNcr(r: Resolution, confirmedBy: string): Promise<Ncr> {
  const db = await openDb();
  const ncr: Ncr = {
    id: ncrIdFor(r.zone_id, r.serial, r.installedRev ?? '?'),
    serial: r.serial, sku: r.sku, zone_id: r.zone_id,
    installed_rev: r.installedRev ?? '?', approved_rev: r.approvedRev ?? '?',
    created_at: new Date().toISOString(), confirmed_by: confirmedBy,
    narrative:
      `Scanned unit ${r.serial} is Rev ${r.installedRev}. ` +
      `${r.zone_id} approves Rev ${r.approvedRev}` +
      (r.supersededChain.length ? ` (superseded via ${r.supersededChain.join(' -> ')})` : '') +
      `. Identified by ${r.identity.source.toLowerCase()}` +
      (r.identity.source === 'NAMEPLATE'
        ? ` at ${Math.round(r.identity.confidence * 100)}% confidence` : '') +
      `. Flagged at point of install by Witness; confirmed by ${confirmedBy}.`,
    status: 'OPEN',
  };
  await db.runAsync(
    `INSERT OR REPLACE INTO ncrs VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ncr.id, ncr.serial, ncr.sku, ncr.zone_id, ncr.installed_rev, ncr.approved_rev,
    ncr.created_at, ncr.confirmed_by!, ncr.narrative!, ncr.status!,
  );
  // The unit is now known-bad in this location. Leaving its install row
  // untouched left it counted as outstanding work rather than a caught defect.
  const flagged = {
    id: installIdFor(r.zone_id, r.serial), serial: r.serial, sku: r.sku,
    zone_id: r.zone_id, installed_at: ncr.created_at, verified_by: confirmedBy,
    status: 'FLAGGED',
  };
  await db.runAsync(
    `INSERT OR REPLACE INTO installs VALUES (?,?,?,?,?,?,?)`,
    flagged.id, flagged.serial, flagged.sku, flagged.zone_id,
    flagged.installed_at, flagged.verified_by, flagged.status,
  );
  await enqueue('/install', flagged);
  await enqueue('/ncr', ncr);
  await logEvent('NCR_CONFIRMED', ncr);
  return ncr;
}

/**
 * A worker files a problem the record could never have known about.
 *
 * This is the one place in Witness where the worker is the authority rather
 * than the record. No engine verdict is involved and none is implied: whether a
 * part is cracked, or whether the wrong thing turned up on the pallet, is not
 * derivable from the approved submittals. Only the person holding it knows.
 *
 * So it is stored as testimony, attributed and timestamped, and it never
 * changes a verdict. What it CAN do is feed the delivery-level view — enough
 * WRONG_ITEM reports on the same part at the same revision is a mis-order, and
 * that inference is made in server/reorder.mjs where it can be tested.
 */
export type ReportKind = 'DAMAGED' | 'WRONG_ITEM' | 'OTHER';

export interface WorkerReport {
  id: string;
  serial: string;
  sku: string;
  zone_id: string;
  kind: ReportKind;
  note: string;
  reported_by: string;
  created_at: string;
  status: 'OPEN' | 'CLOSED';
}

export async function commitReport(
  { serial, sku, zoneId }: { serial: string; sku: string; zoneId: string },
  kind: ReportKind,
  note: string,
  reportedBy: string,
): Promise<WorkerReport> {
  const db = await openDb();
  const report: WorkerReport = {
    id: reportIdFor(zoneId, serial, kind),
    serial, sku, zone_id: zoneId, kind,
    note: note.trim(),
    reported_by: reportedBy,
    created_at: new Date().toISOString(),
    status: 'OPEN',
  };
  await db.runAsync(
    `INSERT OR REPLACE INTO reports VALUES (?,?,?,?,?,?,?,?,?)`,
    report.id, report.serial, report.sku, report.zone_id, report.kind,
    report.note, report.reported_by, report.created_at, report.status,
  );
  await enqueue('/report', report);
  await logEvent('REPORT_FILED', report);
  return report;
}

/** Worker notes already filed for a location. */
export async function reportsForZone(zoneId: string): Promise<WorkerReport[]> {
  const db = await openDb();
  return db.getAllAsync<WorkerReport>(SQL_ZONE_REPORTS, zoneId);
}

/** A clean scan is field verification. The scan doubles as the sign-off. */
export async function recordVerifiedInstall(r: Resolution, by: string): Promise<void> {
  const db = await openDb();
  const install = {
    id: installIdFor(r.zone_id, r.serial),
    serial: r.serial, sku: r.sku, zone_id: r.zone_id,
    installed_at: new Date().toISOString(), verified_by: by, status: 'VERIFIED',
  };
  await db.runAsync(
    `INSERT OR REPLACE INTO installs VALUES (?,?,?,?,?,?,?)`,
    install.id, install.serial, install.sku, install.zone_id,
    install.installed_at, install.verified_by, install.status,
  );
  await enqueue('/install', install);
  await logEvent('INSTALL_VERIFIED', install);
}

/**
 * Field-verified coverage per zone, counted in distinct units.
 *
 * NOTE: nothing in the app calls this today — the supervisor dashboard computes
 * the same figures server-side from synced data. It is kept because the query is
 * the phone-side equivalent and is covered by sync.test.ts, so an on-device
 * summary screen can use it without re-deriving the rules. Flagging it plainly
 * so nobody assumes the app is already running it.
 */
export async function zoneCoverage(): Promise<
  { zone_id: string; verified: number; flagged: number; pct: number }[]
> {
  const db = await openDb();
  const rows = await db.getAllAsync<any>(SQL_ZONE_COVERAGE);
  return rows.map(r => ({
    zone_id: r.zone_id, verified: r.verified, flagged: r.flagged,
    pct: r.total ? Math.round((r.verified / r.total) * 100) : 0,
  }));
}
