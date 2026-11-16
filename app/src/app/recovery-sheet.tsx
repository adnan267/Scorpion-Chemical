import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useRpc } from '@/lib/api';
import { fmtDate, money, num } from '@/lib/format';
import { printDoc, reportHtml } from '@/lib/report';
import { Btn, Card, Chips, Empty, ErrorBox, Line, Loading, T, Toggle } from '@/ui/kit';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

type Sheet = {
  date: string;
  city: string | null;
  order_taker: string | null;
  cities: { city: string; customers: number }[];
  order_takers: { id: string; name: string }[] | null;
  total: number;
  rows: { id: string; name: string; address: string | null; phone: string | null; city: string; order_taker: string | null; balance: number; overdue: number; last_paid: string | null }[];
};

/** Customers of a city or an order taker with what each owes, printed for the recovery round. */
export default function RecoverySheet() {
  const me = useMe();
  const admin = me.role === 'admin';
  const [city, setCity] = useState('all');
  const [taker, setTaker] = useState('all');
  const [owing, setOwing] = useState(true);
  const q = useRpc<Sheet>('recovery_sheet', { p_city: city === 'all' ? null : city, p_user_id: taker === 'all' ? null : taker, p_only_owing: owing });
  const s = q.data;
  const what = [s?.city, s?.order_taker].filter(Boolean).join(', ') || 'All customers';

  function print() {
    if (!s) return;
    printDoc(
      reportHtml({
        title: 'Recovery sheet',
        subtitle: `${what}. ${fmtDate(s.date)}`,
        company: me.company,
        tables: [
          {
            cols: [
              { label: '#', width: '26px' },
              { label: 'Customer' },
              { label: 'Area / phone' },
              { label: 'Balance', right: true, width: '80px' },
              { label: 'Overdue', right: true, width: '72px' },
              { label: 'Received', width: '90px', blank: true },
              { label: 'Remaining', width: '90px', blank: true },
            ],
            rows: s.rows.map((r, n) => [n + 1, r.name, [r.address, r.phone].filter(Boolean).join(', '), num(r.balance), Number(r.overdue) ? num(r.overdue) : '', '', '']),
            foot: ['', `${s.rows.length} ${s.rows.length === 1 ? 'customer' : 'customers'}`, '', num(s.total), '', '', ''],
          },
        ],
        signLines: ['Order taker', 'Received by (office)'],
      }),
    ).catch(() => {});
  }

  return (
    <Screen title="Recovery sheet" back={admin ? '/' : '/more'} onRefresh={q.refresh} refreshing={q.refreshing} footer={s && s.rows.length ? <Btn title="Print recovery sheet" icon="print-outline" onPress={print} /> : undefined}>
      <T color={C.sub}>Choose a city, or an order taker for local areas. Print it; the order taker writes what each customer paid in the empty column.</T>
      {s ? <Chips value={city} onChange={setCity} options={[{ value: 'all', label: 'All cities' }, ...s.cities.map((c) => ({ value: c.city, label: `${c.city} (${c.customers})` }))]} /> : null}
      {admin && s?.order_takers?.length ? <Chips value={taker} onChange={setTaker} options={[{ value: 'all', label: 'All order takers' }, ...s.order_takers.map((u) => ({ value: u.id, label: u.name }))]} /> : null}
      <Toggle label="Only customers who owe money" value={owing} onChange={setOwing} />
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !s ? <Loading /> : null}
      {s && s.rows.length === 0 ? <Empty icon="document-text-outline" title="No customers for this choice" /> : null}
      {s && s.rows.length ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: S.lg }}>
            <T v="h3">{what}</T>
            <T v="h3" color={C.red}>{money(s.total)}</T>
          </View>
          {s.rows.map((r) => (
            <View key={r.id}>
              <Line />
              <Pressable accessibilityRole="button" onPress={() => router.push(`/customer/${r.id}` as any)} style={({ pressed }) => [{ flexDirection: 'row', gap: S.md, paddingVertical: 10, paddingHorizontal: S.lg }, pressed && { backgroundColor: C.paper }]}>
                <View style={{ flex: 1 }}>
                  <T v="strong">{r.name}</T>
                  <T v="small">{[r.address, r.city, admin ? r.order_taker : null].filter(Boolean).join(', ')}</T>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <T v="strong">{money(r.balance)}</T>
                  {Number(r.overdue) ? <T v="small" color={C.red}>{money(r.overdue)} overdue</T> : null}
                </View>
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
