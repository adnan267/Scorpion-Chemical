import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useMe } from '@/ctx/auth';
import { useRpc } from '@/lib/api';
import { fmtDate, money } from '@/lib/format';
import type { CitySummary } from '@/lib/types';
import { Card, Empty, ErrorBox, Line, Loading, SearchBox, T, Tag } from '@/ui/kit';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

/** An order taker's customers city by city: who owes what and what was collected. */
export default function Cities() {
  const params = useLocalSearchParams<{ user?: string; city?: string }>();
  const me = useMe();
  const admin = me.role === 'admin';
  const q = useRpc<CitySummary>('city_summary', { p_user_id: admin ? (params.user ? String(params.user) : null) : null });
  const [open, setOpen] = useState<string | null>(params.city ? String(params.city) : null);
  const [search, setSearch] = useState('');
  const cities = (q.data?.cities ?? []).filter((c) => !search.trim() || c.city.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Screen title={admin && q.data ? `Cities: ${q.data.user.name}` : 'My cities'} back={admin && params.user ? `/user/form?id=${params.user}` : '/'} onRefresh={q.refresh} refreshing={q.refreshing}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <Loading /> : null}
      {q.data && q.data.cities.length === 0 ? <Empty icon="business-outline" title="No customers yet" hint="Customers show here by their city." /> : null}
      {q.data && q.data.cities.length > 4 ? <SearchBox value={search} onChangeText={setSearch} placeholder="Search city" /> : null}
      {cities.map((c) => {
        const isOpen = open === c.city;
        return (
          <Card key={c.city} style={{ padding: 0, overflow: 'hidden' }}>
            <Pressable accessibilityRole="button" onPress={() => setOpen(isOpen ? null : c.city)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.lg }}>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="h3">{c.city}</T>
                <T v="small">
                  {c.customers} {c.customers === 1 ? 'customer' : 'customers'}, collected {money(c.paid_month)} this month{Number(c.paid_today) ? `, ${money(c.paid_today)} today` : ''}
                </T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T v="strong" color={Number(c.balance) > 0 ? C.red : C.ink}>{money(c.balance)}</T>
                <T v="small">to receive</T>
              </View>
              <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={C.sub} />
            </Pressable>
            {isOpen
              ? c.list.map((x) => (
                  <View key={x.id}>
                    <Line />
                    <Pressable accessibilityRole="button" onPress={() => router.push(`/customer/${x.id}` as any)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 10, paddingHorizontal: S.lg }, pressed && { backgroundColor: C.paper }]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T v="strong">{x.name}</T>
                        <T v="small">
                          {x.address ? `${x.address}. ` : ''}
                          {Number(x.paid_month) ? `Paid ${money(x.paid_month)} this month` : x.last_paid ? `Last paid ${fmtDate(x.last_paid)}` : 'No payment yet'}
                        </T>
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                          {Number(x.overdue) ? <Tag label={`${money(x.overdue)} overdue`} tone="red" /> : null}
                          {Number(x.paid_today) ? <Tag label={`${money(x.paid_today)} today`} tone="green" /> : null}
                        </View>
                      </View>
                      <T v="strong" color={Number(x.balance) > 0 ? C.red : C.ink}>{money(x.balance)}</T>
                    </Pressable>
                  </View>
                ))
              : null}
          </Card>
        );
      })}
    </Screen>
  );
}
