/**
 * FIELD INSTRUMENT — the phone half of the design system.
 *
 * Every choice assumes direct sun, a dusty screen, gloves, and a worker with
 * about one second of attention.
 *
 * The phone is dark and the supervisor's dashboard is light, and that is
 * deliberate rather than inconsistent: this screen sits around a live camera
 * viewfinder, where dark chrome keeps the eye on the image; the dashboard is a
 * register read at a desk, where a document reads better than a console.
 *
 * What this palette avoids, on purpose. The default look of a generated
 * interface is a cool blue-black surface, rounded cards floating on a slightly
 * darker background, a single blue or violet accent applied to anything
 * tappable, and soft glow. None of that is here. The black is neutral ink, not
 * navy. Structure comes from hairline rules and space, not from boxes. There is
 * no decorative accent colour at all — colour means exactly one thing in this
 * app, which is the state of the work, and spending it on a button would make
 * the one thing that matters ordinary.
 */
import type { TextStyle } from 'react-native';

export const C = {
  /** True neutral ink. A blue-tinted black is the tell of a template. */
  bg: '#0C0C0D',
  /** Raised surface — used sparingly, and never as a floating rounded card. */
  surface: '#151517',
  sunk: '#08080A',
  rule: '#26262A',
  ruleStrong: '#3A3A40',

  /** Warm white, matching the paper the dashboard is set on. */
  text: '#F4F2EE',
  text2: '#A5A29B',
  text3: '#6E6C68',

  /** The state of the work. The only colour in the app. */
  ok: '#34C46A',
  okBg: '#072313',
  stop: '#FF3B2F',
  stopBg: '#2A0906',
  check: '#FFA317',
  checkBg: '#2A1A03',

  /**
   * Kept for anything still importing it, but nothing new should. Interaction
   * is expressed with contrast and motion, not with a blue.
   * @deprecated
   */
  accent: '#F4F2EE',
  card: '#151517',
  line: '#26262A',
  dim: '#A5A29B',
};

export const severityColors = {
  OK:    { fg: C.ok,    bg: C.okBg },
  STOP:  { fg: C.stop,  bg: C.stopBg },
  CHECK: { fg: C.check, bg: C.checkBg },
} as const;

/**
 * Type scale.
 *
 * Tracking is size-specific — large text needs NEGATIVE tracking because
 * letters read further apart as they grow, and small caps-labels need positive
 * tracking to stay legible. One letter-spacing value for everything is wrong
 * somewhere by definition.
 */
export const T = {
  verdict: 52,
  display: 34,
  title: 22,
  body: 16,
  small: 13.5,
  label: 11.5,

  /** Pair each size with its tracking. */
  trackVerdict: -1.6,
  trackDisplay: -0.9,
  trackTitle: -0.35,
  trackBody: 0,
  trackLabel: 1.5,

  /** Leading tightens as size grows. */
  leadVerdict: 52,
  leadTitle: 27,
  leadBody: 24,
} as const;

/**
 * Serials, revisions and counts are set in tabular figures so a column of them
 * lines up and a changing number does not shift the text beside it.
 */
export const MONO: TextStyle = {
  fontVariant: ['tabular-nums'],
};

/** Minimum touch target with work gloves on. */
export const GLOVE_TARGET = 72;

/**
 * Springs, in Apple's two parameters rather than the physics triplet, converted
 * to what React Native's Animated wants (mass 1).
 *
 *   response — how quickly it reaches the target, in seconds
 *   damping  — 1.0 settles with no overshoot; below 1.0 bounces
 *
 * Bounce is reserved for motion the user threw. A panel that merely appeared
 * should not overshoot; a card that was flicked may.
 */
const springOf = (response: number, ratio: number) => ({
  stiffness: Math.round((2 * Math.PI / response) ** 2),
  damping: Math.round(4 * Math.PI * ratio / response * 10) / 10,
  mass: 1,
  useNativeDriver: true,
});

export const SPRING = {
  /** Default for anything that simply changes state. No overshoot. */
  ui: springOf(0.35, 1),
  /** Screen-to-screen. Slightly slower, still critically damped. */
  screen: springOf(0.42, 1),
  /** Only after a gesture that carried momentum. */
  thrown: springOf(0.4, 0.8),
  /** Press feedback — fast enough to feel like contact, not animation. */
  press: springOf(0.16, 1),
} as const;
