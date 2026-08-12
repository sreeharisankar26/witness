/**
 * The SQL and the id derivations, in one place with no native imports.
 *
 * Split out of db.ts so the test suite can exercise the REAL statements against
 * a real SQLite rather than a paraphrase of them. Every regression found in the
 * last review landed in this layer precisely because it had no tests, and a test
 * against a re-typed copy of a query proves nothing.
 *
 * Nothing here may import expo-* — it must load under plain Node.
 */

/**
 * Install id, derived from WHAT was verified rather than when or by whom.
 *
 * A unit in a location is one work item. Scanning it again is that item
 * re-confirmed, not a second install. Time-based ids meant one good part
 * scanned six times drove a zone from 13% to 46% "field-verified".
 *
 * The seed generator uses the identical derivation, so a phone verifying a
 * pre-existing unit REPLACES its row instead of adding a duplicate.
 */
export function installIdFor(zoneId: string, serial: string): string {
  return `INS-${zoneId}-${serial}`;
}

/**
 * NCR id, derived from the FINDING rather than the moment of pressing.
 *
 * Two phones reporting the same wrong part in the same place produce one
 * nonconformance, not two. Two different findings cannot collide.
 */
export function ncrIdFor(zoneId: string, serial: string, installedRev: string): string {
  return `NCR-${zoneId}-${serial}-R${installedRev}`;
}

/**
 * Report id, derived from the FINDING: this unit, in this place, this problem.
 *
 * Consistent with the two ids above, and for the same reason — the same worker
 * re-opening the same crack on the same unit is one problem, not two, and two
 * phones reporting it produce one row rather than a race.
 *
 * The cost of this choice, stated plainly: a second note about the SAME kind of
 * problem on the SAME unit replaces the first rather than appending. That is
 * the right trade for a queue that must not fill with duplicates, and the
 * narrative field is where a worker adds detail.
 */
export function reportIdFor(zoneId: string, serial: string, kind: string): string {
  return `RPT-${zoneId}-${serial}-${kind}`;
}

/** Worker-filed problems for a location, newest first. */
export const SQL_ZONE_REPORTS = `
  SELECT * FROM reports WHERE zone_id = ? ORDER BY created_at DESC`;

/**
 * Coverage per zone, counted in DISTINCT UNITS.
 *
 * Never `COUNT(*)`. Rows can repeat for one physical unit — from a rescan, or
 * from a seeded row and a phone write meeting — and counting rows let the
 * percentage be inflated by waving a single tag at the camera.
 */
export const SQL_ZONE_COVERAGE = `
  SELECT zone_id,
         COUNT(DISTINCT CASE WHEN status = 'VERIFIED' THEN serial END) AS verified,
         COUNT(DISTINCT CASE WHEN status = 'FLAGGED'  THEN serial END) AS flagged,
         COUNT(DISTINCT serial)                                        AS total
  FROM installs GROUP BY zone_id ORDER BY zone_id`;

/**
 * Supersede any unsent queue row for the same record.
 *
 * Ids are derived, so a rescan produces a byte-identical payload. Without this,
 * twenty rehearsal scans became twenty queued rows and the header read
 * "20 queued" while the data was perfectly correct.
 */
export const SQL_SUPERSEDE_OUTBOX = `
  DELETE FROM outbox
  WHERE synced_at IS NULL AND endpoint = ? AND json_extract(payload_json, '$.id') = ?`;

export const SQL_PENDING_OUTBOX = `
  SELECT * FROM outbox WHERE synced_at IS NULL ORDER BY id ASC LIMIT 100`;

export const SQL_MARK_SYNCED = `
  UPDATE outbox SET synced_at = ?, attempts = attempts + 1 WHERE id = ?`;

export const SQL_COUNT_PENDING = `
  SELECT COUNT(*) AS n FROM outbox WHERE synced_at IS NULL`;

/** Prior nonconformances for a component in a location, oldest first. */
export const SQL_PRIOR_NCRS = `
  SELECT * FROM ncrs WHERE sku = ? AND zone_id = ? ORDER BY created_at ASC`;
