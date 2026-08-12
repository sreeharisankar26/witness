/**
 * The scan, and the fallback ladder beneath it.
 *
 *    1. QR tag            exact, offline, instant
 *    2. Nameplate         vision model reads the plate  <- needs signal
 *    3. Type it in        always works
 *
 * A worker is never dead-ended. Most site equipment has no machine-readable
 * code at all, which is why rung 2 exists and why it is the only place in
 * Witness where a model touches the flow.
 *
 * The layout is a readout, not a landing page: what the app currently believes
 * — where you are, who you are, how old the record is, what has not synced —
 * stated plainly in a column, with one enormous action at the bottom under the
 * thumb. Nothing is centred, nothing floats in a card, and the only colour on
 * screen belongs to a status that has earned it.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Modal, Linking, Animated,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { C, T, MONO, GLOVE_TARGET, SPRING } from '../theme';
import Press from '../components/Press';
import { parseTag, TagParseError } from '../engine/resolve';
import type { ScannedTag } from '../engine/types';

interface Props {
  zoneId: string;
  zoneName: string;
  worker: string;
  pending: number;
  online: boolean;
  /** Radio on AND server answering. The header reflects THIS, not the radio. */
  serverReachable: boolean;
  syncedLabel: string;
  syncStale: boolean;
  onZonePress: () => void;
  onScanned: (tag: ScannedTag) => void;
  onNameplate: (base64: string) => void;
  onManualEntry: () => void;
  /** Long-press the brand mark. Reseeds the device between takes. */
  onReset: () => void;
  /** Where queued writes are being sent, and why they are not landing. */
  syncServer: string;
  syncError: string | null;
  onTestSync: () => void;
}

type Mode = 'closed' | 'tag' | 'plate';

export default function ScanScreen({
  zoneId, zoneName, worker, pending, online, serverReachable, syncedLabel, syncStale,
  onZonePress, onScanned, onNameplate, onManualEntry, onReset,
  syncServer, syncError, onTestSync,
}: Props) {
  useKeepAwake();
  const [perm, requestPerm] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('closed');
  const [torch, setTorch] = useState(false);
  const [badScan, setBadScan] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);
  const locked = useRef(false);       // one verdict per opening of the camera
  const cam = useRef<CameraView>(null);

  useEffect(() => { if (!perm?.granted) requestPerm(); }, [perm?.granted]);

  const open = (m: Mode) => {
    locked.current = false; setBadScan(null); setShooting(false); setMode(m);
  };

  const handleTag = ({ data }: { data: string }) => {
    if (locked.current || mode !== 'tag') return;
    locked.current = true;
    try {
      const tag = parseTag(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMode('closed');
      onScanned(tag);
    } catch (e) {
      // Not one of ours. Say so plainly and let them try again - never
      // half-interpret an unknown code.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setBadScan(e instanceof TagParseError ? 'Not a Witness tag' : 'Unreadable code');
      setTimeout(() => { locked.current = false; setBadScan(null); }, 1800);
    }
  };

  const shootPlate = async () => {
    if (shooting || !cam.current) return;
    setShooting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cam.current.takePictureAsync({
        base64: true, quality: 0.6, skipProcessing: true,
      });
      setMode('closed');
      if (photo?.base64) onNameplate(photo.base64);
    } catch {
      setBadScan('Camera failed. Type the serial in instead.');
    } finally {
      setShooting(false);
    }
  };

  // Permission denied is a dead end unless we say what to do about it.
  const denied = perm && !perm.granted && !perm.canAskAgain;

  const statusColour = !online ? C.text3 : serverReachable ? C.ok : C.stop;
  const statusText = !online ? 'OFFLINE' : serverReachable ? 'ONLINE' : 'NO SERVER';

  return (
    <View style={s.root}>
      {/* ── header: where, and what the connection actually is ───────────── */}
      <View style={s.header}>
        <Press style={s.zoneBtn} onPress={onZonePress} depth={0.99} hitSlop={16}>
          <Text style={s.label}>WORKING IN</Text>
          <Text style={s.zoneName}>{zoneName}</Text>
          <Text style={s.zoneChange}>Tap to change</Text>
        </Press>
        {/* Three states, not two. "ONLINE" used to mean only that the radio was
            on, so the header could read ONLINE directly above "can't reach the
            server" — technically true, and useless. */}
        <View style={s.status}>
          <View style={s.statusRow}>
            <View style={[s.dot, { backgroundColor: statusColour }]} />
            <Text style={s.statusText}>{statusText}</Text>
          </View>
          {pending > 0 && (
            <Text style={[s.pending, MONO]}>{pending} queued</Text>
          )}
        </View>
      </View>

      <View style={s.rule} />

      {/* ── the readout ──────────────────────────────────────────────────── */}
      <View style={s.middle}>
        <Pressable onLongPress={onReset} delayLongPress={2500}>
          <Text style={s.brand}>WITNESS</Text>
        </Pressable>
        <Text style={s.prompt}>Scan the tag on the part before you fix it.</Text>

        <View style={s.facts}>
          {/* Freshness is always on screen. A verdict from a stale record is the
              most dangerous thing this app can produce, so we never hide its
              age. */}
          <Fact label="RECORD" value={syncedLabel} tone={syncStale ? C.check : undefined} />
          <Fact label="SIGNED IN" value={worker} />
        </View>

        {/* A queue that will not drain used to be silent. Now it says exactly
            where it is trying to post and what went wrong — that is the
            difference between a two-minute fix and an evening lost. */}
        {(pending > 0 || syncError) && (
          <Press style={s.syncBox} onPress={onTestSync} depth={0.99}>
            <Text style={s.syncTitle}>
              {syncError ? "CAN'T REACH THE SITE SERVER" : `${pending} WAITING TO SYNC`}
            </Text>
            <Text style={s.syncBody}>{syncError || `Sending to ${syncServer}`}</Text>
            <Text style={s.syncHint}>Tap to test the connection</Text>
          </Press>
        )}
      </View>

      {/* ── the action ───────────────────────────────────────────────────── */}
      {denied ? (
        <Press style={[s.scanBtn, { backgroundColor: C.check }]}
               onPress={() => Linking.openSettings()} depth={0.985}>
          <Text style={s.scanBtnText}>ENABLE CAMERA</Text>
        </Press>
      ) : (
        <Press style={s.scanBtn} onPress={() => open('tag')} depth={0.985}
               accessibilityLabel="Scan a part">
          <Text style={s.scanBtnText}>SCAN</Text>
        </Press>
      )}

      <View style={s.ladder}>
        <Press style={s.rung} onPress={() => open('plate')} depth={0.98}>
          <Text style={s.rungText}>No tag? Read the nameplate</Text>
        </Press>
        <View style={s.rungDivider} />
        <Press style={s.rung} onPress={onManualEntry} depth={0.98}>
          <Text style={s.rungText}>Type it in</Text>
        </Press>
      </View>

      {/* ── camera ───────────────────────────────────────────────────────── */}
      <Modal visible={mode !== 'closed'} animationType="fade"
             onRequestClose={() => setMode('closed')}>
        <View style={s.camWrap}>
          {perm?.granted ? (
            <CameraView
              ref={cam}
              style={StyleSheet.absoluteFill}
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'datamatrix', 'code128'] }}
              onBarcodeScanned={mode === 'tag' ? handleTag : undefined}
            />
          ) : (
            <View style={s.center}><ActivityIndicator color={C.text} /></View>
          )}

          {/* Corner marks, not a full rectangle. They frame without covering,
              and they read as a viewfinder rather than as a border. */}
          <View style={s.reticle} pointerEvents="none">
            {(['tl', 'tr', 'bl', 'br'] as const).map(k => (
              <View key={k} style={[s.corner, s[k], badScan ? { borderColor: C.stop } : null]} />
            ))}
          </View>

          <View style={s.camTop}>
            <Text style={[s.camHint, badScan ? { color: C.stop } : null]}>
              {badScan ? badScan
                : mode === 'tag' ? 'Hold the tag in the frame'
                  : 'Frame the nameplate — get close, keep it square'}
            </Text>
            {mode === 'plate' && !badScan && (
              <Text style={s.camSub}>a model reads it · you confirm before anything is filed</Text>
            )}
          </View>

          <View style={s.camBottom}>
            <Press style={s.camBtn} onPress={() => setTorch(t => !t)}>
              <Text style={s.camBtnText}>{torch ? 'LIGHT ON' : 'LIGHT'}</Text>
            </Press>
            {mode === 'plate' && (
              <Press style={[s.camBtn, s.shoot]} onPress={shootPlate} disabled={shooting}>
                <Text style={[s.camBtnText, { color: '#08080A' }]}>
                  {shooting ? 'READING…' : 'READ PLATE'}
                </Text>
              </Press>
            )}
            <Press style={s.camBtn} onPress={() => setMode('closed')}>
              <Text style={s.camBtnText}>CANCEL</Text>
            </Press>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={[s.factValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 22 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', paddingTop: 10, paddingBottom: 14,
  },
  zoneBtn: { paddingVertical: 2 },
  label: { color: C.text3, fontSize: T.label, letterSpacing: T.trackLabel, fontWeight: '700' },
  zoneName: {
    color: C.text, fontSize: 21, fontWeight: '700', letterSpacing: T.trackTitle, marginTop: 5,
  },
  zoneChange: { color: C.text3, fontSize: 12, marginTop: 4 },

  status: { alignItems: 'flex-end', paddingVertical: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: C.text2, fontSize: T.label, fontWeight: '700', letterSpacing: T.trackLabel },
  pending: { color: C.check, fontSize: 12, marginTop: 6 },

  rule: { height: 1, backgroundColor: C.rule },

  middle: { flex: 1, justifyContent: 'center' },
  brand: {
    color: C.text, fontSize: 42, fontWeight: '800', letterSpacing: -1.4,
  },
  prompt: { color: C.text2, fontSize: 17, lineHeight: 25, marginTop: 12, maxWidth: 320 },

  facts: { marginTop: 34, borderTopWidth: 1, borderTopColor: C.rule },
  fact: {
    flexDirection: 'row', alignItems: 'baseline', paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: C.rule,
  },
  factLabel: {
    width: 92, color: C.text3, fontSize: T.label, fontWeight: '700', letterSpacing: T.trackLabel,
  },
  factValue: { flex: 1, color: C.text2, fontSize: 13.5 },

  syncBox: {
    marginTop: 22, paddingLeft: 14, paddingVertical: 4,
    borderLeftWidth: 2, borderLeftColor: C.check,
  },
  syncTitle: { color: C.check, fontSize: T.label, fontWeight: '800', letterSpacing: T.trackLabel },
  syncBody: { color: C.text, fontSize: 13, marginTop: 6, lineHeight: 19 },
  syncHint: { color: C.text3, fontSize: 11.5, marginTop: 7 },

  scanBtn: {
    height: 120, borderRadius: 4, backgroundColor: C.text,
    alignItems: 'center', justifyContent: 'center',
  },
  scanBtnText: {
    color: '#08080A', fontSize: 32, fontWeight: '800', letterSpacing: 1,
  },

  ladder: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    minHeight: 58, marginBottom: 4,
  },
  rung: { paddingVertical: 14, paddingHorizontal: 14 },
  rungText: { color: C.text2, fontSize: 13.5 },
  rungDivider: { width: 1, height: 15, backgroundColor: C.rule },

  camWrap: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  reticle: { position: 'absolute', top: '25%', left: '9%', right: '9%', height: '38%' },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: '#FFFFFFCC' },
  tl: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2 },
  tr: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2 },
  br: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2 },

  camTop: { position: 'absolute', top: 58, left: 22, right: 22, gap: 7 },
  camHint: { color: '#fff', fontSize: 16, fontWeight: '600' },
  camSub: { color: '#FFFFFF99', fontSize: 12 },

  camBottom: {
    position: 'absolute', bottom: 38, left: 18, right: 18, flexDirection: 'row', gap: 10,
  },
  camBtn: {
    flex: 1, minHeight: GLOVE_TARGET, borderRadius: 4, backgroundColor: '#FFFFFF1C',
    alignItems: 'center', justifyContent: 'center',
  },
  shoot: { flex: 1.7, backgroundColor: C.text },
  camBtnText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1.1 },
});
