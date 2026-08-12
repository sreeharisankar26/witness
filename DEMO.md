# Running the demo

Everything here is reproducible from a clean clone. Nothing is staged, nothing
is a mockup, and the numbers you see on screen are computed from the data.

---

## Before you film

```bash
cd witness/app && npm test        # 177 passing. Film this.
```

Then double-click **`Witness.bat`** and press **▶ Start everything**. It frees
stale ports, finds the address this PC is actually reachable on, writes it into
the app, starts the sync server and starts Expo pinned to that same address.

If the orange card appears — *"This PC is refusing incoming connections"* —
press **Let my phone in** and approve the Windows prompt. On campus, hotel or
guest wifi this is required: Windows classifies those networks as Public and
silently drops inbound connections, so the laptop works and the phone gets
nothing. That is the single most common reason a phone will not connect.

Open the dashboard on a second screen. Print `witness_qr_tags.pdf` at **100%
scale** — "fit to page" shrinks the code until it stops scanning.

**Reset between takes:** *Reset demo data* on the control panel (server side)
and the reset gesture in the app (phone side). Do both, or the second take
starts with the first take's NCRs.

---

## The tags, and what each one proves

| Tag | Zone | What happens | Why it is in the demo |
|---|---|---|---|
| `SN-4471` | Zone A | **STOP** — Rev B installed, Rev C approved | The hero. Also fires Witness Memory: it has happened here before. |
| `SN-4472` | Zone A | **CORRECT** — scan is the sign-off | The happy path, and the "no extra paperwork" point. |
| `SN-9999` | any | **NOT ON RECORD** | It refuses to guess. Most demos hide this case. |
| `SN-4475` | Zone D | **NO APPROVAL HERE** | Advisory, not a ruling. It says less because it knows less. |
| `SN-4473` | Zone D | **SUPERSEDED CHAIN** | Two revisions behind, and it can trace the path. |

---

## Shot list — three minutes

Times are targets. The argument matters more than the clock.

### 0:00 — 0:25 · The gap

One line over site footage or a still: *a revision is approved weeks before
installation, and on the beam, hands full, nobody can see it.*

Say the thesis now, not at the end:

> **A model reads the world. It never rules on it.**

### 0:25 — 1:05 · The loop

Zone A. Scan **SN-4471**.

- Verdict lands in under a second, spoken out loud.
- Point at **BINDING** and the memory line — *this exact confusion has happened
  here twice before*.
- Press **Confirm & raise NCR**.
- **Cut to the dashboard.** Zone A ticks. The feed shows the NCR arriving.

Then scan **SN-4472**: correct revision, marked field-verified. *The scan is the
sign-off.*

### 1:05 — 1:45 · The part nobody else films

This is the section that separates you. Do not skip it for time.

1. **Airplane mode on.** Scan `SN-4471`. Same verdict, same second, still
   spoken. Header shows **1 queued**.
2. **Airplane mode off.** The queue drains on camera and the dashboard updates.
   *Nothing on the worker's path ever waits for the network.*
3. Scan **SN-9999** → `NOT ON RECORD`. Say it plainly: *it refuses to guess.*

If you have time, show a verdict downgraded to **ADVISORY** because the record
is stale — and mention that a phone whose clock is wrong is treated as maximally
stale, not perfectly fresh.

### 1:45 — 2:15 · One level up

Open the **Zone A** tile on the dashboard. The drawer shows what is approved,
what is correctly installed, what was misinstalled, what is damaged, and the
worker's own notes.

Then the reorder card:

> Three units of the same part, at the same wrong revision, in the same place is
> not three mistakes. It is one bad delivery.

Press **Confirm return of 3**. Show that it waits for a human — the system
proposes, a supervisor disposes.

If the earlier NCR is still in the record, the batch reads **4**, not 3, because
the scan you did at 0:25 joined it. Say so.

### 2:15 — 2:50 · Where "approved" comes from

Show `docs/submittals/submittal-register-A.pdf` — a real-looking, messy register.

```bash
node tools/ingest.mjs
```

Read the result off the screen: **13 rows in, 8 accepted, 2 held, 3 refused** —
and, with a key configured, *"the two reads agreed on 100% of rows"*.

Say what that second line means, because nobody else will be doing it:

> We read every document twice and compare. Where the two reads disagree, that
> row is held. We are not asking the model how confident it is — that number is
> not worth much. We are measuring where it contradicts itself. And we do not
> take a majority: two out of three is not evidence about an approved revision,
> it is a coin that landed twice.

Then land the point on one row:

> SUB-0005 is still **PENDING** consultant approval, sitting in the same table as
> the approved ones. A pipeline that OCRs this table into JSON turns a row nobody
> approved into an approved revision — and from that moment the app is
> confidently wrong, out loud, to a worker.

And on one more:

> SUB-0008 reads `GT-l2` — a lowercase L where a digit one belongs. We know the
> answer is almost certainly `GT-12`. We say so, and we still refuse the row,
> because a part number silently corrected is a wrong part confidently approved.

Then show `docs/RFI_DRAFTS.md`:

> Every held row is a question somebody has to ask. These are drafted, addressed
> and referenced, each asking one thing with a decidable answer. **None have been
> sent** — an RFI is contract correspondence, and a system emailing a consultant
> in a coordinator's name is not a feature.

### 2:50 — 3:05 · Close

`npm test` — 177 passing, about two seconds, nothing installed.

> The model reads. The logic rules. On a building site, a confidently wrong
> compliance ruling is a safety incident — so no model is allowed to make one.

---

## Two things worth doing for the camera

**Before you film, run `npm run modeltest`.** One command, and it tells you
whether the nameplate reader, the document reader and the phrasing layer are
actually live. Discovering mid-take that no model is configured is the single
most avoidable way to lose this.

**Film outdoors, in sunlight, wearing work gloves.** The touch targets are 72px
and the palette is built for a dusty screen in direct sun
([`app/src/theme.ts`](app/src/theme.ts)). In a track where every team has the
same phone, showing that you designed for the physical conditions is the
cheapest differentiation available.

**Let one thing visibly fail.** The queue banner, the refusal to guess, the
held submittal. A demo where nothing goes wrong looks staged; a demo that
handles going wrong looks built.

---

## If something breaks mid-shoot

| Symptom | Fix |
|---|---|
| Phone will not connect | Control panel → **Let my phone in**, approve the prompt. Then **Start everything**. |
| Dashboard shows `HTTP 404` on a zone | The sync server is older than the code. **Restart sync server**, or run `tools\RestartSyncServer.bat`. |
| QR never appears | **Start everything** again — it frees the port a stale Metro was holding. |
| Numbers look wrong between takes | *Reset demo data*, and reset the phone. Both. |
| Nothing works and time is short | `tools\Diagnose.bat` writes `tools\diagnostic.txt` with the network, ports, firewall and address in one file. |
