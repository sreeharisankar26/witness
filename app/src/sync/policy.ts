/**
 * What to do with one attempted send. Pure, so it can be tested exhaustively.
 *
 * This is the rule that broke the queue twice:
 *
 *   v1  gave up on a row after 8 failures  -> rows queued while the server was
 *       misconfigured died permanently, even after the problem was fixed.
 *   v2  removed the cap but kept `break` on any failure -> one row the server
 *       permanently refused blocked every row behind it, forever.
 *
 * The distinction both versions missed: an ANSWER we don't like is not the same
 * as NO ANSWER.
 */
export type SendOutcome =
  /** Accepted. Mark synced, move to the next row. */
  | 'SENT'
  /** Server understood and refused. Retrying cannot help — retire it, keep going. */
  | 'RETIRE'
  /** No answer at all. Every following row would fail the same way — stop. */
  | 'STOP';

/** Classify an HTTP response the server actually gave us. */
export function classifyStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return 'SENT';
  // 4xx is a considered refusal: malformed body, unknown route, too large.
  // No amount of retrying changes the answer.
  if (status >= 400 && status < 500) return 'RETIRE';
  // 5xx is the server having a bad moment — it may well work next tick.
  return 'STOP';
}

/** Classify a thrown error: we never got an answer. */
export function classifyError(err: { name?: string } | null | undefined): SendOutcome {
  return 'STOP';
}

/**
 * Human-readable reason, for the banner on the scan screen. A queue that will
 * not drain must never be silent about why.
 */
export function describe(outcome: SendOutcome, server: string, status?: number): string | null {
  switch (outcome) {
    case 'SENT': return null;
    case 'RETIRE':
      return `the site server rejected one item (${status}); the rest are still syncing`;
    case 'STOP':
      return status
        ? `the site server is having trouble (${status}) — will retry`
        : `cannot reach ${server}`;
  }
}
