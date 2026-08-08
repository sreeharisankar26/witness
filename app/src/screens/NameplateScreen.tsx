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
  View, Text, Pressable, TextInput, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { C, T, GLOVE_TARGET } from '../theme';
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
        <ActivityIndicator color={C.accent} size="large" />
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
            <Text style={[s.confPct, { color: low ? C.check : C.ok }]}>{pct}%</Text>
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
          autoCapitalize="characters" placeholder="e.g. GT-12" placeholderTextColor={C.dim}
        />

        <Text style={s.fieldLabel}>SERIAL</Text>
        <TextInput
          style={[s.input, low && s.inputWarn]} value={serial} onChangeText={setSerial}
          autoCapitalize="characters" placeholder="e.g. SN-4471" placeholderTextColor={C.dim}
        />

        <Text style={s.note}>
          A model read this off a photograph, so Witness will treat the result as
          advisory rather than a ruling. A scanned tag is exact; a plate is
          evidence. {reading.model ? `\n\nModel: ${reading.model}` : ''}
        </Text>
      </ScrollView>

      <View style={s.actions}>
        <Pressable
          style={[s.primary, !ready && s.disabled]}
          disabled={!ready}
          onPress={() => onConfirm(sku, serial, reading.confidence)}
        >
          <Text style={s.primaryText}>THAT'S RIGHT — CHECK IT</Text>
        </Pressable>
        <View style={s.row}>
          <Pressable style={s.secondary} onPress={onRetake}>
            <Text style={s.secondaryText}>Retake photo</Text>
          </Pressable>
          <Pressable style={s.secondary} onPress={onCancel}>
            <Text style={s.secondaryText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  thinking: { color: C.text, fontSize: 18, fontWeight: '700', marginTop: 18 },
  thinkingSub: { color: C.dim, fontSize: 12, marginTop: 6 },

  scroll: { padding: 20, paddingTop: 40 },
  label: { color: C.dim, fontSize: 11, fontWeight: '900', letterSpacing: 1.8 },

  error: {
    color: C.check, fontSize: 15, lineHeight: 22, marginTop: 14,
    backgroundColor: C.checkBg, padding: 14, borderRadius: 10,
  },

  confBar: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14,
    borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14,
  },
  confPct: { fontSize: 30, fontWeight: '900' },
  confText: { color: C.dim, fontSize: 12, flex: 1, lineHeight: 18 },

  rawBox: {
    backgroundColor: C.card, borderRadius: 10, padding: 14, marginTop: 16,
    borderLeftWidth: 3, borderLeftColor: C.accent,
  },
  rawLabel: { color: C.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  raw: { color: C.text, fontSize: 13, marginTop: 8, lineHeight: 20, fontFamily: 'monospace' },

  fieldLabel: { color: C.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginTop: 20, marginBottom: 8 },
  input: {
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.line,
    color: C.text, fontSize: 20, fontWeight: '700', paddingHorizontal: 16, minHeight: GLOVE_TARGET,
  },
  inputWarn: { borderColor: C.check },

  note: { color: C.dim, fontSize: 11.5, lineHeight: 18, marginTop: 22 },

  actions: { padding: 16, gap: 8 },
  primary: {
    minHeight: 88, borderRadius: 16, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
  primaryText: { color: '#04101F', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  row: { flexDirection: 'row', gap: 8 },
  secondary: {
    flex: 1, minHeight: GLOVE_TARGET - 16, alignItems: 'center', justifyContent: 'center',
  },
  secondaryText: { color: C.dim, fontSize: 14 },
});
