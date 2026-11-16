import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { useRpc } from '@/lib/api';
import { addDays, fmtDate, fmtDateTime, isoDate, money } from '@/lib/format';
import { routeKm } from '@/lib/mapHtml';
import type { RouteVisits } from '@/lib/types';
import { Btn, Card, ErrorBox, KV, Line, Loading, Section, T } from '@/ui/kit';
import { MapView } from '@/ui/MapView';
import { RouteDay } from '@/ui/RouteToday';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

type Route = {
  user: { id: string; name: string; phone: string } | null;
  date: string;
  sessions: { started_at: string; ended_at: string | null }[];
  points: [number, number, number, number | null][];
  orders: { id: string; order_no: string; customer: string; total: number; at: string }[];
};

function time(d: string | null): string {
  if (!d) return 'still on duty';
  return fmtDateTime(d).split(', ')[1] ?? '';
}

export default function TeamRoute() {
  const params = useLocalSearchParams<{ id: string; date?: string }>();
  const { height } = useWindowDimensions();
  const [day, setDay] = useState<string>(params.date ? String(params.date) : isoDate(new Date()));
  const q = useRpc<Route>('taker_route', { p_user_id: params.id, p_date: day });
  const plan = useRpc<RouteVisits>('route_visits', { p_user_id: params.id, p_date: day });
  const r = q.data;
  const stops = plan.data?.stops ?? [];
  const today = isoDate(new Date());

  const data = useMemo(
    () => ({
      route: (r?.points ?? []).map((p) => [p[0], p[1]] as [number, number]),
      markers: stops
        .filter((s) => s.lat !== null && s.lng !== null)
        .map((s, n) => ({
          id: s.customer_id,
          lat: s.lat!,
          lng: s.lng!,
          label: String(n + 1),
          title: s.name,
          sub: s.ordered ? 'Ordered' : s.visited ? 'Visited' : 'Not visited',
          color: s.ordered ? C.green : s.visited ? C.blue : C.red,
        })),
      refit: true,
    }),
    [r, stops],
  );
  const km = r ? routeKm(r.points) : 0;
  const first = r?.points[0];
  const last = r?.points[r.points.length - 1];

  function shift(n: number) {
    const d = new Date(day + 'T00:00:00');
    setDay(addDays(n, d));
  }

  return (
    <Screen title={r?.user?.name ?? 'Route'} subtitle={fmtDate(day)} back="/team-map" onRefresh={() => { q.refresh(); plan.reload(); }} refreshing={q.refreshing}>
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <Btn title="Previous day" small kind="secondary" icon="chevron-back" onPress={() => shift(-1)} style={{ flex: 1 }} />
        <Btn title="Next day" small kind="secondary" onPress={() => shift(1)} disabled={day >= today} style={{ flex: 1 }} />
      </View>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !r ? <Loading /> : null}
      {r ? (
        <>
          {r.points.length || data.markers.length ? (
            <MapView data={data} height={Math.max(320, Math.round(height * 0.5))} onMarker={(cid) => router.push(`/customer/${cid}` as any)} />
          ) : (
            <Card>
              <T color={C.sub}>No location was recorded on this day.</T>
            </Card>
          )}
          <Card style={{ gap: 2 }}>
            <KV k="Duty" v={r.sessions.length ? r.sessions.map((s) => `${time(s.started_at)} to ${time(s.ended_at)}`).join(', ') : 'Not on duty'} />
            {first ? <KV k="First location" v={time(new Date(first[2] * 1000).toISOString())} /> : null}
            {last ? <KV k="Last location" v={time(new Date(last[2] * 1000).toISOString())} /> : null}
            <KV k="Distance (approx.)" v={`${km.toFixed(1)} km`} />
            <KV k="Location points" v={String(r.points.length)} />
          </Card>
          {plan.data ? (
            <Section title="Route plan for this day">
              <RouteDay r={plan.data} />
              {data.markers.length ? <T v="small">On the map: green ordered, blue visited, red not visited. Numbers follow the route order.</T> : null}
            </Section>
          ) : null}
          <Section title={`Orders taken (${r.orders.length})`}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {r.orders.length === 0 ? <T color={C.sub} style={{ padding: S.lg }}>No orders on this day.</T> : null}
              {r.orders.map((o, n) => (
                <View key={o.id}>
                  {n > 0 ? <Line /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.md }}>
                    <View style={{ flex: 1 }}>
                      <T v="strong">{o.customer}</T>
                      <T v="small">{o.order_no}, {time(o.at)}</T>
                    </View>
                    <Btn title={money(o.total)} small kind="ghost" onPress={() => router.push(`/order/${o.id}` as any)} />
                  </View>
                </View>
              ))}
            </Card>
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
