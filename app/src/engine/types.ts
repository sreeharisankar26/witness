// Shared types for the Witness match engine.
// Frozen early. Everyone codes against this file.

export type Verdict =
  | 'MATCH'                 // installed rev == approved rev for this location
  | 'MISMATCH'              // installed rev != approved rev
  | 'MISMATCH_SUPERSEDED'   // installed rev is explicitly superseded by the approved one
  | 'UNKNOWN_UNIT'          // serial is not in the approved record at all
  | 'NO_APPROVED_RECORD'    // nothing approved for this SKU in this zone
  | 'TAG_CONFLICT';         // tag SKU disagrees with the record's SKU for that serial

/** Whether the worker should act on this, or a human needs to look first. */
export type Authority =
  | 'BINDING'    // record is fresh and the identification is certain
  | 'ADVISORY';  // record is stale, or identification came from perception

/** How we learned which part this is. Perception is never binding on its own. */
export type IdentitySource =
  | 'TAG'         // machine-readable code. exact.
  | 'NAMEPLATE'   // vision model read the plate. probabilistic.
  | 'MANUAL';     // a human typed it. trusted, but human.

export interface Unit {
  serial: string;
  sku: string;
  rev: string;
  manufactured_date?: string;
}

export interface Submittal {
  id: string;
  sku: string;
  description: string;
  discipline?: string;
  zone_id: string;
  approved_rev: string;
  approved_date: string;
  doc_ref?: string;
}

export interface Revision {
  sku: string;
  rev: string;
  superseded_by: string | null;
  approved_date: string;
  change_note?: string;
}

export interface Ncr {
  id: string;
  serial: string;
  sku: string;
  zone_id: string;
  installed_rev: string;
  approved_rev: string;
  created_at: string;
  confirmed_by?: string | null;
  narrative?: string;
  status?: 'OPEN' | 'CLOSED';
}

export interface Zone {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
}

/** Everything resolve() is allowed to see. No network, no globals, no clock. */
export interface RecordSnapshot {
  units: Unit[];
  submittals: Submittal[];
  revisions: Revision[];
  ncrs: Ncr[];
  zones?: Zone[];
  /** ISO timestamp of the last successful sync with the approved record. */
  record_synced_at: string;
}

export interface ScannedTag {
  sku: string;
  serial: string;
  /** Tag payload version, from "WTNS:<v>|..." */
  version: number;
  /** How this identification was obtained. Defaults to TAG. */
  source?: IdentitySource;
  /** 0..1. Only meaningful for NAMEPLATE. */
  confidence?: number;
}

/**
 * A repeat-failure record for one component in one location.
 *
 * Naming honesty: this is not machine learning. It is a deduplicated count of
 * prior confirmed nonconformances, plus how widely and how recently they
 * happened. We call the product feature "Witness Memory"; the mechanism is a
 * repeat-failure counter, and we describe it that way rather than dressing it up.
 * It is useful precisely because it is exact and explainable.
 */
export interface MemoryWarning {
  sku: string;
  zone_id: string;
  /** Distinct physical units involved. NOT a row count - see memoryFor(). */
  priorCount: number;
  /** Distinct people who confirmed one of these. Repeats across crew matter more. */
  distinctWorkers: number;
  firstOccurred: string;
  lastOccurred: string;
  spanDays: number;
  /** ISOLATED < RECURRING < SYSTEMIC. Thresholds are explicit, not learned. */
  pattern: 'RECURRING' | 'SYSTEMIC';
  message: string;
}

/** Result of a vision model reading an equipment nameplate. */
export interface NameplateReading {
  ok: boolean;
  sku: string | null;
  serial: string | null;
  /** 0..1 self-reported by the model, clamped and floored by us. */
  confidence: number;
  /** Everything the model claims it could read. Shown to the human verbatim. */
  rawText: string;
  /** Populated when ok === false. */
  error?: string;
  model?: string;
}

export interface Resolution {
  verdict: Verdict;
  authority: Authority;
  serial: string;
  sku: string;
  zone_id: string;
  installedRev: string | null;
  approvedRev: string | null;
  description: string | null;
  docRef: string | null;
  /** Revisions between installed and approved, oldest first. */
  supersededChain: string[];
  /** Why the record might not be trustworthy right now. */
  staleness: { ageHours: number; stale: boolean; syncedAt: string; clockSuspect: boolean };
  /** How we identified the part, and how sure we are. */
  identity: { source: IdentitySource; confidence: number };
  /** Non-null when this exact confusion has happened here before. */
  memory: MemoryWarning | null;
  /** Deterministic fallback sentence. Used verbatim when offline. */
  templateSpeech: string;
  /** True when a nonconformance report should be drafted for a human to confirm. */
  requiresNcr: boolean;
}
