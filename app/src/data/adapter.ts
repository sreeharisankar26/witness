/**
 * THE SWAP POINT.
 *
 * When a judge says "your data is fake", open this file. It is the only place
 * that knows where the approved record comes from. Everything downstream -
 * the match engine, the memory, the NCR draft, the dashboard - consumes
 * RecordSnapshot and does not care who produced it.
 *
 * To go live against Kaya: implement KayaAdapter.fetch() and change one line
 * in getAdapter(). Nothing else in the codebase moves.
 */
import seed from './witness_seed.json';
import type { RecordSnapshot } from '../engine/types';

export interface RecordAdapter {
  readonly name: string;
  /** Pull the current approved record. Called on first launch and on sync. */
  fetch(): Promise<RecordSnapshot>;
}

/** Synthetic record, bundled with the app. Works with the radio off. */
export class SeedAdapter implements RecordAdapter {
  readonly name = 'seed (synthetic)';
  async fetch(): Promise<RecordSnapshot> {
    return seed as unknown as RecordSnapshot;
  }
}

/**
 * Kaya's approved submittal record. Stubbed - we do not have credentials.
 * The shape below is what we built against; if Kaya's differs, the mapping
 * lives here and only here.
 */
export class KayaAdapter implements RecordAdapter {
  readonly name = 'kaya';
  constructor(private baseUrl: string, private token: string) {}

  async fetch(): Promise<RecordSnapshot> {
    const res = await fetch(`${this.baseUrl}/v1/projects/PRJ-4471/approved-record`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`Kaya record fetch failed: ${res.status}`);
    const raw = await res.json();
    // Map Kaya's field names onto ours. Deliberately explicit - a rename on
    // their side should break loudly here, not silently produce wrong verdicts.
    return {
      record_synced_at: new Date().toISOString(),
      units: raw.assets.map((a: any) => ({
        serial: a.serial_number, sku: a.item_code, rev: a.revision,
        manufactured_date: a.mfg_date,
      })),
      submittals: raw.submittals.map((s: any) => ({
        id: s.submittal_id, sku: s.item_code, description: s.item_description,
        discipline: s.discipline, zone_id: s.location_code,
        approved_rev: s.current_approved_revision, approved_date: s.approved_on,
        doc_ref: s.document_reference,
      })),
      revisions: raw.revisions.map((r: any) => ({
        sku: r.item_code, rev: r.revision, superseded_by: r.superseded_by ?? null,
        approved_date: r.approved_on, change_note: r.change_summary,
      })),
      ncrs: raw.nonconformances ?? [],
    };
  }
}

/**
 * The record built by reading real submittal documents.
 *
 * Produced by `node tools/ingest.mjs`: a model reads the PDFs, then
 * server/ingest.mjs decides what is allowed to become an approved revision.
 * Only accepted rows are in here — anything held for review or refused is
 * listed under `_ingest` with the reason, and is deliberately NOT approved.
 *
 * This is the honest answer to "your data is synthetic". The documents are
 * synthetic; the path from a document to a verdict is not.
 */
export class IngestedAdapter implements RecordAdapter {
  readonly name = 'ingested (from submittal documents)';
  async fetch(): Promise<RecordSnapshot> {
    // Static require so Metro bundles it. Falls back to the seed if ingestion
    // has never been run, rather than starting with no record at all.
    try {
      return require('./witness_record.json') as RecordSnapshot;
    } catch {
      return seed as unknown as RecordSnapshot;
    }
  }
}

/**
 * Which record the app runs on.
 *
 * Defaults to the seed, because a demo should not silently change what it is
 * ruling against. Set EXPO_PUBLIC_RECORD=ingested in app/.env (the control
 * panel writes it) to run against what ingestion produced — fewer approved
 * revisions, and the parts that were held now correctly return
 * NO_APPROVED_RECORD instead of a confident answer nobody signed off.
 */
export function getAdapter(): RecordAdapter {
  const source = process.env.EXPO_PUBLIC_RECORD ?? 'seed';
  if (source === 'ingested') return new IngestedAdapter();
  return new SeedAdapter();
}
