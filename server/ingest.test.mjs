/**
 * Tests for the ingestion gate.
 *
 * This module decides what becomes "approved" for the whole system. A mistake
 * here is not a wrong pixel — it is the engine ruling correctly against a
 * record that was already wrong, and telling a worker so out loud. It gets the
 * same treatment as engine/resolve.ts: pure functions, every branch, no clock.
 *
 * Zero dependencies. Runs on a bare Node install.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseRev, normaliseZone, nearestSku, classifyStatus,
  extractCandidates, validateSubmittals, toSubmittals,
} from './ingest.mjs';

const zones = [
  { id: 'ZONE-A', name: 'Zone A - Level 3 Mech Room' },
  { id: 'ZONE-B', name: 'Zone B - Level 3 Riser' },
];
const knownSkus = ['GT-12', 'VLV-22', 'AHU-04'];
const ctx = { zones, knownSkus };

const row = o => ({
  id: 'SUB-0001', sku: 'GT-12', description: 'd', discipline: 'Structural',
  zone: 'Zone A', rev: 'Rev C', date: '31-Jul-2026', status: 'APPROVED', ...o,
});
const run = (rows, notes = []) => validateSubmittals({ rows, notes }, ctx);

describe('normalising what a document actually contains', () => {
  test('a revision is written five ways and means one thing', () => {
    for (const s of ['Rev C', 'REV-C', 'Rev. C', 'C', 'rev:c', ' rev  c ']) {
      assert.equal(normaliseRev(s), 'C', `failed on ${JSON.stringify(s)}`);
    }
  });

  test('revisions with a digit survive', () => {
    assert.equal(normaliseRev('Rev C1'), 'C1');
  });

  test('anything unrecognisable becomes null, never a guess', () => {
    for (const s of ['', '-', 'see note', 'Revision pending', null, undefined, 'CC12']) {
      assert.equal(normaliseRev(s), null, `should not have parsed ${JSON.stringify(s)}`);
    }
  });

  test('a zone resolves by id or by human name', () => {
    assert.equal(normaliseZone('Zone A', zones), 'ZONE-A');
    assert.equal(normaliseZone('zone-a', zones), 'ZONE-A');
    assert.equal(normaliseZone('ZONE A', zones), 'ZONE-A');
    assert.equal(normaliseZone('Zone A - Level 3 Mech Room', zones), 'ZONE-A');
  });

  test('a zone this project does not have is not a zone', () => {
    assert.equal(normaliseZone('Zone Q', zones), null);
    assert.equal(normaliseZone('-', zones), null);
    assert.equal(normaliseZone('', zones), null);
  });

  test('the lowercase-L typo finds its neighbour but is not applied', () => {
    assert.equal(nearestSku('GT-l2', knownSkus), 'GT-12');
    assert.equal(nearestSku('VLV-2Z', knownSkus), 'VLV-22');
  });

  test('something genuinely unrelated suggests nothing', () => {
    assert.equal(nearestSku('ZZZ-99', knownSkus), null);
  });
});

describe('the gate — what may become approved', () => {
  test('a clean approved row is accepted', () => {
    const v = run([row()]);
    assert.equal(v.accepted.length, 1);
    assert.equal(v.accepted[0].rev, 'C');
    assert.equal(v.accepted[0].zone_id, 'ZONE-A');
  });

  test('PENDING never becomes approved — the whole reason this file exists', () => {
    const v = run([row({ status: 'PENDING' })]);
    assert.equal(v.accepted.length, 0);
    assert.equal(v.rejected[0].reason.code, 'NOT_APPROVED');
    assert.match(v.rejected[0].reason.detail, /never approved/);
  });

  test('REJECTED never becomes approved either', () => {
    assert.equal(run([row({ status: 'REJECTED' })]).rejected[0].reason.code, 'NOT_APPROVED');
  });

  test('a row with no status at all is refused, not assumed fine', () => {
    const v = run([row({ status: null })]);
    assert.equal(v.accepted.length, 0);
    assert.equal(v.rejected[0].reason.code, 'STATUS_UNREADABLE');
  });

  test('an unrecognised review code is refused, never assumed to be approval', () => {
    const v = run([row({ status: 'ZZ9' })]);
    assert.equal(v.accepted.length, 0);
    assert.equal(v.rejected[0].reason.code, 'STATUS_UNREADABLE');
  });

  test('an approval with no location is held, not dropped and not guessed', () => {
    const v = run([row({ zone: '' })]);
    assert.equal(v.held.length, 1);
    assert.equal(v.held[0].reason.code, 'ZONE_UNKNOWN');
    assert.equal(v.accepted.length, 0);
  });

  test('an unknown part is held with a suggestion attached', () => {
    const v = run([row({ sku: 'GT-l2' })]);
    assert.equal(v.held[0].reason.code, 'SKU_UNKNOWN');
    assert.equal(v.held[0].suggestion, 'GT-12');
    // The point: the record still says GT-l2. Nothing was corrected for us.
    assert.equal(v.held[0].sku, 'GT-l2');
  });

  test('an unreadable revision is held', () => {
    assert.equal(run([row({ rev: 'see attached' })]).held[0].reason.code, 'REVISION_UNREADABLE');
  });

  test('a row with no part number is rejected as unreadable', () => {
    assert.equal(run([row({ sku: null })]).rejected[0].reason.code, 'UNREADABLE');
  });

  test('nothing is ever silently dropped', () => {
    const rows = [
      row({ id: 'SUB-1' }), row({ id: 'SUB-2', status: 'PENDING' }),
      row({ id: 'SUB-3', zone: '' }), row({ id: 'SUB-4', sku: 'ZZZ-99' }),
      row({ id: 'SUB-5', rev: '??' }),
    ];
    const v = run(rows);
    assert.equal(v.accepted.length + v.held.length + v.rejected.length, rows.length);
    assert.equal(v.stats.read, rows.length);
  });
});

describe('contradictions between documents', () => {
  const a = row({ id: 'SUB-0001', rev: 'Rev C' });
  const b = row({ id: 'SUB-0013', rev: 'Rev B' });

  test('two revisions approved for one part in one place is not resolved by guessing', () => {
    const v = run([a, b]);
    assert.equal(v.accepted.length, 0, 'must not pick a winner on its own');
    assert.equal(v.held.length, 2);
    assert.equal(v.held[0].reason.code, 'CONFLICT');
    assert.deepEqual(v.held[0].conflictsWith, ['SUB-0013']);
  });

  test('the newer date does NOT win — a date is not an approval', () => {
    const v = run([
      row({ id: 'SUB-0001', rev: 'Rev C', date: '2020-01-01' }),
      row({ id: 'SUB-0013', rev: 'Rev B', date: '2026-12-31' }),
    ]);
    assert.equal(v.accepted.length, 0);
  });

  test('a supersession note in prose settles it, and is cited', () => {
    const notes = [{ kind: 'SUPERSEDED_BY', loser: 'SUB-0013', winner: 'SUB-0001', text: 'SUB-0013 SUPERSEDED BY SUB-0001' }];
    const v = run([a, b], notes);
    assert.equal(v.accepted.length, 1);
    assert.equal(v.accepted[0].id, 'SUB-0001');
    assert.equal(v.accepted[0].rev, 'C');
    const gone = v.rejected.find(r => r.id === 'SUB-0013');
    assert.equal(gone.reason.code, 'SUPERSEDED');
    assert.equal(gone.citation.winner, 'SUB-0001');
  });

  test('a note about an unrelated row does not settle the conflict', () => {
    const notes = [{ kind: 'SUPERSEDED_BY', loser: 'SUB-9999', winner: 'SUB-0001', text: 'x' }];
    const v = run([a, b], notes);
    assert.equal(v.accepted.length, 0);
    assert.equal(v.held.length, 2);
  });

  test('the same revision twice for one part is agreement, not conflict', () => {
    const v = run([row({ id: 'SUB-1' }), row({ id: 'SUB-2' })]);
    assert.equal(v.accepted.length, 2);
    assert.equal(v.held.length, 0);
  });

  test('the same part in different zones is not a conflict', () => {
    const v = run([row({ id: 'SUB-1', zone: 'Zone A' }), row({ id: 'SUB-2', zone: 'Zone B', rev: 'Rev D' })]);
    assert.equal(v.accepted.length, 2);
  });
});

describe('reading a real register', () => {
  // The shape pdftext.mjs actually produces: one cell per line.
  const TEXT = `
SUBMITTAL REGISTER
REF
ITEM
SUB-0001
GT-12
Grout Termination Unit, 50mm
Structural
Zone A
Rev C
APPROVED
31-Jul-2026
SUB-0005
VLV-22
Isolation Valve, DN50 PN16
Mechanical
Zone B
Rev B
PENDING
09-Aug-2026
NOTES
1. SUB-0013 (GT-12 Rev B, Zone A) is SUPERSEDED BY SUB-0001 Rev C dated 31-Jul-2026.
`;

  test('rows come out with their fields on the right keys', () => {
    const { rows } = extractCandidates(TEXT);
    assert.equal(rows.length, 2);
    const r = rows[0];
    assert.equal(r.id, 'SUB-0001');
    assert.equal(r.sku, 'GT-12');
    assert.equal(r.zone, 'Zone A');
    assert.equal(r.rev, 'Rev C');
    assert.equal(r.status, 'APPROVED');
    assert.equal(r.discipline, 'Structural');
    assert.equal(r.date, '31-Jul-2026');
    assert.equal(r.description, 'Grout Termination Unit, 50mm');
  });

  test('the PENDING row is read, so it can be refused rather than missed', () => {
    const { rows } = extractCandidates(TEXT);
    assert.equal(rows[1].status, 'PENDING');
  });

  test('a supersession buried in prose is found', () => {
    const { notes } = extractCandidates(TEXT);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].loser, 'SUB-0013');
    assert.equal(notes[0].winner, 'SUB-0001');
  });

  test('fields are found by shape, not by column order', () => {
    const shuffled = `
SUB-0002
APPROVED
Zone B
Mechanical
Rev D
VLV-22
Isolation Valve, DN50 PN16
2026-07-28
`;
    const { rows } = extractCandidates(shuffled);
    assert.equal(rows[0].sku, 'VLV-22');
    assert.equal(rows[0].rev, 'Rev D');
    assert.equal(rows[0].zone, 'Zone B');
    assert.equal(rows[0].status, 'APPROVED');
  });

  test('a document with no submittal rows yields nothing, not junk', () => {
    const { rows, notes } = extractCandidates('Just a letter about the weather.');
    assert.deepEqual(rows, []);
    assert.deepEqual(notes, []);
  });
});

describe('handing accepted rows to the engine', () => {
  test('the output is the shape engine/types.ts calls a Submittal', () => {
    const v = run([row()]);
    const s = toSubmittals(v.accepted)[0];
    assert.equal(s.sku, 'GT-12');
    assert.equal(s.zone_id, 'ZONE-A');
    assert.equal(s.approved_rev, 'C');
    assert.equal(s.id, 'SUB-0001');
    assert.ok('description' in s && 'approved_date' in s);
  });

  test('only accepted rows ever reach the engine', () => {
    const v = run([row({ id: 'SUB-1' }), row({ id: 'SUB-2', status: 'PENDING' })]);
    const out = toSubmittals(v.accepted);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'SUB-1');
  });
});

describe('review action codes — what a real register actually says', () => {
  const approved   = ['A', 'NET', 'No Exceptions Taken', 'APPROVED', 'APPD', 'Accepted'];
  const conditional = ['AN', 'B', 'Approved as Noted', 'Make Corrections Noted', 'Furnish as Corrected'];
  const refused    = ['C', 'RR', 'Revise and Resubmit', 'D', 'DIS', 'Disapproved', 'Rejected'];
  const notAnApproval = ['FIO', 'For Information Only', 'RA', 'Receipt Acknowledged', 'Record Copy'];

  for (const code of approved) {
    test(`"${code}" is an approval`, () => {
      const c = classifyStatus(code);
      assert.equal(c.approved, true);
      assert.equal(c.conditional, false);
    });
  }

  for (const code of conditional) {
    test(`"${code}" approves, but conditionally`, () => {
      const c = classifyStatus(code);
      assert.equal(c.approved, true);
      assert.equal(c.conditional, true, 'the reviewer\'s corrections must be surfaced');
    });
  }

  for (const code of refused) {
    test(`"${code}" is not an approval`, () => {
      assert.equal(classifyStatus(code).approved, false);
    });
  }

  // The trap. These look benign and sit in the same column as the approvals.
  for (const code of notAnApproval) {
    test(`"${code}" is filing, not approving`, () => {
      const c = classifyStatus(code);
      assert.equal(c.approved, false);
      assert.equal(c.code, 'INFORMATION_ONLY');
    });
  }

  test('an unknown code returns null rather than a guess', () => {
    for (const junk of ['', '   ', 'Q', 'MAYBE', '???', null, undefined]) {
      assert.equal(classifyStatus(junk), null, `should not classify ${JSON.stringify(junk)}`);
    }
  });

  test('punctuation and brackets from a table cell do not defeat it', () => {
    assert.equal(classifyStatus('A.').code, 'APPROVED');
    assert.equal(classifyStatus('(C)').code, 'REVISE_AND_RESUBMIT');
    assert.equal(classifyStatus('[NET]').code, 'APPROVED');
    assert.equal(classifyStatus(' AN ').code, 'APPROVED_AS_NOTED');
  });

  test('a conditional approval reaches the engine flagged, not silently', () => {
    const v = run([row({ status: 'AN' })]);
    assert.equal(v.accepted.length, 1);
    assert.equal(v.accepted[0].conditional, true);
    assert.equal(toSubmittals(v.accepted)[0].conditional, true);
  });

  test('"For Information Only" never becomes an approved revision', () => {
    const v = run([row({ status: 'FIO' })]);
    assert.equal(v.accepted.length, 0);
    assert.match(v.rejected[0].reason.detail, /not an approval/i);
  });

  test('a bare revision letter is not mistaken for a review action', () => {
    // Rev D + APPROVED. Reading "D" as the action means disapproved, and a good
    // approval gets refused. This is the collision that actually happened.
    const TEXT = ['SUB-0200', 'AHU-04', 'Air Handling Unit', 'Mechanical', 'Zone A', 'D', 'APPROVED', '01-Aug-2026'].join('\n');
    const { rows } = extractCandidates(TEXT);
    assert.equal(rows[0].rev, 'D');
    assert.equal(rows[0].status, 'APPROVED');
    const v = validateSubmittals({ rows }, ctx);
    assert.equal(v.accepted.length, 1);
    assert.equal(v.accepted[0].rev, 'D');
  });

  test('explicit "Rev X" is claimed before any bare letter', () => {
    const TEXT = ['SUB-0201', 'GT-12', 'Grout unit', 'Structural', 'Zone A', 'Rev C', 'A', '01-Aug-2026'].join('\n');
    const { rows } = extractCandidates(TEXT);
    assert.equal(rows[0].rev, 'Rev C');
    assert.equal(rows[0].status, 'A');
  });

  test('two bare letters fall back to document order — revision, then action', () => {
    const TEXT = ['SUB-0202', 'GT-12', 'Grout unit', 'Structural', 'Zone A', 'C', 'A', '01-Aug-2026'].join('\n');
    const { rows } = extractCandidates(TEXT);
    assert.equal(rows[0].rev, 'C');
    assert.equal(rows[0].status, 'A');
    assert.equal(validateSubmittals({ rows }, ctx).accepted.length, 1);
  });

  test('a register using only letter codes still parses end to end', () => {
    const TEXT = [
      'SUB-0100', 'GT-12', 'Grout Termination Unit', 'Structural', 'Zone A', 'Rev C', 'A', '01-Aug-2026',
      'SUB-0101', 'VLV-22', 'Isolation Valve', 'Mechanical', 'Zone B', 'Rev D', 'C', '02-Aug-2026',
      'SUB-0102', 'AHU-04', 'Air Handling Unit', 'Mechanical', 'Zone A', 'Rev B', 'FIO', '03-Aug-2026',
    ].join('\n');
    const { rows } = extractCandidates(TEXT);
    assert.equal(rows.length, 3);
    const v = validateSubmittals({ rows }, ctx);
    assert.equal(v.accepted.length, 1, 'only the A row is approved');
    assert.equal(v.accepted[0].id, 'SUB-0100');
    assert.equal(v.rejected.length, 2, 'C and FIO are both refused');
  });
});

/**
 * Grounded against a real document, not against our own assumptions.
 *
 * Source: Hanford Mission Integration Solutions, Project L-895 "Fire Protection
 * Infrastructure for Plateau Raw Water", RFP 354825, Appendix A - Submittal
 * Register, Rev 0, 10/11/2021. A genuine US Department of Energy site document,
 * in docs/submittals/.
 *
 * It is worth more than a hundred invented cases because we did not choose any
 * of it: the column layout, the vocabulary and the code definitions are all
 * theirs. The definitions below are quoted from its own instructions page.
 */
describe('grounded in a real DOE submittal register (Hanford L-895)', () => {
  // "9. STATUS CODE: Submittal review status code."
  const DOC = [
    ['A', 'Conforms to the subcontract requirements',                 'APPROVED',            true,  false],
    ['B', 'Minor comments, approved with exceptions as corrected',    'APPROVED_AS_NOTED',   true,  true ],
    ['C', 'Revise and resubmit',                                      'REVISE_AND_RESUBMIT', false, false],
  ];

  for (const [code, meaning, expected, approved, conditional] of DOC) {
    test(`"${code}" = ${meaning}`, () => {
      const c = classifyStatus(code);
      assert.equal(c.code, expected);
      assert.equal(c.approved, approved);
      assert.equal(c.conditional, conditional);
    });
  }

  /**
   * The trap this document set for us.
   *
   * Column 5 is SUBMITTAL TYPE and carries AP and APW:
   *   "AP  = Approval Required (work associated with the submittal may proceed
   *          prior to Buyer approval)"
   *   "APW = Approval Required Prior to Work"
   *
   * Both begin with A, both sit in a letter column, and neither is a review
   * outcome — they describe when work may start, not whether anything was
   * approved. A parser matching on leading letters reads "AP" as approved and
   * puts an unreviewed submittal into the record wearing a tick.
   */
  for (const code of ['AP', 'APW']) {
    test(`"${code}" is a submittal TYPE, not an approval`, () => {
      assert.equal(classifyStatus(code), null,
        `${code} describes when work may begin, not whether anything was approved`);
    });
  }

  test('the format codes in column 6 are not approvals either', () => {
    for (const c of ['DWG', 'MFC', 'PDF', 'P3', 'MPP']) {
      assert.equal(classifyStatus(c), null, `${c} is a file format`);
    }
  });

  test('the milestone codes in column 7 are not approvals either', () => {
    // "A = Date of Subcontract Award" — note this document uses a BARE "A" for
    // a milestone as well as for an approval, in a different column. Column
    // position is the only thing distinguishing them, which is exactly why the
    // extractor claims unambiguous forms first and why a row it cannot resolve
    // is refused rather than guessed.
    for (const c of ['BO', 'KO', 'CD', 'DD', 'SC', 'EC']) {
      assert.equal(classifyStatus(c), null, `${c} is a schedule milestone`);
    }
  });

  test('a prefixed reference is still a reference', () => {
    // Real registers put the contract number first: "XXXXXX-XXX-SUB-001".
    // The extractor originally required the line to BEGIN with "SUB-", so it
    // found zero rows in the genuine document — the model saw them and the
    // pattern fallback silently saw nothing, which is the worst way for a
    // fallback to fail.
    for (const ref of ['XXXXXX-XXX-SUB-001', '24-0142-SUB-003', 'SUB-0001', 'L895-SUB-12']) {
      const { rows } = extractCandidates([ref, 'GT-12', 'Zone A', 'Rev C', 'A'].join('\n'));
      assert.equal(rows.length, 1, `did not recognise ${ref}`);
      assert.equal(rows[0].id, ref.toUpperCase());
    }
  });

  test('prose mentioning a submittal number does not start a row', () => {
    const { rows } = extractCandidates(
      'Note: the reference SUB-0013 shall be updated upon award.\nSee section 5.1.2.');
    assert.equal(rows.length, 0);
  });

  test('a supersession note naming full contract-scoped references is found', () => {
    const { notes } = extractCandidates(
      'NOTES:  1. 354825-001-SUB-004 (AHU-04 Rev B, Zone C) is SUPERSEDED BY 354825-001-SUB-011 Rev C.');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].loser, '354825-001-SUB-004');
    assert.equal(notes[0].winner, '354825-001-SUB-011');
  });

  test('the real A/B/C codes drive the gate end to end', () => {
    const rows = [
      { id: 'X-SUB-1', sku: 'GT-12',  zone: 'Zone A', rev: 'Rev C', status: 'A' },
      { id: 'X-SUB-2', sku: 'VLV-22', zone: 'Zone B', rev: 'Rev C', status: 'B' },
      { id: 'X-SUB-3', sku: 'AHU-04', zone: 'Zone A', rev: 'Rev B', status: 'C' },
    ];
    const v = validateSubmittals({ rows }, ctx);
    assert.equal(v.accepted.length, 2, 'A and B are approvals');
    assert.equal(v.accepted.find(r => r.id === 'X-SUB-2').conditional, true,
      'B is approved WITH exceptions and must say so');
    assert.equal(v.rejected.length, 1);
    assert.equal(v.rejected[0].id, 'X-SUB-3');
  });

  test('a pre-award register has no part numbers, and none are invented', () => {
    // The published L-895 register is pre-award: "The XXXXX-XXX shall be updated
    // to the contract-release number upon award." Every row is a placeholder.
    const TEXT = [
      'XXXXXX-XXX-SUB-001', '001', '5.1.2', 'Personnel Training Qualifications', 'APW', 'PDF, MFC', 'KO + 8d', '4d',
      'XXXXXX-XXX-SUB-002', '001', '5.1.2', 'NRTL Certification', 'APW', 'PDF, MFC', 'KO + 8d', '4d',
    ].join('\n');
    const { rows } = extractCandidates(TEXT);
    const v = validateSubmittals({ rows }, ctx);
    assert.equal(v.accepted.length, 0, 'nothing may enter the record from a blank template');
    assert.ok(v.rejected.length > 0, 'and the rows must be reported, not silently dropped');
  });
});
