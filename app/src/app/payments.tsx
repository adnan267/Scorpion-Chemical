import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';

import { useMe } from '@/ctx/auth';
import { useRpc } from '@/lib/api';
import type { PaymentRow } from '@/lib/types';
import { Btn, Chips, Empty, ErrorBox, IconBtn, Loading, T } from '@/ui/kit';
import { PaymentCard } from '@/ui/rows';
import { Screen } from '@/ui/Shell';
import { C } from '@/ui/theme';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Awaiting approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export default function Payments() {
  const me = useMe();
  const params = useLocalSearchParams<{ status?: string; customer?: string; name?: string }>();
  const [status, setStatus] = useState(params.status ? String(params.status) : 'all');
  const staff = me.role === 'admin' || me.role === 'order_taker';
  const customerId = params.customer ? String(params.customer) : null;
  const list = useRpc<PaymentRow[]>('payments_list', { p_status: status === 'all' ? null : status, p_customer_id: customerId, p_limit: 100 });
  const add = () => router.push((staff ? (customerId ? `/payment/new?customer=${customerId}&name=${encodeURIComponent(String(params.name ?? ''))}` : '/customers?pick=payment') : '/payment/new') as any);

  return (
    <Screen
      title="Payments"
      subtitle={customerId && params.name ? String(params.name) : undefined}
      top={!customerId}
      back="/customers"
      onRefresh={list.refresh}
      refreshing={list.refreshing}
      right={<IconBtn icon="add-circle" color={C.blue} label={staff ? 'Record payment' : 'Send payment'} onPress={add} />}>
      <Chips value={status} onChange={setStatus} options={FILTERS} />
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && list.data.length === 0 ? (
        <Empty
          icon="wallet-outline"
          title={status === 'all' ? 'No payments yet' : 'No payments match'}
          hint={status === 'all' ? (staff ? 'Payments you record will show here.' : 'Send a payment with its receipt and it will show here.') : 'Try another filter.'}
          action={status === 'all' ? <Btn title={staff ? 'Record payment' : 'Send payment'} onPress={add} /> : undefined}
        />
      ) : null}
      {list.data?.map((p) => <PaymentCard key={p.id} p={p} showCustomer={staff && !customerId} />)}
      {list.data && list.data.length === 100 ? <T v="small">Showing the latest 100 payments.</T> : null}
    </Screen>
  );
}
