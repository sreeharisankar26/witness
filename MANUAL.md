# Witness — User Manual

Everything the system does, what every screen means, and how to run the demo.
Written for someone who has never seen it before.

---

## Contents

1. [What Witness is](#1-what-witness-is)
2. [The three pieces](#2-the-three-pieces)
3. [The control panel](#3-the-control-panel)
4. [The phone app, screen by screen](#4-the-phone-app-screen-by-screen)
5. [The verdicts](#5-the-verdicts)
6. [Witness Memory](#6-witness-memory)
7. [The supervisor dashboard](#7-the-supervisor-dashboard)
8. [The tags](#8-the-tags)
9. [Running the demo](#9-running-the-demo)
10. [Resetting](#10-resetting)
11. [Troubleshooting](#11-troubleshooting)
12. [Glossary](#12-glossary)

---

## 1. What Witness is

A worker is about to install a part. Somewhere in the project record, a document
says which *revision* of that part is approved for that exact location. That
document is in a trailer, or an inbox, or a PDF nobody opens on a ladder.

Witness puts the answer in front of them in under a second:

1. **Identify** the part — scan its tag, photograph its nameplate, or type the serial
2. **Rule** on it — check against the approved record for *this location*
3. **Speak** — a spoken verdict, a colour, and a distinct vibration
4. **Record** — a human confirms; the result becomes site data
5. **Remember** — the next worker is warned before repeating the same mistake

Steps 1–4 work with the phone in airplane mode.

---

## 2. The three pieces

| Piece | Runs on | Needed for scanning? |
|---|---|---|
| **Phone app** | The Android phone | This *is* the product |
| **Sync server** | Your laptop | ❌ No — the app queues and syncs later |
| **Dashboard** | Browser on your laptop | ❌ No — it's a read-only view |

**The phone does the work.** The laptop is the site office: it receives what
phones queued and shows the supervisor view. If the laptop catches fire, every
phone on site still gives correct verdicts.

---

## 3. The control panel

Double-click **`Witness.bat`**. A browser page opens. This replaces every
terminal command.

| Section | What it does |
|---|---|
| **Start here** | A checklist that ticks itself: Node version → dependencies → tests → app running |
| **Phone app** | Starts Expo and shows a **scannable QR** for Expo Go, plus the URL to type |
| **Site systems** | Starts/stops the sync server, opens the dashboard, resets demo data |
| **Checks & setup** | Runs the 66 tests, installs dependencies, fixes package versions |
| **Connection** | Picks your wifi address and writes it to `app/.env` — plus a QR to test from the phone's browser |
| **Printable tags** | Opens the tag PDF, regenerates seed data and tags |
| **Build the APK** | Expo token → cloud or local build → download link |
| **Check everything** | Real checks against your machine, each row saying what to fix |

Every long-running job streams its output, with a **Copy log** button.
**Quit everything** stops all child processes cleanly.

> **Why your phone can't use `localhost`.** On the phone, `localhost` means *the
> phone*. It needs your laptop's address on the wifi — that's what the Connection
> dropdown sets. The QR beside it opens a health check in the phone's browser: if
> that shows `{"ok":true}`, syncing will work. If it doesn't load, it's almost
> always Windows Firewall blocking Node on private networks.

---

## 4. The phone app, screen by screen

### First launch — who is on this phone

You pick a name. Every flag you confirm is recorded against it. Attribution is
the entire point of a QA record, so this isn't decoration.

### The scan screen

| Element | Meaning |
|---|---|
| **WORKING IN** (top left) | Your zone. Tap to change. **Witness never guesses your location** — the approved revision depends on it. |
| **ONLINE / OFFLINE** (top right) | Radio state. `N queued` means writes are waiting to sync. |
| **approved record synced…** | How fresh the record is. Turns amber when stale. |
| **SCAN** | Opens the camera. Auto-closes the instant it reads a tag. |
| **No tag? Read the nameplate** | Rung 2 — a vision model reads the plate. Needs signal. |
| **Type it in** | Rung 3 — always works. |
| **Sync warning** | Appears only when something is queued or failing. Shows the exact address it's posting to. **Tap it to run a live connection test.** |
| **Long-press WITNESS (2.5s)** | Reset this device between takes. |

### The verdict screen

Three things happen the moment a tag resolves, in this order:

1. **The screen turns red or green** — instant, local, no network
2. **The phone vibrates** a distinct pattern — works at 95 dB, works in a pocket
3. **It speaks** — nice when you can hear it

The screen never waits for the model. If a better phrasing arrives from the
network it replaces the caption afterwards.

At the bottom, **provenance** — how the part was identified and how confident,
that the ruling was a deterministic join computed on the phone, whether the
wording came from a model or a template, and the record's age.

Then one action: **CONFIRM & RAISE NCR**, **MARK FIELD-VERIFIED**, or **SEND TO
SUPERVISOR**. Nothing is ever filed automatically.

### The nameplate screen

Shows what the vision model read — **verbatim**, including raw plate text and a
confidence percentage. Below the confidence floor the fields start editable,
because a model that is unsure should be asking, not asserting. Confirming keeps
the verdict `ADVISORY`, because the identification still came from perception.

---

## 5. The verdicts

| Verdict | Screen | Means | Action offered |
|---|---|---|---|
| `MATCH` | Green **CORRECT** | Approved revision for this zone | Mark field-verified |
| `MISMATCH_SUPERSEDED` | Red **STOP** | Wrong revision; chain traced | Confirm & raise NCR |
| `MISMATCH` | Red **STOP** | Wrong revision; chain untraceable | Confirm & raise NCR |
| `UNKNOWN_UNIT` | Amber **NOT ON RECORD** | Serial not in the record | Send to supervisor |
| `NO_APPROVED_RECORD` | Amber **NO APPROVAL HERE** | Nothing approved for this part here | Send to supervisor |
| `TAG_CONFLICT` | Amber **TAG DISPUTED** | Tag and record disagree | Send to supervisor |

### Authority — `BINDING` vs `ADVISORY`

Every verdict carries one. Three things downgrade a ruling to a prompt:

- **The record is stale** (older than 24h)
- **The device clock is wrong** — a record that synced "in the future" means we
  cannot trust freshness at all, so we fail *closed*
- **The identity came from perception** — a nameplate reading, however confident

### What the actions do

**CONFIRM & RAISE NCR** — an NCR (Non-Conformance Report) is a real construction
QA document: the formal "this doesn't match what was approved" record that must
be closed before handover. Witness writes it locally with both revisions, the
serial, the zone, a timestamp and a narrative; queues it; marks that unit
`FLAGGED`; and adds it to memory.

**MARK FIELD-VERIFIED** — field verification is paperwork that *already has to
happen*. Today it's a clipboard filled in later from memory. Here the scan **is**
the sign-off. This is the adoption argument: Witness replaces a step rather than
adding one.

---

## 6. Witness Memory

When a component has been the wrong revision in the same zone before, a banner
appears **above** the verdict — before you install, not after.

It states history, never an instruction ("GT-12 has been the wrong revision here
3 times before, across 2 different people, most recently 2026-08-01"), because it
sits directly above a verdict that already tells you what to do.

**It counts distinct physical units, not report rows.** Scanning one wrong part
five times during a rehearsal is one problem, not five. Two thresholds, both
explicit: 2 distinct units → `RECURRING`, 3 or more → `SYSTEMIC`.

> **This is not machine learning, and we don't call it that.** It's a
> deduplicated repeat-failure counter with fixed thresholds. It's useful
> *because* it's exact and explainable — a supervisor can audit every number.

---

## 7. The supervisor dashboard

Polls every 3 seconds, so it updates the moment a phone's queue drains.

- **Field-verified %** — distinct units verified ÷ distinct units in the zone
- **Open NCRs**
- **Zones at risk** — driven by *repeat* failures, not raw counts
- **Rework risk by zone** — coverage bar and risk pill per zone
- **Most confused components** — where the same mistake keeps happening, by distinct units
- **Live from the field** — updates as phones come back into signal
- **Nonconformances** — every one confirmed by a human at the point of install

> **Coverage cannot be inflated.** Both numerator and denominator count distinct
> units. Scanning one part 500 times moves nothing. Verifying a genuinely
> different part moves it. Two phones verifying the same unit is still one work
> item. There are seven tests pinning exactly this.

---

## 8. The tags

`witness_qr_tags.pdf` — generate it with **Rebuild tag sheet** in the panel.

- Payload format: `WTNS:1|<SKU>|<SERIAL>`, e.g. `WTNS:1|GT-12|SN-4471`
- **Error correction level H** — roughly 30% of the tag can be destroyed and it
  still reads. That's what backs the "works dirty" claim: a property of the tag,
  not a trick.
- The serial is printed in human-readable text underneath, so a worker can fall
  back to manual entry.

**Print at 100% scale.** "Fit to page" shrinks the code and it stops scanning.

Anything that isn't a Witness tag is refused outright rather than half-read.

> **Real equipment already carries this.** Manufacturers put model and serial on
> nameplates and barcodes. Our printed tags stand in for tags that already exist
> in the supply chain — Witness reads what's there; it doesn't ask sites to
> relabel everything. That's also why rung 2 (nameplate) exists, for items that
> were never serialised.

---

## 9. Running the demo

**Before you start:** set the connection address, start the sync server, open the
dashboard, reset both the phone and the server.

Set the phone to **Zone A**, then:

| # | Scan | Zone | Expect |
|---|---|---|---|
| 1 | `GT-12 / SN-4471` | A | Red **STOP**, double buzz, spoken verdict, memory banner, NCR button |
| 2 | `GT-12 / SN-4472` | A | Green **CORRECT**, single buzz, "mark field-verified" |
| 3 | `VLV-22 / SN-9999` | any | Amber **NOT ON RECORD** — refuses to guess |
| 4 | `SPR-14 / SN-4475` | D | Amber **NO APPROVAL HERE** |

Confirm the NCR on #1 and watch the dashboard flip Zone A to **HIGH** risk within
about 3 seconds.

### The offline sequence — the shot that matters

1. Airplane mode **on**
2. Scan `SN-4471` — full verdict, spoken, memory and all. Nothing degrades.
3. Confirm the NCR — header shows `1 queued`
4. Airplane mode **off**
5. Within ~5 seconds the counter clears and it lands on the dashboard

> **Use the standalone APK for this shot.** Expo Go streams its bundle from your
> laptop over wifi; a reconnect mid-take throws a red banner across your best
> fifteen seconds. See [BUILD_APK.md](BUILD_APK.md).

**Film verdicts 3 and 4.** Every team shows a happy path; almost none show what
their system does when it doesn't know.

---

## 10. Resetting

| What | How |
|---|---|
| The phone | Long-press **WITNESS** for 2.5 seconds → Reset |
| The server | **Reset demo data** in the panel |
| Everything | Both, in that order |

Reset restores the seeded record and re-stamps it as freshly synced — which
matters, because a record older than 24h correctly downgrades every verdict to
`ADVISORY`.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm test` syntax error | Node older than 22 | Install the LTS from nodejs.org, **reopen the terminal** |
| `'npm' is not recognized` | Node not installed, or PATH not refreshed | Install Node, then close and reopen the window |
| Expo Go won't connect | Different networks, or a VPN | Same wifi, VPN off. Failing that, **tunnel mode** in the panel |
| Queue never clears | Firewall, or wrong address | Scan the health-check QR in the panel from the phone. Allow Node on Private networks |
| Queue never clears **after changing the address** | The address is baked in at app start | Restart the app (or rebuild the APK) |
| Verdicts appear, nothing spoken | Phone on silent, or no TTS voice | Volume up; Android → Accessibility → Text-to-speech. Colour and haptics still work — that's deliberate |
| Camera won't read the tag | Printed at "fit to page", or too close | Reprint at 100%. Hold 15–25cm. Tap **LIGHT** |
| "Not a Witness tag" | Scanning some other QR | Only tags from the sheet parse. That refusal is intended |
| Wrong verdict | Phone is in the wrong zone | Tap the zone name. Zone is chosen, never inferred |
| Nameplate reading unavailable | No model key set | Add one in **Connection**, then restart the app |
| Everything says ADVISORY | Record older than 24h, or the phone's clock is wrong | Reset the phone; check the date |

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **SKU** | The part *type* — `GT-12`. Like "iPhone 15 Pro". |
| **Serial** | One physical object — `SN-4471`. Like a specific phone's IMEI. |
| **Revision** | Which approved design version a unit was built to — Rev B, Rev C. |
| **Submittal** | The approved record saying which revision is approved where. |
| **NCR** | Non-Conformance Report. The formal "this doesn't match" document. |
| **Field verification** | Confirming an installed item matches what was approved. Legally required; today done on clipboards. |
| **Zone** | A location on site. The approved revision depends on it. |
| **Superseded** | An older revision replaced by a newer approved one. |
| **BINDING / ADVISORY** | Whether a verdict is a ruling or a prompt. |
| **Outbox** | The local queue of writes waiting to reach the server. |
