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
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { C, T, severityColors, GLOVE_TARGET } from '../theme';
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

interface Props {
  resolution: Resolution;
  onConfirmNcr: () => void;
  onVerifyInstall: () => void;
  onDismiss: () => void;
}

export default function VerdictScreen({
  resolution: r, onConfirmNcr, onVerifyInstall, onDismiss,
}: Props) {
  const sev = severityOf(r.verdict);
  const col = severityColors[sev];
  const [caption, setCaption] = useState(r.templateSpeech);
  const [source, setSource] = useState<'template' | 'model'>('template');

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

  return (
    <View style={[s.root, { backgroundColor: col.bg }]}>
      <ScrollView contentContainerStyle={s.scroll}>

        {/* Memory speaks BEFORE the verdict. The whole point is to warn the
            next worker rather than report on the last one. */}
        {r.memory && (
          <View style={s.memory}>
            <Text style={s.memoryLabel}>
              WITNESS REMEMBERS · {r.memory.pattern}
            </Text>
            <Text style={s.memoryText}>{r.memory.message}</Text>
            <Text style={s.memoryMeta}>
              {r.memory.priorCount} distinct units
              {r.memory.spanDays > 0 ? ` over ${r.memory.spanDays} days` : ''}
              {r.memory.distinctWorkers > 1 ? ` · ${r.memory.distinctWorkers} people` : ''}
            </Text>
          </View>
        )}

        <Text style={[s.verdict, { color: col.fg }]}>{HEADLINE[r.verdict]}</Text>

        <Text style={s.part}>
          {r.sku}{r.description ? ` · ${r.description}` : ''}
        </Text>
        <Text style={s.serial}>{r.serial}   ·   {r.zone_id}</Text>

        {(r.installedRev || r.approvedRev) && (
          <View style={s.revRow}>
            <View style={s.revBox}>
              <Text style={s.revLabel}>SCANNED</Text>
              <Text style={[s.revValue, { color: sev === 'OK' ? C.ok : C.stop }]}>
                {r.installedRev ? `REV ${r.installedRev}` : '—'}
              </Text>
            </View>
            <View style={s.revBox}>
              <Text style={s.revLabel}>APPROVED HERE</Text>
              <Text style={[s.revValue, { color: C.ok }]}>
                {r.approvedRev ? `REV ${r.approvedRev}` : '—'}
              </Text>
            </View>
          </View>
        )}

        {r.supersededChain.length > 0 && (
          <Text style={s.chain}>
            superseded: Rev {r.installedRev} → {r.supersededChain.map(c => `Rev ${c}`).join(' → ')}
          </Text>
        )}

        <Text style={s.caption}>{caption}</Text>

        {/* Provenance is not decoration. Anyone acting on this is entitled to
            know what decided it, what merely phrased it, and how sure we are of
            each part. */}
        <View style={s.provenance}>
          <Text style={s.provText}>
            Identified by {IDENTITY[r.identity.source]}
            {r.identity.source === 'NAMEPLATE'
              ? ` · ${Math.round(r.identity.confidence * 100)}% confident`
              : ''}
          </Text>
          <Text style={s.provText}>
            Ruling: deterministic join against the approved record, on this phone.
          </Text>
          <Text style={s.provText}>
            Wording: {source === 'model' ? 'language model' : 'on-device template'}
          </Text>
          <Text style={[s.provText, (r.staleness.stale || r.staleness.clockSuspect) && { color: C.check }]}>
            {r.staleness.clockSuspect
              ? 'Record age unknown — this phone\'s clock is wrong'
              : `Record synced ${r.staleness.ageHours}h ago`} · {r.authority}
          </Text>
          {r.docRef && <Text style={s.provText}>Source: {r.docRef}</Text>}
        </View>
      </ScrollView>

      <View style={s.actions}>
        {r.requiresNcr ? (
          <Pressable style={[s.primary, { backgroundColor: C.stop }]} onPress={onConfirmNcr}>
            <Text style={s.primaryText}>CONFIRM & RAISE NCR</Text>
            {/* Nothing is filed until a human presses this. Witness drafts;
                it does not decide. */}
            <Text style={s.primarySub}>a human confirms every flag</Text>
          </Pressable>
        ) : r.verdict === 'MATCH' ? (
          <Pressable style={[s.primary, { backgroundColor: C.ok }]} onPress={onVerifyInstall}>
            <Text style={s.primaryText}>MARK FIELD-VERIFIED</Text>
            <Text style={s.primarySub}>the scan is the sign-off — no extra paperwork</Text>
          </Pressable>
        ) : (
          <Pressable style={[s.primary, { backgroundColor: C.check }]} onPress={onDismiss}>
            <Text style={s.primaryText}>SEND TO SUPERVISOR</Text>
            <Text style={s.primarySub}>Witness will not call this one</Text>
          </Pressable>
        )}

        <Pressable style={s.secondary} onPress={onDismiss} hitSlop={10}>
          <Text style={s.secondaryText}>Scan another</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 20, paddingTop: 44, paddingBottom: 12 },

  memory: {
    borderLeftWidth: 4, borderLeftColor: C.check, backgroundColor: '#00000033',
    padding: 12, borderRadius: 8, marginBottom: 20,
  },
  memoryLabel: { color: C.check, fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
  memoryText: { color: C.text, fontSize: 14, marginTop: 6, lineHeight: 20 },
  memoryMeta: { color: C.dim, fontSize: 11, marginTop: 6 },

  verdict: { fontSize: T.verdict, fontWeight: '900', letterSpacing: 1 },
  part: { color: C.text, fontSize: 18, fontWeight: '700', marginTop: 10 },
  serial: { color: C.dim, fontSize: 13, marginTop: 4, letterSpacing: 0.6 },

  revRow: { flexDirection: 'row', gap: 12, marginTop: 22 },
  revBox: { flex: 1, backgroundColor: '#00000044', borderRadius: 12, padding: 14 },
  revLabel: { color: C.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  revValue: { fontSize: 28, fontWeight: '900', marginTop: 6 },

  chain: { color: C.dim, fontSize: 12, marginTop: 12, fontStyle: 'italic' },
  caption: { color: C.text, fontSize: 16, lineHeight: 24, marginTop: 22 },

  provenance: { marginTop: 24, borderTopWidth: 1, borderTopColor: '#FFFFFF1A', paddingTop: 12, gap: 3 },
  provText: { color: C.dim, fontSize: 11 },

  actions: { padding: 16, gap: 4 },
  primary: {
    minHeight: 92, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { color: '#08110C', fontSize: 19, fontWeight: '900', letterSpacing: 1 },
  primarySub: { color: '#08110CBB', fontSize: 11, marginTop: 4 },
  secondary: { minHeight: GLOVE_TARGET - 16, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: C.text, fontSize: 14, opacity: 0.8 },
});
