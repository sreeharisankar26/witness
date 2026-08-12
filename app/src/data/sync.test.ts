/**
 * Sync and data-layer tests.
 *
 *   npm test
 *
 * Every regression in the last two reviews landed HERE — the layer that had no
 * tests — while the engine, which has them, stayed clean. These run the REAL
 * SQL strings from sql.ts against Node's built-in SQLite, so a query that drifts
 * fails the suite rather than the demo.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  installIdFor, ncrIdFor, reportIdFor,
  SQL_ZONE_COVERAGE, SQL_SUPERSEDE_OUTBOX, SQL_PENDING_OUTBOX,
  SQL_MARK_SYNCED, SQL_COUNT_PENDING,
} from './sql.ts';
import { classifyStatus, describe as describeOutcome } from '../sync/policy.ts';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE installs (id TEXT PRIMARY KEY, serial TEXT, sku TEXT, zone_id TEXT,
      installed_at TEXT, verified_by TEXT, status TEXT);
    CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
      synced_at TEXT, attempts INTEGER NOT NULL DEFAULT 0);
  `);
  return db;
}

/** Mirrors db.recordVerifiedInstall / commitNcr's install write. */
function upsertInstall(db: any, zone: string, serial: string, sku: string, status: string) {
  db.prepare(`INSERT OR REPLACE INTO installs VALUES (?,?,?,?,?,?,?)`)
    .run(installIdFor(zone, serial), serial, sku, zone, 't', 'M. Nair', status);
}

/** Mirrors db.enqueue. */
function enqueue(db: any, endpoint: string, payload: any) {
  if (payload?.id) db.prepare(SQL_SUPERSEDE_OUTBOX).run(endpoint, payload.id);
  db.prepare(`INSERT INTO outbox (endpoint, payload_json, created_at) VALUES (?,?,?)`)
    .run(endpoint, JSON.stringify(payload), 't');
}

const coverage = (db: any, zone: string) =>
  db.prepare(SQL_ZONE_COVERAGE).all().find((r: any) => r.zone_id === zone);
const pct = (r: any) => (r.total ? Math.round((r.verified / r.total) * 100) : 0);

describe('derived ids', () => {
  test('an install id depends only on where and what', () => {
    assert.equal(installIdFor('ZONE-A', 'SN-4471'), 'INS-ZONE-A-SN-4471');
    assert.equal(installIdFor('ZONE-A', 'SN-4471'), installIdFor('ZONE-A', 'SN-4471'));
  });

  test('the same unit in a different zone is a different work item', () => {
    assert.notEqual(installIdFor('ZONE-A', 'SN-4471'), installIdFor('ZONE-B', 'SN-4471'));
  });

  test('an NCR id depends only on the finding', () => {
    assert.equal(ncrIdFor('ZONE-A', 'SN-4471', 'B'), 'NCR-ZONE-A-SN-4471-RB');
  });

  test('a different revision is a different finding', () => {
    assert.notEqual(ncrIdFor('ZONE-A', 'SN-4471', 'B'), ncrIdFor('ZONE-A', 'SN-4471', 'A'));
  });

  test('a report id depends only on the unit, the place and the problem', () => {
    assert.equal(reportIdFor('ZONE-A', 'SN-4471', 'DAMAGED'), 'RPT-ZONE-A-SN-4471-DAMAGED');
  });

  test('two different problems with one unit are two reports', () => {
    assert.notEqual(
      reportIdFor('ZONE-A', 'SN-4471', 'DAMAGED'),
      reportIdFor('ZONE-A', 'SN-4471', 'WRONG_ITEM'),
    );
  });

  test('ids carry no clock and no device — two phones agree', () => {
    // Time- or device-based ids made every rescan a brand new record, which is
    // what inflated coverage and duplicated NCRs across phones.
    assert.equal(installIdFor('ZONE-A', 'SN-1'), installIdFor('ZONE-A', 'SN-1'));
    assert.doesNotMatch(installIdFor('ZONE-A', 'SN-1'), /\d{10,}/);
  });
});

describe('coverage cannot be inflated', () => {
  test('re-verifying the same unit does not move the number', () => {
    const db = freshDb();
    for (const s of ['SN-1', 'SN-2', 'SN-3', 'SN-4']) upsertInstall(db, 'ZONE-A', s, 'GT-12', 'PENDING');
    const before = coverage(db, 'ZONE-A');
    assert.equal(pct(before), 0);

    for (let i = 0; i < 20; i++) upsertInstall(db, 'ZONE-A', 'SN-1', 'GT-12', 'VERIFIED');
    const after = coverage(db, 'ZONE-A');
    assert.equal(after.verified, 1);
    assert.equal(after.total, 4, 'the denominator must not grow');
    assert.equal(pct(after), 25);
  });

  test('verifying a genuinely different unit does move it', () => {
    const db = freshDb();
    for (const s of ['SN-1', 'SN-2', 'SN-3', 'SN-4']) upsertInstall(db, 'ZONE-A', s, 'GT-12', 'PENDING');
    upsertInstall(db, 'ZONE-A', 'SN-1', 'GT-12', 'VERIFIED');
    assert.equal(pct(coverage(db, 'ZONE-A')), 25);
    upsertInstall(db, 'ZONE-A', 'SN-2', 'GT-12', 'VERIFIED');
    assert.equal(pct(coverage(db, 'ZONE-A')), 50);
  });

  test('a duplicate row for one serial still counts once', () => {
    // A seeded row and a phone write can meet with different ids. The query has
    // to be robust to that on its own.
    const db = freshDb();
    upsertInstall(db, 'ZONE-A', 'SN-1', 'GT-12', 'VERIFIED');
    db.prepare(`INSERT OR REPLACE INTO installs VALUES (?,?,?,?,?,?,?)`)
      .run('INS-0001', 'SN-1', 'GT-12', 'ZONE-A', 't', null, 'PENDING');   // legacy id
    const c = coverage(db, 'ZONE-A');
    assert.equal(c.total, 1, 'one physical unit is one work item');
    assert.equal(c.verified, 1);
  });

  test('coverage never exceeds 100% however hard you scan', () => {
    const db = freshDb();
    upsertInstall(db, 'ZONE-A', 'SN-1', 'GT-12', 'PENDING');
    for (let i = 0; i < 500; i++) upsertInstall(db, 'ZONE-A', 'SN-1', 'GT-12', 'VERIFIED');
    assert.equal(pct(coverage(db, 'ZONE-A')), 100);
    assert.equal(coverage(db, 'ZONE-A').total, 1);
  });

  test('flagging a unit takes it out of pending, not out of the total', () => {
    const db = freshDb();
    for (const s of ['SN-1', 'SN-2']) upsertInstall(db, 'ZONE-A', s, 'GT-12', 'PENDING');
    upsertInstall(db, 'ZONE-A', 'SN-1', 'GT-12', 'FLAGGED');
    const c = coverage(db, 'ZONE-A');
    assert.equal(c.flagged, 1);
    assert.equal(c.total, 2);
  });

  test('zones are counted independently', () => {
    const db = freshDb();
    upsertInstall(db, 'ZONE-A', 'SN-1', 'GT-12', 'VERIFIED');
    upsertInstall(db, 'ZONE-B', 'SN-2', 'GT-12', 'PENDING');
    assert.equal(pct(coverage(db, 'ZONE-A')), 100);
    assert.equal(pct(coverage(db, 'ZONE-B')), 0);
  });
});

describe('the outbox', () => {
  const pending = (db: any) => db.prepare(SQL_COUNT_PENDING).get().n;

  test('re-scanning supersedes rather than piles up', () => {
    const db = freshDb();
    for (let i = 0; i < 8; i++) enqueue(db, '/install', { id: 'INS-ZONE-A-SN-1', serial: 'SN-1' });
    assert.equal(pending(db), 1, '"8 queued" on screen while the data was fine');
  });

  test('different records queue separately', () => {
    const db = freshDb();
    enqueue(db, '/install', { id: 'INS-ZONE-A-SN-1' });
    enqueue(db, '/install', { id: 'INS-ZONE-A-SN-2' });
    enqueue(db, '/ncr', { id: 'NCR-ZONE-A-SN-1-RB' });
    assert.equal(pending(db), 3);
  });

  test('the same id on a different endpoint is a different record', () => {
    const db = freshDb();
    enqueue(db, '/install', { id: 'X' });
    enqueue(db, '/ncr', { id: 'X' });
    assert.equal(pending(db), 2);
  });

  test('an already-sent row is never superseded — history is kept', () => {
    const db = freshDb();
    enqueue(db, '/install', { id: 'INS-ZONE-A-SN-1' });
    db.prepare(SQL_MARK_SYNCED).run('2026-08-09T10:00:00Z', 1);
    enqueue(db, '/install', { id: 'INS-ZONE-A-SN-1' });
    assert.equal(pending(db), 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM outbox`).get().n, 2);
  });

  test('a payload with no id is always queued', () => {
    const db = freshDb();
    enqueue(db, '/install', { serial: 'SN-1' });
    enqueue(db, '/install', { serial: 'SN-1' });
    assert.equal(pending(db), 2);
  });

  test('a worker report queues and supersedes like everything else', () => {
    const db = freshDb();
    const id = reportIdFor('ZONE-A', 'SN-1', 'DAMAGED');
    enqueue(db, '/report', { id, note: 'cracked housing' });
    enqueue(db, '/report', { id, note: 'cracked housing, flange side' });
    assert.equal(pending(db), 1, 'one problem with one unit is one report');
    // The LATEST note is the one that ships — a worker adding detail must not
    // have their correction sit behind the vaguer first attempt.
    const row = db.prepare(SQL_PENDING_OUTBOX).all()[0] as any;
    assert.equal(JSON.parse(row.payload_json).note, 'cracked housing, flange side');
  });

  test('damage and wrong-item on one unit are separate queue rows', () => {
    const db = freshDb();
    enqueue(db, '/report', { id: reportIdFor('ZONE-A', 'SN-1', 'DAMAGED') });
    enqueue(db, '/report', { id: reportIdFor('ZONE-A', 'SN-1', 'WRONG_ITEM') });
    assert.equal(pending(db), 2);
  });

  test('rows drain oldest first', () => {
    const db = freshDb();
    enqueue(db, '/install', { id: 'A' });
    enqueue(db, '/install', { id: 'B' });
    const rows = db.prepare(SQL_PENDING_OUTBOX).all();
    assert.deepEqual(rows.map((r: any) => JSON.parse(r.payload_json).id), ['A', 'B']);
  });

  test('marking synced removes a row from the queue but not from the table', () => {
    const db = freshDb();
    enqueue(db, '/install', { id: 'A' });
    assert.equal(pending(db), 1);
    db.prepare(SQL_MARK_SYNCED).run('2026-08-09T10:00:00Z', 1);
    assert.equal(pending(db), 0);
    assert.equal(db.prepare(`SELECT attempts FROM outbox WHERE id = 1`).get().attempts, 1);
  });
});

describe('send policy — an answer we dislike is not the same as no answer', () => {
  test('2xx is sent', () => {
    for (const s of [200, 201, 204]) assert.equal(classifyStatus(s), 'SENT');
  });

  test('4xx retires the row so it cannot block the queue', () => {
    // The bug: `break` on any failure meant one permanently-refused row froze
    // every row behind it forever.
    for (const s of [400, 404, 409, 413, 422]) assert.equal(classifyStatus(s), 'RETIRE');
  });

  test('5xx stops the run — the server may recover', () => {
    for (const s of [500, 502, 503]) assert.equal(classifyStatus(s), 'STOP');
  });

  test('a whole queue drains past a poisoned row', () => {
    const responses = [200, 400, 200, 200];
    let sent = 0, retired = 0, i = 0;
    for (; i < responses.length; i++) {
      const o = classifyStatus(responses[i]);
      if (o === 'SENT') { sent++; continue; }
      if (o === 'RETIRE') { retired++; continue; }
      break;
    }
    assert.equal(sent, 3);
    assert.equal(retired, 1);
    assert.equal(i, responses.length, 'the loop must reach the end');
  });

  test('a 5xx stops before wasting attempts on the rest', () => {
    const responses = [200, 503, 200, 200];
    let sent = 0, i = 0;
    for (; i < responses.length; i++) {
      const o = classifyStatus(responses[i]);
      if (o === 'SENT') { sent++; continue; }
      if (o === 'RETIRE') continue;
      break;
    }
    assert.equal(sent, 1);
    assert.equal(i, 1, 'stopped at the 503');
  });

  test('every outcome except success explains itself', () => {
    assert.equal(describeOutcome('SENT', 'http://x'), null);
    assert.match(describeOutcome('RETIRE', 'http://x', 400)!, /rejected one item/);
    assert.match(describeOutcome('STOP', 'http://x')!, /cannot reach/);
    assert.match(describeOutcome('STOP', 'http://x', 503)!, /trouble/);
  });
});
