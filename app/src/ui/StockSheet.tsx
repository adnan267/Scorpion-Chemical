import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useRpc } from '@/lib/api';
import { printDoc, reportHtml } from '@/lib/report';
import { addDays, fmtDate, isoDate, money } from '@/lib/format';
import { Btn, Card, Empty, ErrorBox, Line, Loading, OrderTag, Section, T, Toggle } from './kit';
import { C, S } from './theme';

type Line_ = { product_name: string; qty: number };
type Booker = {
  user_id: string;
  name: string;
  role: string;
  orders: { id: string; order_no: string; customer: string; city: string | null; status: string; total: number; items: number }[] | null;
  totals: Line_[] | null;
};
type Sheet = { date: string; orders_count: number; to_deliver: number; totals: (Line_ & { product_id: string })[]; bookers: Booker[] };

function Totals({ rows }: { rows: Line_[] }) {
  return (
    <View style={{ gap: 2 }}>
      {rows.map((r, n) => (
        <View key={n} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md, paddingVertical: 4, borderBottomWidth: n < rows.length - 1 ? 1 : 0, borderBottomColor: C.line }}>
          <T style={{ flex: 1 }}>{r.product_name}</T>
          <T v="strong">{r.qty}</T>
        </View>
      ))}
    </View>
  );
}

/** The day's booked orders: what to take out of the store, per booker and in total. */
export function StockSheet() {
  const [day, setDay] = useState(isoDate(new Date()));
  const [withDelivered, setWithDelivered] = useState(false);
  const q = useRpc<Sheet>('stock_sheet', { p_date: day, p_include_delivered: withDelivered });
  const s = q.data;
  const today = isoDate(new Date());
  const me = useMe();

  function printSheet() {
    if (!s) return;
    const title = `Loading sheet, ${fmtDate(day)}`;
    printDoc(
      reportHtml({
        title: 'Loading sheet',
        subtitle: `${fmtDate(day)}, ${s.orders_count} ${s.orders_count === 1 ? 'order' : 'orders'}${withDelivered ? '' : ' still to go out'}`,
        company: me.company,
        tables: [
          { heading: 'Take out of the store in total', cols: [{ label: '#', width: '30px' }, { label: 'Product' }, { label: 'Qty', right: true, width: '70px' }, { label: 'Checked', width: '80px', blank: true }], rows: s.totals.map((r, n) => [n + 1, r.product_name, r.qty, '']) },
          ...s.bookers.map((b) => ({
            heading: `${b.name}: ${(b.orders ?? []).map((o) => `${o.customer} (${o.order_no})`).join(', ')}`,
            cols: [{ label: '#', width: '30px' }, { label: 'Product' }, { label: 'Qty', right: true, width: '70px' }],
            rows: (b.totals ?? []).map((r, n) => [n + 1, r.product_name, r.qty]),
          })),
        ],
        signLines: ['Taken out by', 'Checked by'],
      }),
    ).catch(() => {});
    return title;
  }

  return (
    <>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
        <Btn title="Previous day" small kind="secondary" icon="chevron-back" onPress={() => setDay(addDays(-1, new Date(day + 'T00:00:00')))} style={{ flex: 1 }} />
        <Btn title="Next day" small kind="secondary" onPress={() => setDay(addDays(1, new Date(day + 'T00:00:00')))} disabled={day >= today} style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <T v="h2">{day === today ? 'Today' : fmtDate(day)}</T>
        {s ? <T v="small">{s.orders_count} {s.orders_count === 1 ? 'order' : 'orders'}, {s.to_deliver} to deliver</T> : null}
      </View>
      <Toggle label="Also show orders already delivered" value={withDelivered} onChange={setWithDelivered} hint={withDelivered ? 'Showing every order booked on this day.' : 'Showing only orders still to go out of the store.'} />
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !s ? <Loading /> : null}
      {s && s.orders_count === 0 ? <Empty icon="cube-outline" title={withDelivered ? 'No orders on this day' : 'Nothing left to take out'} hint={withDelivered ? undefined : 'Turn on "Also show orders already delivered" to see the whole day.'} /> : null}
      {s && s.orders_count > 0 ? (
        <>
          <Section title="Take out in total">
            <Card>
              <Totals rows={s.totals} />
            </Card>
          </Section>
          <Btn title="Print loading sheet" icon="print-outline" onPress={printSheet} />
          <Btn title="Print all bills" icon="document-text-outline" kind="secondary" onPress={() => router.push(`/invoices?date=${day}` as any)} />
          {s.bookers.map((b) => (
            <Section key={b.user_id} title={b.name}>
              <Card style={{ gap: S.sm }}>
                <T v="smallStrong">Products for {b.name.split(' ')[0]}</T>
                <Totals rows={b.totals ?? []} />
                <Line />
                <T v="smallStrong">{(b.orders ?? []).length} {(b.orders ?? []).length === 1 ? 'order' : 'orders'}</T>
                {(b.orders ?? []).map((o) => (
                  <Pressable key={o.id} onPress={() => router.push(`/order/${o.id}` as any)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 6 }, pressed && { opacity: 0.6 }]}>
                    <View style={{ flex: 1 }}>
                      <T v="strong">{o.customer}</T>
                      <T v="small">{o.order_no}{o.city ? `, ${o.city}` : ''}, {o.items} {o.items === 1 ? 'item' : 'items'}</T>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <T v="small">{money(o.total)}</T>
                      <OrderTag status={o.status} />
                    </View>
                  </Pressable>
                ))}
                <Btn title={`Print ${b.name.split(' ')[0]}'s bills`} small kind="secondary" icon="print-outline" onPress={() => router.push(`/invoices?date=${day}&user=${b.user_id}` as any)} />
              </Card>
            </Section>
          ))}
        </>
      ) : null}
    </>
  );
}
