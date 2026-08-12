# Putting this on GitHub

## Before you push — the one thing that matters

Three files on your machine must **never** reach GitHub. `.gitignore` already
excludes them, but check with your own eyes rather than trusting it:

| File | Why |
|---|---|
| `tools/control/.expo-token` | Your Expo credential. Anyone with it can build and publish as you. |
| `app/.env` | Contains your model API key and your laptop's LAN address. |
| `server/store.json` | One machine's demo state. |

After `git add .`, run:

```bash
git status
```

If any of those three appear under "Changes to be committed", **stop** and fix
`.gitignore` before continuing.

> If you ever *do* push a token by accident: deleting the file in a later commit
> is not enough — it stays in history. Revoke it immediately at
> **expo.dev → Settings → Access tokens** and create a new one. Revoking is
> instant and free; scrubbing git history is neither.

---

## Publish

```bash
cd witness

git init
git add .
git status                      # ← check the three files above are absent
git commit -m "Witness — approved-revision verification at the point of install"

git branch -M main
git remote add origin https://github.com/<your-username>/witness.git
git push -u origin main
```

Create the empty repo on github.com first (no README, no .gitignore — you have
both).

---

## What a visitor sees

`README.md` renders as the landing page: the problem, the architecture idea, a
quick start, and links to everything else.

```
README.md         landing page
SETUP.md          installing and running
BUILD_APK.md      building the phone app
docs/
  ARCHITECTURE.md data model, the deterministic/perception split, sync protocol
  PLAN.md         the build plan and field failure analysis
  RED_TEAM_1.md   first adversarial review
  RED_TEAM_2.md   second — and the bugs the first one's fixes introduced
```

---

## Worth knowing

**The tag PDF is gitignored.** `witness_qr_tags.pdf` is generated from the seed
data, so committing it risks it drifting out of sync with the serials it was
printed from. Anyone cloning regenerates it with **Rebuild tag sheet**. If you
would rather ship it, delete that line from `.gitignore`.

**`app/.env.example` is committed** — it's the template, with no values. That's
how a new clone knows what to fill in.

**Clone size is small.** `node_modules/` and `android/` are excluded; a fresh
clone is source and docs only, and `npm test` runs before installing anything.

---

## Suggested repo description

> Catches the wrong part before it goes into a building. Scans equipment at the
> point of install, checks it against the approved submittal record for that
> exact location, and remembers repeat failures. Offline-first Android app.
> AI reads the world; deterministic logic rules on it.

**Topics:** `construction-tech` `react-native` `expo` `offline-first`
`computer-vision` `quality-assurance` `hackathon`
