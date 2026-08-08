# Witness — setup

## The easy way: double-click `Witness.bat`

A control panel opens in your browser. Everything below can be done from it with
buttons — install, tests, start the app (with a scannable QR on screen), sync
server, dashboard, tag sheet, settings. It also has **Check everything**, which
runs real checks against your machine and tells you what to fix.

The rest of this file is the manual/terminal path, kept for reference and for
anyone who prefers it.

---

Two paths. **Take Path A today.** Path B is for the final build, later in the week.

| | Path A — Expo Go | Path B — standalone APK |
| --- | --- | --- |
| Setup time | ~10 min | 45–90 min first time |
| Needs Android Studio | No | Yes (or an Expo account for cloud build) |
| Good for | Trying it, developing, most filming | Final submission, no Expo Go branding |

Every native module this app uses — camera, speech, SQLite, haptics, network —
ships inside Expo Go. There is no reason to install an Android toolchain to see
it work.

---

## Prerequisites

| | Version | Check | Get it |
| --- | --- | --- | --- |
| Node | **22 or newer** | `node -v` | nodejs.org (LTS) |
| Python | 3.9+ | `python --version` | only for regenerating seed/tags |
| Android phone | Android 8+ | | on the **same wifi** as the laptop |

Node 22 matters: the test suite runs TypeScript natively with no compiler.
On Node 20 or older, `npm test` fails with a syntax error — that is the only symptom.

---

## Step 0 — Prove the logic works before touching a phone (30 seconds)

```bash
cd witness/app
npm test
```

Expect `# pass 42`, `# fail 0`, about 250ms. **No `npm install` needed** — the
engine suite has zero dependencies.

If this passes, the entire safety-critical path is verified. Everything after
this point is plumbing and pixels.

---

## Step 1 — Start the sync server

New terminal, leave it running:

```bash
cd witness
node server/index.mjs
```

You should see `Witness sync server on http://localhost:8787`.

Then open `witness/dashboard/index.html` in a browser — just double-click it.
It should show Hillside Tower with four zones. If it shows a red "No sync
server" bar, the server isn't running.

---

## Step 2 — Find your laptop's LAN IP

The phone cannot reach `localhost` — on the phone, that means the phone.

**Windows:** `ipconfig` → look for **IPv4 Address** under your wifi adapter,
something like `192.168.1.5`.
**macOS:** `ipconfig getifaddr en0`

```bash
cd witness/app
cp .env.example .env          # Windows: copy .env.example .env
```

Edit `.env` and put your IP in:

```
EXPO_PUBLIC_SERVER_URL=http://192.168.1.5:8787
```

Leave the model keys blank for now. Without them the app speaks the deterministic
template and nameplate reading is unavailable — every verdict still works. Add a
key later to enable the vision path.

---

## Step 3 — Install and run

```bash
cd witness/app
npm install          # 2–4 minutes, one time
npm start
```

A QR code appears in the terminal.

On the phone: install **Expo Go** from the Play Store, open it, tap
**Scan QR code**, point it at the terminal. The app builds and opens in ~30s.

Grant the camera permission when asked.

---

## Step 4 — The tags

Print `witness_qr_tags.pdf` at **100% scale** (not "fit to page" — that shrinks
the code). Twelve tags, six per page.

No printer right now? Open the PDF on your laptop screen and scan it off the
monitor. Works fine for a first test; useless for the video.

---

## Step 5 — Run the demo sequence

App should say **Zone A — Level 3 Mech Room** at the top. If not, tap the zone
name and pick it.

| Scan this tag | In zone | You should get |
| --- | --- | --- |
| `GT-12 / SN-4471` | ZONE-A | Red **STOP**, double buzz, spoken "that's Rev B…", memory banner, NCR button |
| `GT-12 / SN-4472` | ZONE-A | Green **CORRECT**, single buzz, "mark field-verified" |
| `VLV-22 / SN-9999` | ZONE-A | Amber **NOT ON RECORD** — refuses to guess |
| `SPR-14 / SN-4475` | ZONE-D | Amber **NO APPROVAL HERE** |

Tap **CONFIRM & RAISE NCR** on the first one, then watch the dashboard — it
polls every 3s, so Zone A should flip to **HIGH** risk and the NCR appears in the
live feed within a few seconds.

### The offline shot

> ⚠️ **Build the standalone APK before filming this.** Expo Go streams its
> bundle from Metro over wifi, so a reconnect mid-take can throw a red
> "disconnected from Metro" banner across your best fifteen seconds. The APK has
> no such dependency. See Path B below.

1. Put the phone in **airplane mode**
2. Scan `SN-4471` — full verdict, spoken, memory and all. Nothing degrades.
3. Confirm the NCR — the header shows `1 queued`
4. Turn airplane mode **off**
5. Within ~6 seconds the counter clears and the NCR lands on the dashboard

That is the whole architecture argument, in fifteen seconds of footage.

---

## Reset between takes

```bash
curl -X POST http://localhost:8787/reset
```

On the phone: **long-press the WITNESS wordmark for 2.5 seconds** → Reset.
Wipes local scans, NCRs and the queue, then reloads the approved record and
re-stamps it as freshly synced.

---

## When it goes wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| `npm test` syntax error | Node < 22 | Upgrade Node. Nothing else causes this. |
| Expo Go can't connect to the dev server | Laptop and phone on different networks, or laptop is on a VPN | Same wifi, VPN off. Failing that: `npx expo start --tunnel` |
| App runs, but `0 queued` never clears | Windows Firewall blocking port 8787 | Allow Node through the firewall on **Private** networks, or briefly disable it to confirm that's the cause |
| Dashboard shows the red server bar | Server not running, or opened from a different machine | `node server/index.mjs`; or open `index.html?server=http://<ip>:8787` |
| Verdicts appear but nothing is spoken | Phone on silent, or no TTS voice installed | Volume up. Android Settings → Accessibility → Text-to-speech. The haptics and colour still work — that is deliberate. |
| Camera never reads the tag | Printed at "fit to page", or too close | Reprint at 100%. Hold ~15–25cm away. Tap **LIGHT**. |
| Every scan says "Not a Witness asset tag" | Scanning some other QR | Only tags from `witness_qr_tags.pdf` parse. That refusal is the intended behaviour. |
| Wrong verdict for a tag | Phone is in the wrong zone | Tap the zone name at the top. Zone is chosen, never inferred. |

---

## Path B — standalone APK

**Easiest: the control panel.** Open `Witness.bat`, scroll to
**Build the phone app (APK)**, press **Build in the cloud**. 10–20 minutes,
no Android tooling, free Expo account. A download link appears in the log.

> **Save your connection settings BEFORE building.** The server address is baked
> into the APK at build time. Building with the wrong address means rebuilding.

First run asks you to log in. If the build stops immediately, run this once in a
terminal and then press the button again:

```
npx eas-cli login
```

**Local build** (the panel's second button) needs **JDK 17 or newer** and
Android Studio. Press **Check build tools** first — it will tell you what is
missing rather than failing twenty minutes in.

**Why bother:** Expo Go streams its bundle from your laptop over wifi. For the
airplane-mode sequence that is a real risk — a reconnect mid-take throws a red
banner across your best fifteen seconds. The APK has no such dependency.

---

## Regenerating data

```bash
cd witness
python3 tools/make_seed.py        # deterministic — identical output every run
python3 tools/make_qr_sheet.py    # needs: pip install qrcode[pil] reportlab
```

Changing the seed means reprinting the tags. Serials are baked into the codes.
