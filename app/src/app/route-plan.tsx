import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { RoutePlan } from '@/lib/types';
import { Btn, Card, Chips, DateField, ErrorBox, Field, Line, Loading, Section, T, Tag } from '@/ui/kit';
import { MenuRow } from '@/ui/rows';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

const OFF = [
  { value: 'none', label: 'No off day' },
  { value: '5', label: 'Friday off' },
  { value: '0', label: 'Sunday off' },
];

export default function RoutePlanScreen() {
  const params = useLocalSearchParams<{ user?: string }>();
  const me = useMe();
  const dialog = useDialog();
  const admin = me.role === 'admin';
  const userId = admin ? (params.user ? String(params.user) : null) : null;
  const q = useRpc<RoutePlan>('route_plan_get', { p_user_id: userId });
  const r = q.data;
  const [start, setStart] = useState<string | null>(null);
  const [days, setDays] = useState('30');
  const [off, setOff] = useState<string>('none');
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    if (!r || filled) return;
    setStart(r.plan?.start_date ?? r.today.date);
    setDays(String(r.plan?.cycle_days ?? 30));
    setOff(r.plan?.off_day === null || r.plan?.off_day === undefined ? 'none' : String(r.plan.off_day));
    setFilled(true);
  }, [r, filled]);

  async function saveSettings() {
    const n = Number(days);
    if (!start) return dialog.toast('Choose the date of Day 1', 'error');
    if (!Number.isInteger(n) || n < 1 || n > 60) return dialog.toast('Days in the plan must be 1 to 60', 'error');
    setBusy(true);
    try {
      await rpc('route_plan_save', { p_user_id: r!.user.id, p_start_date: start, p_cycle_days: n, p_off_day: off === 'none' ? null : Number(off) });
      dialog.toast('Route plan saved');
      setFilled(false);
      q.reload();
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={admin ? `Route plan${r ? `: ${r.user.name}` : ''}` : 'My route plan'} back={admin && userId ? `/user/form?id=${userId}` : '/'} onRefresh={q.refresh} refreshing={q.refreshing}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !r ? <Loading /> : null}
      {r ? (
        <>
          {r.plan ? (
            <Card style={{ gap: 2 }}>
              <T v="strong">{r.today.day_no ? `Today is Day ${r.today.day_no}` : 'No route today'}</T>
              <T v="small">
                {r.tomorrow.day_no ? `Tomorrow is Day ${r.tomorrow.day_no}` : 'No route tomorrow'}. After Day {r.plan.cycle_days} the plan starts again from Day 1.
              </T>
            </Card>
          ) : (
            <Card>
              <T color={C.sub}>{admin ? 'No plan yet. Choose when Day 1 is, then set the customers for each day.' : 'The admin has not made your route plan yet.'}</T>
            </Card>
          )}

          {admin ? (
            <Card style={{ gap: S.md }}>
              <T v="h3">Plan settings</T>
              <DateField label="Day 1 is on" value={start} onChange={setStart} presets={[0, 1]} />
              <Field label="Days in the plan" value={days} onChangeText={setDays} keyboardType="number-pad" hint="After the last day the plan starts again from Day 1." />
              <Chips value={off} onChange={setOff} options={OFF} />
              <T v="small">On the off day there is no route, and the days continue on the next working day.</T>
              <View style={{ flexDirection: 'row' }}>
                <Btn title="Save plan settings" small onPress={saveSettings} loading={busy} />
              </View>
            </Card>
          ) : null}

          {admin && r.unplanned > 0 ? (
            <Card style={{ borderColor: C.amber }}>
              <T v="small" color={C.ink}>
                {r.unplanned} of {r.user.name.split(' ')[0]}'s customers are not on any day yet.
              </T>
            </Card>
          ) : null}

          {r.plan || admin ? (
            <Section title="Days">
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {r.days.map((d, n) => (
                  <View key={d.day_no}>
                    {n > 0 ? <Line /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <MenuRow
                          icon="map-outline"
                          label={`Day ${d.day_no}${d.label ? `: ${d.label}` : ''}`}
                          sub={d.customers.length ? `${d.customers.length} ${d.customers.length === 1 ? 'customer' : 'customers'}: ${d.customers.slice(0, 3).map((c) => c.name).join(', ')}${d.customers.length > 3 ? '…' : ''}` : 'No customers'}
                          onPress={() => router.push(`/route-day?user=${r.user.id}&day=${d.day_no}` as any)}
                        />
                      </View>
                      {r.today.day_no === d.day_no ? <View style={{ paddingRight: S.lg }}><Tag label="Today" tone="blue" /></View> : r.tomorrow.day_no === d.day_no ? <View style={{ paddingRight: S.lg }}><Tag label="Tomorrow" tone="gray" /></View> : null}
                    </View>
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}
          {r.plan ? <T v="small">Day 1 was {fmtDate(r.plan.start_date)}.</T> : null}
        </>
      ) : null}
    </Screen>
  );
}
