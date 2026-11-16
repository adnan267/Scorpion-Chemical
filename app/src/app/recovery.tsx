import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useRpc } from '@/lib/api';
import { addDays, fmtDate, fmtDateTime, isoDate, methodLabel, money, num } from '@/lib/format';
import { printDoc, reportHtml } from '@/lib/report';
import { Btn, Card, Empty, ErrorBox, KV, Line, Loading, Section, T, Tag } from '@/ui/kit';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

type Day = {
  date: string;
  total: number;
  approved: number;
  pending: number;
  by_method: { method: string; amount: number; count: number }[];
  by_user: { name: string; role: string; amount: number; count: number }[];
  payments: { id: string; payment_no: string; customer_id: string; customer: string; city: string | null; amount: number; method: string; status: string; entered_by_name: string; entered_by_role: string; created_at: string }[];
};

/** Every payment of a day: total, by how it was paid, by who collected it. */
export default function Recovery() {
  const me = useMe();
  const today = isoDate(new Date());
  const [day, setDay] = useState(today);
  const q = useRpc<Day>('recovery_day', { p_date: day });
  const r = q.data;

  function print() {
    if (!r) return;
    printDoc(
      reportHtml({
        title: 'Recovery',
        subtitle: `${fmtDate(r.date)}. Total ${money(r.total)}`,
        company: me.company,
        tables: [
          { heading: 'By order taker / who entered', cols: [{ label: 'Name' }, { label: 'Payments', right: true }, { label: 'Amount', right: true }], rows: r.by_user.map((u) => [u.name, u.count, num(u.amount)]) },
          { heading: 'By how it was paid', cols: [{ label: 'Method' }, { label: 'Payments', right: true }, { label: 'Amount', right: true }], rows: r.by_method.map((m) => [methodLabel(m.method), m.count, num(m.amount)]) },
          {
            heading: 'Payments',
            cols: [{ label: 'No.' }, { label: 'Customer' }, { label: 'Entered by' }, { label: 'Method' }, { label: 'Status' }, { label: 'Amount', right: true }],
            rows: r.payments.map((p) => [p.payment_no, `${p.customer}${p.city ? `, ${p.city}` : ''}`, p.entered_by_name, methodLabel(p.method), p.status === 'pending' ? 'To approve' : 'Approved', num(p.amount)]),
            foot: ['', '', '', '', 'Total', num(r.total)],
          },
        ],
      }),
    ).catch(() => {});
  }

  return (
    <Screen title="Recovery" subtitle={day === today ? 'Today' : fmtDate(day)} back="/" onRefresh={q.refresh} refreshing={q.refreshing}>
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <Btn title="Previous day" small kind="secondary" icon="chevron-back" onPress={() => setDay(addDays(-1, new Date(day + 'T00:00:00')))} style={{ flex: 1 }} />
        <Btn title="Next day" small kind="secondary" onPress={() => setDay(addDays(1, new Date(day + 'T00:00:00')))} disabled={day >= today} style={{ flex: 1 }} />
      </View>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !r ? <Loading /> : null}
      {r ? (
        <>
          <Card style={{ gap: 4 }}>
            <T v="small">Received {day === today ? 'today' : `on ${fmtDate(day)}`}</T>
            <T v="figure">{money(r.total)}</T>
            <KV k="Approved" v={money(r.approved)} />
            <KV k="Waiting for approval" v={money(r.pending)} color={Number(r.pending) ? C.amber : undefined} />
          </Card>
          {r.payments.length === 0 ? <Empty icon="cash-outline" title="No payments on this day" /> : null}
          {r.by_user.length ? (
            <Section title="By who collected">
              <Card style={{ gap: 2 }}>
                {r.by_user.map((u) => (
                  <KV key={u.name} k={`${u.name} (${u.count})`} v={money(u.amount)} />
                ))}
              </Card>
            </Section>
          ) : null}
          {r.by_method.length ? (
            <Section title="By how it was paid">
              <Card style={{ gap: 2 }}>
                {r.by_method.map((m) => (
                  <KV key={m.method} k={`${methodLabel(m.method)} (${m.count})`} v={money(m.amount)} />
                ))}
              </Card>
            </Section>
          ) : null}
          {r.payments.length ? (
            <Section title="Payments">
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {r.payments.map((p, n) => (
                  <View key={p.id}>
                    {n > 0 ? <Line /> : null}
                    <Pressable accessibilityRole="button" onPress={() => router.push(`/payment/${p.id}` as any)} style={({ pressed }) => [{ flexDirection: 'row', gap: S.md, paddingVertical: 10, paddingHorizontal: S.lg }, pressed && { backgroundColor: C.paper }]}>
                      <View style={{ flex: 1 }}>
                        <T v="strong">{p.customer}</T>
                        <T v="small">
                          {methodLabel(p.method)}, by {p.entered_by_name}, {fmtDateTime(p.created_at).split(', ')[1]}
                        </T>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <T v="strong">{money(p.amount)}</T>
                        {p.status === 'pending' ? <Tag label="To approve" tone="amber" /> : null}
                      </View>
                    </Pressable>
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}
          {r.payments.length ? <Btn title="Print recovery" icon="print-outline" kind="secondary" onPress={print} /> : null}
        </>
      ) : null}
    </Screen>
  );
}
