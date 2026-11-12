import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, View } from 'react-native';

import { useDialog } from '@/ctx/dialog';
import { rpc } from '@/lib/api';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { flushLocations, isTracking, lastSentAt, queuedCount, startTracking, stopTracking, trackingSupported } from '@/lib/tracking';

import { Btn, Card, T } from './kit';
import { C, R, S } from './theme';

type Status = { on_duty: boolean; started_at: string | null; last_point_at: string | null };

/** Order taker: start/end duty. While on duty the phone shares its location with the admin. */
export function DutyCard() {
  const dialog = useDialog();
  const [st, setSt] = useState<Status | null>(null);
  const [running, setRunning] = useState(false);
  const [lastSent, setLastSent] = useState<number | null>(null);
  const [queued, setQueued] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      await flushLocations();
      const [s, r, ls, q] = await Promise.all([rpc<Status>('duty_status'), isTracking(), lastSentAt(), queuedCount()]);
      setSt(s);
      setRunning(r);
      setLastSent(ls);
      setQueued(q);
      // duty was ended elsewhere (or by the server) but the phone is still tracking
      if (!s.on_duty && r) {
        await stopTracking();
        setRunning(false);
      }
    } catch {
      // keep the last known state when offline
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    const sub = AppState.addEventListener('change', (a) => a === 'active' && load());
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [load]);

  async function start() {
    if (!trackingSupported) {
      dialog.toast('Live location works in the Android app only.', 'error');
      return;
    }
    const ok = await dialog.confirm({
      title: 'Start duty?',
      message:
        'Your location will be shared with the admin every few minutes until you tap "End duty", even when the app is closed. Android will ask for location permission; choose "Allow all the time" if it asks.',
      confirmLabel: 'Start duty',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await rpc('duty_start');
      const res = await startTracking();
      dialog.toast(res.background ? 'Duty started' : 'Duty started. Keep the "On duty" notification on.');
      await load();
    } catch (e: any) {
      // tracking could not start: do not leave a duty open without location
      await rpc('duty_end', { p_reason: 'Location could not start' }).catch(() => {});
      dialog.toast(e.message, 'error');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    setBusy(true);
    try {
      await startTracking();
      dialog.toast('Location sharing resumed');
      await load();
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    const ok = await dialog.confirm({ title: 'End duty?', message: 'Location sharing will stop.', confirmLabel: 'End duty' });
    if (!ok) return;
    setBusy(true);
    try {
      await flushLocations();
      await stopTracking();
      await rpc('duty_end');
      dialog.toast('Duty ended');
      await load();
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!st) return null;

  if (!st.on_duty) {
    return (
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.graySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="location-outline" size={22} color={C.sub} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="strong">Off duty</T>
          <T v="small">{trackingSupported ? 'Start duty when you leave for your route.' : 'Start duty from the Android app.'}</T>
        </View>
        {trackingSupported ? <Btn title="Start duty" small icon="play" loading={busy} onPress={start} /> : null}
      </Card>
    );
  }

  const stale = trackingSupported && !running;
  return (
    <Card style={{ gap: S.sm, borderColor: stale ? C.red : C.green }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: stale ? C.redSoft : C.greenSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={stale ? 'warning-outline' : 'navigate'} size={20} color={stale ? C.red : C.green} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="strong" color={stale ? C.red : C.green}>{stale ? 'On duty, location is not being sent' : 'On duty, sharing location'}</T>
          <T v="small">Since {fmtDateTime(st.started_at)}</T>
          {lastSent ? <T v="small">Last sent {timeAgo(new Date(lastSent).toISOString())}{queued ? `, ${queued} waiting for internet` : ''}</T> : null}
        </View>
      </View>
      {stale ? (
        <View style={{ backgroundColor: C.redSoft, borderRadius: R.input, padding: S.md, gap: S.sm }}>
          <T v="small" color={C.red}>
            Location stopped (phone restarted, permission removed or battery saver). Tap Resume. If it keeps stopping, turn off battery saver for this app.
          </T>
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Btn title="Resume" small loading={busy} onPress={resume} />
            <Btn title="App settings" small kind="secondary" onPress={() => Linking.openSettings()} />
          </View>
        </View>
      ) : null}
      <Btn title="End duty" kind="secondary" small icon="stop" loading={busy} onPress={end} style={{ alignSelf: 'flex-start' }} />
    </Card>
  );
}
