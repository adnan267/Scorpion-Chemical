import { useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';

import { useRpc } from '@/lib/api';
import { invoicesHtml } from '@/lib/invoice';
import type { InvoiceSettings, OrderDetail } from '@/lib/types';
import { ErrorBox, Loading } from '@/ui/kit';
import { InvoicePreview } from '@/ui/InvoicePreview';
import { Screen } from '@/ui/Shell';

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useRpc<OrderDetail>('order_get', { p_id: id });
  const settings = useRpc<InvoiceSettings>('invoice_settings');
  const html = useMemo(() => (order.data && settings.data ? invoicesHtml([order.data], settings.data, `Invoice ${order.data.order_no}`) : null), [order.data, settings.data]);
  const err = order.error || settings.error;

  return (
    <Screen title={order.data ? `Invoice ${order.data.order_no}` : 'Invoice'} subtitle={order.data?.customer.name} back={`/order/${id}`}>
      {err ? <ErrorBox message={err} onRetry={() => { order.reload(); settings.reload(); }} /> : null}
      {!html && !err ? <Loading /> : null}
      {html && order.data ? <InvoicePreview html={html} name={`Invoice ${order.data.order_no}`} /> : null}
    </Screen>
  );
}
