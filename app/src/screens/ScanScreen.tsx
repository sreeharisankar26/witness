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
 * One button, bottom third, thumb-reachable. Camera opens on tap and closes the
 * instant it reads a tag - median session under eight seconds, which is what
 * keeps the phone cool and the battery alive across a shift.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Modal, Linking,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { C, T, GLOVE_TARGET } from '../theme';
import { parseTag, TagParseError } from '../engine/resolve';
import type { ScannedTag } from '../engine/types';

interface Props {
  zoneId: string;
  zoneName: string;
  worker: string;
  pending: number;
  online: boolean;
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
  zoneId, zoneName, worker, pending, online, syncedLabel, syncStale,
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

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={onZonePress} hitSlop={16} style={s.zoneBtn}>
          <Text style={s.zoneLabel}>WORKING IN</Text>
          <Text style={s.zoneName}>{zoneName}</Text>
          <Text style={s.zoneChange}>tap to change</Text>
        </Pressable>
        <View style={s.status}>
          <View style={[s.dot, { backgroundColor: online ? C.ok : C.check }]} />
          <Text style={s.statusText}>{online ? 'ONLINE' : 'OFFLINE'}</Text>
          {pending > 0 && <Text style={s.pending}>{pending} queued</Text>}
        </View>
      </View>

      <View style={s.middle}>
        <Pressable onLongPress={onReset} delayLongPress={2500}>
          <Text style={s.brand}>WITNESS</Text>
        </Pressable>
        <Text style={s.prompt}>Scan the tag on the part{'\n'}before you fix it.</Text>
        {/* Freshness is always on screen. A verdict from a stale record is the
            most dangerous thing this app can produce, so we never hide its age. */}
        <Text style={[s.synced, syncStale && { color: C.check }]}>
          approved record {syncedLabel}
        </Text>
        <Text style={s.worker}>signed in as {worker}</Text>

        {/* A queue that will not drain used to be silent. Now it says exactly
            where it is trying to post and what went wrong — that is the
            difference between a two-minute fix and an evening lost. */}
        {(pending > 0 || syncError) && (
          <Pressable onPress={onTestSync} style={s.syncBox}>
            <Text style={s.syncTitle}>
              {syncError ? "CAN'T REACH THE SITE SERVER" : `${pending} waiting to sync`}
            </Text>
            <Text style={s.syncBody}>{syncError || `sending to ${syncServer}`}</Text>
            <Text style={s.syncHint}>tap to test the connection</Text>
          </Pressable>
        )}
      </View>

      {denied ? (
        <Pressable style={[s.scanBtn, { backgroundColor: C.check }]}
                   onPress={() => Linking.openSettings()}>
          <Text style={s.scanBtnText}>ENABLE CAMERA</Text>
        </Pressable>
      ) : (
        <Pressable style={s.scanBtn} onPress={() => open('tag')} accessibilityLabel="Scan a part">
          <Text style={s.scanBtnText}>SCAN</Text>
        </Pressable>
      )}

      <View style={s.ladder}>
        <Pressable style={s.rung} onPress={() => open('plate')} hitSlop={8}>
          <Text style={s.rungText}>No tag? Read the nameplate</Text>
        </Pressable>
        <Text style={s.rungDiv}>·</Text>
        <Pressable style={s.rung} onPress={onManualEntry} hitSlop={8}>
          <Text style={s.rungText}>Type it in</Text>
        </Pressable>
      </View>

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
            <View style={s.center}><ActivityIndicator color={C.accent} /></View>
          )}

          <View style={[s.reticle, mode === 'plate' && { borderColor: C.accent }]}
                pointerEvents="none" />

          <View style={s.camTop}>
            <Text style={s.camHint}>
              {badScan ? badScan
                : mode === 'tag' ? 'Hold the tag in the frame'
                  : 'Frame the nameplate — get close, keep it square'}
            </Text>
            {mode === 'plate' && !badScan && (
              <Text style={s.camSub}>a model reads it · you confirm before anything is filed</Text>
            )}
          </View>

          <View style={s.camBottom}>
            <Pressable style={s.camBtn} onPress={() => setTorch(t => !t)}>
              <Text style={s.camBtnText}>{torch ? 'LIGHT ON' : 'LIGHT'}</Text>
            </Pressable>
            {mode === 'plate' && (
              <Pressable style={[s.camBtn, s.shoot]} onPress={shootPlate} disabled={shooting}>
                <Text style={[s.camBtnText, { color: '#04101F' }]}>
                  {shooting ? 'READING…' : 'READ PLATE'}
                </Text>
              </Pressable>
            )}
            <Pressable style={[s.camBtn, s.camCancel]} onPress={() => setMode('closed')}>
              <Text style={s.camBtnText}>CANCEL</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: 8 },
  zoneBtn: { paddingVertical: 8 },
  zoneLabel: { color: C.dim, fontSize: T.label, letterSpacing: 1.4, fontWeight: '700' },
  zoneName: { color: C.text, fontSize: 20, fontWeight: '800', marginTop: 2 },
  zoneChange: { color: C.accent, fontSize: 11, marginTop: 2 },
  status: { alignItems: 'flex-end', paddingVertical: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, marginBottom: 4 },
  statusText: { color: C.dim, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  pending: { color: C.check, fontSize: 11, marginTop: 2 },

  middle: { flex: 1, justifyContent: 'center' },
  brand: { color: C.text, fontSize: 40, fontWeight: '900', letterSpacing: 6 },
  prompt: { color: C.dim, fontSize: T.body, marginTop: 14, lineHeight: 24 },
  synced: { color: C.dim, fontSize: 12, marginTop: 24, opacity: 0.8 },
  worker: { color: C.dim, fontSize: 11, marginTop: 6, opacity: 0.6 },
  syncBox: {
    marginTop: 18, padding: 12, borderRadius: 10,
    backgroundColor: '#00000055', borderLeftWidth: 3, borderLeftColor: C.check,
  },
  syncTitle: { color: C.check, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  syncBody: { color: C.text, fontSize: 12, marginTop: 5, lineHeight: 17 },
  syncHint: { color: C.dim, fontSize: 10.5, marginTop: 6 },

  scanBtn: {
    height: 128, borderRadius: 20, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  scanBtnText: { color: '#04101F', fontSize: 34, fontWeight: '900', letterSpacing: 4 },

  ladder: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    minHeight: 56, marginBottom: 6, gap: 10,
  },
  rung: { paddingVertical: 12, paddingHorizontal: 4 },
  rungText: { color: C.dim, fontSize: 13, textDecorationLine: 'underline' },
  rungDiv: { color: C.line, fontSize: 13 },

  camWrap: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reticle: {
    position: 'absolute', top: '26%', left: '10%', right: '10%', height: '36%',
    borderWidth: 3, borderColor: '#FFFFFFAA', borderRadius: 18,
  },
  camTop: { position: 'absolute', top: 56, left: 0, right: 0, alignItems: 'center', gap: 6 },
  camHint: {
    color: '#fff', fontSize: 15, fontWeight: '600',
    backgroundColor: '#000000AA', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
  },
  camSub: {
    color: '#FFFFFFAA', fontSize: 11,
    backgroundColor: '#00000088', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
  },
  camBottom: {
    position: 'absolute', bottom: 40, left: 16, right: 16, flexDirection: 'row', gap: 10,
  },
  camBtn: {
    flex: 1, minHeight: GLOVE_TARGET, borderRadius: 14, backgroundColor: '#FFFFFF22',
    alignItems: 'center', justifyContent: 'center',
  },
  shoot: { flex: 1.6, backgroundColor: C.accent },
  camCancel: { backgroundColor: '#FFFFFF11' },
  camBtnText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1.2 },
});
