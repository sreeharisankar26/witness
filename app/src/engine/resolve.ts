/**
 * THE SAFETY PATH.
 *
 * This file decides whether an installed unit is the approved one for its
 * location. It is a pure function over a local data snapshot:
 *
 *   - no network call
 *   - no language model
 *   - no ambient clock (time is passed in)
 *   - no I/O of any kind
 *
 * The division of labour in Witness is deliberate and worth stating plainly:
 *
 *      AI reads the world.          (vision/nameplate.ts - probabilistic)
 *      This file rules on it.       (deterministic, auditable, offline)
 *
 * A vision model may tell us "that plate says GT-12, serial SN-4471". It never
 * tells us whether that is allowed to be there. The ruling is a join against the
 * approved record, so it cannot invent a revision that was never approved. And
 * because perception is fallible, anything identified by a model is returned as
 * ADVISORY - it prompts a human rather than issuing a ruling.
 *
 * Every branch below returns a verdict. There is no default "looks fine".
 */

import type {
  RecordSnapshot, Resolution, ScannedTag, MemoryWarning, Verdict, Authority,
  IdentitySource,
} from './types.ts';

/** Beyond this, the cached approved record is no longer treated as binding. */
export const STALE_AFTER_HOURS = 24;

/** Distinct prior units needed before Witness speaks up pre-emptively. */
export const MEMORY_THRESHOLD = 2;

/** At or above this many distinct units, the problem is with the process. */
export const SYSTEMIC_THRESHOLD = 3;

/**
 * A nameplate reading below this is never auto-resolved - the worker is asked
 * to confirm what the model read before we rule on it.
 */
export const NAMEPLATE_MIN_CONFIDENCE = 0.55;

export class TagParseError extends Error {}

/**
 * Tag payload: "WTNS:1|GT-12|SN-4471"
 * Versioned so a future format cannot be silently misread as this one.
 */
export function parseTag(raw: string): ScannedTag {
  const t = (raw || '').trim();
  const m = /^WTNS:(\d+)\|([A-Za-z0-9\-_.]+)\|([A-Za-z0-9\-_.]+)$/.exec(t);
  if (!m) throw new TagParseError(`Not a Witness asset tag: ${JSON.stringify(t.slice(0, 40))}`);
  const version = Number(m[1]);
  if (version !== 1) throw new TagParseError(`Unsupported tag version ${version}`);
  return { version, sku: m[2].toUpperCase(), serial: m[3].toUpperCase(), source: 'TAG', confidence: 1 };
}

/** Build a tag from a non-QR identification (nameplate or typed by hand). */
export function tagFrom(
  sku: string, serial: string, source: IdentitySource, confidence: number,
): ScannedTag {
  return {
    version: 1,
    sku: sku.trim().toUpperCase(),
    serial: serial.trim().toUpperCase(),
    source,
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}

interface Age { hours: number; clockSuspect: boolean; }

/**
 * Age of the record, from the phone's point of view.
 *
 * Fails CLOSED. A negative age means the record claims to have synced in the
 * future - almost always a wrong device clock, which is common on cheap site
 * hardware. Previously this clamped to zero, which made a bad clock silently
 * disable staleness protection entirely. Now it is treated as maximally stale,
 * because we cannot trust the one signal we use to judge freshness.
 */
function ageOf(syncedIso: string, nowIso: string): Age {
  const a = Date.parse(syncedIso), b = Date.parse(nowIso);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return { hours: Number.POSITIVE_INFINITY, clockSuspect: true };
  }
  const hours = (b - a) / 36e5;
  if (hours < 0) return { hours: Number.POSITIVE_INFINITY, clockSuspect: true };
  return { hours, clockSuspect: false };
}

/**
 * Walk the revision chain from `from` forward, returning the revisions passed
 * through to reach `to`. Empty if `to` is not downstream of `from`.
 * Guarded against cyclic data.
 */
export function supersededChain(
  snapshot: RecordSnapshot, sku: string, from: string, to: string,
): string[] {
  const byRev = new Map(
    snapshot.revisions.filter(r => r.sku === sku).map(r => [r.rev, r]),
  );
  const chain: string[] = [];
  const seen = new Set<string>([from]);
  let cur = byRev.get(from);
  while (cur?.superseded_by) {
    const next = cur.superseded_by;
    if (seen.has(next)) return [];       // cycle in the record - refuse to guess
    chain.push(next);
    if (next === to) return chain;
    seen.add(next);
    cur = byRev.get(next);
  }
  return [];
}

/**
 * Has this component been confused in this location before?
 *
 * Counts DISTINCT PHYSICAL UNITS, not NCR rows. Scanning the same wrong part
 * five times during a rehearsal is one problem, not five, and reporting it as
 * five would make the number meaningless within a day of real use.
 */
export function memoryFor(
  snapshot: RecordSnapshot, sku: string, zoneId: string,
): MemoryWarning | null {
  const prior = snapshot.ncrs
    .filter(n => n.sku === sku && n.zone_id === zoneId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const units = new Set(prior.map(n => n.serial));
  if (units.size < MEMORY_THRESHOLD) return null;

  const workers = new Set(prior.map(n => n.confirmed_by).filter(Boolean) as string[]);
  const first = prior[0].created_at;
  const last = prior[prior.length - 1].created_at;
  const spanDays = Math.max(
    0, Math.round((Date.parse(last) - Date.parse(first)) / 864e5) || 0,
  );
  const pattern = units.size >= SYSTEMIC_THRESHOLD ? 'SYSTEMIC' : 'RECURRING';

  // Stated as history, not as an instruction. The verdict gives the
  // instruction; if this also said "double-check" it would contradict a green
  // MATCH sitting directly beneath it.
  const crew = workers.size > 1 ? ` across ${workers.size} different people` : '';
  return {
    sku, zone_id: zoneId,
    priorCount: units.size,
    distinctWorkers: workers.size,
    firstOccurred: first.slice(0, 10),
    lastOccurred: last.slice(0, 10),
    spanDays,
    pattern,
    message:
      `${sku} has been the wrong revision here ${units.size} times before${crew}` +
      `, most recently ${last.slice(0, 10)}.`,
  };
}

export interface ResolveOptions {
  /** ISO timestamp. Injected, never read from the ambient clock, so tests are stable. */
  now: string;
  staleAfterHours?: number;
}

/**
 * The single entry point. Given an identified part and the zone the worker has
 * confirmed they are standing in, return a verdict.
 *
 * Note the zone is an INPUT, not an inference. Witness never guesses location:
 * a unit can physically be anywhere; the question is only ever "is this unit
 * approved for THIS place".
 */
export function resolve(
  snapshot: RecordSnapshot,
  tag: ScannedTag,
  zoneId: string,
  opts: ResolveOptions,
): Resolution {
  const age = ageOf(snapshot.record_synced_at, opts.now);
  const staleAfter = opts.staleAfterHours ?? STALE_AFTER_HOURS;
  const stale = age.hours > staleAfter;

  const source: IdentitySource = tag.source ?? 'TAG';
  const confidence = tag.confidence ?? (source === 'TAG' ? 1 : 0.5);
  // Perception is never binding on its own. A model reading a grimy plate is a
  // strong hint, not a compliance ruling.
  const perceived = source === 'NAMEPLATE';

  const unit = snapshot.units.find(u => u.serial === tag.serial) ?? null;
  const submittal =
    snapshot.submittals.find(s => s.sku === tag.sku && s.zone_id === zoneId) ?? null;
  const memory = memoryFor(snapshot, tag.sku, zoneId);

  const ageHours = Number.isFinite(age.hours) ? Math.round(age.hours * 10) / 10 : Infinity;

  const base = {
    serial: tag.serial,
    sku: tag.sku,
    zone_id: zoneId,
    installedRev: unit?.rev ?? null,
    approvedRev: submittal?.approved_rev ?? null,
    description: submittal?.description ?? null,
    docRef: submittal?.doc_ref ?? null,
    supersededChain: [] as string[],
    staleness: {
      ageHours, stale,
      syncedAt: snapshot.record_synced_at,
      clockSuspect: age.clockSuspect,
    },
    identity: { source, confidence },
    memory,
  };

  const staleNote = age.clockSuspect
    ? ` Careful - this phone's clock disagrees with the record, so I can't tell how current it is. Treat this as advisory.`
    : stale
      ? ` Heads up - the approved record here last synced ${Math.round(age.hours)} hours ago, so treat this as advisory until it refreshes.`
      : '';

  const perceivedNote = perceived
    ? ` I read this off the nameplate rather than a tag, so confirm the numbers before you act.`
    : '';

  const out = (
    verdict: Verdict, speech: string, requiresNcr: boolean,
    authority: Authority = 'BINDING', extra: Partial<Resolution> = {},
  ): Resolution => ({
    ...base,
    verdict,
    // Any of: stale record, suspect clock, or model-derived identity downgrades
    // a ruling to a prompt.
    authority: (stale || age.clockSuspect || perceived) ? 'ADVISORY' : authority,
    templateSpeech: `${speech}${perceivedNote}${staleNote}`,
    requiresNcr,
    ...extra,
  });

  // 1. The serial is not in the record. This is a first-class answer, not an error.
  if (!unit) {
    return out(
      'UNKNOWN_UNIT',
      `I have no approved record for serial ${tag.serial} in ${zoneId}. Flagging this for your supervisor rather than guessing.`,
      false, 'ADVISORY',
    );
  }

  // 2. The tag says one SKU, the record says the serial belongs to another.
  //    Relabelled part, cloned tag, or a data error - all need a human.
  if (unit.sku !== tag.sku) {
    return out(
      'TAG_CONFLICT',
      `This reads as ${tag.sku} but serial ${tag.serial} is recorded as ${unit.sku}. I won't call this one - get it checked.`,
      false, 'ADVISORY',
    );
  }

  // 3. Nothing is approved for this SKU here. Possibly the wrong zone, possibly
  //    a submittal that never landed. Either way, not our call to make.
  if (!submittal) {
    return out(
      'NO_APPROVED_RECORD',
      `Nothing is approved for ${tag.sku} in ${zoneId}. Either this part is in the wrong place or the submittal hasn't come through. Not installing on my say-so.`,
      false, 'ADVISORY',
    );
  }

  // 4. Correct.
  if (unit.rev === submittal.approved_rev) {
    return out(
      'MATCH',
      `${tag.sku} Rev ${unit.rev}, ${tag.serial}. That's the approved revision for ${zoneId}. Good to install - logging it as field-verified.`,
      false,
    );
  }

  // 5. Wrong revision. Is the installed one explicitly superseded by the approved one?
  const chain = supersededChain(snapshot, tag.sku, unit.rev, submittal.approved_rev);
  const approvedOn = submittal.approved_date;

  if (chain.length > 0) {
    const behind = chain.length;
    return out(
      'MISMATCH_SUPERSEDED',
      `Stop - that's Rev ${unit.rev}. Rev ${submittal.approved_rev} was approved for ${zoneId} on ${approvedOn}, ${behind} revision${behind > 1 ? 's' : ''} ahead of what you're holding. Drafting an NCR for you to confirm.`,
      true, 'BINDING', { supersededChain: chain },
    );
  }

  // 6. Different revision, but not on a chain we can trace. Still wrong, but we
  //    say less, because we know less.
  return out(
    'MISMATCH',
    `That's Rev ${unit.rev}; ${zoneId} approves Rev ${submittal.approved_rev}. I can't trace how those two relate, so I'm drafting an NCR for a human to confirm.`,
    true,
  );
}

/** Verdict -> UI treatment. Kept here so app and dashboard never disagree. */
export function severityOf(v: Verdict): 'OK' | 'STOP' | 'CHECK' {
  switch (v) {
    case 'MATCH': return 'OK';
    case 'MISMATCH':
    case 'MISMATCH_SUPERSEDED': return 'STOP';
    default: return 'CHECK';
  }
}
