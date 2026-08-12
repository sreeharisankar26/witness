/**
 * REPORT A PROBLEM
 *
 * The record knows which revision was approved. It does not know that this
 * particular unit arrived with a cracked housing, or that the pallet contained
 * something nobody ordered. Only the worker standing in front of it knows that,
 * and until now there was nowhere for them to say so.
 *
 * Two rules this screen holds to:
 *
 *   1. It never produces a verdict. Everything here is testimony — attributed,
 *      timestamped, and clearly separated from anything the engine ruled on.
 *      A worker's note is evidence for a human, not an input to the safety path.
 *
 *   2. It never waits for the network. The note is written locally and queued,
 *      exactly like an NCR. A worker in a basement plant room with no signal
 *      must be able to file this and walk away.
 *
 * Sized for gloves and sunlight like every other screen: big targets, few
 * words, one decision at a time.
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { C, T, MONO, GLOVE_TARGET } from '../theme';
import Press from '../components/Press';
import type { ReportKind } from '../data/db';

interface Props {
  serial: string;
  sku: string;
  zoneName: string;
  worker: string;
  onSubmit: (kind: ReportKind, note: string) => void;
  onCancel: () => void;
}

/**
 * Three kinds, not ten.
 *
 * A long list on a phone in the sun is a list nobody reads, and the difference
 * that actually matters downstream is only this: is the part broken, is it the
 * wrong part, or is it something a human needs to read. The first two feed the
 * reorder and return lists; the third is filed for a supervisor.
 */
const KINDS: { kind: ReportKind; label: string; blurb: string; colour: string }[] = [
  {
    kind: 'DAMAGED', label: 'Damaged', colour: C.stop,
    blurb: 'Arrived or became unusable. Goes straight onto the reorder list.',
  },
  {
    kind: 'WRONG_ITEM', label: 'Wrong item delivered', colour: C.check,
    blurb: 'Not what was ordered. Enough of these on one part means a mis-order, not a mistake.',
  },
  {
    kind: 'OTHER', label: 'Something else', colour: C.text,
    blurb: 'Anything a supervisor should read. Does not change any verdict.',
  },
];

export default function ReportScreen({
  serial, sku, zoneName, worker, onSubmit, onCancel,
}: Props) {
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [note, setNote] = useState('');

  const chosen = KINDS.find(k => k.kind === kind);
  // A note is required for OTHER — an unexplained "something else" helps nobody.
  const canSend = Boolean(kind) && (kind !== 'OTHER' || note.trim().length > 2);

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.eyebrow}>REPORT A PROBLEM</Text>
        <Text style={s.part}>{sku}</Text>
        <Text style={[s.serial, MONO]}>{serial}</Text>
        <Text style={s.where}>{zoneName}</Text>

        <View style={s.divider} />

        <Text style={s.q}>What's wrong with it?</Text>
        {KINDS.map(k => {
          const on = kind === k.kind;
          return (
            <Press
              key={k.kind}
              style={s.kind}
              depth={0.99}
              onPress={() => setKind(k.kind)}
              accessibilityRole="radio"
            >
              <View style={[s.mark, { backgroundColor: on ? k.colour : C.ruleStrong }]} />
              <View style={s.kindText}>
                <Text style={[s.kindLabel, on && { color: k.colour }]}>{k.label}</Text>
                <Text style={s.kindBlurb}>{k.blurb}</Text>
              </View>
            </Press>
          );
        })}

        <Text style={s.q}>
          What happened?{' '}
          <Text style={s.optional}>{kind === 'OTHER' ? '(required)' : '(optional, but useful)'}</Text>
        </Text>
        <Text style={s.hint}>
          In your words. This is the part the record cannot work out for itself —
          a supervisor reads it exactly as you write it.
        </Text>
        <TextInput
          style={s.note}
          placeholder="e.g. Housing cracked on the flange side, found it that way in the crate"
          placeholderTextColor={C.text3}
          value={note}
          onChangeText={setNote}
          multiline
          textAlignVertical="top"
          maxLength={500}
        />

        <Text style={s.attrib}>Filed as {worker}. Your name stays on this.</Text>

        <Press
          style={[s.send, { backgroundColor: canSend ? (chosen?.colour ?? C.text) : C.rule }]}
          disabled={!canSend}
          onPress={() => onSubmit(kind!, note)}
        >
          <Text style={[s.sendText, !canSend && { color: C.text3 }]}>
            {canSend ? 'FILE THIS REPORT' : 'PICK WHAT IS WRONG'}
          </Text>
        </Press>

        <Press style={s.cancel} onPress={onCancel}>
          <Text style={s.cancelText}>Cancel</Text>
        </Press>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 22, paddingBottom: 44 },

  eyebrow: { color: C.text3, fontSize: T.label, fontWeight: '700', letterSpacing: T.trackLabel },
  part: {
    color: C.text, fontSize: T.display, fontWeight: '800',
    letterSpacing: T.trackDisplay, marginTop: 12,
  },
  serial: { color: C.text2, fontSize: 16, marginTop: 4 },
  where: { color: C.text3, fontSize: 13.5, marginTop: 6 },

  divider: { height: 1, backgroundColor: C.rule, marginVertical: 26 },

  q: { color: C.text, fontSize: 19, fontWeight: '600', letterSpacing: T.trackTitle, marginTop: 6 },
  optional: { color: C.text3, fontSize: 14, fontWeight: '500' },
  hint: { color: C.text3, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 14, maxWidth: 460 },

  /* A ruled list with a colour mark on the left, not three bordered cards.
     Selection is shown by the mark and the label colour — the row does not
     need to grow a box around itself to say it is chosen. */
  kind: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    minHeight: GLOVE_TARGET, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.rule,
  },
  mark: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  kindText: { flex: 1 },
  kindLabel: { color: C.text, fontSize: 18, fontWeight: '600', letterSpacing: T.trackTitle },
  kindBlurb: { color: C.text3, fontSize: 13, lineHeight: 19, marginTop: 5 },

  note: {
    borderBottomWidth: 1, borderBottomColor: C.ruleStrong,
    color: C.text, fontSize: 16, lineHeight: 24, paddingHorizontal: 0,
    paddingTop: 10, paddingBottom: 14, minHeight: 120,
  },

  attrib: { color: C.text3, fontSize: 12.5, marginTop: 18, marginBottom: 22 },

  send: {
    minHeight: 88, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
  },
  sendText: { color: '#08080A', fontSize: 18, fontWeight: '800', letterSpacing: 0.6 },

  cancel: { minHeight: 56, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  cancelText: { color: C.text3, fontSize: 15 },
});
