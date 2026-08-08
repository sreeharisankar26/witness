/**
 * Engine tests.
 *
 *   npm test        (from app/)
 *
 * Zero dependencies - Node's built-in test runner and TypeScript stripping.
 * Nothing to install, nothing to break on someone else's machine at 2am.
 *
 * These run against the real seed file, not a toy fixture, so a regression in
 * the seed generator fails the suite too. Every test pins a behaviour that
 * matters on a site or on camera.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  resolve, parseTag, tagFrom, memoryFor, supersededChain, severityOf,
  TagParseError, MEMORY_THRESHOLD, SYSTEMIC_THRESHOLD,
} from './resolve.ts';
import type { RecordSnapshot, Ncr } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(join(here, '..', 'data', 'witness_seed.json'), 'utf8'),
) as RecordSnapshot;

// The seed no longer carries a live sync time - the device stamps it at install
// (see db.ensureSeeded). Tests pin it explicitly so they never drift with the
// calendar.
const SYNCED = '2026-08-08T06:40:00Z';
const snap: RecordSnapshot = { ...raw, record_synced_at: SYNCED };

const NOW = '2026-08-08T09:00:00Z';     // ~2h after sync
const LATER = '2026-08-12T09:00:00Z';   // 4 days on - aged out
const tag = (sku: string, serial: string) => parseTag(`WTNS:1|${sku}|${serial}`);

describe('tag parsing', () => {
  test('parses a well-formed tag', () => {
    const t = tag('GT-12', 'SN-4471');
    assert.equal(t.sku, 'GT-12');
    assert.equal(t.serial, 'SN-4471');
    assert.equal(t.version, 1);
    assert.equal(t.source, 'TAG');
    assert.equal(t.confidence, 1);
  });

  test('normalises case', () => {
    assert.equal(parseTag('WTNS:1|gt-12|sn-4471').sku, 'GT-12');
    assert.equal(parseTag('WTNS:1|gt-12|sn-4471').serial, 'SN-4471');
  });

  test('tolerates surrounding whitespace from the scanner', () => {
    assert.equal(parseTag('  WTNS:1|GT-12|SN-4471 \n').serial, 'SN-4471');
  });

  test('rejects a random QR rather than half-reading it', () => {
    assert.throws(() => parseTag('https://example.com'), TagParseError);
    assert.throws(() => parseTag(''), TagParseError);
    assert.throws(() => parseTag('WTNS:1|GT-12'), TagParseError);
  });

  test('refuses an unknown future tag version instead of guessing', () => {
    assert.throws(() => parseTag('WTNS:2|GT-12|SN-4471'), /Unsupported tag version/);
  });
});

describe('hero scenario - Rev B installed where Rev C is approved', () => {
  const r = resolve(snap, tag('GT-12', 'SN-4471'), 'ZONE-A', { now: NOW });

  test('calls a superseded mismatch', () => {
    assert.equal(r.verdict, 'MISMATCH_SUPERSEDED');
    assert.equal(severityOf(r.verdict), 'STOP');
  });

  test('reports both revisions', () => {
    assert.equal(r.installedRev, 'B');
    assert.equal(r.approvedRev, 'C');
  });

  test('traces the chain from installed to approved', () => {
    assert.deepEqual(r.supersededChain, ['C']);
  });

  test('drafts an NCR, and is binding on a fresh record read from a tag', () => {
    assert.equal(r.requiresNcr, true);
    assert.equal(r.authority, 'BINDING');
  });

  test('produces a usable spoken line with no model involved', () => {
    assert.match(r.templateSpeech, /Rev B/);
    assert.match(r.templateSpeech, /Rev C/);
    assert.match(r.templateSpeech, /NCR/i);
  });

  test('surfaces the memory of prior identical failures', () => {
    assert.ok(r.memory);
    assert.equal(r.memory!.priorCount, 3);
    assert.equal(r.memory!.pattern, 'SYSTEMIC');
  });
});

describe('the clean scan', () => {
  const r = resolve(snap, tag('GT-12', 'SN-4472'), 'ZONE-A', { now: NOW });

  test('passes the correct revision', () => {
    assert.equal(r.verdict, 'MATCH');
    assert.equal(severityOf(r.verdict), 'OK');
    assert.equal(r.requiresNcr, false);
  });

  test('still carries zone memory - the risk is about the location', () => {
    assert.equal(r.memory!.priorCount, 3);
  });

  test('the memory banner states history, never an instruction', () => {
    // It renders directly above a green CORRECT. "Double-check before
    // installing" there would contradict the verdict beneath it.
    assert.doesNotMatch(r.memory!.message, /double-check|check before|stop/i);
  });
});

describe('graceful failure - the states most demos hide', () => {
  test('UNKNOWN_UNIT: an unrecorded serial is answered, not errored', () => {
    const r = resolve(snap, tag('VLV-22', 'SN-9999'), 'ZONE-A', { now: NOW });
    assert.equal(r.verdict, 'UNKNOWN_UNIT');
    assert.equal(r.authority, 'ADVISORY');
    assert.equal(r.requiresNcr, false);
    assert.match(r.templateSpeech, /supervisor/i);
  });

  test('NO_APPROVED_RECORD: nothing approved for this SKU here', () => {
    const r = resolve(snap, tag('SPR-14', 'SN-4475'), 'ZONE-D', { now: NOW });
    assert.equal(r.verdict, 'NO_APPROVED_RECORD');
    assert.equal(r.authority, 'ADVISORY');
  });

  test('TAG_CONFLICT: tag SKU disagrees with the serial on record', () => {
    const r = resolve(snap, tag('PNL-08', 'SN-4471'), 'ZONE-A', { now: NOW });
    assert.equal(r.verdict, 'TAG_CONFLICT');
    assert.equal(r.requiresNcr, false);
  });

  test('never returns undefined - every unit, every zone, yields a verdict', () => {
    for (const z of ['ZONE-A', 'ZONE-B', 'ZONE-C', 'ZONE-D']) {
      for (const u of snap.units) {
        const r = resolve(snap, tag(u.sku, u.serial), z, { now: NOW });
        assert.ok(r.verdict, `no verdict for ${u.serial} in ${z}`);
        assert.ok(r.templateSpeech.length > 10);
        assert.ok(['BINDING', 'ADVISORY'].includes(r.authority));
      }
    }
  });

  test('an NCR is only ever drafted when both revisions are known', () => {
    for (const z of ['ZONE-A', 'ZONE-B', 'ZONE-C', 'ZONE-D']) {
      for (const u of snap.units) {
        const r = resolve(snap, tag(u.sku, u.serial), z, { now: NOW });
        if (r.requiresNcr) {
          assert.ok(r.installedRev, 'NCR without an installed rev');
          assert.ok(r.approvedRev, 'NCR without an approved rev');
          assert.notEqual(r.installedRev, r.approvedRev);
        }
      }
    }
  });
});

describe('perception is never binding on its own', () => {
  const plate = tagFrom('GT-12', 'SN-4471', 'NAMEPLATE', 0.91);

  test('a model-read identity produces the same finding', () => {
    const r = resolve(snap, plate, 'ZONE-A', { now: NOW });
    assert.equal(r.verdict, 'MISMATCH_SUPERSEDED');
    assert.equal(r.installedRev, 'B');
  });

  test('...but only ever as ADVISORY, even at high confidence', () => {
    const r = resolve(snap, plate, 'ZONE-A', { now: NOW });
    assert.equal(r.authority, 'ADVISORY');
    assert.equal(r.identity.source, 'NAMEPLATE');
  });

  test('and says out loud that it came off a plate', () => {
    const r = resolve(snap, plate, 'ZONE-A', { now: NOW });
    assert.match(r.templateSpeech, /nameplate/i);
  });

  test('a tag at the same moment IS binding - the difference is the source', () => {
    const r = resolve(snap, tag('GT-12', 'SN-4471'), 'ZONE-A', { now: NOW });
    assert.equal(r.authority, 'BINDING');
  });

  test('typed-by-hand is trusted like a tag - a human read it', () => {
    const r = resolve(snap, tagFrom('GT-12', 'SN-4471', 'MANUAL', 1), 'ZONE-A', { now: NOW });
    assert.equal(r.authority, 'BINDING');
    assert.equal(r.identity.source, 'MANUAL');
  });
});

describe('staleness - the most dangerous failure mode', () => {
  test('downgrades BINDING to ADVISORY once the cache ages out', () => {
    const fresh = resolve(snap, tag('GT-12', 'SN-4471'), 'ZONE-A', { now: NOW });
    const old = resolve(snap, tag('GT-12', 'SN-4471'), 'ZONE-A', { now: LATER });
    assert.equal(fresh.authority, 'BINDING');
    assert.equal(old.authority, 'ADVISORY');
    assert.equal(old.verdict, 'MISMATCH_SUPERSEDED');  // the finding is unchanged
    assert.equal(old.staleness.stale, true);
  });

  test('tells the worker how old the record is, out loud', () => {
    const old = resolve(snap, tag('GT-12', 'SN-4471'), 'ZONE-A', { now: LATER });
    assert.match(old.templateSpeech, /advisory/i);
    assert.match(old.templateSpeech, /hours ago/);
  });

  test('a MATCH on a stale record is also only advisory', () => {
    const r = resolve(snap, tag('GT-12', 'SN-4472'), 'ZONE-A', { now: LATER });
    assert.equal(r.verdict, 'MATCH');
    assert.equal(r.authority, 'ADVISORY');
  });

  test('an unparseable sync timestamp is infinitely stale, never fresh', () => {
    const broken = { ...snap, record_synced_at: 'not-a-date' };
    const r = resolve(broken, tag('GT-12', 'SN-4471'), 'ZONE-A', { now: NOW });
    assert.equal(r.authority, 'ADVISORY');
    assert.equal(r.staleness.clockSuspect, true);
  });

  test('FAILS CLOSED on a wrong device clock', () => {
    // A phone whose date is set BEFORE the record's sync time gives a negative
    // age. This used to clamp to zero, so a bad clock silently disabled
    // staleness protection and a month-old record read as perfectly fresh.
    // Cheap site phones lose their clock constantly.
    const r = resolve(snap, tag('GT-12', 'SN-4471'), 'ZONE-A', { now: '2026-07-01T00:00:00Z' });
    assert.equal(r.staleness.clockSuspect, true);
    assert.equal(r.authority, 'ADVISORY');
    assert.match(r.templateSpeech, /clock/i);
  });
});

describe('determinism', () => {
  test('pure function - same inputs, byte-identical output', () => {
    const a = resolve(snap, tag('GT-12', 'SN-4471'), 'ZONE-A', { now: NOW });
    const b = resolve(snap, tag('GT-12', 'SN-4471'), 'ZONE-A', { now: NOW });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  test('reads no ambient time source at all', () => {
    // The previous version of this test stubbed Date.now() - which resolve()
    // never called, so it asserted nothing and passed trivially. This breaks
    // every route to the wall clock, including the one actually used
    // (Date.parse), and proves the result depends only on opts.now.
    const realNow = Date.now;
    const realParse = Date.parse;
    const realDate = globalThis.Date;
    const control = resolve(snap, tag('GT-12', 'SN-4471'), 'ZONE-A', { now: NOW });
    try {
      (Date as any).now = () => { throw new Error('resolve() read Date.now()'); };
      // Date.parse is legitimately needed - for the injected `now`, the record's
      // sync stamp, and dates inside the record itself. So we assert on its
      // arguments: every value it sees must have come IN, never from the clock.
      const allowed = new Set<string>([
        SYNCED, NOW,
        ...snap.ncrs.map(n => n.created_at),
      ]);
      (Date as any).parse = (s: string) => {
        assert.ok(allowed.has(s), `resolve() parsed a time that was not an input: ${s}`);
        return realParse(s);
      };
      const b = resolve(snap, tag('GT-12', 'SN-4471'), 'ZONE-A', { now: NOW });
      assert.equal(JSON.stringify(b), JSON.stringify(control));
    } finally {
      (Date as any).now = realNow;
      (Date as any).parse = realParse;
      globalThis.Date = realDate;
    }
  });

  test('does not mutate the record it was given', () => {
    const before = JSON.stringify(snap);
    resolve(snap, tag('GT-12', 'SN-4471'), 'ZONE-A', { now: NOW });
    assert.equal(JSON.stringify(snap), before);
  });
});

describe('memory', () => {
  const ncr = (id: string, serial: string, by: string, at: string): Ncr => ({
    id, serial, sku: 'ZZ-01', zone_id: 'ZONE-A',
    installed_rev: 'A', approved_rev: 'B', created_at: at, confirmed_by: by,
  });
  const withNcrs = (list: Ncr[]) => ({ ...snap, ncrs: list } as RecordSnapshot);

  test('stays silent below the threshold', () => {
    assert.equal(memoryFor(snap, 'AHU-04', 'ZONE-C'), null);   // only 1 prior
    assert.equal(MEMORY_THRESHOLD, 2);
  });

  test('speaks up at or above the threshold', () => {
    assert.equal(memoryFor(snap, 'GT-12', 'ZONE-A')!.priorCount, 3);
  });

  test('is scoped to the zone - Zone B does not inherit Zone A history', () => {
    assert.equal(memoryFor(snap, 'GT-12', 'ZONE-B'), null);
  });

  test('COUNTS DISTINCT UNITS, not NCR rows', () => {
    // Scanning the same wrong part five times in a rehearsal is one problem.
    // Counting rows made the number climb on every repeat scan, so by shoot day
    // it read "confused 40 times" and the whole feature looked fabricated.
    const m = memoryFor(withNcrs([
      ncr('n1', 'SN-1', 'A. Kumar', '2026-07-01'),
      ncr('n2', 'SN-1', 'A. Kumar', '2026-07-02'),
      ncr('n3', 'SN-1', 'A. Kumar', '2026-07-03'),
      ncr('n4', 'SN-2', 'M. Nair', '2026-07-04'),
    ]), 'ZZ-01', 'ZONE-A');
    assert.equal(m!.priorCount, 2);          // two units, not four rows
    assert.equal(m!.distinctWorkers, 2);
  });

  test('one unit scanned repeatedly never trips the threshold', () => {
    const m = memoryFor(withNcrs([
      ncr('n1', 'SN-1', 'A. Kumar', '2026-07-01'),
      ncr('n2', 'SN-1', 'A. Kumar', '2026-07-02'),
      ncr('n3', 'SN-1', 'A. Kumar', '2026-07-03'),
    ]), 'ZZ-01', 'ZONE-A');
    assert.equal(m, null);
  });

  test('escalates RECURRING -> SYSTEMIC on distinct units', () => {
    const two = memoryFor(withNcrs([
      ncr('n1', 'SN-1', 'A', '2026-07-01'), ncr('n2', 'SN-2', 'B', '2026-07-02'),
    ]), 'ZZ-01', 'ZONE-A');
    const three = memoryFor(withNcrs([
      ncr('n1', 'SN-1', 'A', '2026-07-01'), ncr('n2', 'SN-2', 'B', '2026-07-02'),
      ncr('n3', 'SN-3', 'C', '2026-07-09'),
    ]), 'ZZ-01', 'ZONE-A');
    assert.equal(two!.pattern, 'RECURRING');
    assert.equal(three!.pattern, 'SYSTEMIC');
    assert.equal(SYSTEMIC_THRESHOLD, 3);
    assert.equal(three!.spanDays, 8);
  });

  test('mentions crew spread only when more than one person was involved', () => {
    const solo = memoryFor(withNcrs([
      ncr('n1', 'SN-1', 'A. Kumar', '2026-07-01'), ncr('n2', 'SN-2', 'A. Kumar', '2026-07-02'),
    ]), 'ZZ-01', 'ZONE-A');
    const crew = memoryFor(withNcrs([
      ncr('n1', 'SN-1', 'A. Kumar', '2026-07-01'), ncr('n2', 'SN-2', 'M. Nair', '2026-07-02'),
    ]), 'ZZ-01', 'ZONE-A');
    assert.doesNotMatch(solo!.message, /different people/);
    assert.match(crew!.message, /2 different people/);
  });
});

describe('revision chain', () => {
  test('walks forward A -> B -> C', () => {
    assert.deepEqual(supersededChain(snap, 'GT-12', 'A', 'C'), ['B', 'C']);
  });

  test('returns empty walking backwards', () => {
    assert.deepEqual(supersededChain(snap, 'GT-12', 'C', 'A'), []);
  });

  test('survives a cyclic record without hanging', () => {
    const cyclic = {
      ...snap,
      revisions: [
        { sku: 'X', rev: 'A', superseded_by: 'B', approved_date: '2026-01-01' },
        { sku: 'X', rev: 'B', superseded_by: 'A', approved_date: '2026-01-02' },
      ],
    } as RecordSnapshot;
    assert.deepEqual(supersededChain(cyclic, 'X', 'A', 'Z'), []);
  });
});
