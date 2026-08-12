/**
 * Tests for the delivery-level inference.
 *
 * This file earns its place because reorder.mjs makes a CLAIM about the world —
 * "this was a bad delivery, send it back" — and that claim costs money if it is
 * wrong. It is the same category of logic as engine/resolve.ts, so it gets the
 * same treatment: pure functions, exhaustively tested, no clock, no I/O.
 *
 * Zero dependencies, like the rest of the suite. Runs on a bare Node install.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { deriveReturnBatches, deriveReorder, RETURN_THRESHOLD } from './reorder.mjs';

const submittals = [
  { id: 'S1', sku: 'GT-12', zone_id: 'ZONE-A', approved_rev: 'C' },
  { id: 'S2', sku: 'GT-12', zone_id: 'ZONE-B', approved_rev: 'C' },
  { id: 'S3', sku: 'VLV-22', zone_id: 'ZONE-B', approved_rev: 'B' },
  { id: 'S4', sku: 'AHU-04', zone_id: 'ZONE-C', approved_rev: 'C' },
];

const units = [
  { serial: 'SN-1', sku: 'GT-12', rev: 'B' },
  { serial: 'SN-2', sku: 'GT-12', rev: 'B' },
  { serial: 'SN-3', sku: 'GT-12', rev: 'B' },
  { serial: 'SN-9', sku: 'VLV-22', rev: 'A' },
];

const ncr = (serial, sku, zone, found, approved) => ({
  id: `NCR-${serial}`, serial, sku, zone_id: zone,
  installed_rev: found, approved_rev: approved, created_at: '2026-08-01',
});

const report = (serial, sku, zone, kind, status = 'OPEN') => ({
  id: `RPT-${zone}-${serial}-${kind}`, serial, sku, zone_id: zone,
  kind, note: 'n', reported_by: 'M. Nair', created_at: '2026-08-02', status,
});

describe('return batches', () => {
  test('one wrong unit is an installation problem, not a delivery problem', () => {
    const b = deriveReturnBatches({
      ncrs: [ncr('SN-1', 'GT-12', 'ZONE-A', 'B', 'C')], units, submittals,
    });
    assert.equal(b.length, 0);
  });

  test('the threshold is where it flips', () => {
    const b = deriveReturnBatches({
      ncrs: [ncr('SN-1', 'GT-12', 'ZONE-A', 'B', 'C'), ncr('SN-2', 'GT-12', 'ZONE-A', 'B', 'C')],
      units, submittals,
    });
    assert.equal(b.length, 1);
    assert.equal(b[0].qty, RETURN_THRESHOLD);
    assert.equal(b[0].sku, 'GT-12');
    assert.equal(b[0].foundRev, 'B');
    assert.equal(b[0].needRev, 'C');
    assert.equal(b[0].decision, 'PROPOSED');
  });

  test('counts DISTINCT units — the same unit twice is still one unit', () => {
    // Two NCR rows for one serial. Ids are derived so this should not happen,
    // but a merge of two devices' data could produce it, and inflating a return
    // quantity is a commercial error.
    const b = deriveReturnBatches({
      ncrs: [ncr('SN-1', 'GT-12', 'ZONE-A', 'B', 'C'), ncr('SN-1', 'GT-12', 'ZONE-A', 'B', 'C')],
      units, submittals,
    });
    assert.equal(b.length, 0, 'one physical unit cannot make a batch');
  });

  test('different wrong revisions are different batches', () => {
    const b = deriveReturnBatches({
      ncrs: [
        ncr('SN-1', 'GT-12', 'ZONE-A', 'B', 'C'), ncr('SN-2', 'GT-12', 'ZONE-A', 'B', 'C'),
        ncr('SN-3', 'GT-12', 'ZONE-A', 'A', 'C'),
      ],
      units, submittals,
    });
    assert.equal(b.length, 1, 'the single Rev A unit is below threshold on its own');
    assert.equal(b[0].foundRev, 'B');
  });

  test('a batch can span zones', () => {
    const b = deriveReturnBatches({
      ncrs: [ncr('SN-1', 'GT-12', 'ZONE-A', 'B', 'C'), ncr('SN-2', 'GT-12', 'ZONE-B', 'B', 'C')],
      units, submittals,
    });
    assert.deepEqual(b[0].zones, ['ZONE-A', 'ZONE-B']);
  });

  test('WRONG_ITEM reports count, using the unit record for the revision', () => {
    const b = deriveReturnBatches({
      ncrs: [ncr('SN-1', 'GT-12', 'ZONE-A', 'B', 'C')],
      reports: [report('SN-2', 'GT-12', 'ZONE-A', 'WRONG_ITEM')],
      units, submittals,
    });
    assert.equal(b.length, 1);
    assert.equal(b[0].qty, 2);
    assert.deepEqual(b[0].evidence.map(e => e.via).sort(), ['NCR', 'REPORT']);
  });

  test('a report about a unit we have never heard of is not evidence', () => {
    const b = deriveReturnBatches({
      ncrs: [ncr('SN-1', 'GT-12', 'ZONE-A', 'B', 'C')],
      reports: [report('SN-UNKNOWN', 'GT-12', 'ZONE-A', 'WRONG_ITEM')],
      units, submittals,
    });
    assert.equal(b.length, 0, 'refuses to guess a revision it does not have');
  });

  test('a unit with both an NCR and a report is counted once', () => {
    const b = deriveReturnBatches({
      ncrs: [ncr('SN-1', 'GT-12', 'ZONE-A', 'B', 'C'), ncr('SN-2', 'GT-12', 'ZONE-A', 'B', 'C')],
      reports: [report('SN-1', 'GT-12', 'ZONE-A', 'WRONG_ITEM')],
      units, submittals,
    });
    assert.equal(b[0].qty, 2);
  });

  test('DAMAGED reports never create a return batch', () => {
    const b = deriveReturnBatches({
      reports: [report('SN-1', 'GT-12', 'ZONE-A', 'DAMAGED'), report('SN-2', 'GT-12', 'ZONE-A', 'DAMAGED')],
      units, submittals,
    });
    assert.equal(b.length, 0, 'a broken part is not a wrong part');
  });

  test('a supervisor decision sticks as more evidence arrives', () => {
    const decisions = { 'GT-12|B': { decision: 'DISMISSED', by: 'S. Rao', at: 't' } };
    const b = deriveReturnBatches({
      ncrs: [
        ncr('SN-1', 'GT-12', 'ZONE-A', 'B', 'C'), ncr('SN-2', 'GT-12', 'ZONE-A', 'B', 'C'),
        ncr('SN-3', 'GT-12', 'ZONE-A', 'B', 'C'),
      ],
      units, submittals, decisions,
    });
    assert.equal(b[0].qty, 3);
    assert.equal(b[0].decision, 'DISMISSED');
    assert.equal(b[0].decidedBy, 'S. Rao');
  });

  test('an NCR whose revisions agree is not evidence of anything', () => {
    const b = deriveReturnBatches({
      ncrs: [ncr('SN-1', 'GT-12', 'ZONE-A', 'C', 'C'), ncr('SN-2', 'GT-12', 'ZONE-A', 'C', 'C')],
      units, submittals,
    });
    assert.equal(b.length, 0);
  });
});

describe('reorder list', () => {
  const twoWrong = [ncr('SN-1', 'GT-12', 'ZONE-A', 'B', 'C'), ncr('SN-2', 'GT-12', 'ZONE-A', 'B', 'C')];

  test('damaged units are firm without anyone signing off', () => {
    const lines = deriveReorder({
      reports: [report('SN-9', 'VLV-22', 'ZONE-B', 'DAMAGED')], submittals,
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].sku, 'VLV-22');
    assert.equal(lines[0].needRev, 'B');
    assert.equal(lines[0].qty, 1);
    assert.equal(lines[0].firm, 1);
    assert.equal(lines[0].awaiting, 0);
  });

  test('a proposed batch is counted but not firm', () => {
    const batches = deriveReturnBatches({ ncrs: twoWrong, units, submittals });
    const lines = deriveReorder({ batches, submittals });
    assert.equal(lines[0].qty, 2);
    assert.equal(lines[0].firm, 0);
    assert.equal(lines[0].awaiting, 2);
  });

  test('confirming the batch makes it firm', () => {
    const batches = deriveReturnBatches({
      ncrs: twoWrong, units, submittals,
      decisions: { 'GT-12|B': { decision: 'CONFIRMED', by: 'S. Rao', at: 't' } },
    });
    const lines = deriveReorder({ batches, submittals });
    assert.equal(lines[0].firm, 2);
    assert.equal(lines[0].awaiting, 0);
  });

  test('a dismissed batch leaves the list entirely', () => {
    const batches = deriveReturnBatches({
      ncrs: twoWrong, units, submittals,
      decisions: { 'GT-12|B': { decision: 'DISMISSED', by: 'S. Rao', at: 't' } },
    });
    assert.deepEqual(deriveReorder({ batches, submittals }), []);
  });

  test('both causes for one part collapse into a single order line', () => {
    const batches = deriveReturnBatches({
      ncrs: twoWrong, units, submittals,
      decisions: { 'GT-12|B': { decision: 'CONFIRMED', by: 'S. Rao', at: 't' } },
    });
    const lines = deriveReorder({
      batches,
      reports: [report('SN-3', 'GT-12', 'ZONE-A', 'DAMAGED')],
      submittals,
    });
    assert.equal(lines.length, 1, 'one part, one line — procurement orders once');
    assert.equal(lines[0].qty, 3);
    assert.deepEqual(lines[0].causes.map(c => c.kind).sort(), ['DAMAGED', 'MIS_ORDERED']);
  });

  test('a closed damage report is not still on order', () => {
    const lines = deriveReorder({
      reports: [report('SN-9', 'VLV-22', 'ZONE-B', 'DAMAGED', 'CLOSED')], submittals,
    });
    assert.deepEqual(lines, []);
  });

  test('the same unit reported damaged twice is one replacement', () => {
    const lines = deriveReorder({
      reports: [
        report('SN-9', 'VLV-22', 'ZONE-B', 'DAMAGED'),
        { ...report('SN-9', 'VLV-22', 'ZONE-B', 'DAMAGED'), id: 'other-id' },
      ],
      submittals,
    });
    assert.equal(lines[0].qty, 1);
  });

  test('nothing wrong means nothing to order', () => {
    assert.deepEqual(deriveReorder({ batches: [], reports: [], submittals }), []);
  });
});
