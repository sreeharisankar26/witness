# WITNESS — Red Team, round 2

Every finding below was reproduced with a script before being called a bug, and
re-run after the fix. **Four of the five were introduced by my own repairs in the
previous two rounds** — which is the honest headline: this codebase's main risk
right now is churn, not design.

---

## What I attacked

The coverage-inflation bug you found was a specific shape: *does repeating a
harmless action inflate a number?* I assumed that shape had more instances and
went looking, then swept the code I had touched most recently.

---

## FOUND AND FIXED

### 1. One rejected item froze the entire sync queue — **I introduced this**

When I removed the retry cap two rounds ago, I left `break` on any failure. A row
the server permanently refuses (malformed payload, 400) sat at the head of the
queue and blocked every row behind it, forever.

```
  drain 1: sent=1  still queued=3
  drain 2: sent=0  still queued=3      <- rows 3 and 4 never sync. ever.
  drain 6: sent=0  still queued=3
```

The old retry cap at least parked it. I removed the cap and replaced it with
something strictly worse.

**Fixed** by distinguishing the two failure kinds, which the old code conflated:
a **4xx** means the server understood and refused, so retrying is pointless —
retire the row, write a `SYNC_REJECTED` event so it stays auditable, and *keep
going*. A **thrown error** means no answer at all, so every following row would
fail identically — stop and retry next tick.

```
  after fix: sent=3 rejected=1 queued=0
```

### 2. Re-scanning inflated the "N queued" counter — **I introduced this**

Deriving ids from the thing rather than the moment fixed the *data*, but
`enqueue` still appended a new outbox row on every scan. Eight rehearsal scans of
one tag produced eight queued rows with byte-identical payloads.

```
  before: 8 rescans + 3 of another -> 11 queued
  after :                          ->  2 queued
```

Cosmetic for correctness, ugly on camera: the header would read "11 queued"
while everything was actually fine. `enqueue` now supersedes any unsent row for
the same record — wrapped in a `try` so that a missing SQLite JSON1 extension
can degrade the de-duplication rather than break the scan flow itself.

### 3. Demo parts were not known work items

Only `SN-4472` existed as an install in its zone. Verifying `SN-4471`, `SN-4473`
or `SN-4474` *added* to the denominator, so coverage moved in a confusing
direction mid-demo.

Seed install ids also used `INS-0001` while the app writes `INS-<zone>-<serial>`
— so a phone verifying a seeded unit created a **second row for the same work
item**. The distinct-serial counting I added last round masked this; it would
have surfaced the moment anyone counted rows.

**Fixed:** the seed now derives install ids identically to the app, and the four
demo units start as `PENDING` in their zones. Denominator is now stable at 9 for
Zone A and coverage only ever moves on genuine progress.

### 4. A confirmed NCR left the unit counted as outstanding work

Raising an NCR wrote the nonconformance but never touched the install row, so a
part you had just proven wrong still sat in "pending" rather than "flagged".
Now `commitNcr` marks the unit `FLAGGED` in the same operation.

### 5. The panel's log cursor could silently drop a line

`/api/log` used a millisecond timestamp as the cursor, so any line written in the
same millisecond as a poll was filtered out and lost. Replaced with a monotonic
sequence number.

---

## CHECKED AND CLEARED

| Attack | Verdict |
| --- | --- |
| `sniff()` re-joins the whole log on every stdout chunk — O(n²)? | **Not a problem.** 2000 chunks against a 500-line log = 34ms. I was wrong to suspect it. |
| Path traversal via `/view/<key>` | Fixed allowlist, no user path ever reaches the filesystem. |
| Panel exposed on the network | Binds `127.0.0.1` only. |
| Two phones minting the same NCR | Derived ids: same finding = one NCR (correct), different findings can't collide. |
| Memory counter inflating on rescans | Counts distinct serials; covered by tests. |
| `installIdFor` used before definition | Function declarations hoist; imports all resolve (checked programmatically). |

---

## KNOWN AND ACCEPTED

Not bugs — deliberate limits worth being able to state out loud.

- **The sync server has no authentication.** Anything on the wifi can POST to it.
  Correct for a hackathon demo; a real deployment needs a token.
- **The `events` table grows without bound.** Tens of bytes per scan; irrelevant
  at demo scale.
- **Verifying a part not in the record adds a work item.** Arguably right — you
  found something the record didn't know about — but worth knowing it moves the
  denominator.
- **A photographed QR still verifies.** Unsolved, by design, and stated as such.

---

## End-to-end replay after all fixes

```
  start            verified=0 flagged=2 pending=7 total=9 ->  0%  NCRs=5
  verify SN-4472 x5  verified=1 flagged=2 pending=6 total=9 -> 11%  NCRs=5
  verify SN-4474     verified=2 flagged=2 pending=5 total=9 -> 22%  NCRs=5
  NCR SN-4471 x3     verified=2 flagged=3 pending=4 total=9 -> 22%  NCRs=6
  malformed payload  HTTP 400 -> retired, queue keeps moving
```

Denominator fixed. Repetition inert. Only distinct progress moves the number.

**42/42 engine tests pass. Server, panel and app all parse clean.**

---

## The one thing I'd still watch

Four of five findings this round were regressions from my own fixes. The engine
is protected by 42 tests; **the sync and data layers have none**, and that is
exactly where every regression landed. If you have a spare hour before Friday,
the highest-value thing left is a small test file around `drain()` and
`enqueue()` — not more features.

Second: **reset the phone and the server** before filming. Devices still holding
rows written under the old id scheme will look wrong in ways none of this
explains.
