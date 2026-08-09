# Witness — User Manual

Everything the system does, how to run it, and what every screen means.
Written for someone who has never seen it before.

---

## Contents

1. [What Witness is](#1-what-witness-is)
2. [Get it running — start here](#2-get-it-running--start-here)
3. [Two ways onto a phone](#3-two-ways-onto-a-phone)
4. [The control panel](#4-the-control-panel)
5. [The phone app, screen by screen](#5-the-phone-app-screen-by-screen)
6. [The verdicts](#6-the-verdicts)
7. [Witness Memory](#7-witness-memory)
8. [The supervisor dashboard](#8-the-supervisor-dashboard)
9. [The tags](#9-the-tags)
10. [Running the demo](#10-running-the-demo)
11. [Making changes](#11-making-changes)
12. [Troubleshooting](#12-troubleshooting)
13. [Glossary](#13-glossary)

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

### The three pieces

| Piece | Runs on | Needed for scanning? |
|---|---|---|
| **Phone app** | An Android phone | This *is* the product |
| **Sync server** | Your laptop | ❌ No — the app queues and syncs later |
| **Dashboard** | Browser on your laptop | ❌ No — a read-only view |

**The phone does the work.** The laptop is the site office. If the laptop caught
fire, every phone on site would still give correct verdicts.

---

## 2. Get it running — start here

**You need [Node 22 or newer](https://nodejs.org).** Nothing else. Check with
`node -v`; if it's older, install the LTS and **reopen your terminal** — the
installer edits your PATH and an open window keeps the old one.

```bash
git clone https://github.com/sreeharisankar26/witness.git
cd witness
```

### Prove the logic works before touching a phone — 30 seconds

```bash
cd app
npm test
```

Expect `# pass 66`, `# fail 0`, about 400ms. **No install needed** — the test
suite has zero dependencies, deliberately, so a broken toolchain can never hide
whether the safety logic is sound.

### Then open the control panel

Double-click **`Witness.bat`** (Windows). A page opens in your browser with a
checklist that ticks itself off. Work down it:

1. **Node 22+** — should already be green
2. **Install dependencies** — press it once, 2–4 minutes
3. **Set your connection** — **do not skip this**, see below
4. **Run the engine tests** — should say 66 passed
5. **Start the app** — a scannable QR appears

> **Why step 3 matters and why it isn't automatic.** Your phone cannot reach
> `localhost` — on the phone, that word means *the phone*. It needs your
> laptop's address on the wifi you're both using. That address is different for
> every person and every network, so it is deliberately **not** committed to the
> repo. Pick your wifi adapter in **Connection**, press **Save settings**. That
> writes `app/.env` for you.

**No terminal?** Everything above except `git clone` is a button in the panel.

---

## 3. Two ways onto a phone

| | Expo Go | Standalone APK |
|---|---|---|
| Setup | ~2 minutes | 10–20 minutes |
| Needs | The Expo Go app from Play Store | A free Expo account |
| Code changes | Reload and they appear | Rebuild |
| Works without your laptop | ❌ streams from Metro | ✅ fully standalone |
| Good for | Development, most testing | Filming, the submission |

### Expo Go — the fast way

1. Install **Expo Go** from the Play Store
2. Phone and laptop on the **same wifi**
3. Panel → **Start app**
4. Scan the QR that appears, or type the `exp://…` URL into Expo Go

The app builds on your phone in ~30 seconds. Grant the camera permission.

Your phone is now running the code in this folder. Edit a file, save it, and the
app reloads. To force it: shake the phone → **Reload**.

> **If Expo Go won't connect:** you're on different networks, or a VPN is on.
> Same wifi, VPN off. Failing that, press **Start in tunnel mode** — slower, but
> it routes around the network entirely.

> **One catch:** Expo Go streams its bundle from your laptop over wifi. For the
> airplane-mode demo that's a real risk — a reconnect mid-take throws a red
> banner across the shot. Use the APK for that.

### The APK — the standalone way

Panel → **Build the phone app (APK)**. Full walkthrough in
**[BUILD_APK.md](BUILD_APK.md)**; the short version:

1. **Set your connection first** — the address is baked in at build time
2. Paste an **Expo access token** (from expo.dev → Settings → Access tokens)
3. **Set up git** — EAS uploads your source through git
4. **Build in the cloud** — 10–20 minutes, a download link appears in the log
5. Open that link **on the phone's browser**, download, install

Android warns about installing outside the Play Store. Expected for any
unpublished app.

---

## 4. The control panel

Double-click **`Witness.bat`**. This replaces every terminal command.

| Section | What it does |
|---|---|
| **Start here** | The five-step checklist, ticking itself off |
| **Phone app** | Starts Expo, shows a scannable QR and the URL to type |
| **Site systems** | Sync server, dashboard, reset demo data |
| **Checks & setup** | The 66 tests, install, fix package versions, fix Babel preset |
| **Connection** | Your wifi address, model API key, and a QR to test from the phone |
| **Printable tags** | Opens the tag PDF, regenerates seed data and tags |
| **Build the APK** | Token → git → cloud or local build |
| **Check everything** | Real checks against your machine, each row saying what to fix |

Every long job streams its output with a **Copy log** button. **Quit everything**
stops all child processes cleanly.

Things it handles for you, because each one cost us an evening:

- Picks a free port if 8081 is taken, rather than failing on a prompt
- Reuses a running sync server instead of crashing on "address in use"
- Warns if the app's baked-in address no longer matches your PC
- Warns if the project folder is too deep for Windows' 260-character limit

---

## 5. The phone app, screen by screen

### First launch — who is on this phone

You pick a name. Every flag you confirm is recorded against it. Attribution is
the entire point of a QA record, so this isn't decoration.

### The scan screen

| Element | Meaning |
|---|---|
| **WORKING IN** (top left) | Your zone. Tap to change. **Witness never guesses your location** — the approved revision depends on it. |
| **OFFLINE / NO SERVER / ONLINE** | Grey: no radio. Red: radio on, server unreachable. Green: both fine. `N queued` shows writes waiting. |
| **approved record synced…** | How fresh the record is. Amber when stale. |
| **SCAN** | Opens the camera. Closes the instant it reads a tag. |
| **No tag? Read the nameplate** | Rung 2 — a vision model reads the plate. Needs signal. |
| **Type it in** | Rung 3 — always works. |
| **Sync warning** | Appears only when something is queued or failing. Shows the exact address it's posting to. **Tap it for a live connection test.** |
| **Long-press WITNESS (2.5s)** | Reset this device between takes. |

### The verdict screen

Three things happen the moment a tag resolves, in this order:

1. **The screen turns red or green** — instant, local, no network
2. **The phone vibrates** a distinct pattern — works at 95 dB, works in a pocket
3. **It speaks** — nice when you can hear it

The screen never waits for the model. If better phrasing arrives from the
network it replaces the caption afterwards.

At the bottom, **provenance**: how the part was identified and how confident,
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

## 6. The verdicts

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

## 7. Witness Memory

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

## 8. The supervisor dashboard

Panel → **Open dashboard**. Polls every 3 seconds, so it updates the moment a
phone's queue drains.

- **Field-verified %** — distinct units verified ÷ distinct units in the zone
- **Open NCRs**
- **Zones at risk** — driven by *repeat* failures, not raw counts
- **Rework risk by zone** — coverage bar and risk pill per zone
- **Most confused components** — where the same mistake keeps happening
- **Live from the field** — updates as phones come back into signal
- **Nonconformances** — every one confirmed by a human at the point of install

> **Coverage cannot be inflated.** Both numerator and denominator count distinct
> units. Scanning one part 500 times moves nothing. Verifying a genuinely
> different part moves it. Two phones verifying the same unit is still one work
> item. Seven tests pin exactly this.

---

## 9. The tags

`witness_qr_tags.pdf` — generate it with **Rebuild tag sheet** in the panel.
It's not committed, so it can never drift from the seed data it was printed from.

- Payload format: `WTNS:1|<SKU>|<SERIAL>`, e.g. `WTNS:1|GT-12|SN-4471`
- **Error correction level H** — roughly 30% of the tag can be destroyed and it
  still reads. That's what backs the "works dirty" claim: a property of the tag,
  not a trick.
- The serial is printed in readable text underneath, for manual entry

**Print at 100% scale.** "Fit to page" shrinks the code and it stops scanning.

Anything that isn't a Witness tag is refused outright rather than half-read.

> **Real equipment already carries this.** Manufacturers put model and serial on
> nameplates and barcodes. Our printed tags stand in for tags that already exist
> in the supply chain — Witness reads what's there; it doesn't ask sites to
> relabel everything. That's also why rung 2 exists, for items never serialised.

---

## 10. Running the demo

**Before you start:** set the connection, start the sync server, open the
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

**Use the APK for this shot**, not Expo Go.

**Film verdicts 3 and 4.** Every team shows a happy path; almost none show what
their system does when it doesn't know.

---

## 11. Making changes

| What changed | Expo Go | APK |
|---|---|---|
| Any `.ts` / `.tsx` file | Reload (shake → Reload) | Rebuild |
| `app/.env` — the server address | **Restart the app**, not just reload | Rebuild |
| `witness_seed.json` | Reload — the phone re-seeds itself | Rebuild |
| Anything in `server/` or `dashboard/` | Restart the sync server | Same |

**Why `.env` needs a restart:** `EXPO_PUBLIC_*` values are compiled into the
bundle when it starts. A reload picks up code but keeps the old address.

**Why the seed doesn't:** the record carries a fingerprint. Change it, and the
phone notices on next launch and re-seeds itself. Earlier this seeded exactly
once ever, so a phone could hold a stale record indefinitely with nothing on
screen to explain the wrong numbers.

### Resetting

| What | How |
|---|---|
| The phone | Long-press **WITNESS** for 2.5 seconds → Reset |
| The server | **Reset demo data** in the panel |
| Everything | Both, in that order |

Reset restores the seeded record and re-stamps it as freshly synced — which
matters, because a record older than 24h correctly downgrades every verdict to
`ADVISORY`.

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm test` syntax error | Node older than 22 | Install the LTS, **reopen the terminal** |
| `'npm' is not recognized` | Node missing, or PATH not refreshed | Install Node, close and reopen the window |
| Expo Go won't connect | Different networks, or a VPN | Same wifi, VPN off. Else **tunnel mode** |
| Header says **NO SERVER** | Radio fine, server unreachable | See the three rows below |
| Queue never clears — firewall | Windows blocks Node inbound | `tools/allow-firewall.bat` → **right-click, Run as administrator** |
| Queue never clears — wrong address | Your IP changed | Panel warns you. Save settings, **restart the app** |
| Queue never clears — after changing the address | Address is baked in at start | Restart the app; a reload isn't enough |
| Wifi marked "Public" | Firewall rule won't apply | Settings → Network → Wi-Fi → set to **Private** |
| Verdicts appear, nothing spoken | Silent mode, or no TTS voice | Volume up; Android → Accessibility → Text-to-speech. Colour and haptics still work — deliberate |
| Camera won't read the tag | Printed at "fit to page", or too close | Reprint at 100%. Hold 15–25cm. Tap **LIGHT** |
| "Not a Witness tag" | Scanning some other QR | Only tags from the sheet parse. That refusal is intended |
| Wrong verdict | Phone is in the wrong zone | Tap the zone name. Zone is chosen, never inferred |
| Everything says ADVISORY | Record older than 24h, or the phone's clock is wrong | Reset the phone; check the date |
| Nameplate reading unavailable | No model key set | Add one in **Connection**, restart the app |
| Numbers look stale | Old record on the device | Reload — it re-seeds itself now. Or long-press WITNESS → Reset |

Build problems have their own table in **[BUILD_APK.md](BUILD_APK.md)**.

---

## 13. Glossary

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
| **Metro** | Expo's dev server. Streams the app to Expo Go over wifi. |
| **EAS** | Expo's cloud build service. Turns the source into an installable APK. |
