# Building the APK — from an Expo account to an app on your phone

You have the account. Here is the rest, in order. **No terminal needed.**
Total: about 5 minutes of your time, then 10–20 minutes of waiting.

---

## Step 0 — Move the project out of the session folder

If the control panel shows an orange **"This folder is too deep for Windows"**
banner, do this first — nothing else will work reliably until you do.

Windows refuses any path longer than 260 characters. The project starts life in
a Cowork session directory around **243 characters deep**, which leaves 17
characters for everything inside it. A single `node_modules` file needs ~150.
The symptoms are misleading: git says *"Filename too long"*, builds fail, and
installs break in ways that look like unrelated problems.

Press **Move the project somewhere shorter**. It copies everything to
`C:\Users\<you>\witness` — source, docs, settings and your Expo token — and
leaves `node_modules` behind because it rebuilds in seconds and is the main
casualty of the long path.

Then close the panel, open the new folder, and run `Witness.bat` from there.
**Work in the new location from now on**; the old one is temporary.

---

## Step 1 — Set the server address FIRST

**Do not skip this.** The laptop's address is baked into the APK when it builds.
Build with the wrong one and you build again.

1. Double-click **`Witness.bat`**
2. In **Connection**, pick your wifi adapter from the dropdown
3. Press **Save settings**

If you plan to demo the nameplate reader, paste the model API key now too —
same reason, it is baked in at build time.

---

## Step 2 — Create an access token

This is instead of typing a password into a terminal.

1. Go to **https://expo.dev/settings/access-tokens**
2. Press **Create token**, name it anything (`witness-laptop`)
3. **Copy it now** — Expo shows it once and never again
4. In the control panel → **Build the phone app (APK)** → paste into the token box
5. Press **Save token & check**

The token chip turns **SAVED**, and the log below should print your
Expo username. If it prints an error, the token was mistyped or has expired —
make another.

> The token is stored in `tools/control/.expo-token` on this PC only. It is
> deliberately **not** in `app/.env`, because everything in that file gets
> compiled into the APK — a credential there would ship to every phone.

---

## Step 3 — Set up git

EAS uploads your source **through git**, so it refuses to build in a folder that
is not a repository. Press **Set up git** in the build card.

That runs `git init`, then commits everything except your token, your `.env` and
`node_modules` — verified, not assumed. It is also exactly step one of putting
the project on GitHub, so you are not doing throwaway work. See
[PUBLISHING.md](PUBLISHING.md).

> EAS offers to run `git init` inside `app/`. **Don't let it** — that would put
> the repository one level too deep and leave the server, dashboard, tools and
> docs outside version control. The panel initialises it at the project root.

The chip turns **READY**.

---

## Step 4 — Build

Press **Build in the cloud (recommended)**.

What happens, in order:

1. Your source uploads to Expo's build servers (~1 min)
2. Expo asks about a **keystore** — the certificate that signs the app.
   With a token set it generates one automatically and remembers it. You will
   see something like *"Generating a new Android Keystore"*. This is normal and
   you do not need to understand it.
3. It builds (10–20 min). The log shows queue position, then progress.
4. At the end you get a **URL** in the log.

Leave the panel open. You can watch the log or ignore it.

---

## Step 5 — Install on the phone

The build finishes with a link like `https://expo.dev/artifacts/eas/xxxx.apk`.

**Easiest:** open that link **on the phone's browser** and download it. Android
will ask you to allow installing from that browser — allow it, then open the
downloaded file.

**Or:** press **Download the built APK** in the panel if you built locally.

Android will warn about installing an app from outside the Play Store. That is
expected for any app not published to a store.

---

## Step 6 — Check it works

Open Witness on the phone. It should:

- ask **who is on this phone** (pick a name — attribution is the point)
- show **Zone A — Level 3 Mech Room**
- show `approved record synced just now`

Now scan `GT-12 / SN-4471` in Zone A → red **STOP**, double buzz, spoken verdict,
memory banner.

**Then do the shot the APK exists for:** airplane mode on → scan → confirm →
`1 queued` → airplane mode off → watch it clear. No Metro, no wifi dependency,
nothing to drop mid-take.

---

## When it goes wrong

| What you see | What it means |
| --- | --- |
| Token box says NOT SET after saving | The token had a stray space, or you copied the token *name* instead of the token. Make a new one. |
| `Must be logged in` in the log | Token invalid or expired. Create another at expo.dev. |
| Build fails on **keystore** | Press build again — the first run sometimes needs a second attempt to persist the generated keystore. |
| `eas.json is not valid` | A malformed build profile. Fixed — if you still see it, the file was edited by hand. |
| `Existing project not found` / project not linked | The first cloud build now runs `eas init` automatically before building. If it still appears, press **Copy log** and send it. |
| `Filename too long` | The folder is too deep. Press **Move the project somewhere shorter** on the panel. |
| `EAS requires you to use a git repository` | Press **Set up git** first. |
| `Input is required, but stdin is not readable` | A prompt appeared that non-interactive mode cannot answer. The three known ones — create project, git init, keystore — are all handled. Anything else: send the log. |
| Build asks a question and stops | `--non-interactive` cannot answer prompts. The two normal prompts (create project, generate keystore) are handled. Anything else: send the log. |
| Long queue wait | Free tier shares builders. It is normal to wait; the build itself is ~10 min. |
| APK installs, app opens, but nothing syncs | You built before Step 0. Check the address shown on the phone's sync banner, fix it in the panel, rebuild. |
| "Build on this PC" fails immediately | Needs **JDK 17+** and Android Studio. Press **Check build tools** — it says which is missing. Use the cloud build instead. |

---

## Worth knowing

- **The APK is a snapshot.** Change any code and you rebuild. Keep using Expo Go
  for day-to-day development; the APK is for filming and for the submission.
- **Rebuild if you change `.env`.** Same reason — baked in.
- **Reset before filming.** Long-press the WITNESS wordmark for 2.5 seconds on
  the phone, and press **Reset demo data** in the panel. Rows written under older
  builds can look wrong in ways nothing else explains.
