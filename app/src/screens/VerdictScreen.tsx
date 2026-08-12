/**
 * The verdict.
 *
 * Three things happen the moment a tag resolves, in this order:
 *   1. the screen turns red or green      (instant, local, no network)
 *   2. the phone buzzes a distinct pattern (works at 95 dB, works in a pocket)
 *   3. it speaks                           (nice when you can hear it)
 *
 * The screen NEVER waits on the model. `templateSpeech` is already correct;
 * if a nicer phrasing arrives from the network it replaces the caption after
 * the fact. A worker on a beam does not wait for a token stream.
 *
 * Layout note. This is the one screen in the app that is allowed to shout, so
 * it is the one screen carrying a saturated field of colour. Everything else
 * stays neutral precisely so that arriving here means something. The two
 * revisions are set as a single line of large tabular figures rather than in
 * two bordered boxes — the comparison IS the screen, and putting a box round
 * each half makes the reader work to do the comparison the layout should be
 * doing for them.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, ScrollView, StyleSheet, Easing } from 'react-native';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { C, T, MONO, severityColors, GLOVE_TARGET, SPRING } from '../theme';
import Press from '../components/Press';
import { severityOf } from '../engine/resolve';
import type { Resolution } from '../engine/types';
import { phrase } from '../llm/phrase';

const IDENTITY: Record<Resolution['identity']['source'], string> = {
  TAG: 'scanned tag',
  NAMEPLATE: 'nameplate photo, read by a vision model',
  MANUAL: 'typed in by hand',
};

const HEADLINE: Record<Resolution['verdict'], string> = {
  MATCH: 'CORRECT',
  MISMATCH: 'STOP',
  MISMATCH_SUPERSEDED: 'STOP',
  UNKNOWN_UNIT: 'NOT ON RECORD',
  NO_APPROVED_RECORD: 'NO APPROVAL HERE',
  TAG_CONFLICT: 'TAG DISPUTED',
};

/** One line under the headline that says what to DO, not what happened. */
const INSTRUCTION: Record<Resolution['verdict'], string> = {
  MATCH: 'Fit it. This scan is the sign-off.',
  MISMATCH: 'Do not fit this. Wrong revision for this location.',
  MISMATCH_SUPERSEDED: 'Do not fit this. It has been superseded.',
  UNKNOWN_UNIT: 'This serial is not in the approved record. Do not guess.',
  NO_APPROVED_RECORD: 'Nothing is approved for this part here. Ask before fitting.',
  TAG_CONFLICT: 'The tag and the record disagree. A person has to look.',
};

interface Props {
  resolution: Resolution;
  onConfirmNcr: () => void;
  onVerifyInstall: () => void;
  onDismiss: () => void;
  /** The part is right but something else about it is wrong. Worker's words. */
  onReportProblem: () => void;
}

export default function VerdictScreen({
  resolution: r, onConfirmNcr, onVerifyInstall, onDismiss, onReportProblem,
}: Props) {
  const sev = severityOf(r.verdict);
  const col = severityColors[sev];
  const [caption, setCaption] = useState(r.templateSpeech);
  const [source, setSource] = useState<'template' | 'model'>('template');

  /**
   * The verdict arrives rather than fades in — it rises a little and settles,
   * so the eye is drawn to it landing. Critically damped: a compliance ruling
   * that bounces reads as playful, which this is not.
   */
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, ...SPRING.screen }).start();
  }, [r.serial, r.verdict, r.zone_id]);

  useEffect(() => {
    // Haptics first - the only channel that survives a loud site and a pocket.
    Haptics.notificationAsync(
      sev === 'STOP' ? Haptics.NotificationFeedbackType.Error
        : sev === 'OK' ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
    );
    if (sev === 'STOP') {
      // Double buzz. Unmistakably different from a pass.
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 260);
    }

    let cancelled = false;
    Speech.stop();
    Speech.speak(r.templateSpeech, { rate: 1.0, pitch: 1.0 });

    // Best-effort upgrade of the wording. Purely cosmetic.
    phrase(r).then(spoken => {
      if (cancelled || spoken.source !== 'model') return;
      setCaption(spoken.text);
      setSource('model');
    });
    return () => { cancelled = true; Speech.stop(); };
  }, [r.serial, r.verdict, r.zone_id]);

  const rise = enter.interpolate({ inputRange: [0, 1], outputRange: [22, 0] });

  return (
    <View style={[s.root, { backgroundColor: col.bg }]}>
      {/* A single hairline of the verdict colour along the top edge. It reads as
          a status light on an instrument, and it is visible even when the phone
          is flat on a bench and you are looking down the length of it. */}
      <View style={[s.edge, { backgroundColor: col.fg }]} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: enter, transform: [{ translateY: rise }] }}>

          {/* Memory speaks BEFORE the verdict. The whole point is to warn the
              next worker rather than report on the last one. */}
          {r.memory && (
            <View style={[s.memory, { borderLeftColor: col.fg }]}>
              <Text style={s.memoryLabel}>WITNESS REMEMBERS · {r.memory.pattern}</Text>
              <Text style={s.memoryText}>{r.memory.message}</Text>
              <Text style={[s.memoryMeta, MONO]}>
                {r.memory.priorCount} distinct units
                {r.memory.spanDays > 0 ? ` over ${r.memory.spanDays} days` : ''}
                {r.memory.distinctWorkers > 1 ? ` · ${r.memory.distinctWorkers} people` : ''}
              </Text>
            </View>
          )}

          <Text style={[s.verdict, { color: col.fg }]}>{HEADLINE[r.verdict]}</Text>
          <Text style={s.instruction}>{INSTRUCTION[r.verdict]}</Text>

          <View style={s.rule} />

          <Text style={s.part}>{r.sku}</Text>
          {!!r.description && <Text style={s.desc}>{r.description}</Text>}
          <Text style={[s.serial, MONO]}>{r.serial}   ·   {r.zone_id}</Text>

          {/* The comparison, as one line. Scanned on the left, approved on the
              right, the same size, so the difference is the only thing moving. */}
          {(r.installedRev || r.approvedRev) && (
            <View style={s.revRow}>
              <View style={s.revCol}>
                <Text style={s.revLabel}>SCANNED</Text>
                <Text style={[s.revValue, MONO, { color: sev === 'OK' ? C.ok : C.stop }]}>
                  {r.installedRev ? `Rev ${r.installedRev}` : '—'}
                </Text>
              </View>
              <View style={s.revDivider} />
              <View style={s.revCol}>
                <Text style={s.revLabel}>APPROVED HERE</Text>
                <Text style={[s.revValue, MONO, { color: C.ok }]}>
                  {r.approvedRev ? `Rev ${r.approvedRev}` : '—'}
                </Text>
              </View>
            </View>
          )}

          {r.supersededChain.length > 0 && (
            <Text style={[s.chain, MONO]}>
              Rev {r.installedRev} → {r.supersededChain.map(c => `Rev ${c}`).join(' → ')}
            </Text>
          )}

          <Text style={s.caption}>{caption}</Text>

          {/* Provenance is not decoration. Anyone acting on this is entitled to
              know what decided it, what merely phrased it, and how sure we are
              of each part. */}
          <View style={s.provenance}>
            <Row label="Identified by" value={
              IDENTITY[r.identity.source]
              + (r.identity.source === 'NAMEPLATE'
                ? ` · ${Math.round(r.identity.confidence * 100)}% confident` : '')} />
            <Row label="Ruling" value="deterministic join against the approved record, on this phone" />
            <Row label="Wording" value={source === 'model' ? 'language model' : 'on-device template'} />
            <Row
              label="Record"
              value={r.staleness.clockSuspect
                ? "age unknown — this phone's clock is wrong"
                : `synced ${r.staleness.ageHours}h ago`}
              tone={r.staleness.stale || r.staleness.clockSuspect ? C.check : undefined}
            />
            <Row label="Authority" value={r.authority} tone={r.authority === 'ADVISORY' ? C.check : undefined} />
            {!!r.docRef && <Row label="Source" value={r.docRef} />}
          </View>
        </Animated.View>
      </ScrollView>

      <View style={s.actions}>
        {r.requiresNcr ? (
          <Press style={[s.primary, { backgroundColor: C.stop }]} onPress={onConfirmNcr}>
            <Text style={s.primaryText}>CONFIRM &amp; RAISE NCR</Text>
            {/* Nothing is filed until a human presses this. Witness drafts;
                it does not decide. */}
            <Text style={s.primarySub}>a human confirms every flag</Text>
          </Press>
        ) : r.verdict === 'MATCH' ? (
          <Press style={[s.primary, { backgroundColor: C.ok }]} onPress={onVerifyInstall}>
            <Text style={s.primaryText}>MARK FIELD-VERIFIED</Text>
            <Text style={s.primarySub}>the scan is the sign-off — no extra paperwork</Text>
          </Press>
        ) : (
          <Press style={[s.primary, { backgroundColor: C.check }]} onPress={onDismiss}>
            <Text style={s.primaryText}>SEND TO SUPERVISOR</Text>
            <Text style={s.primarySub}>Witness will not call this one</Text>
          </Press>
        )}

        {/* Deliberately quieter than the ruling above. A verdict is what the
            record says; a report is what the worker says. Giving them equal
            weight would blur the line this whole app exists to hold. */}
        <View style={s.secondaryRow}>
          <Press style={s.secondary} onPress={onDismiss}>
            <Text style={s.secondaryText}>Scan another</Text>
          </Press>
          <View style={s.secondaryDivider} />
          <Press style={s.secondary} onPress={onReportProblem}>
            <Text style={[s.secondaryText, { color: C.check }]}>Report a problem</Text>
          </Press>
        </View>
      </View>
    </View>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={s.provRow}>
      <Text style={s.provLabel}>{label}</Text>
      <Text style={[s.provValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  edge: { height: 3, width: '100%' },
  scroll: { paddingHorizontal: 22, paddingTop: 34, paddingBottom: 16 },

  memory: {
    borderLeftWidth: 2, paddingLeft: 14, paddingVertical: 2, marginBottom: 26,
  },
  memoryLabel: {
    color: C.check, fontSize: T.label, fontWeight: '700', letterSpacing: T.trackLabel,
  },
  memoryText: { color: C.text, fontSize: 17, lineHeight: 25, marginTop: 8 },
  memoryMeta: { color: C.text3, fontSize: 12.5, marginTop: 7 },

  verdict: {
    fontSize: T.verdict, lineHeight: T.leadVerdict, fontWeight: '800',
    letterSpacing: T.trackVerdict,
  },
  instruction: {
    color: C.text, fontSize: 18, lineHeight: 26, marginTop: 12, maxWidth: 460,
  },

  rule: { height: 1, backgroundColor: C.ruleStrong, marginVertical: 26, opacity: 0.5 },

  part: { color: C.text, fontSize: T.title, fontWeight: '700', letterSpacing: T.trackTitle },
  desc: { color: C.text2, fontSize: 15, marginTop: 3 },
  serial: { color: C.text3, fontSize: 14, marginTop: 8 },

  revRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: 28 },
  revCol: { flex: 1 },
  revDivider: { width: 1, backgroundColor: C.ruleStrong, opacity: 0.5, marginHorizontal: 18 },
  revLabel: {
    color: C.text3, fontSize: T.label, fontWeight: '700', letterSpacing: T.trackLabel,
  },
  revValue: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6, marginTop: 8 },

  chain: { color: C.text2, fontSize: 13.5, marginTop: 18 },

  caption: { color: C.text, fontSize: 16, lineHeight: 24, marginTop: 28, maxWidth: 520 },

  provenance: { marginTop: 30, borderTopWidth: 1, borderTopColor: C.rule, paddingTop: 4 },
  provRow: {
    flexDirection: 'row', paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: C.rule,
  },
  provLabel: {
    width: 104, color: C.text3, fontSize: 12, letterSpacing: 0.3, paddingTop: 1,
  },
  provValue: { flex: 1, color: C.text2, fontSize: 12.5, lineHeight: 18 },

  actions: { paddingHorizontal: 22, paddingBottom: 10, paddingTop: 12 },
  primary: {
    minHeight: 92, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryText: { color: '#08080A', fontSize: 20, fontWeight: '800', letterSpacing: 0.6 },
  primarySub: { color: '#08080A', fontSize: 12.5, opacity: 0.72, marginTop: 5 },

  secondaryRow: { flexDirection: 'row', alignItems: 'center' },
  secondary: {
    flex: 1, minHeight: GLOVE_TARGET - 16, alignItems: 'center', justifyContent: 'center',
  },
  secondaryDivider: { width: 1, height: 18, backgroundColor: C.rule },
  secondaryText: { color: C.text2, fontSize: 14.5 },
});
