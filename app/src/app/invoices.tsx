import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';

import { rpc, useRpc } from '@/lib/api';
import { fmtDate, isoDate } from '@/lib/format';
import { invoicesHtml } from '@/lib/invoice';
import type { InvoiceSettings, OrderDetail } from '@/lib/types';
import { Empty, ErrorBox, Loading, T } from '@/ui/kit';
import { InvoicePreview } from '@/ui/InvoicePreview';
import { Screen } from '@/ui/Shell';

type Sheet = { bookers: { user_id: string; name: string; orders: { id: string }[] | null }[] };

/** All invoices of a day (optionally one booker) in one printable document. */
export default function Invoices() {
  const params = useLocalSearchParams<{ date?: string; user?: string }>();
  const day = params.date ? String(params.date) : isoDate(new Date());
  const user = params.user ? String(params.user) : null;
  const sheet = useRpc<Sheet>('stock_sheet', { p_date: day, p_include_delivered: true });
  const settings = useRpc<InvoiceSettings>('invoice_settings');
  const [orders, setOrders] = useState<OrderDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ids = useMemo(
    () => (sheet.data?.bookers ?? []).filter((b) => !user || b.user_id === user).flatMap((b) => (b.orders ?? []).map((o) => o.id)),
    [sheet.data, user]
  );
  const who = user ? sheet.data?.bookers.find((b) => b.user_id === user)?.name : null;

  useEffect(() => {
    let alive = true;
    if (!sheet.data) return;
    setOrders(null);
    (async () => {
      try {
        const out: OrderDetail[] = [];
        for (const id of ids) out.push(await rpc<OrderDetail>('order_get', { p_id: id }));
        if (alive) setOrders(out);
      } catch (e: any) {
        if (alive) setError(e.message);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')]);

  const html = useMemo(() => (orders && settings.data ? invoicesHtml(orders, settings.data, `Invoices ${day}`) : null), [orders, settings.data, day]);
  const err = error || sheet.error || settings.error;

  return (
    <Screen title="All invoices" subtitle={`${fmtDate(day)}${who ? `, ${who}` : ''}`} back="/stock-sheet">
      {err ? <ErrorBox message={err} /> : null}
      {!err && (!html || !orders) ? <Loading /> : null}
      {orders && orders.length === 0 ? <Empty icon="document-text-outline" title="No orders on this day" /> : null}
      {html && orders && orders.length ? (
        <>
          <T v="small">{orders.length} {orders.length === 1 ? 'invoice' : 'invoices'}, each on its own page.</T>
          <InvoicePreview html={html} name={`Invoices ${day}`} />
        </>
      ) : null}
    </Screen>
  );
}
