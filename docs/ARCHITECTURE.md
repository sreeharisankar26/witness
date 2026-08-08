# Architecture

## The split

```
┌──────────────────────── PHONE (works with the radio off) ────────────────────┐
│                                                                              │
│  camera ──► QR "WTNS:1|GT-12|SN-4471"          exact, offline                │
│         └─► nameplate photo ──► VISION MODEL   probabilistic, needs signal   │
│         └─► typed by hand                      exact, always available       │
│                          │                                                   │
│                          ▼  ScannedTag { sku, serial, source, confidence }   │
│         ┌────────────────────────────────────────────┐                       │
│         │  engine/resolve.ts   ── THE SAFETY PATH    │                       │
│         │  pure function. no network, no model,      │                       │
│         │  no ambient clock, no I/O.                 │                       │
│         │  → { verdict, authority, memory, speech }  │                       │
│         └────────────────────────────────────────────┘                       │
│                    │                    │                                    │
│                    ▼                    ▼                                    │
│              SQLite (record)      llm/phrase.ts  ── optional, cosmetic       │
│              · units              turns a DECIDED verdict into a sentence.   │
│              · submittals         offline ⇒ deterministic template.          │
│              · revisions                                                     │
│              · ncrs      ──► memory: distinct prior units in this zone       │
│              · installs                                                      │
│              · events                     ▼                                  │
│              · outbox ──┐          expo-speech + haptics + colour            │
│                         │                                                    │
└─────────────────────────┼────────────────────────────────────────────────────┘
                          │ drains when it can — never blocks a scan
                          ▼
                  server/index.mjs  ──►  dashboard/index.html
                  (Node core only)       (polls /summary every 3s)
```

**The rule:** a model may say *what the part is*. Only the engine says *whether
it is allowed to be there*.

---

## Why the engine is a pure function

`resolve(snapshot, tag, zoneId, { now })` takes everything it needs as arguments
and touches nothing else. No `fetch`, no `Date.now()`, no database handle.

That buys three things:

1. **It cannot hallucinate.** The verdict is a join over a local table. There is
   no revision it can invent, because no model is in the path.
2. **It is exhaustively testable.** 42 tests, no mocks, no fixtures beyond the
   real seed file. Injecting `now` means staleness and clock-skew behaviour are
   deterministic rather than dependent on when CI runs.
3. **It works offline by construction**, not by fallback logic.

The cost is that it only knows what it is handed — so `App.tsx` must reload the
snapshot after every write. Forgetting that once froze the memory counter at
whatever it was when the app launched.

---

## Data model

```sql
zones      (id, name, lat, lng)
units      (serial PK, sku, rev, manufactured_date)      -- what physically exists
submittals (id PK, sku, zone_id, approved_rev, ...)      -- what is approved WHERE
revisions  (sku, rev, superseded_by, ...)                -- the revision chain
installs   (id PK, serial, sku, zone_id, status)         -- work items
ncrs       (id PK, serial, sku, zone_id, installed_rev, approved_rev, ...)
events     (id, type, payload_json, created_at)          -- audit trail
outbox     (id, endpoint, payload_json, synced_at, attempts)
```

A mismatch is only detectable because `units` and `submittals` are separate:
the unit says *which revision this object is*, the submittal says *which
revision is approved here*, and those disagreeing is the entire product.

### Ids derive from the thing, not the moment

```
INS-<zone>-<serial>              e.g. INS-ZONE-A-SN-4471
NCR-<zone>-<serial>-R<rev>       e.g. NCR-ZONE-A-SN-4471-RB
```

Non-negotiable, and learned the hard way:

- **Re-scanning must not create a new record.** With timestamp ids, one good part
  scanned six times took a zone from 13% to 46% "field-verified" — both numerator
  and denominator grew. A judge could have reached 100% with one tag.
- **Two phones reporting the same finding must produce one NCR**, not two.
- **The seed generator uses the identical derivation**, so a phone verifying a
  pre-existing unit *replaces* its row instead of adding a duplicate.

Belt and braces: coverage is also computed with `COUNT(DISTINCT serial)` on both
phone and server, so even mismatched rows from an older build cannot inflate it.

---

## Authority: `BINDING` vs `ADVISORY`

Every verdict carries one. Three conditions downgrade a ruling to a prompt:

| Condition | Why |
|---|---|
| Record older than 24h | The approved revision may have changed since |
| Device clock untrustworthy | A record that synced "in the future" means we cannot judge freshness **at all** — so we fail *closed*, not open |
| Identity came from a vision model | Perception is fallible, however confident |

The finding itself never changes — only whether it is binding. A stale record
still reports the same mismatch; it just says so as advice, out loud.

---

## Sync protocol

Two endpoints, both idempotent.

```
POST /install    { id, serial, sku, zone_id, installed_at, verified_by, status }
POST /ncr        { id, serial, sku, zone_id, installed_rev, approved_rev, ... }
GET  /summary    computed read model for the dashboard
POST /reset      restore the seeded state (between takes)
```

Every request carries `Idempotency-Key: <deviceId>-<outboxRowId>`. **Device
scoping is required** — outbox ids are a local autoincrement, so every phone's
first write was `outbox-1`, and the server discarded the second phone's genuine
write as a duplicate while reporting success.

### The drain

```
rows = SELECT * FROM outbox WHERE synced_at IS NULL ORDER BY id LIMIT 100
for each row:
    POST it
    2xx  → mark synced, continue
    4xx  → RETIRE: mark synced, log SYNC_REJECTED, continue   ← queue keeps moving
    5xx  → STOP: the server may recover, try next tick
    throw → STOP: no answer at all; every following row would fail identically
```

The 4xx/5xx distinction is the whole point. An **answer we dislike** is not the
same as **no answer**. Conflating them means one permanently-refused row blocks
every row behind it, forever.

The drain also never consults the radio before trying. A site wifi with no route
to the internet — captive portal, site router, phone hotspot — is perfectly
usable for LAN sync, and asking a heuristic for permission stopped it from even
attempting.

---

## Tag format

```
WTNS:1|<SKU>|<SERIAL>
```

Versioned, so a future format cannot be silently misread as this one. Anything
that doesn't match is refused outright rather than half-interpreted. QR error
correction **level H** tolerates roughly 30% destruction — the basis of the
"works dirty" claim.

---

## Swapping in real data

[`app/src/data/adapter.ts`](../app/src/data/adapter.ts) is the only file that
knows where the approved record comes from. It exposes one interface:

```ts
interface RecordAdapter { fetch(): Promise<RecordSnapshot> }
```

`SeedAdapter` returns the bundled synthetic record. `KayaAdapter` is written and
field-mapped; only credentials are missing. Everything downstream — engine,
memory, NCR drafting, dashboard — consumes `RecordSnapshot` and does not care
who produced it.

---

## Testing

| Suite | Count | Runs against |
|---|---|---|
| `app/src/engine/resolve.test.ts` | 42 | The real seed file |
| `app/src/data/sync.test.ts` | 24 | The **real SQL strings** from `sql.ts`, against Node's built-in SQLite |

Zero dependencies. `npm test` works on a machine with nothing installed but
Node 22 — deliberate, because safety-critical code must never be blocked by a
broken toolchain.

The sync suite exists because two adversarial reviews found that *every*
regression had landed in the untested data layer while the engine stayed clean.
It imports the same query constants the app uses, so a query that drifts fails
the suite rather than the demo.
