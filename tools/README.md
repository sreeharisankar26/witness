# tools

Nothing here is on the safety path. These build the data, print the tags, read
the documents, and get the thing running on a laptop without a terminal.

## The one you want

| | |
|---|---|
| **`../Witness.bat`** | Double-click. Opens the control panel in a browser. Everything below has a button there. |

## Ingestion — where the approved record comes from

| | |
|---|---|
| `ingest.mjs` | Reads `docs/submittals/*.pdf` into an approved record. A model reads the documents; [`server/ingest.mjs`](../server/ingest.mjs) decides what is allowed in. Writes `app/src/data/witness_record.json` and `docs/INGEST_REPORT.md`. **Node core only** — runs with no key, no Python, no poppler. |
| `modeltest.mjs` | Are the model paths actually live? Exercises reachability, structured extraction, the vision path and phrasing, reports latency for each, and writes `tools/modeltest.txt`. **Run this before filming.** |
| `make_submittals.py` | Generates the sample submittal registers. Deliberately messy: a `PENDING` row, a missing zone, an OCR-plausible typo, and a supersession note in prose. Needs `reportlab`. |

## Evidence

| | |
|---|---|
| `bench.mjs` | Generates 1k/10k/100k-unit projects and measures p50/p99 for the safety path. Answers "does it scale" with numbers, and states the memory ceiling honestly. Writes `tools/bench.txt`. |
| `backtest.mjs` | Replays the record's own nonconformances through the engine to measure catch rate and false alarms. Found a data-integrity bug on its first run. Writes `tools/backtest.txt`. |

## Data and tags

| | |
|---|---|
| `make_seed.py` | Generates the synthetic supply-chain record — units, revisions, zones, prior NCRs, worker reports. |
| `make_qr_sheet.py` | Prints `witness_qr_tags.pdf`. Error correction level H: roughly 30% of a tag can be destroyed and it still reads. Print at **100% scale**. |

## Getting it running

| | |
|---|---|
| `control/` | The control panel — `server.mjs` runs the commands, `panel.html` is the UI. Node core only. |
| `allow-firewall.bat` | Opens 8787 and 8081–8090 to **this subnet only**. Right-click → Run as administrator. The panel's *Let my phone in* button does the same thing. |
| `setup-env.ps1` | Writes `app/.env` from PowerShell, for people who prefer a terminal. |

## When something will not work

| | |
|---|---|
| `Diagnose.bat` | Writes `tools/diagnostic.txt`: network adapters, the routed address, ports, firewall rules, `.env`. One file that answers "why can't my phone reach this". |
| `RestartSyncServer.bat` | Frees 8787 and restarts the sync server. Needed after editing anything in `server/` — a running Node process keeps the code it started with, so a new route returns 404 while the file plainly contains it. |
| `checkserver.mjs` | Is the sync server that is answering the same code that is on disk? Writes `tools/servercheck.txt`. |
| `Verify.bat` | End-to-end check of the control panel: starts one on a spare port, exercises every endpoint, writes `tools/verify.txt`, shuts down what it started. |

Output files (`diagnostic.txt`, `verify.txt`, `servercheck.txt`) are gitignored —
they describe one machine at one moment.
