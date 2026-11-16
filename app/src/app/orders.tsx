import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useRpc } from '@/lib/api';
import { money, periodRange, ROLE_LABEL } from '@/lib/format';
import type { OrderRow } from '@/lib/types';
import { Btn, Card, Chips, Empty, ErrorBox, IconBtn, Line, Loading, SearchBox, T, Tag } from '@/ui/kit';
import { OrderCard } from '@/ui/rows';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'confirmed', label: 'To deliver' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'returned', label: 'Returned' },
  { value: 'cancelled', label: 'Cancelled' },
];

type Period = 'all' | 'today' | 'week' | 'month' | 'last_month';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'all', label: 'All time' },
];

type Summary = {
  orders: number;
  amount: number;
  returned: number;
  by_user: { user_id: string; name: string; role: string; customer_name: string | null; orders: number; amount: number }[];
};

export default function Orders() {
  const me = useMe();
  const params = useLocalSearchParams<{ status?: string; customer?: string; name?: string; period?: string }>();
  const admin = me.role === 'admin';
  const staff = admin || me.role === 'order_taker' || me.role === 'stock_keeper';
  const customerId = params.customer ? String(params.customer) : null;
  const [status, setStatus] = useState(params.status === 'open' || params.status === 'pending' ? 'confirmed' : params.status ? String(params.status) : 'all');
  const [period, setPeriod] = useState<Period>((params.period as Period) || (admin && !customerId ? 'month' : 'all'));
  const [byUser, setByUser] = useState<{ id: string; name: string } | null>(null);
  const [q, setQ] = useState('');
  const range = period === 'all' ? null : periodRange(period);

  const list = useRpc<OrderRow[]>('orders_list', {
    p_status: status === 'all' ? null : status,
    p_customer_id: customerId,
    p_search: q.trim() || null,
    p_limit: 200,
    p_from: range?.from ?? null,
    p_to: range?.to ?? null,
    p_created_by: byUser?.id ?? null,
  });
  const summary = useRpc<Summary>('orders_summary', { p_from: range?.from ?? null, p_to: range?.to ?? null }, admin && !customerId && !!range);
  const canBook = me.role !== 'stock_keeper';
  const newOrder = () => router.push((admin || me.role === 'order_taker' ? '/customers?pick=order' : '/catalog') as any);
  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? '';

  return (
    <Screen
      title="Orders"
      subtitle={customerId && params.name ? String(params.name) : undefined}
      top={!customerId}
      back="/customers"
      onRefresh={() => {
        list.refresh();
        summary.reload();
      }}
      refreshing={list.refreshing}
      right={canBook ? <IconBtn icon="add-circle" color={C.blue} label="New order" onPress={newOrder} /> : undefined}>
      {staff ? <SearchBox value={q} onChangeText={setQ} placeholder="Search by invoice number or customer" /> : null}
      {admin && !customerId ? <Chips value={period} onChange={(v) => { setPeriod(v); setByUser(null); }} options={PERIODS} /> : null}

      {admin && summary.data && range ? (
        <Card style={{ gap: S.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: S.md }}>
            <T v="h3">{periodLabel}</T>
            <T v="small">{summary.data.orders} {summary.data.orders === 1 ? 'order' : 'orders'}</T>
          </View>
          <T v="figure">{money(summary.data.amount)}</T>
          {Number(summary.data.returned) > 0 ? <T v="small" color={C.red}>Returns in this period: {money(summary.data.returned)}</T> : null}
          {summary.data.by_user.length ? (
            <>
              <Line />
              <T v="smallStrong">Booked by</T>
              {summary.data.by_user.map((u) => {
                const on = byUser?.id === u.user_id;
                return (
                  <Pressable
                    key={u.user_id}
                    accessibilityRole="button"
                    onPress={() => setByUser(on ? null : { id: u.user_id, name: u.name })}
                    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 6, backgroundColor: on ? C.blueSoft : 'transparent' }, pressed && { opacity: 0.7 }]}>
                    <View style={{ flex: 1 }}>
                      <T v="strong">{u.name}</T>
                      <T v="small">{u.customer_name ? `Customer, ${u.customer_name}` : ROLE_LABEL[u.role] ?? u.role}</T>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <T v="strong">{money(u.amount)}</T>
                      <T v="small">{u.orders} {u.orders === 1 ? 'order' : 'orders'}</T>
                    </View>
                  </Pressable>
                );
              })}
              <T v="small">Tap a name to see only their orders.</T>
            </>
          ) : null}
        </Card>
      ) : null}

      {byUser ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <Tag label={`Booked by ${byUser.name}`} tone="blue" />
          <Btn title="Show everyone" small kind="ghost" onPress={() => setByUser(null)} />
        </View>
      ) : null}

      <Chips value={status} onChange={setStatus} options={FILTERS} />
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && list.data.length === 0 ? (
        <Empty
          icon="receipt-outline"
          title={status === 'all' && !q && period === 'all' ? 'No orders yet' : 'No orders match'}
          hint={status === 'all' && !q && period === 'all' ? (staff ? 'Choose a customer to book the first order.' : 'Order products and they will show here.') : 'Try another filter.'}
          action={status === 'all' && !q && period === 'all' && canBook ? <Btn title={staff ? 'Book an order' : 'Order products'} onPress={newOrder} /> : undefined}
        />
      ) : null}
      {list.data?.map((o) => <OrderCard key={o.id} o={o} showCustomer={staff && !customerId} />)}
      {list.data && list.data.length === 200 ? <T v="small">Showing the latest 200 orders. Use search or a filter to find others.</T> : null}
    </Screen>
  );
}
