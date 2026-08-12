# Evidence

Committed output from the three tools that produce numbers, so a reviewer can
read the results without installing or running anything.

These are **snapshots, not claims**. Every one of them is reproducible in a few
seconds, and if a file here disagrees with what the tool prints today, believe
the tool.

| File | Produced by | What it answers |
|---|---|---|
| [`benchmark.txt`](benchmark.txt) | `node tools/bench.mjs` | Does the safety path hold up at the size of a real tower? Per-scan latency and memory at 1k / 10k / 100k units. |
| [`backtest.txt`](backtest.txt) | `node --experimental-strip-types tools/backtest.mjs` | Would it actually have caught the nonconformances in the record — and how many correct installs would it have stopped by mistake? |
| [`model-check.txt`](model-check.txt) | `node tools/modeltest.mjs` | Are the optional model paths actually live, or silently doing nothing? |

## Reading them honestly

**The benchmark's flat line is not a trick.** The record is indexed once when it
loads and a verdict is a lookup in that index, so it does not get slower as the
project grows. What *does* grow is the memory footprint and the one-time index
build, and both are in the same file. It was linear before the benchmark caught
it.

**The backtest is a small sample.** Five nonconformances is an indication, not a
rate, and the file says so itself. The record is synthetic; the measurement that
would actually settle this is replaying a contractor's own closed NCR log.

**The model check needs a key.** Without one it reports that nothing is running,
which is the point of it existing — every model path in Witness degrades
silently by design, so "the AI is configured" is not something anyone should
discover is false during a demo.
