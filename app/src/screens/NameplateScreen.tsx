/**
 * What the model read, before it counts for anything.
 *
 * This screen exists because perception is fallible and a compliance system
 * must not pretend otherwise. The vision model's reading is shown verbatim -
 * including the raw plate text and its confidence - and the worker confirms or
 * corrects the characters before Witness will rule on them.
 *
 * Below the confidence floor the fields start editable, because a model that is
 * unsure should be asking, not asserting.
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { C, T, MONO, GLOVE_TARGET } from '../theme';
import Press from '../components/Press';
import { NAMEPLATE_MIN_CONFIDENCE } from '../engine/resolve';
import type { NameplateReading } from '../engine/types';

interface Props {
  reading: NameplateReading | null;   // null while the model is thinking
  onConfirm: (sku: string, serial: string, confidence: number) => void;
  onRetake: () => void;
  onCancel: () => void;
}

export default function NameplateScreen({ reading, onConfirm, onRetake, onCancel }: Props) {
  const [sku, setSku] = useState(reading?.sku ?? '');
  const [serial, setSerial] = useState(reading?.serial ?? '');

  if (!reading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={C.text2} size="large" />
        <Text style={s.thinking}>Reading the plate…</Text>
        <Text style={s.thinkingSub}>this is the one step that needs signal</Text>
      </View>
    );
  }

  const pct = Math.round(reading.confidence * 100);
  const low = reading.confidence < NAMEPLATE_MIN_CONFIDENCE;
  const ready = sku.trim().length > 1 && serial.trim().length > 1;

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.label}>NAMEPLATE READING</Text>

        {reading.error ? (
          <Text style={s.error}>{reading.error}</Text>
        ) : (
          <View style={[s.confBar, low && { borderColor: C.check }]}>
            <Text style={[s.confPct, MONO, { color: low ? C.check : C.ok }]}>{pct}%</Text>
            <Text style={s.confText}>
              {low
                ? 'Not confident. Check every character against the plate.'
                : 'Confident — but confirm it before this counts.'}
            </Text>
          </View>
        )}

        {!!reading.rawText && (
          <View style={s.rawBox}>
            <Text style={s.rawLabel}>WHAT IT COULD READ</Text>
            <Text style={s.raw}>{reading.rawText}</Text>
          </View>
        )}

        <Text style={s.fieldLabel}>PART CODE</Text>
        <TextInput
          style={[s.input, low && s.inputWarn]} value={sku} onChangeText={setSku}
          autoCapitalize="characters" placeholder="e.g. GT-12" placeholderTextColor={C.text3}
        />

        <Text style={s.fieldLabel}>SERIAL</Text>
        <TextInput
          style={[s.input, low && s.inputWarn]} value={serial} onChangeText={setSerial}
          autoCapitalize="characters" placeholder="e.g. SN-4471" placeholderTextColor={C.text3}
        />

        <Text style={s.note}>
          A model read this off a photograph, so Witness will treat the result as
          advisory rather than a ruling. A scanned tag is exact; a plate is
          evidence. {reading.model ? `\n\nModel: ${reading.model}` : ''}
        </Text>
      </ScrollView>

      <View style={s.actions}>
        <Press
          style={[s.primary, !ready && s.disabled]}
          disabled={!ready}
          onPress={() => onConfirm(sku, serial, reading.confidence)}
        >
          <Text style={s.primaryText}>THAT'S RIGHT — CHECK IT</Text>
        </Press>
        <View style={s.row}>
          <Press style={s.secondary} onPress={onRetake}>
            <Text style={s.secondaryText}>Retake photo</Text>
          </Press>
          <View style={s.secondaryDivider} />
          <Press style={s.secondary} onPress={onCancel}>
            <Text style={s.secondaryText}>Cancel</Text>
          </Press>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  thinking: { color: C.text, fontSize: 19, fontWeight: '700', marginTop: 20, letterSpacing: T.trackTitle },
  thinkingSub: { color: C.text3, fontSize: 12.5, marginTop: 7 },

  scroll: { padding: 22, paddingTop: 40, paddingBottom: 30 },
  label: { color: C.text3, fontSize: T.label, fontWeight: '700', letterSpacing: T.trackLabel },

  error: {
    color: C.check, fontSize: 15, lineHeight: 22, marginTop: 16,
    paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: C.check,
  },

  /* Confidence is a figure, so it is set as one: large, tabular, with the
     caveat beside it rather than inside a bordered box. */
  confBar: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginTop: 18 },
  confPct: { fontSize: 40, fontWeight: '700', letterSpacing: -1.2, lineHeight: 42 },
  confText: { color: C.text2, fontSize: 13, flex: 1, lineHeight: 19, paddingTop: 4 },

  rawBox: { marginTop: 26, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: C.rule },
  rawLabel: { color: C.text3, fontSize: T.label, fontWeight: '700', letterSpacing: T.trackLabel },
  raw: { color: C.text, fontSize: 13, marginTop: 8, lineHeight: 20, fontFamily: 'monospace' },

  fieldLabel: {
    color: C.text3, fontSize: T.label, fontWeight: '700', letterSpacing: T.trackLabel,
    marginTop: 26, marginBottom: 9,
  },
  /* Underlined field, not a filled rounded box. It reads as something to write
     on, which is what it is. */
  input: {
    borderBottomWidth: 1, borderBottomColor: C.ruleStrong,
    color: C.text, fontSize: 24, fontWeight: '700', letterSpacing: T.trackTitle,
    paddingHorizontal: 0, minHeight: GLOVE_TARGET - 8,
  },
  inputWarn: { borderBottomColor: C.check },

  note: { color: C.text3, fontSize: 12.5, lineHeight: 19, marginTop: 28, maxWidth: 480 },

  actions: {
    paddingHorizontal: 22, paddingBottom: 10, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: C.rule,
  },
  primary: {
    minHeight: 88, borderRadius: 4, backgroundColor: C.text,
    alignItems: 'center', justifyContent: 'center',
  },
  disabled: { opacity: 0.3 },
  primaryText: { color: '#08080A', fontSize: 18, fontWeight: '800', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center' },
  secondary: {
    flex: 1, minHeight: GLOVE_TARGET - 16, alignItems: 'center', justifyContent: 'center',
  },
  secondaryDivider: { width: 1, height: 15, backgroundColor: C.rule },
  secondaryText: { color: C.text2, fontSize: 14 },
});
