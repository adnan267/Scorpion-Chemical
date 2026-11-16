import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import type { Customer, RoutePlan } from '@/lib/types';
import { Btn, Card, Empty, ErrorBox, Field, Line, Loading, SearchBox, Sheet, T } from '@/ui/kit';
import { MenuRow } from '@/ui/rows';
import { goBack, Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

type Pick = { id: string; name: string; city: string | null; has_location: boolean };

export default function RouteDayScreen() {
  const params = useLocalSearchParams<{ user: string; day: string }>();
  const me = useMe();
  const admin = me.role === 'admin';
  const dialog = useDialog();
  const day = Number(params.day);
  const userId = String(params.user ?? '');
  const plan = useRpc<RoutePlan>('route_plan_get', { p_user_id: admin ? userId : null });
  const all = useRpc<Customer[]>('customers_list', {}, admin);
  const d = plan.data?.days.find((x) => x.day_no === day);
  const [label, setLabel] = useState('');
  const [chosen, setChosen] = useState<Pick[]>([]);
  const [filled, setFilled] = useState(false);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const back = admin ? `/route-plan?user=${userId}` : '/route-plan';

  useEffect(() => {
    if (!d || filled) return;
    setLabel(d.label ?? '');
    setChosen(d.customers);
    setFilled(true);
  }, [d, filled]);

  const options = useMemo(() => {
    const s = q.trim().toLowerCase();
    const ids = new Set(chosen.map((c) => c.id));
    return (all.data ?? [])
      .filter((c) => c.is_active && !ids.has(c.id) && (!s || `${c.name} ${c.city ?? ''} ${c.address ?? ''}`.toLowerCase().includes(s)))
      .sort((a, b) => Number(b.order_taker_id === userId) - Number(a.order_taker_id === userId) || a.name.localeCompare(b.name));
  }, [all.data, chosen, q, userId]);

  function move(i: number, by: number) {
    setChosen((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      await rpc('route_day_save', { p_user_id: userId, p_day_no: day, p_label: label, p_customers: chosen.map((c) => c.id) });
      dialog.toast(`Day ${day} saved`);
      goBack(back);
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!admin) {
    return (
      <Screen title={`Day ${day}${d?.label ? `: ${d.label}` : ''}`} back={back}>
        {plan.loading && !plan.data ? <Loading /> : null}
        {d && d.customers.length === 0 ? <Empty icon="map-outline" title="No customers on this day" /> : null}
        {d?.customers.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {d.customers.map((c, n) => (
              <View key={c.id}>
                {n > 0 ? <Line /> : null}
                <MenuRow icon="storefront-outline" label={`${n + 1}. ${c.name}`} sub={c.city ?? undefined} onPress={() => router.push(`/customer/${c.id}` as any)} />
              </View>
            ))}
          </Card>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      title={`Day ${day}`}
      subtitle={plan.data?.user.name}
      back={back}
      footer={<Btn title={`Save Day ${day}`} onPress={save} loading={busy} disabled={!filled} />}>
      {plan.error ? <ErrorBox message={plan.error} onRetry={plan.reload} /> : null}
      {!filled ? <Loading /> : null}
      {filled ? (
        <>
          <Field label="Area name (optional)" value={label} onChangeText={setLabel} placeholder="e.g. Nishtar Road, Chowk Kumharanwala" />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T v="h3">
              Customers ({chosen.length})
            </T>
            <Btn title="Add customers" icon="add" small kind="secondary" onPress={() => setAdding(true)} />
          </View>
          {chosen.length === 0 ? (
            <Card>
              <T color={C.sub}>No customers on this day yet. Add them in the order they should be visited.</T>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {chosen.map((c, i) => (
                <View key={c.id}>
                  {i > 0 ? <Line /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 10, paddingHorizontal: S.lg }}>
                    <View style={{ flex: 1 }}>
                      <T v="strong">
                        {i + 1}. {c.name}
                      </T>
                      <T v="small">{[c.city, c.has_location ? null : 'no shop location'].filter(Boolean).join(', ') || ' '}</T>
                    </View>
                    <Pressable accessibilityLabel={`Move ${c.name} up`} onPress={() => move(i, -1)} hitSlop={6} style={{ padding: 4, opacity: i === 0 ? 0.3 : 1 }}>
                      <Ionicons name="arrow-up" size={20} color={C.sub} />
                    </Pressable>
                    <Pressable accessibilityLabel={`Move ${c.name} down`} onPress={() => move(i, 1)} hitSlop={6} style={{ padding: 4, opacity: i === chosen.length - 1 ? 0.3 : 1 }}>
                      <Ionicons name="arrow-down" size={20} color={C.sub} />
                    </Pressable>
                    <Pressable accessibilityLabel={`Remove ${c.name}`} onPress={() => setChosen((l) => l.filter((x) => x.id !== c.id))} hitSlop={6} style={{ padding: 4 }}>
                      <Ionicons name="close-circle" size={22} color={C.red} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </Card>
          )}
          <T v="small">Customers without an order taker are given to {plan.data?.user.name.split(' ')[0]} when you save.</T>
        </>
      ) : null}

      <Sheet visible={adding} title="Add customers" onClose={() => setAdding(false)} footer={<Btn title="Done" onPress={() => setAdding(false)} />}>
        <View style={{ padding: S.lg, gap: S.md }}>
          <SearchBox value={q} onChangeText={setQ} placeholder="Search by name, area or city" />
          {all.loading && !all.data ? <Loading /> : null}
          {options.slice(0, 80).map((c) => {
            const other = c.order_taker_id && c.order_taker_id !== userId;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                disabled={!!other}
                onPress={() => setChosen((l) => [...l, { id: c.id, name: c.name, city: c.city, has_location: !!c.has_location }])}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 8, opacity: other ? 0.45 : 1 }, pressed && { backgroundColor: C.paper }]}>
                <View style={{ flex: 1 }}>
                  <T v="strong">{c.name}</T>
                  <T v="small">{[c.address, c.city].filter(Boolean).join(', ')}{c.has_location ? '' : ', no shop location'}{other ? ` (${c.order_taker_name}'s customer)` : !c.order_taker_id ? ' (no order taker)' : ''}</T>
                </View>
                {!other ? <Ionicons name="add-circle" size={24} color={C.blue} /> : null}
              </Pressable>
            );
          })}
          {all.data && options.length === 0 ? <T color={C.sub}>No more customers to add.</T> : null}
        </View>
      </Sheet>
    </Screen>
  );
}
