/**
 * WITNESS
 *
 * The loop: identify -> resolve -> speak -> a human confirms -> queue -> sync.
 *
 * Two properties this file must never lose:
 *   1. It never awaits the network before showing a verdict.
 *   2. It reloads the record after every write. The engine is pure, so it only
 *      knows what it is handed - forgetting this froze the memory counter at
 *      whatever it was when the app launched.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, Modal, TextInput, StyleSheet, ScrollView, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import ScanScreen from './src/screens/ScanScreen';
import VerdictScreen from './src/screens/VerdictScreen';
import NameplateScreen from './src/screens/NameplateScreen';
import ReportScreen from './src/screens/ReportScreen';
import { C, T, MONO, GLOVE_TARGET } from './src/theme';
import Press from './src/components/Press';
import { resolve, parseTag, tagFrom } from './src/engine/resolve';
import type {
  RecordSnapshot, Resolution, ScannedTag, NameplateReading, Zone,
} from './src/engine/types';
import {
  ensureSeeded, loadSnapshot, logEvent, commitNcr, recordVerifiedInstall,
  commitReport, pendingCount, getWorker, setWorker, resetAll, touchSync,
} from './src/data/db';
import type { ReportKind } from './src/data/db';
import { drain, isOnline, startAutoSync, pingServer, SERVER } from './src/sync/outbox';
import { readNameplate } from './src/vision/nameplate';

const CREW = ['M. Nair', 'P. Singh', 'A. Kumar', 'S. Harisankar'];

type Screen = 'scan' | 'verdict' | 'nameplate' | 'report';

export default function App() {
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<RecordSnapshot | null>(null);
  const [screen, setScreen] = useState<Screen>('scan');
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [reading, setReading] = useState<NameplateReading | null>(null);
  const [zoneId, setZoneId] = useState('ZONE-A');
  const [zonePicker, setZonePicker] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualSku, setManualSku] = useState('');
  const [manualSerial, setManualSerial] = useState('');
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(false);
  const [serverReachable, setServerReachable] = useState(false);
  const [worker, setWorkerState] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const zones: Zone[] = snapshot?.zones ?? [];
  const zoneName = zones.find(z => z.id === zoneId)?.name ?? zoneId;

  /** Single source of truth for "what does the engine know right now". */
  const refresh = useCallback(async () => {
    setSnapshot(await loadSnapshot());
    setPending(await pendingCount());
  }, []);

  useEffect(() => {
    (async () => {
      await ensureSeeded();
      await refresh();
      setWorkerState(await getWorker());
      setOnline(await isOnline());
      setReady(true);
    })();
    const stop = startAutoSync(r => {
      setPending(r.pending); setOnline(r.online);
      setServerReachable(r.serverReachable); setSyncError(r.lastError);
    });
    const t = setInterval(async () => setOnline(await isOnline()), 4000);
    return () => { stop(); clearInterval(t); };
  }, [refresh]);

  /**
   * The hot path. No `await fetch` anywhere in it - a scan resolves against the
   * in-memory snapshot and renders immediately.
   */
  const onScanned = useCallback(async (tag: ScannedTag) => {
    if (!snapshot) return;
    const r = resolve(snapshot, tag, zoneId, { now: new Date().toISOString() });
    setResolution(r);
    setScreen('verdict');
    logEvent('SCAN', {
      tag, zoneId, verdict: r.verdict, authority: r.authority,
      identity: r.identity,
    });
  }, [snapshot, zoneId]);

  /** Rung 2 of the ladder: a model reads the plate, then a human confirms it. */
  const onNameplate = useCallback(async (base64: string) => {
    setReading(null);
    setScreen('nameplate');
    const result = await readNameplate(base64);
    setReading(result);
    logEvent('NAMEPLATE_READ', {
      ok: result.ok, confidence: result.confidence, model: result.model,
      sku: result.sku, serial: result.serial,
    });
  }, []);

  const onNameplateConfirmed = useCallback(
    async (sku: string, serial: string, confidence: number) => {
      // Source stays NAMEPLATE even though a human approved the characters -
      // the identification still originated from perception, and the verdict
      // stays advisory because of it.
      await onScanned(tagFrom(sku, serial, 'NAMEPLATE', confidence));
    }, [onScanned]);

  const onConfirmNcr = useCallback(async () => {
    if (!resolution || !worker) return;
    const ncr = await commitNcr(resolution, worker);
    await refresh();                 // memory must see the NCR just written
    drain().then(r => {
      setPending(r.pending); setOnline(r.online);
      setServerReachable(r.serverReachable); setSyncError(r.lastError);
    });
    Alert.alert(
      `${ncr.id} raised`,
      online
        ? 'Sent to the site record.'
        : 'Saved on this phone. It will sync by itself when you get signal.',
    );
    setScreen('scan');
  }, [resolution, online, worker, refresh]);

  const onVerifyInstall = useCallback(async () => {
    if (!resolution || !worker) return;
    await recordVerifiedInstall(resolution, worker);
    await refresh();
    drain().then(r => {
      setPending(r.pending); setOnline(r.online);
      setServerReachable(r.serverReachable); setSyncError(r.lastError);
    });
    setScreen('scan');
  }, [resolution, worker, refresh]);

  /**
   * Testimony, not adjudication.
   *
   * Deliberately does NOT call refresh() the way NCR confirmation does. A
   * worker's note changes nothing the engine reasons about, so re-reading the
   * snapshot would imply it might. It queues, it syncs, a human reads it.
   */
  const onSubmitReport = useCallback(async (kind: ReportKind, note: string) => {
    if (!resolution || !worker) return;
    const report = await commitReport(
      { serial: resolution.serial, sku: resolution.sku, zoneId: resolution.zone_id },
      kind, note, worker,
    );
    setPending(await pendingCount());
    drain().then(r => {
      setPending(r.pending); setOnline(r.online);
      setServerReachable(r.serverReachable); setSyncError(r.lastError);
    });
    Alert.alert(
      'Report filed',
      (kind === 'DAMAGED'
        ? `${report.sku} ${report.serial} is on the reorder list.`
        : kind === 'WRONG_ITEM'
          ? `Logged. If more of this part turn up at the same revision, the site record will call it a mis-order.`
          : 'Logged for your supervisor.')
      + (online ? '' : '\n\nSaved on this phone — it will sync by itself when you get signal.'),
    );
    setScreen('scan');
  }, [resolution, worker, online]);

  /** Tap the sync warning to find out precisely what is wrong. */
  const onTestSync = useCallback(async () => {
    const p = await pingServer();
    const r = await drain();
    setPending(r.pending); setOnline(r.online);
    setServerReachable(p.ok); setSyncError(r.lastError);
    Alert.alert(
      p.ok ? 'Site server reachable' : 'Cannot reach the site server',
      p.ok
        ? `${p.detail}\n\n${r.sent} sent, ${r.pending} still waiting.`
        : `${p.detail}\n\nCheck: the phone and laptop are on the same wifi, the sync server is running, and Windows Firewall is allowing Node on private networks.\n\nIf you changed the address in the control panel, restart the app — this value is baked in when the app starts.`,
    );
  }, []);

  const submitManual = useCallback(async () => {
    try {
      const tag = parseTag(`WTNS:1|${manualSku.trim()}|${manualSerial.trim()}`);
      setManual(false); setManualSku(''); setManualSerial('');
      await onScanned({ ...tag, source: 'MANUAL', confidence: 1 });
    } catch {
      Alert.alert('Check the entry', 'Enter the part code and serial exactly as printed on the tag.');
    }
  }, [manualSku, manualSerial, onScanned]);

  const onReset = useCallback(() => {
    Alert.alert(
      'Reset this device?',
      'Wipes local scans, NCRs and the queue, then reloads the approved record. Used between takes.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset', style: 'destructive',
          onPress: async () => {
            await resetAll();
            await refresh();
            setScreen('scan');
          },
        },
      ],
    );
  }, [refresh]);

  const syncedLabel = (() => {
    if (!snapshot) return '';
    const ms = Date.now() - Date.parse(snapshot.record_synced_at);
    if (!Number.isFinite(ms)) return 'never synced';
    if (ms < 0) return 'clock disagrees — treat as advisory';
    const h = ms / 36e5;
    if (h < 1) return 'synced just now';
    if (h < 48) return `synced ${Math.round(h)}h ago`;
    return `synced ${Math.round(h / 24)} days ago — refresh before relying on it`;
  })();

  const syncStale = (() => {
    if (!snapshot) return false;
    const ms = Date.now() - Date.parse(snapshot.record_synced_at);
    return !Number.isFinite(ms) || ms < 0 || ms / 36e5 > 24;
  })();

  if (!ready) {
    return (
      <View style={[st.root, st.center]}>
        <Text style={st.boot}>WITNESS</Text>
        <Text style={st.bootSub}>loading the approved record…</Text>
      </View>
    );
  }

  // Attribution on a QA record is the entire point - "confirmed by" cannot be a
  // hardcoded constant. Asked once, stored on the device.
  if (!worker) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SafeAreaView style={st.root}>
          <View style={st.signin}>
            <Text style={st.boot}>WITNESS</Text>
            <Text style={st.signinSub}>
              Who's on this phone? Every flag you confirm is recorded against your name.
            </Text>
            {CREW.map(n => (
              <Press key={n} style={st.crewRow} depth={0.99}
                     onPress={async () => { await setWorker(n); setWorkerState(n); }}>
                <Text style={st.crewText}>{n}</Text>
                <Text style={st.crewMark}>→</Text>
              </Press>
            ))}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={st.root} edges={['top', 'bottom']}>
        {screen === 'scan' && (
          <ScanScreen
            zoneId={zoneId}
            zoneName={zoneName}
            worker={worker}
            pending={pending}
            online={online}
            serverReachable={serverReachable}
            syncedLabel={syncedLabel}
            syncStale={syncStale}
            onZonePress={() => setZonePicker(true)}
            onScanned={onScanned}
            onNameplate={onNameplate}
            onManualEntry={() => setManual(true)}
            onReset={onReset}
            syncServer={SERVER}
            syncError={syncError}
            onTestSync={onTestSync}
          />
        )}

        {screen === 'nameplate' && (
          <NameplateScreen
            reading={reading}
            onConfirm={onNameplateConfirmed}
            onRetake={() => setScreen('scan')}
            onCancel={() => setScreen('scan')}
          />
        )}

        {screen === 'verdict' && resolution && (
          <VerdictScreen
            resolution={resolution}
            onConfirmNcr={onConfirmNcr}
            onVerifyInstall={onVerifyInstall}
            onDismiss={() => setScreen('scan')}
            onReportProblem={() => setScreen('report')}
          />
        )}

        {/* Reached from the verdict, so the part is already identified. The
            worker never re-types a serial they have just scanned. */}
        {screen === 'report' && resolution && (
          <ReportScreen
            serial={resolution.serial}
            sku={resolution.sku}
            zoneName={zoneName}
            worker={worker}
            onSubmit={onSubmitReport}
            onCancel={() => setScreen('verdict')}
          />
        )}

        {/* Zone is chosen, never inferred. A unit can physically be anywhere;
            the question is only ever "is it approved for THIS place". */}
        <Modal visible={zonePicker} animationType="slide" transparent
               onRequestClose={() => setZonePicker(false)}>
          <View style={st.sheetWrap}>
            <View style={st.sheet}>
              <View style={st.grab} />
              <Text style={st.sheetTitle}>Where are you working?</Text>
              <Text style={st.sheetSub}>
                Witness never guesses your location — the approved revision depends on it.
              </Text>
              <ScrollView>
                {zones.map(z => (
                  <Press key={z.id} style={st.zoneRow} depth={0.99}
                         onPress={() => { setZoneId(z.id); setZonePicker(false); }}>
                    <Text style={[st.zoneRowText, z.id === zoneId && { fontWeight: '700' }]}>
                      {z.name}
                    </Text>
                    {z.id === zoneId && <Text style={st.zoneCurrent}>CURRENT</Text>}
                  </Press>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Bottom rung of the ladder. The worker is never dead-ended. */}
        <Modal visible={manual} animationType="slide" transparent
               onRequestClose={() => setManual(false)}>
          <View style={st.sheetWrap}>
            <View style={st.sheet}>
              <View style={st.grab} />
              <Text style={st.sheetTitle}>Enter the tag by hand</Text>
              <Text style={st.sheetSub}>Both are printed under the code on every tag.</Text>
              <TextInput
                style={[st.input, MONO]} placeholder="Part code, e.g. GT-12" placeholderTextColor={C.text3}
                autoCapitalize="characters" value={manualSku} onChangeText={setManualSku}
              />
              <TextInput
                style={[st.input, MONO]} placeholder="Serial, e.g. SN-4471" placeholderTextColor={C.text3}
                autoCapitalize="characters" value={manualSerial} onChangeText={setManualSerial}
              />
              <Press style={st.sheetBtn} onPress={submitManual}>
                <Text style={st.sheetBtnText}>CHECK IT</Text>
              </Press>
              <Press style={st.sheetCancel} onPress={() => setManual(false)}>
                <Text style={st.sheetCancelText}>Cancel</Text>
              </Press>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  boot: { color: C.text, fontSize: 38, fontWeight: '800', letterSpacing: -1.2 },
  bootSub: { color: C.text3, marginTop: 12, fontSize: 14.5 },

  signin: { flex: 1, justifyContent: 'center', paddingHorizontal: 22 },
  signinSub: {
    color: C.text2, fontSize: 15, lineHeight: 23, marginTop: 14, marginBottom: 30, maxWidth: 400,
  },
  crewRow: {
    minHeight: GLOVE_TARGET, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: C.rule,
  },
  crewText: { color: C.text, fontSize: 19, fontWeight: '600', letterSpacing: T.trackTitle },
  crewMark: { color: C.text3, fontSize: 17 },

  /* Sheets are a surface arriving over the work, so they get a real edge and a
     grab rail rather than a rounded floating panel. */
  sheetWrap: { flex: 1, backgroundColor: '#000000CC', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.ruleStrong,
    paddingHorizontal: 22, paddingTop: 20, paddingBottom: 26, maxHeight: '80%',
  },
  grab: {
    alignSelf: 'center', width: 40, height: 3, borderRadius: 2,
    backgroundColor: C.ruleStrong, marginBottom: 18,
  },
  sheetTitle: { color: C.text, fontSize: 23, fontWeight: '700', letterSpacing: T.trackTitle },
  sheetSub: { color: C.text3, fontSize: 13.5, marginTop: 8, marginBottom: 14, lineHeight: 20 },

  zoneRow: {
    minHeight: GLOVE_TARGET, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: C.rule,
  },
  zoneRowText: { color: C.text, fontSize: 17, flex: 1 },
  zoneCurrent: {
    color: C.text3, fontSize: T.label, fontWeight: '700', letterSpacing: T.trackLabel,
  },

  input: {
    borderBottomWidth: 1, borderBottomColor: C.ruleStrong,
    color: C.text, fontSize: 24, fontWeight: '700', letterSpacing: T.trackTitle,
    minHeight: GLOVE_TARGET - 8, marginBottom: 14,
  },
  sheetBtn: {
    minHeight: 84, borderRadius: 4, backgroundColor: C.text,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  sheetBtnText: { color: '#08080A', fontSize: 19, fontWeight: '800', letterSpacing: 0.8 },
  sheetCancel: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  sheetCancelText: { color: C.text3, fontSize: 15 },
});
