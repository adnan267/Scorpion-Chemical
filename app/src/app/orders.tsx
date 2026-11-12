import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';

import { useMe } from '@/ctx/auth';
import { useRpc } from '@/lib/api';
import type { OrderRow } from '@/lib/types';
import { Btn, Chips, Empty, ErrorBox, IconBtn, Loading, SearchBox, T } from '@/ui/kit';
import { OrderCard } from '@/ui/rows';
import { Screen } from '@/ui/Shell';
import { C } from '@/ui/theme';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function Orders() {
  const me = useMe();
  const params = useLocalSearchParams<{ status?: string; customer?: string; name?: string }>();
  const [status, setStatus] = useState(params.status === 'open' ? 'all' : params.status ? String(params.status) : 'all');
  const [q, setQ] = useState('');
  const staff = me.role === 'admin' || me.role === 'order_taker';
  const customerId = params.customer ? String(params.customer) : null;
  const list = useRpc<OrderRow[]>('orders_list', {
    p_status: status === 'all' ? null : status,
    p_customer_id: customerId,
    p_search: q.trim() || null,
    p_limit: 100,
  });
  const newOrder = () => router.push((staff ? '/customers?pick=order' : '/catalog') as any);

  return (
    <Screen
      title="Orders"
      subtitle={customerId && params.name ? String(params.name) : undefined}
      top={!customerId}
      back="/customers"
      onRefresh={list.refresh}
      refreshing={list.refreshing}
      right={<IconBtn icon="add-circle" color={C.blue} label="New order" onPress={newOrder} />}>
      {staff ? <SearchBox value={q} onChangeText={setQ} placeholder="Search by order number or customer" /> : null}
      <Chips value={status} onChange={setStatus} options={FILTERS} />
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && list.data.length === 0 ? (
        <Empty
          icon="receipt-outline"
          title={status === 'all' && !q ? 'No orders yet' : 'No orders match'}
          hint={status === 'all' && !q ? (staff ? 'Choose a customer to take the first order.' : 'Order products and they will show here.') : 'Try another filter.'}
          action={status === 'all' && !q ? <Btn title={staff ? 'Take an order' : 'Order products'} onPress={newOrder} /> : undefined}
        />
      ) : null}
      {list.data?.map((o) => <OrderCard key={o.id} o={o} showCustomer={staff && !customerId} />)}
      {list.data && list.data.length === 100 ? <T v="small">Showing the latest 100 orders. Use search or a filter to find older ones.</T> : null}
    </Screen>
  );
}
