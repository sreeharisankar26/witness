/**
 * Site-legible design tokens.
 *
 * Every choice here assumes: direct sun, a dusty screen, gloves, and a worker
 * who has about one second of attention. Big, loud, high contrast, few words.
 */
export const C = {
  bg: '#0B0D10',
  card: '#14181D',
  line: '#252B33',
  text: '#F2F5F8',
  dim: '#8B95A1',

  ok: '#12B76A',
  okBg: '#06301E',
  stop: '#E5484D',
  stopBg: '#3A0D0F',
  check: '#F5A524',
  checkBg: '#3A2606',

  accent: '#4C8DFF',
};

/** Verdict severity -> the two colours the whole screen swings between. */
export const severityColors = {
  OK:    { fg: C.ok,    bg: C.okBg },
  STOP:  { fg: C.stop,  bg: C.stopBg },
  CHECK: { fg: C.check, bg: C.checkBg },
} as const;

export const T = {
  /** Readable at arm's length in sunlight. Do not shrink these. */
  verdict: 46,
  headline: 26,
  body: 16,
  label: 12,
};

/** Minimum touch target with work gloves on. */
export const GLOVE_TARGET = 72;
