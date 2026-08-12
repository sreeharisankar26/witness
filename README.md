<div align="center">

# WITNESS

**Catches the wrong part before it goes into a building.**

Kaya AI · IIT India Hackathon 2026 · Track 1 — Physical AI
Team Espada — IIT Hyderabad

Sree Harisankar · Priyanshu Kripashankar Singh · Mithun N · Nishanth A

</div>

---

## Verify it in sixty seconds

```bash
git clone https://github.com/sreeharisankar26/kaya_espada.git
cd kaya_espada/app && npm test   # 189 tests, ~2s, nothing to install
node ../tools/ingest.mjs         # read submittal PDFs into an approved record
```

No install step, no API key, no network. The safety-critical code has zero
dependencies on purpose — it must never be blocked by a broken toolchain.

| Look here | For |
|---|---|
| [`app/src/engine/resolve.ts`](app/src/engine/resolve.ts) | The ruling. Pure function, no model, no network, no clock. |
| [`server/ingest.mjs`](server/ingest.mjs) | What is allowed to become "approved". |
| [`server/ensemble.mjs`](server/ensemble.mjs) | Disagreement between reads, used as the confidence signal. |
| [`server/forecast.mjs`](server/forecast.mjs) | How many wrong parts are still in the un-scanned remainder. |
| [`server/reorder.mjs`](server/reorder.mjs) | Three wrong parts = one bad delivery. |
| [`docs/RED_TEAM_1.md`](docs/RED_TEAM_1.md) · [`docs/RED_TEAM_2.md`](docs/RED_TEAM_2.md) | Two adversarial reviews, and every bug they found. |
| [`DEMO.md`](DEMO.md) | Reproduce the demo, including the offline sequence. |

---

## The problem

On a construction site the right answer already exists. It just never reaches
the person holding the part.

A revision gets approved weeks before installation. On the beam, hands full, no
one can see it. The wrong revision goes in. That gap — between *approved* and
*installed* — is where rework is born, and industry studies put rework at
roughly 5–15% of project cost.

**Witness closes that gap at the only moment that matters: the moment of install.**

A worker points their phone at the part. In under a second they get a spoken,
unambiguous answer — *"Stop. That's Rev B. Rev C was approved for this zone."* —
and the site remembers, so the next worker is warned before they repeat it.

**It runs on the Android phone the worker already carries.** No new hardware, no
procurement cycle, no IT rollout.

---

## The one idea worth stealing

> **AI reads the world. Deterministic logic rules on it.**

These are two separate systems, and keeping them separate is the whole design.

| Layer | Job | Can it be wrong? |
|---|---|---|
| [`src/vision/nameplate.ts`](app/src/vision/nameplate.ts) | A vision model reads a photographed equipment nameplate — oily, dented, at an angle, half in shadow | **Yes.** So anything it identifies returns as `ADVISORY`, is shown to the worker verbatim with its confidence, and must be confirmed before it counts. |
| [`src/engine/resolve.ts`](app/src/engine/resolve.ts) | Decides whether that part is approved for this location | **No.** A pure function over a local database. It cannot invent a revision that was never approved, because no model is involved in the ruling. |
| [`src/llm/phrase.ts`](app/src/llm/phrase.ts) | Turns the decided verdict into a spoken sentence | Doesn't matter. If it fails, the worker still hears the correct verdict from an on-device template. |

Perception is where a model earns its place. Adjudication is not. On a building
site, a confidently wrong compliance ruling is a safety incident.

---

## What's in the box

```
witness/
├─ Witness.bat            ← double-click this. Control panel, no terminal needed.
├─ app/                   Android app (Expo / React Native)
│  ├─ src/engine/         THE SAFETY PATH — pure, deterministic, offline
│  ├─ src/vision/         perception — vision model reads nameplates
│  ├─ src/data/           SQLite: approved record, outbox, device identity
│  ├─ src/sync/           the drain — nothing blocks on the network
│  └─ src/screens/        Scan · Verdict · Nameplate · Report
├─ server/                sync server. Node core only, zero dependencies.
│  ├─ ingest.mjs          THE GATE — what may become an approved revision
│  ├─ ensemble.mjs        disagreement between reads as the confidence signal
│  ├─ forecast.mjs        Beta-Binomial projection of what is still wrong
│  ├─ rfi.mjs             the question each held row implies
│  ├─ model.mjs           one client, OpenAI-shaped or Anthropic-native
│  ├─ pdftext.mjs         PDF text layer reader, no dependencies
│  └─ reorder.mjs         returns and replacements, derived not stored
├─ dashboard/             supervisor view. One HTML file, no build step.
├─ tools/                 ingestion CLI, seed generator, QR printer, control panel
└─ docs/                  architecture, two adversarial reviews, sample submittals
```

---

## Quick start

**Requires [Node 22+](https://nodejs.org).** Nothing else.

```bash
git clone https://github.com/sreeharisankar26/kaya_espada.git
cd kaya_espada/app && npm test        # 189 tests, ~2s, no install needed
```

Then double-click **`Witness.bat`** (Windows). A control panel opens in your
browser with a five-step checklist: install, **set your connection**, run the
tests, start the app. Scan the QR it shows with **Expo Go** and you are running.

> **Don't skip "set your connection".** Your phone cannot reach `localhost` —
> on the phone that means the phone. Your laptop's wifi address differs for
> everyone, so it is deliberately not committed. The panel writes it for you.

**[MANUAL.md](MANUAL.md) → "Get it running"** has the full walkthrough, including
Expo Go vs a standalone APK and when to use each.

> The engine test suite has **zero dependencies** — it runs on a laptop with
> nothing installed but Node. Deliberate: safety-critical code must never be
> blocked by a broken toolchain at 2am.

---

## Documentation

| | |
|---|---|
| **[MANUAL.md](MANUAL.md)** | **Start here.** What every screen does, what every verdict means, how to run the demo. |
| [DEMO.md](DEMO.md) | Reproducing the demo — which tag proves what, and the offline sequence |
| [docs/INGEST_REPORT.md](docs/INGEST_REPORT.md) | What ingestion accepted, held and refused, and why |
| [SETUP.md](SETUP.md) | Installing and running, with a troubleshooting table |
| [BUILD_APK.md](BUILD_APK.md) | Building an installable APK, no terminal |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data model, the deterministic/perception split, sync protocol |
| [docs/PLAN.md](docs/PLAN.md) | The build plan and field failure analysis |
| [docs/RED_TEAM_1.md](docs/RED_TEAM_1.md) · [docs/RED_TEAM_2.md](docs/RED_TEAM_2.md) | Two adversarial reviews, and every bug they found |

---

## The fallback ladder

A worker is never dead-ended by an unreadable part.

| Rung | Method | Works offline? | Authority |
|---|---|---|---|
| 1 | **QR tag** — error correction level H, tolerates ~30% damage | ✅ | `BINDING` |
| 2 | **Nameplate** — vision model reads the plate | ❌ needs signal | `ADVISORY` — human confirms the characters |
| 3 | **Type it in** — serial printed under every code | ✅ | `BINDING` — a human read it |

Rung 2 exists because most site equipment has no machine-readable code at all.

---

## Does it scale, and does it work?

Both are claims until they have numbers. Two commands produce them.

### Scale — `node tools/bench.mjs`

`resolve()` is the only thing on the worker's path: the work between holding the
phone at a part and the verdict appearing, offline, on a cheap handset.

| Units in the project | Record held in RAM | `resolve()` p50 | p99 |
|---|---|---|---|
| 1,000 | 0.2 MB | `<0.01 ms` | `<0.01 ms` |
| 10,000 | 1.7 MB | `<0.01 ms` | `0.012 ms` |
| 100,000 | 16.9 MB | `<0.01 ms` | `0.023 ms` |

**Constant time regardless of project size.** It was not: the engine used
`Array.find` per lookup and rebuilt a revision map on every call, so p50 rose
from 0.046 ms at 10k units to 0.444 ms at 100k. Building the maps once per
snapshot — cached in a `WeakMap` keyed on the snapshot object, so a new record
gets a new index and a stale one is impossible — made it flat and about 50×
faster at 100k. All 42 engine tests passed unchanged, which is what made the
change safe to do days before a demo.

The honest ceiling is the **MB column, not the milliseconds**. The whole approved
record is held in memory so a scan needs no I/O and no radio — that is what buys
the offline guarantee, and it is what limits project size per device. Past it,
the record scopes to the zones a worker actually covers: a change to the adapter
and nothing else. These are laptop numbers; a mid-range Android on Hermes is
roughly 3–5× slower.

### Accuracy — `node tools/backtest.mjs`

Every nonconformance in the record is a wrong part that really went in. The
backtest replays each one through the engine and asks what it would have said
*before* the part was fitted — and counts false alarms too, because a tool that
flags everything catches everything and is worthless.

```
caught 5 of 5 = 100%   ·   0 false alarms out of 4 correct installs
```

It also states what it cannot measure: five cases is an indication, not a rate;
the record is synthetic; and whole classes of defect — workmanship, a part
fitted backwards, an untagged part nobody scanned — are outside what this
system claims to do by design.

**It earned its place immediately.** The first run returned a catch rate of
**zero**: three nonconformances referenced serials that were not in the units
table at all, and two named a different part than the unit record did. The app
never noticed, because the app only ever looks up a serial it has just scanned.
`make_seed.py` now reconciles them and refuses to write a record that
contradicts itself.

---

## Where "approved" comes from

The engine is only ever as trustworthy as the record it rules against. So the
record gets a gate of its own — and it is the same kind of gate.

```
submittal PDFs
  ->  text          pdftotext if present, else server/pdftext.mjs (no dependencies)
  ->  candidates    A MODEL READS IT. Messy tables, prose notes. Fallible.
  ->  validation    DETERMINISTIC. server/ingest.mjs. 29 tests.
  ->  record        only what survived, plus a report of what did not.
```

Run it: `node tools/ingest.mjs` → [`docs/INGEST_REPORT.md`](docs/INGEST_REPORT.md).

Three outcomes, never two. **Accepted** — every field verified against the
project's own zones and parts. **Held** — readable but not verifiable, sent to a
human *with the reason*. **Refused** — positively disqualified. A pipeline with
only accept and reject has to guess about everything in between, and guessing is
the thing we are here to avoid.

On the sample register of 13 rows it accepts 8, holds 2 and refuses 3:

| Row | Outcome | Why |
|---|---|---|
| SUB-0005 | **Refused** | status is `PENDING` — still awaiting consultant approval |
| SUB-0015 | **Refused** | status is `REJECTED` |
| SUB-0013 | **Refused** | superseded by SUB-0001, per a note in prose in a *different document* |
| SUB-0006 | **Held** | no location — an approval that does not say where cannot be applied |
| SUB-0008 | **Held** | part reads `GT-l2`, lowercase L for a digit one. Suggests `GT-12`, **does not apply it** |

The `PENDING` row is the one that matters. It sits in the same table as the
approved rows. A pipeline that OCRs the table into JSON turns a row nobody
approved into an approved revision — and from that moment the app is
confidently, deterministically wrong, out loud, to a worker. Everything
downstream is honest; the lie was let in at the door.

The `GT-l2` row is the second one. We know the answer is almost certainly
`GT-12`. We say so, and we still refuse the row — a part number silently
corrected is a wrong part confidently approved.

---

## Where the model earns its place, and where it does not

Four model-touched paths. Not one of them can change a verdict.

| Path | What the model does | What happens when it is wrong or absent |
|---|---|---|
| Nameplate | reads a photographed data plate | returns `ADVISORY`, shown verbatim, human confirms. No key → falls to "type it in" |
| Document ingestion | reads a submittal register | the gate refuses anything unverifiable. No key → a pattern extractor reads it |
| Verdict phrasing | rewords a decided verdict | the on-device template is already correct |
| RFI drafting | *nothing* — the question is derived deterministically | a model may polish the prose, never choose the question |

### Disagreement, not confidence

Asking a model how sure it is produces a number that is not worth much —
self-reported confidence is poorly calibrated, and the failure is silent.

So [`server/ensemble.mjs`](server/ensemble.mjs) does not ask. Each document is
read **twice**, independently, and any field the two reads contradict each other
on becomes `HELD`. Sampling variance is a property we can measure rather than a
claim we have to trust, and it is measured on exactly the field that matters.

The twist worth stealing: **we do not vote.** Self-consistency implementations
normally take the majority and move on. A majority of two out of three is not
evidence about an approved revision — it is a coin that landed twice. So the row
goes to a person instead.

### A projection that refuses to project

[`server/forecast.mjs`](server/forecast.mjs) puts a Beta-Binomial posterior over
each zone's defect rate — uniform `Beta(1,1)` prior, updated by the scans already
done — and projects how many wrong parts remain in the units nobody has checked,
with an 80% credible interval that narrows on its own as scanning proceeds.

Below five observations in a zone it returns `projectable: false` and says why:
two scans supports any conclusion you like, and a confident number from two scans
is worse than no number. Every projection also carries the assumption it rests
on — scans are not random, and a zone scanned *because* somebody suspected a bad
pallet will read hot.

It is arithmetic on counts, not machine learning, and it does not call itself
otherwise. That is exactly why it can be checked line by line — and the tests
check the posterior mean against `(1+flagged)/(2+scanned)`, which anyone can work
out by hand.

### Checked against a real one

`docs/submittals/L-895_Appendix_A_Rev_0.pdf` is a genuine US Department of
Energy document — Hanford Mission Integration Solutions, Project L-895, RFP
354825. We did not choose its layout, its column headings or its vocabulary.

It defines its own review codes on its instructions page:

> **9. STATUS CODE**
> `A` = Conforms to the subcontract requirements
> `B` = Minor comments, approved with exceptions as corrected
> `C` = Revise and resubmit

Which is exactly the table in `ingest.mjs`, and is now asserted against those
quoted definitions in the test suite.

It also set two traps we would otherwise have walked into.

**Column 5 carries `AP` and `APW`** — *submittal type*, meaning "approval
required" and "approval required prior to work". Both start with `A`, both sit
in a letter column, and neither is a review outcome. A parser matching leading
letters reads `AP` as approved.

**Its references are `XXXXXX-XXX-SUB-001`** — contract number first. Our pattern
extractor required a line to *begin* with `SUB-`, so it found **zero rows** in
the real document while the model found five. A fallback that silently returns
nothing is the worst kind. Both are now regression-tested.

And the published register is **pre-award**: every reference is a placeholder,
because the document says the number *"shall be updated to the contract-release
number upon award"*. So the gate refuses all five rows for having no part number
— which is the correct answer, and the useful one: **on a real document with
nothing in it, the pipeline invented nothing.**

`submittal-register-C-hanford-format.pdf` is that same register at the stage a
live project reaches — contract number issued, status codes entered. The format
and vocabulary are Hanford's; only the equipment rows are ours, because L-895
tracks document deliverables rather than materials.

### What a real register actually says

Almost no submittal register contains the word "APPROVED". They carry review
action codes — `A`, `AN`, `NET`, `B`, `C`, `RR`, `D`, `FIO` — and two of them are
traps. `AN` (approved as noted) is an approval, and is carried through flagged as
conditional. `FIO` (for information only) sits in the same column, looks benign,
and **is not an approval at all**.

Single letters are also ambiguous: `D` is both a revision letter and the code for
disapproved. Reading one as the other refuses a good approval, so the
unambiguous forms are claimed first and only the leftovers assigned.

---

## One level up: the mistake nobody on site can see

A worker sees one wrong part. The record sees the pattern.

> **Three units of the same part, at the same wrong revision, in the same place
> is not three mistakes. It is one bad delivery.**

Standing at the beam, each wrong part looks isolated, so it gets torn out and
replaced one at a time — and the next pallet has the same problem. That
inference is only available from the record, so the record is what makes it.

[`server/reorder.mjs`](server/reorder.mjs) groups confirmed nonconformances by
part and revision. At two or more distinct units it proposes a **return batch**
with its reasoning attached, and a supervisor confirms before anything goes back
to a supplier — the system proposes, a human disposes. Same threshold as the
memory counter, because "this has happened enough times to mean something"
should not have two different answers.

Damaged units join the same view from the other direction: they are firm
immediately, because a cracked part is a fact and does not need a committee. In
a procurement office both causes are the same problem — the right part is not
there — so they collapse into one order line per part.

**Worker reports** are the one place the worker is the authority rather than the
record. Whether a housing is cracked, or the wrong thing turned up on the pallet,
is not derivable from any submittal. It is stored as attributed testimony, it
never changes a verdict, and it is shown to a supervisor in the worker's own
words. 19 tests cover the derivation, because a claim that costs money if it is
wrong belongs on the tested side of the line.

---

## What it does when it doesn't know

Most demos only show the happy path. These are all first-class verdicts:

| Verdict | Meaning |
|---|---|
| `MATCH` | Correct revision. The scan **is** the field-verification sign-off. |
| `MISMATCH_SUPERSEDED` | Wrong revision, and we can trace the chain. NCR drafted. |
| `MISMATCH` | Wrong revision, chain untraceable. Says less, because it knows less. |
| `UNKNOWN_UNIT` | Serial not in the record. Refuses to guess. |
| `NO_APPROVED_RECORD` | Nothing approved for this part here. Advisory, not a ruling. |
| `TAG_CONFLICT` | The tag and the record disagree about what the part is. Human required. |

Every verdict also carries an **authority**: `BINDING` or `ADVISORY`. A stale
record, an untrustworthy device clock, or a model-derived identity all downgrade
a ruling to a prompt — and Witness says so out loud.

---

## Engineering notes

Things that are easy to get wrong and were:

- **Offline-first, genuinely.** The verdict, the memory warning and the NCR draft
  all work in airplane mode. Writes queue locally and drain when signal returns.
- **Fails closed on a bad clock.** A record that claims to have synced in the
  future means the phone's clock is wrong, so freshness is treated as unknown
  rather than perfect. Cheap site phones lose their clock constantly.
- **Ids derive from the thing, not the moment.** `INS-<zone>-<serial>`, not a
  timestamp. Otherwise re-scanning one good part drove "% field-verified" from
  13% to 46%, and a judge could reach 100% by waving a single tag at the camera.
- **An answer you dislike ≠ no answer.** A `4xx` retires the queue row and the
  queue keeps moving; a network failure stops the run. Conflating them once
  froze syncing permanently.
- **"Memory" is a repeat-failure counter, not machine learning.** We call it that
  in the code. It counts *distinct units*, so rehearsal scans can't inflate it.
  It is useful precisely because it is exact and explainable.

**189 tests.** 42 over the engine, 28 over the sync and data layers, 19 over the
reorder derivation, 73 over document ingestion, 27 over the projection and the
ensemble reconciliation — the sync group
added after a review found that every regression had landed in the untested
layer. The data tests run the *real* SQL against Node's built-in SQLite, so a
query that drifts fails the suite rather than the demo.

---

## Status

Hackathon prototype. Honest about its limits:

- The approved record is **synthetic**. The adapter that produces it is a single
  interface ([`app/src/data/adapter.ts`](app/src/data/adapter.ts)) — swap the
  stub for Kaya's endpoint and nothing downstream changes.
- **Android only.** iOS provisioning was a demo-day risk we chose not to take.
- The sync server has **no authentication**. Fine for a demo, not for a site.
- A worker photographing a QR to fake verification is **not solved**. Timestamps
  and coarse geofencing make it harder. We designed for it; we haven't beaten it.

---

## License

MIT — see [LICENSE](LICENSE).
#   w i t n e s s 
 
 