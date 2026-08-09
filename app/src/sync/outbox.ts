/**
 * The drain.
 *
 * Nothing in the worker's path ever waits on the network. Writes land in the
 * local outbox; this pushes them to the site server whenever it can.
 *
 * The ten seconds of video where you put the phone in airplane mode, scan, get
 * a correct verdict, then turn the radio back on and watch the queue empty —
 * that is this file.
 */
import * as Network from 'expo-network';
import { openDb, deviceId, logEvent } from '../data/db';
import { classifyStatus, describe } from './policy';

/**
 * Baked in at bundle time from app/.env. If you change .env you MUST restart
 * the dev server — the running bundle keeps the old value, and the symptom is
 * a queue that never drains while everything else looks healthy. Exported so
 * the app can show it on screen rather than leave you guessing.
 */
export const SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:8787';

export interface SyncResult {
  sent: number;
  failed: number;
  /** Permanently refused by the server. Retired so they cannot block the queue. */
  rejected: number;
  online: boolean;
  /** Radio on AND the site server answering. This is what the header shows. */
  serverReachable: boolean;
  pending: number;
  /** Why the last attempt failed, for display. Null when all is well. */
  lastError: string | null;
  server: string;
}

/**
 * Radio state, for the ONLINE/OFFLINE indicator only.
 *
 * Deliberately does NOT consider `isInternetReachable`. Witness syncs to a
 * server on the local network; a site wifi with no route to the internet — a
 * captive portal, a site router, a phone hotspot — is perfectly usable and used
 * to be reported as offline, which stopped the drain from even trying.
 */
export async function isOnline(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync();
    return Boolean(s.isConnected);
  } catch {
    return false;
  }
}

/** Is the site server actually reachable from this phone? Used by diagnostics. */
export async function pingServer(ms = 3000): Promise<{ ok: boolean; detail: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${SERVER}/health`, { signal: ctl.signal });
    return r.ok
      ? { ok: true, detail: `reachable at ${SERVER}` }
      : { ok: false, detail: `${SERVER} answered ${r.status}` };
  } catch (e: any) {
    return {
      ok: false,
      detail: e?.name === 'AbortError'
        ? `no answer from ${SERVER} (timed out)`
        : `cannot reach ${SERVER}`,
    };
  } finally { clearTimeout(t); }
}

/**
 * Drains the outbox. Safe to call as often as you like — never throws.
 *
 * Two things it deliberately does NOT do:
 *
 *  - It does not check the radio first. Asking permission from a heuristic and
 *    then not trying is strictly worse than trying and failing: the attempt is
 *    cheap, and the heuristic was wrong on exactly the networks a building site
 *    has.
 *  - It does not give up on a row. An earlier version parked anything that had
 *    failed 8 times, so rows queued while the server was down or misconfigured
 *    stayed dead forever, even after the problem was fixed.
 */
export async function drain(): Promise<SyncResult> {
  const db = await openDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM outbox WHERE synced_at IS NULL ORDER BY id ASC LIMIT 100`,
  );

  const online = await isOnline();

  if (rows.length === 0) {
    // Nothing to send, but the header still needs to know whether the server is
    // there — otherwise it reads ONLINE while the app cannot reach anything.
    const { ok } = await pingServer(2000);
    return {
      sent: 0, failed: 0, rejected: 0, online, serverReachable: ok,
      pending: 0, lastError: null, server: SERVER,
    };
  }

  const dev = await deviceId();
  let sent = 0, failed = 0, rejected = 0, lastError: string | null = null;

  for (const row of rows) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      let res: Response;
      try {
        res = await fetch(`${SERVER}${row.endpoint}`, {
          method: 'POST',
          signal: ctl.signal,
          headers: {
            'Content-Type': 'application/json',
            // Lets the server drop a duplicate if we retried after a timeout
            // that actually succeeded.
            //
            // MUST be device-scoped. Outbox ids are a local AUTOINCREMENT, so
            // every phone's first write was `outbox-1`; the server treated the
            // second phone's genuine write as a duplicate and discarded it while
            // reporting success.
            'Idempotency-Key': `${dev}-${row.id}`,
          },
          body: row.payload_json,
        });
      } finally { clearTimeout(t); }

      const outcome = classifyStatus(res.status);
      if (outcome === 'RETIRE') {
        // The server understood us and refused. Retrying cannot help, and
        // leaving it at the head of the queue blocked every row behind it —
        // one malformed payload could freeze syncing forever. Retire it and
        // keep an auditable record rather than dropping it silently.
        await db.runAsync(
          `UPDATE outbox SET synced_at = ?, attempts = attempts + 1 WHERE id = ?`,
          new Date().toISOString(), row.id,
        );
        await logEvent('SYNC_REJECTED', {
          endpoint: row.endpoint, status: res.status, payload: row.payload_json,
        });
        rejected++;
        lastError = describe('RETIRE', SERVER, res.status);
        continue;                       // NOT break — the queue keeps moving
      }
      if (outcome === 'STOP') {
        await db.runAsync(`UPDATE outbox SET attempts = attempts + 1 WHERE id = ?`, row.id);
        failed++;
        lastError = describe('STOP', SERVER, res.status);
        break;
      }
      await db.runAsync(
        `UPDATE outbox SET synced_at = ?, attempts = attempts + 1 WHERE id = ?`,
        new Date().toISOString(), row.id,
      );
      sent++;
    } catch (e: any) {
      // A thrown error means we never got an answer — unreachable, DNS, TLS,
      // timeout. Every remaining row would fail the same way, so stop here and
      // try again on the next tick.
      await db.runAsync(`UPDATE outbox SET attempts = attempts + 1 WHERE id = ?`, row.id);
      failed++;
      lastError = e?.name === 'AbortError'
        ? `no answer from ${SERVER}`
        : (e?.message ? `${e.message} — ${SERVER}` : `cannot reach ${SERVER}`);
      break;
    }
  }

  const after = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM outbox WHERE synced_at IS NULL`,
  );
  return {
    sent, failed, rejected, online,
    // We just talked to it, or we just failed to. No need to ping separately.
    serverReachable: sent > 0 || rejected > 0 ? true : failed === 0,
    pending: after?.n ?? 0, lastError, server: SERVER,
  };
}

/** Background drain. Cheap, and quiet when there is nothing to do. */
export function startAutoSync(onResult?: (r: SyncResult) => void, everyMs = 5000) {
  const t = setInterval(async () => onResult?.(await drain()), everyMs);
  return () => clearInterval(t);
}
