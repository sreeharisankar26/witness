/**
 * HOW MANY WRONG PARTS ARE STILL IN THE WALL?
 *
 * A supervisor knows what has been checked. The useful question is about what
 * has NOT: of the units nobody has scanned yet, how many are likely wrong, and
 * how sure can we be of that number.
 *
 * This is a Beta-Binomial posterior, which is the plainest honest answer to
 * that question and small enough to read in one sitting.
 *
 *   - Each zone has an unknown defect rate p.
 *   - Every scan is a Bernoulli trial: the unit was wrong, or it was not.
 *   - Start from Beta(1,1) — a uniform prior, meaning "we know nothing".
 *   - After f flagged and c correct, the posterior is Beta(1+f, 1+c).
 *   - Expected remaining defects = unscanned x posterior mean.
 *   - The interval comes from the posterior's own quantiles, so it narrows on
 *     its own as scanning proceeds. Nothing is tuned.
 *
 * Three deliberate refusals.
 *
 * It will not project from almost nothing. Below MIN_OBSERVATIONS a zone
 * returns `projectable: false` and says so, because two scans supports any
 * conclusion you like and a confident number from two scans is worse than no
 * number at all.
 *
 * It does not pretend scans are random. They are not — workers scan what is in
 * front of them, and a zone where somebody chased a known bad pallet will read
 * hot. That bias is stated in `caveat` and travels with the number, because a
 * projection whose assumptions are invisible is a way of being wrong quietly.
 *
 * It is not machine learning and does not call itself that. It is arithmetic on
 * counts, which is precisely why it can be checked line by line.
 *
 * Pure functions. No clock, no network, no model. Node core only.
 */

/** Below this many scanned units in a zone, we decline to project. */
export const MIN_OBSERVATIONS = 5;

/** Uniform prior: before any evidence, every defect rate is equally plausible. */
const PRIOR_A = 1, PRIOR_B = 1;

/* ── the small amount of maths, written out ───────────────────────────────── */

/** Log-gamma (Lanczos). Used for the Beta CDF; standard coefficients. */
function lgamma(z) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Regularised incomplete beta, by continued fraction. This is the Beta CDF.
 *
 * The symmetry swap has to be decided BEFORE any work, and with a strict
 * inequality. Doing it at the end cost an afternoon: at exactly
 * x = (a+1)/(a+b+2) — which is where Beta(1,1) evaluated at its own median
 * lands, the single most obvious test case — a non-strict comparison sends the
 * function into infinite recursion against itself.
 */
function betaCdf(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Above the mode the series converges from the other side.
  if (x > (a + 1) / (a + b + 2)) return 1 - betaCdf(1 - x, b, a);

  const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;

  const TINY = 1e-30;
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 300; i++) {
    const m = Math.floor(i / 2);
    let numerator;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0) numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));

    d = 1 + numerator * d;
    if (Math.abs(d) < TINY) d = TINY;
    d = 1 / d;

    c = 1 + numerator / c;
    if (Math.abs(c) < TINY) c = TINY;

    const cd = c * d;
    f *= cd;
    if (Math.abs(1 - cd) < 1e-12) break;
  }
  return front * (f - 1);
}

/** Quantile of Beta(a,b) by bisection on the CDF. Slow, exact enough, obvious. */
export function betaQuantile(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ── the projection ───────────────────────────────────────────────────────── */

/**
 * Project one zone.
 *
 * `flagged` and `correct` are DISTINCT UNITS, not rows — the same rule the
 * coverage figures use. Counting rows here would let a rescan of one bad part
 * inflate the projected defect rate for the whole zone.
 */
export function projectZone({ zone_id, name, flagged = 0, correct = 0, unscanned = 0 }) {
  const observed = flagged + correct;
  const a = PRIOR_A + flagged;
  const b = PRIOR_B + correct;
  const rate = a / (a + b);                       // posterior mean

  if (observed < MIN_OBSERVATIONS) {
    return {
      zone_id, name, observed, unscanned,
      projectable: false,
      reason: `only ${observed} unit${observed === 1 ? '' : 's'} scanned here — `
            + `below ${MIN_OBSERVATIONS} any projection would be an opinion with a number on it`,
    };
  }

  // 80% central credible interval. Not 95%: on the counts a real site produces
  // in a week, 95% is so wide it tells a supervisor nothing they can act on,
  // and a number nobody acts on is decoration.
  const lo = betaQuantile(0.1, a, b);
  const hi = betaQuantile(0.9, a, b);

  return {
    zone_id, name, observed, unscanned,
    projectable: true,
    rate,
    ratePct: Math.round(rate * 100),
    expected: Math.round(unscanned * rate * 10) / 10,
    low: Math.round(unscanned * lo * 10) / 10,
    high: Math.round(unscanned * hi * 10) / 10,
    posterior: { a, b },
    caveat: 'Assumes the unscanned units are like the scanned ones. Scans are not '
          + 'random — if this zone was scanned because somebody suspected a bad '
          + 'pallet, the true rate for the remainder is lower than this.',
  };
}

/**
 * Project every zone, and the site.
 *
 * The site total deliberately sums the per-zone projections rather than pooling
 * all the counts. Pooling would let a large clean zone wash out a small bad one,
 * which is exactly the signal a supervisor needs to see.
 */
export function forecast(zones = []) {
  const perZone = zones.map(projectZone);
  const usable = perZone.filter(z => z.projectable);

  const site = usable.reduce(
    (acc, z) => ({
      expected: acc.expected + z.expected,
      low: acc.low + z.low,
      high: acc.high + z.high,
      unscanned: acc.unscanned + z.unscanned,
    }),
    { expected: 0, low: 0, high: 0, unscanned: 0 },
  );

  const round = n => Math.round(n * 10) / 10;
  return {
    zones: perZone.sort((x, y) => (y.expected ?? -1) - (x.expected ?? -1)),
    site: {
      ...site,
      expected: round(site.expected),
      low: round(site.low),
      high: round(site.high),
      zonesProjected: usable.length,
      zonesTooEarly: perZone.length - usable.length,
    },
    method: 'Beta-Binomial posterior, uniform Beta(1,1) prior, 80% central credible interval',
  };
}
