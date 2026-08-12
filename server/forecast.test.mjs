/**
 * Tests for the rework projection and the ensemble reconciliation.
 *
 * Both make claims a supervisor might act on with money, so both are held to
 * the same standard as the engine: pure, exhaustive, no clock.
 *
 * The forecast tests check the maths against values that can be worked out by
 * hand — a Beta posterior mean is (1+f)/(2+n), and nobody should have to trust
 * a continued fraction they cannot check.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { forecast, projectZone, betaQuantile, MIN_OBSERVATIONS } from './forecast.mjs';
import { reconcile } from './ensemble.mjs';

const close = (a, b, tol = 0.02) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} to be within ${tol} of ${b}`);

describe('the posterior, checked by hand', () => {
  test('Beta(1,1) is uniform — its median is a half', () => {
    close(betaQuantile(0.5, 1, 1), 0.5);
    close(betaQuantile(0.1, 1, 1), 0.1);
    close(betaQuantile(0.9, 1, 1), 0.9);
  });

  test('the mean is (1+flagged)/(2+scanned), which anyone can verify', () => {
    // 3 flagged of 20 -> Beta(4, 18) -> mean 4/22 = 0.1818
    const z = projectZone({ zone_id: 'Z', flagged: 3, correct: 17, unscanned: 100 });
    close(z.rate, 4 / 22);
    close(z.expected, 100 * (4 / 22), 0.2);
  });

  test('evidence narrows the interval on its own — nothing is tuned', () => {
    const few  = projectZone({ zone_id: 'Z', flagged: 1, correct: 9,   unscanned: 100 });
    const many = projectZone({ zone_id: 'Z', flagged: 10, correct: 90, unscanned: 100 });
    const widthFew  = few.high - few.low;
    const widthMany = many.high - many.low;
    assert.ok(widthMany < widthFew * 0.6,
      `ten times the evidence should tighten the interval (${widthFew} -> ${widthMany})`);
  });

  test('a small sample is pulled toward the prior, and that is the point', () => {
    // Both are one-in-ten observed, but ten scans is thin evidence. The
    // posterior says so by sitting closer to "we do not know" (0.5) than the
    // hundred-scan version does. This is the regularisation doing its job —
    // a raw 1/10 would report exactly the same rate as 10/100 and imply the
    // same certainty, which is the mistake this whole module exists to avoid.
    const few  = projectZone({ zone_id: 'Z', flagged: 1, correct: 9,   unscanned: 100 });
    const many = projectZone({ zone_id: 'Z', flagged: 10, correct: 90, unscanned: 100 });
    assert.ok(few.rate > many.rate,
      `thin evidence should hedge upward toward 0.5 (${few.rate} vs ${many.rate})`);
    assert.ok(Math.abs(few.rate - 0.5) < Math.abs(many.rate - 0.5));
  });

  test('the interval always contains the expectation', () => {
    for (const [f, c] of [[0, 10], [1, 9], [5, 5], [9, 1], [10, 0]]) {
      const z = projectZone({ zone_id: 'Z', flagged: f, correct: c, unscanned: 50 });
      assert.ok(z.low <= z.expected && z.expected <= z.high,
        `${f}/${f + c}: ${z.low} <= ${z.expected} <= ${z.high}`);
    }
  });

  test('a zone with no defects yet still does not promise zero', () => {
    const z = projectZone({ zone_id: 'Z', flagged: 0, correct: 20, unscanned: 100 });
    assert.ok(z.expected > 0, 'twenty clean scans is not proof the next hundred are clean');
    assert.ok(z.ratePct < 10);
  });

  test('a zone where everything was wrong does not promise everything', () => {
    const z = projectZone({ zone_id: 'Z', flagged: 20, correct: 0, unscanned: 100 });
    assert.ok(z.expected < 100);
    assert.ok(z.ratePct > 85);
  });
});

describe('refusing to project', () => {
  test('below the minimum it declines, and says why', () => {
    const z = projectZone({ zone_id: 'Z', flagged: 1, correct: 1, unscanned: 100 });
    assert.equal(z.projectable, false);
    assert.equal(z.expected, undefined, 'must not emit a number it will not stand behind');
    assert.match(z.reason, /opinion with a number on it/);
  });

  test('exactly at the minimum it projects', () => {
    const z = projectZone({ zone_id: 'Z', flagged: 1, correct: MIN_OBSERVATIONS - 1, unscanned: 10 });
    assert.equal(z.projectable, true);
  });

  test('a zone with nothing scanned at all is not projectable', () => {
    assert.equal(projectZone({ zone_id: 'Z', flagged: 0, correct: 0, unscanned: 40 }).projectable, false);
  });

  test('every projection carries its own caveat', () => {
    const z = projectZone({ zone_id: 'Z', flagged: 2, correct: 18, unscanned: 50 });
    assert.match(z.caveat, /not\s+random/i);
  });
});

describe('the site total', () => {
  const zones = [
    { zone_id: 'A', name: 'A', flagged: 5, correct: 15, unscanned: 40 },   // hot, small
    { zone_id: 'B', name: 'B', flagged: 0, correct: 40, unscanned: 200 },  // clean, large
    { zone_id: 'C', name: 'C', flagged: 1, correct: 1,  unscanned: 60 },   // too early
  ];

  test('it sums the zones rather than pooling the counts', () => {
    const f = forecast(zones);
    const a = projectZone(zones[0]), b = projectZone(zones[1]);
    close(f.site.expected, a.expected + b.expected, 0.3);
  });

  test('a zone it refused to project contributes nothing and is counted', () => {
    const f = forecast(zones);
    assert.equal(f.site.zonesProjected, 2);
    assert.equal(f.site.zonesTooEarly, 1);
  });

  test('the worst zone sorts first — that is the one to walk to', () => {
    assert.equal(forecast(zones).zones[0].zone_id, 'A');
  });

  test('a large clean zone does not wash out a small bad one', () => {
    const f = forecast(zones);
    const a = f.zones.find(z => z.zone_id === 'A');
    const b = f.zones.find(z => z.zone_id === 'B');
    assert.ok(a.ratePct > b.ratePct * 3,
      'pooling would have hidden this — Zone A is far worse per unit');
  });

  test('no zones at all is not a crash', () => {
    const f = forecast([]);
    assert.equal(f.site.expected, 0);
    assert.deepEqual(f.zones, []);
  });
});

/* ── ensemble ─────────────────────────────────────────────────────────────── */

const r = (id, o = {}) => ({
  id, sku: 'GT-12', rev: 'Rev C', zone: 'Zone A', status: 'A',
  description: 'Grout unit', discipline: 'Structural', date: '01-Aug-2026', ...o,
});

describe('reconciling independent reads', () => {
  test('two reads that agree produce no disputes', () => {
    const out = reconcile([{ rows: [r('SUB-1')] }, { rows: [r('SUB-1')] }]);
    assert.equal(out.rows.length, 1);
    assert.deepEqual(out.rows[0].disputed, []);
    assert.equal(out.agreement.rate, 100);
  });

  test('a disagreement on the revision is flagged, not voted on', () => {
    const out = reconcile([
      { rows: [r('SUB-1', { rev: 'Rev C' })] },
      { rows: [r('SUB-1', { rev: 'Rev D' })] },
    ]);
    assert.deepEqual(out.rows[0].disputed, ['rev']);
    assert.deepEqual(out.rows[0].variants.rev, ['Rev C', 'Rev D']);
  });

  test('a majority does NOT settle it — two against one still holds', () => {
    const out = reconcile([
      { rows: [r('SUB-1', { rev: 'Rev C' })] },
      { rows: [r('SUB-1', { rev: 'Rev C' })] },
      { rows: [r('SUB-1', { rev: 'Rev D' })] },
    ]);
    assert.ok(out.rows[0].disputed.includes('rev'),
      'a coin landing twice is not evidence about an approved revision');
  });

  test('case and spacing are not disagreements', () => {
    const out = reconcile([
      { rows: [r('SUB-1', { status: 'A', zone: 'Zone A' })] },
      { rows: [r('SUB-1', { status: 'a', zone: 'zone  a' })] },
    ]);
    assert.deepEqual(out.rows[0].disputed, []);
  });

  test('a row one read missed entirely is the most serious disagreement', () => {
    const out = reconcile([
      { rows: [r('SUB-1'), r('SUB-2')] },
      { rows: [r('SUB-1')] },
    ]);
    const missed = out.rows.find(x => x.id === 'SUB-2');
    assert.ok(missed.disputed.includes('presence'));
    assert.equal(missed.seenIn, 1);
    assert.equal(out.agreement.missedRows, 1);
  });

  test('a cosmetic field differing does not hold the row', () => {
    const out = reconcile([
      { rows: [r('SUB-1', { description: 'Grout unit' })] },
      { rows: [r('SUB-1', { description: 'Grout Termination Unit, 50mm' })] },
    ]);
    assert.deepEqual(out.rows[0].disputed, [], 'description is not worth stopping work over');
    assert.ok(out.rows[0].variants === undefined);
  });

  test('notes are unioned — a clause only one read saw is still in the document', () => {
    const n = { kind: 'SUPERSEDED_BY', loser: 'SUB-9', winner: 'SUB-1', text: 'x' };
    const out = reconcile([{ rows: [r('SUB-1')], notes: [n] }, { rows: [r('SUB-1')], notes: [] }]);
    assert.equal(out.notes.length, 1);
  });

  test('duplicate notes across reads collapse to one', () => {
    const n = { kind: 'SUPERSEDED_BY', loser: 'SUB-9', winner: 'SUB-1', text: 'x' };
    const out = reconcile([{ rows: [], notes: [n] }, { rows: [], notes: [{ ...n }] }]);
    assert.equal(out.notes.length, 1);
  });

  test('a single read is honest about having nothing to compare against', () => {
    const out = reconcile([{ rows: [r('SUB-1')] }]);
    assert.equal(out.agreement.reads, 1);
    assert.match(out.agreement.note, /no cross-check/);
    assert.deepEqual(out.rows[0].disputed, []);
  });

  test('the agreement rate reflects the share of clean rows', () => {
    const out = reconcile([
      { rows: [r('SUB-1'), r('SUB-2'), r('SUB-3'), r('SUB-4')] },
      { rows: [r('SUB-1'), r('SUB-2'), r('SUB-3'), r('SUB-4', { rev: 'Rev Z' })] },
    ]);
    assert.equal(out.agreement.disputedRows, 1);
    assert.equal(out.agreement.rate, 75);
  });

  test('no reads at all is not a crash', () => {
    assert.deepEqual(reconcile([]).rows, []);
  });
});
