import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { fmtDateTime, isoDate, money } from '@/lib/format';
import type { RouteVisits } from '@/lib/types';
import { Card, Line, T, Tag } from '@/ui/kit';
import { MenuRow } from '@/ui/rows';
import { C, S } from '@/ui/theme';

function time(d: string | null) {
  return d ? fmtDateTime(d).split(', ')[1] ?? '' : '';
}

/** One day's route: who to visit, who was visited (live location) and who ordered. */
export function RouteDay({ r, self }: { r: RouteVisits; self?: boolean }) {
  const past = r.date < isoDate(new Date());
  if (!r.has_plan) {
    return (
      <Card>
        <T color={C.sub}>{self ? 'No route plan yet. The admin will set your daily route.' : 'No route plan for this order taker yet.'}</T>
      </Card>
    );
  }
  if (r.off_day) {
    return (
      <Card>
        <T color={C.sub}>Off day. No route.</T>
      </Card>
    );
  }
  if (!r.day_no) {
    return (
      <Card>
        <T color={C.sub}>The route plan starts later.</T>
      </Card>
    );
  }
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <View style={{ padding: S.lg, gap: 2 }}>
        <T v="h3">
          Day {r.day_no}
          {r.label ? `: ${r.label}` : ''}
        </T>
        <T v="small">
          {r.stops.length} {r.stops.length === 1 ? 'customer' : 'customers'}, {r.visited} visited, {r.ordered} ordered
        </T>
      </View>
      {r.stops.length === 0 ? <T color={C.sub} style={{ paddingHorizontal: S.lg, paddingBottom: S.lg }}>No customers on this day yet.</T> : null}
      {r.stops.map((s) => (
        <View key={s.customer_id}>
          <Line />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <MenuRow
                icon={s.ordered ? 'checkmark-circle' : s.visited ? 'location' : 'ellipse-outline'}
                label={s.name}
                sub={[s.address, s.city].filter(Boolean).join(', ') || undefined}
                onPress={() => router.push(`/customer/${s.customer_id}` as any)}
              />
            </View>
            <View style={{ paddingRight: S.lg, alignItems: 'flex-end', gap: 4 }}>
              {s.ordered ? <Tag label={`Order ${money(s.order_total ?? 0)}`} tone="green" /> : null}
              {s.visited ? <Tag label={`Visited ${time(s.visited_at)}`} tone="blue" /> : !s.has_location ? <Tag label="No shop location" tone="gray" /> : !s.ordered ? <Tag label={past ? 'Not visited' : 'Not yet'} tone={past ? 'red' : 'gray'} /> : null}
            </View>
          </View>
        </View>
      ))}
      {r.off_route_orders.length ? (
        <>
          <Line />
          <T v="small" style={{ padding: S.lg }}>
            Also ordered, not on this day's route: {r.off_route_orders.map((o) => o.name).join(', ')}
          </T>
        </>
      ) : null}
    </Card>
  );
}
