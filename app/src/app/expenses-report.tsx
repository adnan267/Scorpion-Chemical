import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { fmtDate, money, num, periodRange } from '@/lib/format';
import { printDoc, reportHtml } from '@/lib/report';
import type { ExpenseReport } from '@/lib/types';
import { Btn, Card, Chips, Empty, ErrorBox, KV, Line, Loading, Section, T } from '@/ui/kit';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

type Period = 'today' | 'week' | 'month' | 'last_month';

export default function ExpensesReportScreen() {
  const params = useLocalSearchParams<{ user?: string; period?: string }>();
  const dialog = useDialog();
  const me = useMe();
  const [period, setPeriod] = useState<Period>(params.period === 'today' || params.period === 'week' || params.period === 'last_month' ? (params.period as Period) : 'month');
  const [user, setUser] = useState<string>(params.user ? String(params.user) : 'all');
  const [open, setOpen] = useState<string | null>(null);
  const range = periodRange(period);
  const q = useRpc<ExpenseReport>('expenses_report', { p_from: range.from, p_to: range.to, p_user_id: user === 'all' ? null : user });
  const all = useRpc<ExpenseReport>('expenses_report', { p_from: range.from, p_to: range.to, p_user_id: null });
  const r = q.data;

  function print() {
    if (!r) return;
    printDoc(
      reportHtml({
        title: 'Expenses',
        subtitle: `${r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} to ${fmtDate(r.to)}`}. Total ${money(r.total)}`,
        company: me.company,
        tables: [
          ...(r.office.length ? [{ heading: `Office: ${money(r.office_total)}`, cols: [{ label: 'Date' }, { label: 'For' }, { label: 'Note' }, { label: 'Amount', right: true }], rows: r.office.map((e) => [fmtDate(e.date), e.label, e.note ?? '', num(e.amount)]) }] : []),
          ...(r.tours.length
            ? [
                { heading: `Order taker tours: ${money(r.tour_total)}`, cols: [{ label: 'Date' }, { label: 'Order taker' }, { label: 'City' }, { label: 'Details' }, { label: 'Amount', right: true }], rows: r.tours.map((t) => [fmtDate(t.date), t.name, t.city, t.items.map((i) => `${i.label} ${num(i.amount)}`).join(', '), num(t.total)]) },
                { heading: 'Average cost of a tour by city', cols: [{ label: 'City' }, { label: 'Tours', right: true }, { label: 'Average', right: true }], rows: r.by_city.map((c) => [c.city, c.tours, num(c.average)]) },
              ]
            : []),
        ],
      }),
    ).catch(() => {});
  }

  async function remove(id: string, label: string) {
    const ok = await dialog.confirm({ title: 'Delete this expense?', message: label, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await rpc('expense_delete', { p_id: id });
      q.reload();
      all.reload();
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    }
  }

  return (
    <Screen title="Expenses" back="/more" right={<Btn title="Print" icon="print-outline" small kind="ghost" onPress={print} />} onRefresh={() => { q.refresh(); all.reload(); }} refreshing={q.refreshing}>
      <Chips<Period>
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
          { value: 'last_month', label: 'Last month' },
        ]}
      />
      {all.data && all.data.by_user.length > 1 ? (
        <Chips value={user} onChange={setUser} options={[{ value: 'all', label: 'Everyone' }, ...all.data.by_user.map((u) => ({ value: u.user_id, label: u.name }))]} />
      ) : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !r ? <Loading /> : null}
      <Btn title="Add office expense" icon="add" kind="secondary" onPress={() => router.push('/office-expense' as any)} />
      {r && r.tours.length === 0 && r.office.length === 0 ? <Empty icon="wallet-outline" title="No expenses in this period" hint="Order takers add their fares, petrol, food and stock carriage from their Home screen. Office expenses are added here." /> : null}
      {r && (r.tours.length || r.office.length) ? (
        <Card style={{ gap: 2 }}>
          <T v="small">
            {r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} to ${fmtDate(r.to)}`}
          </T>
          <T v="figure">{money(r.total)}</T>
          <KV k={`Order takers (${r.tours.length} ${r.tours.length === 1 ? 'tour' : 'tours'})`} v={money(r.tour_total)} />
          <KV k="Office" v={money(r.office_total)} />
        </Card>
      ) : null}
      {r && r.office.length && user === 'all' ? (
        <Section title={`Office expenses: ${money(r.office_total)}`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {r.office.map((e, n) => (
              <View key={e.id}>
                {n > 0 ? <Line /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 10, paddingHorizontal: S.lg }}>
                  <View style={{ flex: 1 }}>
                    <T v="strong">{e.label}</T>
                    <T v="small">{[fmtDate(e.date), e.note].filter(Boolean).join(', ')}</T>
                  </View>
                  <T v="strong">{money(e.amount)}</T>
                  <Pressable accessibilityLabel={`Delete ${e.label}`} onPress={() => remove(e.id, `${e.label}, ${money(e.amount)}`)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={C.red} />
                  </Pressable>
                </View>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}
      {r && r.tours.length ? (
        <>
          <Card style={{ gap: 2 }}>
            <T v="h3">Order taker tours: {money(r.tour_total)}</T>
            <View style={{ marginTop: S.sm, gap: 2 }}>
              {r.by_category.map((c) => (
                <KV key={c.category} k={c.label} v={money(c.amount)} />
              ))}
            </View>
          </Card>

          {user === 'all' && r.by_user.length > 1 ? (
            <Section title="By order taker">
              <Card style={{ gap: 2 }}>
                {r.by_user.map((u) => (
                  <KV key={u.user_id} k={`${u.name} (${u.tours} ${u.tours === 1 ? 'tour' : 'tours'})`} v={money(u.amount)} />
                ))}
              </Card>
            </Section>
          ) : null}

          <Section title="By city">
            <Card style={{ gap: 2 }}>
              {r.by_city.map((c) => (
                <KV key={c.city} k={`${c.city} (${c.tours} ${c.tours === 1 ? 'tour' : 'tours'})`} v={`${money(c.average)} a tour`} />
              ))}
              <T v="small" style={{ marginTop: 4 }}>Average cost of one tour to each city in this period.</T>
            </Card>
          </Section>

          <Section title="Tours">
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {r.tours.map((t, n) => {
                const key = `${t.user_id}|${t.date}|${t.city}`;
                const isOpen = open === key;
                return (
                  <View key={key}>
                    {n > 0 ? <Line /> : null}
                    <Pressable accessibilityRole="button" onPress={() => setOpen(isOpen ? null : key)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 12, paddingHorizontal: S.lg }}>
                      <View style={{ flex: 1 }}>
                        <T v="strong">
                          {t.city}, {fmtDate(t.date)}
                        </T>
                        <T v="small">
                          {t.name}, {t.orders} {t.orders === 1 ? 'order' : 'orders'} ({money(t.sales)})
                        </T>
                      </View>
                      <T v="strong">{money(t.total)}</T>
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={C.sub} />
                    </Pressable>
                    {isOpen ? (
                      <View style={{ paddingHorizontal: S.lg, paddingBottom: S.md, gap: 6 }}>
                        {t.items.map((e) => (
                          <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
                            <View style={{ flex: 1 }}>
                              <T>{e.label}</T>
                              {e.note ? <T v="small">{e.note}</T> : null}
                            </View>
                            <T>{money(e.amount)}</T>
                            <Pressable accessibilityLabel={`Delete ${e.label}`} onPress={() => remove(e.id, `${t.name}, ${e.label}, ${money(e.amount)}`)} hitSlop={8}>
                              <Ionicons name="trash-outline" size={18} color={C.red} />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
