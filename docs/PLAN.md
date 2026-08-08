# WITNESS — Phone-First Build Plan
**Team Espada · Kaya AI IIT India Hackathon 2026 · Track 1: Physical AI**
Constraints: no Meta glasses · 5 build days · synthetic submittal record · recorded video submission

---

## 0. The reframe — read this before anything else

Losing the glasses is not a downgrade. Handled correctly it is a **stronger** submission, and you should say so out loud on slide 1.

Your own slide 5 already said *"02 · PHONE — Edge first."* The phone was always the compute. The glasses were a display. **Nothing about the architecture changes — only the surface changes, and the surface you lost was the expensive one.**

The line that reframes it:

> Every worker on site already carries the device. Witness needs zero hardware capex, zero procurement cycle, zero IT rollout. It deploys to a thousand sites the day it ships. Glasses are the roadmap, not the requirement.

That is a better answer to "can this actually be adopted?" than glasses ever were. Judges on a Physical AI track have seen a dozen teams promise hardware they can't ship. You are the team that ships.

**But be honest about what you lose: hands-free.** Do not pretend the loss doesn't exist — judges will notice and it will cost you credibility. Instead, engineer around it visibly:

| Lost with glasses | Phone recovery | Show it in the video |
| --- | --- | --- |
| Hands-free viewing | Chest-mounted phone in a clear ID-badge pouch on a lanyard, or hard-hat clip | Buy a ₹200 clear lanyard pouch. Wear it. This one prop sells "physical AI" harder than any slide. |
| Voice-first input | Push-to-talk on a single giant button + spoken TTS reply | Worker taps chest, speaks, keeps hands on the work |
| Always-on scan | One-tap wake → 0.4s scan → auto-sleep | Faster than unlocking a phone normally |

**Reposition the whole product as: "the device is already in his pocket."** That is your slide-1 hook now.

---

## 1. Stack decision — and why

**Build: Expo (dev client) + React Native, Android target only.**

| Layer | Choice | Why this and not the alternative |
| --- | --- | --- |
| App shell | Expo SDK + `expo-dev-client` | Real native modules, but Expo handles the Android build toolchain. Bare React Native or native Kotlin costs you a day of Gradle debugging you do not have. |
| Camera + QR | `expo-camera` (built-in barcode scanning) | Ships in Expo, no extra native module, sub-second QR decode on-device. `react-native-vision-camera` is faster but is a config-plugin risk on day 1. **Do not use it.** |
| Local DB | `expo-sqlite` | Real relational store, real offline. Not AsyncStorage — you need joins for the memory queries. |
| Match engine | **Plain TypeScript. No LLM.** | The safety-critical verdict must be deterministic. See §3. |
| Speech out | `expo-speech` | On-device TTS, works in airplane mode. Critical for the offline claim. |
| Speech in | `@react-native-voice/voice` (P2, cuttable) | Requires dev build. If it fights you past 3 hours, cut it — buttons are fine. |
| LLM layer | Any hosted model via HTTPS, behind an interface | Model-agnostic is a selling point. Only used for *phrasing*, never for the verdict. |
| Backend | Node/Express or FastAPI on Render free tier + SQLite/Postgres | Exists only to serve the seed record and receive synced NCRs. Keep it under 200 lines. |
| Dashboard | Static Next.js/Vite page, deployed to Vercel | Highest visual payoff per hour of work in the entire project. |

**Android only.** iOS provisioning profiles have killed more hackathon demos than bad code. If someone on the team only has an iPhone, they are not the demo phone.

**Rejected: PWA in the browser.** Camera permissions, no reliable offline storage guarantees, no TTS consistency, and it looks like a website in the video. You lose the "physical" in Physical AI.

---

## 2. What you are actually building — scope tiers

Be ruthless. A hackathon is won by one thing working perfectly, not six things working partly.

### P0 — Must exist or there is no submission (Days 1–3)
1. Open app → tap **SCAN** → camera reads a real printed QR on a real physical object
2. App resolves the scanned tag against a **local** SQLite submittal record
3. Deterministic verdict on screen in under 1 second: `INSTALLED REV B` vs `APPROVED REV C` → **MISMATCH**
4. Spoken reply via TTS: *"That's Rev B — Rev C was approved last week."*
5. NCR draft generated, with a **human-confirm** button (never auto-files)
6. Every scan writes to a local `events` table
7. **Works with the phone in airplane mode**

### P1 — This is what makes it win (Day 4)
8. **Witness Memory:** on the 4th scan of a SKU that has ≥2 prior NCRs in the same zone, the app warns **before** the verdict: *"This caused mismatches three times before in Zone A."* Seed the 3 priors into the DB.
9. **Offline sync queue:** writes land in an `outbox` table; turn the network on and watch the queue drain live.
10. **Supervisor dashboard:** web page showing zone heat map + "Zone A: 60% field-verified." Cheap to build, enormous on video, proves the site-level claim from slide 8.
11. NCR exported as a real PDF you can open on screen.

### P2 — Only if Days 1–4 finish clean
12. Voice input (push-to-talk → transcript → intent)
13. VLM nameplate fallback: no QR present → photograph the nameplate → cloud VLM reads model number. **Cloud-called, clearly labelled as the online path.**
14. Multi-zone switching

### CUT — Explicitly do not build these
- ❌ Live parsing of messy submittal PDFs. Pre-parse three of them offline and show the *output* as a one-time ingest screen. This is a two-day rabbit hole disguised as a two-hour task.
- ❌ Any auth, login, or user management
- ❌ Real Kaya integration (build the adapter interface, stub the implementation)
- ❌ On-device fine-tuned models
- ❌ iOS

---

## 3. Architecture — and the one idea that wins the technical question

```
┌──────────────────── PHONE (offline-capable) ─────────────────────┐
│                                                                   │
│  expo-camera ──► QR string "GT-12|ZONE-A|SN-4471"                │
│        │                                                          │
│        ▼                                                          │
│  ┌──────────────────────────────────────────┐                    │
│  │  MATCH ENGINE — pure TypeScript          │  ◄── SAFETY PATH   │
│  │  resolve(tag, zone) → {installed,        │      deterministic │
│  │    approved, status, confidence}         │      no network    │
│  │  Returns UNKNOWN if not confident.       │      no model      │
│  └──────────────────────────────────────────┘                    │
│        │                    │                                     │
│        ▼                    ▼                                     │
│  expo-sqlite          MEMORY QUERY                                │
│  · submittals         SELECT count(*) FROM ncrs                   │
│  · revisions          WHERE sku=? AND zone=?  → ≥2 ⇒ warn         │
│  · installs                                                       │
│  · ncrs               ┌────────────────────────┐                  │
│  · events             │ LLM (optional, cloud)  │  ◄── PHRASING    │
│  · outbox  ──┐        │ verdict → natural      │      ONLY        │
│              │        │ sentence + NCR text    │      degrades to │
│              │        │ offline ⇒ template     │      templates   │
│              │        └────────────────────────┘                  │
│              │                    │                               │
│              │                    ▼  expo-speech (on-device TTS)  │
└──────────────┼───────────────────────────────────────────────────┘
               │ syncs when online
               ▼
       Backend (Render) ──► Supervisor dashboard (Vercel)
                            zone heat map · field-verified %
```

### The idea judges will remember

**The verdict is deterministic. The language is generative. They are separate systems, and only one of them can be wrong.**

Say exactly this when asked "how do you know the AI isn't hallucinating the compliance call?":

> The mismatch check is a database join, not a model output. It cannot hallucinate a revision that isn't in the approved record. The model only turns a structured verdict into a sentence a worker can hear. If the model is offline, the worker still gets the correct verdict — in a template. We separated them on purpose, because on a construction site a confidently wrong answer is worse than no answer.

This single design decision is more impressive than any model you could integrate, and it costs you nothing to build. It also directly serves your slide-9 promise, *"never guesses, and a human confirms every flag."*

### Data model (SQLite)

```sql
submittals(id, sku, description, zone_id, approved_rev, approved_date, doc_ref)
revisions(id, sku, rev, superseded_by, approved_date)
units(serial, sku, rev, manufactured_date)        -- what physically exists
installs(id, serial, zone_id, installed_at, verified_by, status)
ncrs(id, serial, sku, zone_id, installed_rev, approved_rev, created_at, confirmed_by, narrative)
events(id, type, payload_json, created_at)         -- every scan, verdict, warning
outbox(id, endpoint, payload_json, created_at, synced_at)
```

Seed roughly 40 submittals, 120 units, 25 installs, and **3 pre-existing GT-12 NCRs in Zone A** so memory has something to remember on day one.

---

## 4. Five-day schedule, four people

Names map to your team; swap as suits. Everyone commits to `main` twice a day minimum.

| | **Sree — App & Scan** | **Priyanshu — Data & Logic** | **Mithun — Backend & Dashboard** | **Nishanth — Assets, Video, Deck** |
| --- | --- | --- | --- | --- |
| **Day 1** | Expo dev client builds & installs on the demo phone. Camera opens, QR decodes to a string on screen. **Nothing else.** | Design schema, write seed generator, hand a `witness_seed.json` to the team by EOD | Express server + `/record` and `/ncr` endpoints deployed to a live URL | Design QR tag format, print 12 stickers, scout the physical location |
| **Day 2** | Scan → verdict screen. Big high-contrast MATCH / MISMATCH card | `resolve()` match engine + unit tests. 8 test cases incl. UNKNOWN | Dashboard skeleton reading live from backend | Write the three fake submittal PDFs (they must look real on camera) |
| **Day 3** | TTS speaks the verdict. NCR draft screen + confirm button. **P0 complete, airplane mode tested** | Memory query + the ≥2-prior-NCR warning path | Outbox sync endpoint + idempotency | Deck rewrite: slides 1, 4, 5, 9 (see §6) |
| **Day 4** | Wire memory warning into UI. Polish: torch toggle, haptics, glove-size targets | NCR → PDF export | Zone heat map + field-verified % live | LLM prompt + phrasing layer; shoot **rehearsal** footage |
| **Day 5** | **Freeze code at noon.** Bug triage only | Freeze. Write the README + architecture diagram judges may read | Freeze. Verify deployed URLs still work | **Shoot final video, edit, submit by evening** |

**Hard rule: code freezes at noon on Day 5.** The most common hackathon death is a team still committing three hours before submission and shooting a broken build. Half a day of buffer is not generous — it is the minimum.

**3-day compressed version:** Day 1 = Day 1+2 above with P0 only. Day 2 = P1 items 8–10. Day 3 = freeze at noon, shoot. Drop the PDF export and the LLM phrasing layer; use templates.

---

## 5. Failure modes

### 5A. During the build — what will actually go wrong

| Risk | Likelihood | Blast radius | Mitigation |
| --- | --- | --- | --- |
| **Native module / Gradle hell on day 1** | High | Kills a full day | Freeze the dependency list before writing any feature code. Get a dev client onto the physical phone **on day 1 hour 1**, before any logic exists. If it isn't installed and opening the camera by end of day 1, escalate. |
| **Scope creep into document parsing** | Very high | Kills 2 days | It is explicitly CUT. Pre-parse offline. If anyone starts writing a PDF parser, stop them. |
| **Chasing a real VLM nameplate reader** | High | Kills 1–2 days | P2 only. Cloud API call, 10 lines. If not working by Day 4 noon, cut without discussion. |
| **LLM latency ruins the demo feel** | Medium | Looks slow on video | Verdict renders from the deterministic engine *immediately*; the spoken sentence arrives after. The screen never waits on the network. Cache the demo responses. |
| **LLM gives different wording on each take** | Medium | Forces re-shoots | Temperature 0, or cache the response for the demo SKUs. Determinism is your friend on camera. |
| **Merge conflicts across 4 people** | Medium | Hours lost | Strict file ownership per the table above. Shared types file agreed on Day 1 and then frozen. |
| **Seed data arrives late, blocking everyone** | Medium | Blocks 2 people | Priyanshu ships `witness_seed.json` by end of Day 1, even if the values are placeholder. Interface first, content later. |
| **The one demo phone dies / has no space** | Low | Fatal | Nominate the demo phone on Day 1. Free up 8GB. Have a second phone with the same build installed by Day 4. |
| **Everyone builds, nobody films** | Medium | Fatal | Nishanth does not write app code. Ever. This is the role most teams skip and it is why their submission looks worse than their product. |
| **Backend free tier cold-starts / sleeps** | Medium | Awkward pause on video | Ping it before every take. Or bake the dashboard's demo state so it renders without a cold call. |

### 5B. In the field — what breaks on a real site

Judges will probe this. Having crisp answers is itself a scoring differentiator, and several of these belong on a slide.

| Field condition | Failure | Witness's answer |
| --- | --- | --- |
| **QR is dirty, painted, dented, or torn** | Scan fails | Error-correction level H tolerates ~30% damage. Then a cascade: QR → nameplate OCR → manual tag entry. It never dead-ends the worker. **Film a genuinely dusty tag scanning successfully.** |
| **No signal — basement, lift shaft, rebar cage** | Cloud call fails | Entire safety path is on-device. Verdict, memory warning, and NCR draft all work in airplane mode; writes queue and drain later. |
| **Dark, or direct glare on the tag** | Scan fails | Auto-torch below a light threshold, exposure lock. Worker never fiddles with settings. |
| **95 dB ambient noise** | Nobody hears the reply | Audio-first degrades gracefully: distinct haptic pattern for MISMATCH, plus a full-screen red/green verdict card readable at arm's length. Never audio-only. |
| **Gloves, one hand free** | Can't hit the controls | Single 40%-of-screen action button, bottom third, thumb-reachable. Zero small targets, zero typing on the happy path. |
| **Wrong zone assumed** | Wrong verdict | Zone is confirmed by the worker or geofence — never inferred silently. If ambiguous the app **asks** rather than guesses. This is your "never guesses" claim made concrete. |
| **Local cache is stale, rev changed this morning** | Confidently wrong | Every verdict carries a freshness stamp: *"approved record synced 2h ago."* If a critical record is older than a configurable threshold, the verdict downgrades to advisory and prompts a sync. **The most dangerous failure mode in the whole system — name it on stage before a judge names it for you.** |
| **Serial not in the record at all** | Undefined behaviour | `UNKNOWN` is a first-class verdict, not an error. "I don't have an approved record for this serial in Zone A — flagging for supervisor." Show this state in the video. Teams that show a graceful unknown look ten times more real. |
| **Worker scans a photo of the QR to fake verification** | Data integrity | Acknowledged limitation. Mitigations: timestamp + coarse geofence + optional wide-shot capture on scan. Do not claim to have solved it — claim to have designed for it. |
| **False positives erode trust; workers stop using it** | Product death | Nothing auto-files. Every flag is a *draft* a human confirms. Track a precision metric in the pilot. This is why "a human confirms" is a feature, not a hedge. |
| **Continuous camera drains battery / overheats** | Won't survive a shift | Camera opens only on tap and auto-closes after the scan. Median session is under 8 seconds. |

---

## 6. Deck changes — these slides are now wrong

Your current deck says "glasses" in load-bearing positions. Fix these five, leave the rest:

| Slide | Current problem | Change to |
| --- | --- | --- |
| **1** | Neutral on hardware | Add the hook: *"It runs on the phone already in his pocket."* |
| **4 · Walkthrough** | Step 2: *"the glasses scan the code"* | *"He taps the phone on his chest rig; it scans the code."* Reshoot the panel images with the real phone rig. |
| **5 · Through the glasses** | Whole slide is a glasses POV | Retitle **"IN HAND · HOW IT WORKS."** Layer 01 becomes *"PHONE — see, scan, speak."* Merge old 01+02. Free slot goes to the deterministic-verdict-vs-generative-language split from §3 — your strongest technical idea and it currently isn't on any slide. |
| **9 · Buildable now** | *"Glasses are the interface; the phone is the edge they pair with on Meta's live SDK"* — this line is now false | *"Zero new hardware. It runs today on the Android phone every worker already carries — no procurement, no rollout. Glasses are a future skin on the same engine."* This is a **stronger** bullet than what it replaces. |
| **10 · Roadmap** | "NOW: Concept & proposal" | You now have a working app. Change to **"NOW: Working app, real scans, real NCRs."** Move glasses to THEN. |

Also add one new failure-honesty slide or half-slide from §5B. Showing you've thought about dirty tags, dead zones and stale caches signals field seriousness that no competing team will have bothered with.

---

## 7. The video — 3 minutes, and what actually earns the score

Judges watch the first 20 seconds properly and skim the rest. Front-load the proof.

### Shot list

| # | Time | Shot | Note |
| --- | --- | --- | --- |
| 1 | 0:00–0:15 | **Cold open, no titles.** Worker at real equipment, phone on chest, taps, scans, red MISMATCH, spoken verdict. **One unbroken take.** | This is the whole submission. Nail this and the rest is supporting material. |
| 2 | 0:15–0:35 | Problem framing — the £18k Rev B wall | Keep it short; the deck already carries this |
| 3 | 0:35–1:15 | The loop in full: scan → verdict → NCR draft → human confirms | Screen recording intercut with the physical shot |
| 4 | 1:15–1:35 | **Airplane mode on.** Scan. It still works. Airplane mode off. Queue drains live. | Ten seconds, disproportionate credibility. Show the toggle. |
| 5 | 1:35–2:00 | **Memory.** Second worker, same SKU, and Witness warns *before* installation | The emotional peak — Witness stopping a mistake, not just reporting one |
| 6 | 2:00–2:20 | Cut to supervisor dashboard: heat map, 60% field-verified | Proves it's a system, not a gadget |
| 7 | 2:20–2:45 | Architecture card: deterministic verdict / generative language / on-device | The technical judge's slide |
| 8 | 2:45–3:00 | Phone-first close + roadmap | *"No new hardware. Ships Monday."* |

### Physical prep (Nishanth, Days 1–2)
- Scout real campus equipment: HVAC outdoor unit, electrical distribution panel, water pump, fire suppression valve. **Real metal, real grime.** A QR on a cardboard box on a desk destroys the entire premise.
- Print 12 QR stickers, error correction level H, on white vinyl or laminated paper. Print spares — you will lose some.
- Deliberately dust/scuff one tag for the "works dirty" shot. Verify it actually still scans before filming day.
- Buy the clear lanyard pouch. Wear a hard hat and hi-vis. Costume is 20% of a Physical AI demo.
- Shoot in daylight, phone screen brightness at maximum, and check on a laptop that the screen is legible in the footage before you strike the location.

### Non-negotiables
- **No fake screens.** Every pixel is the running app.
- **The hero shot has no cuts.** Cuts read as concealment.
- **Show one graceful failure** (the UNKNOWN verdict, or the fallback to manual entry). Teams that only show the happy path look like they only have a happy path.

---

## 8. The five questions judges will ask

Rehearse these until each answer is under 30 seconds.

1. **"Isn't this just a QR scanner?"**
   → A scanner tells you what a part *is*. Witness tells you what is *approved for this location right now*, from the live submittal record, and remembers every time this exact confusion happened before. The scan is the input. The approved-record join and the memory are the product.

2. **"How do you know the AI isn't hallucinating?"**
   → The verdict is a database join, not a model output. The model only phrases it. Offline, the worker still gets the correct verdict as a template. §3.

3. **"You lost the glasses — is this still the same product?"**
   → The phone was always the compute; the glasses were a display. We removed the only part that required procurement. It now runs on hardware every worker already owns.

4. **"Your data is fake."**
   → Yes, and the adapter is one interface with one method. Point at the file. *"Swap this stub for Kaya's submittal endpoint and it's live. We built against the shape of your data, not our imagination."*

5. **"What happens when it's wrong?"**
   → Nothing auto-files. Every flag is a draft a human confirms. And the failure we're most careful about isn't a wrong flag — it's a stale cache producing a confident *correct-looking* verdict, which is why every verdict carries a sync timestamp and downgrades to advisory when stale.

---

## 9. The single highest-leverage decision in this plan

If you read nothing else: **get a dev client with a working camera onto the physical demo phone within the first four hours of Day 1, before you write one line of business logic.**

Every hackathon team that fails does so because the thing they assumed was trivial — getting a build onto a real device — turned out to eat a day, and they discovered it on day four. Everything else in this document is recoverable. That is not.

---

*Prepared for Team Espada — Sree Harisankar, Priyanshu Kripashankar Singh, Mithun N, Nishanth A · IIT Hyderabad*
