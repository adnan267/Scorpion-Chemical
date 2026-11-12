import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, useWindowDimensions, View } from 'react-native';

import { useRpc } from '@/lib/api';
import { fmtDateTime, prettyPhone, timeAgo } from '@/lib/format';
import type { MapMarker } from '@/lib/mapHtml';
import { Btn, Card, Empty, ErrorBox, Line, Loading, T, Tag } from '@/ui/kit';
import { MapView } from '@/ui/MapView';
import { Screen } from '@/ui/Shell';
import { C, S, Tone } from '@/ui/theme';

export type TeamRow = {
  user_id: string;
  name: string;
  phone: string;
  on_duty: boolean;
  duty_started_at: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  last_seen_at: string | null;
  orders_today: number;
};

const LIVE_MINUTES = 10;

export function liveState(r: TeamRow): { label: string; tone: Tone; color: string } {
  if (!r.on_duty) return { label: 'Off duty', tone: 'gray', color: '#8A97A6' };
  const age = r.last_seen_at ? (Date.now() - new Date(r.last_seen_at).getTime()) / 60000 : Infinity;
  if (age <= LIVE_MINUTES) return { label: 'Live', tone: 'green', color: '#23804E' };
  return { label: 'On duty, no signal', tone: 'amber', color: '#A8690A' };
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export default function TeamMap() {
  const q = useRpc<TeamRow[]>('team_locations');
  const { height } = useWindowDimensions();
  const [focus, setFocus] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // live refresh every 30 seconds
  useEffect(() => {
    const t = setInterval(() => {
      q.reload();
      setTick((n) => n + 1);
    }, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = q.data ?? [];
  const markers = useMemo<MapMarker[]>(
    () =>
      rows
        .filter((r) => r.lat !== null && r.lng !== null)
        .map((r) => {
          const s = liveState(r);
          return {
            id: r.user_id,
            lat: r.lat!,
            lng: r.lng!,
            label: initials(r.name),
            title: r.name,
            sub: `${s.label}, last seen ${r.last_seen_at ? timeAgo(r.last_seen_at) : 'never'}`,
            color: s.color,
          };
        }),
    [rows]
  );
  const data = useMemo(() => ({ markers, focus }), [markers, focus]);
  const live = rows.filter((r) => liveState(r).label === 'Live').length;
  const onDuty = rows.filter((r) => r.on_duty).length;

  return (
    <Screen title="Live map" subtitle={q.data ? `${live} live, ${onDuty} on duty, ${rows.length} order takers` : undefined} back="/more" onRefresh={q.refresh} refreshing={q.refreshing}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <Loading /> : null}
      {q.data ? (
        <>
          <MapView data={data} height={Math.max(320, Math.round(height * 0.5))} onMarker={(id) => setFocus(id)} />
          <T v="small">Updates every 30 seconds. Order takers share location only while on duty, from the Android app.</T>
          {rows.length === 0 ? (
            <Empty icon="people-outline" title="No order takers yet" action={<Btn title="Add order taker" onPress={() => router.push('/user/form?role=order_taker')} />} />
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {rows.map((r, n) => {
                const s = liveState(r);
                const on = focus === r.user_id;
                return (
                  <View key={r.user_id}>
                    {n > 0 ? <Line /> : null}
                    <Pressable
                      onPress={() => (r.lat !== null ? setFocus(r.user_id) : null)}
                      style={({ pressed }) => [{ padding: S.md, gap: 6, backgroundColor: on ? C.blueSoft : C.surface }, pressed && { opacity: 0.8 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
                        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: s.color, alignItems: 'center', justifyContent: 'center' }}>
                          <T v="smallStrong" color={C.white}>{initials(r.name)}</T>
                        </View>
                        <View style={{ flex: 1 }}>
                          <T v="strong">{r.name}</T>
                          <T v="small">
                            {r.last_seen_at ? `Last seen ${timeAgo(r.last_seen_at)}` : 'No location yet'}
                            {r.on_duty && r.duty_started_at ? `, on duty since ${fmtDateTime(r.duty_started_at)}` : ''}
                          </T>
                        </View>
                        <Tag label={s.label} tone={s.tone} />
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, alignItems: 'center' }}>
                        <T v="small">{r.orders_today} {r.orders_today === 1 ? 'order' : 'orders'} today</T>
                        <View style={{ flex: 1 }} />
                        <Btn title="Today's route" small kind="secondary" onPress={() => router.push(`/team-route?id=${r.user_id}` as any)} />
                        <Btn title="Call" small kind="ghost" icon="call-outline" onPress={() => Linking.openURL(`tel:${r.phone}`)} />
                      </View>
                      {r.accuracy !== null && r.accuracy > 100 ? <T v="small" color={C.amber}>Rough location (within about {Math.round(r.accuracy)} m)</T> : null}
                      <T v="small" color={C.faint}>{prettyPhone(r.phone)}</T>
                    </Pressable>
                  </View>
                );
              })}
            </Card>
          )}
        </>
      ) : null}
    </Screen>
  );
}
