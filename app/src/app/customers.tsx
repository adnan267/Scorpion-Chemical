import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';

import { useMe } from '@/ctx/auth';
import { useRpc } from '@/lib/api';
import { CUSTOMER_TYPES } from '@/lib/format';
import type { Customer } from '@/lib/types';
import { Btn, Chips, Empty, ErrorBox, IconBtn, Loading, SearchBox } from '@/ui/kit';
import { CustomerCard } from '@/ui/rows';
import { Screen } from '@/ui/Shell';
import { C } from '@/ui/theme';

export default function Customers() {
  const me = useMe();
  const params = useLocalSearchParams<{ pick?: string }>();
  const pick = params.pick === 'order' || params.pick === 'payment' ? params.pick : null;
  const [q, setQ] = useState('');
  const [type, setType] = useState<string>('all');
  const list = useRpc<Customer[]>('customers_list', {});
  const admin = me.role === 'admin';

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list.data ?? []).filter(
      (c) => (type === 'all' || c.type === type) && (!pick || c.is_active) && (!s || `${c.name} ${c.city ?? ''} ${c.phone ?? ''}`.toLowerCase().includes(s))
    );
  }, [list.data, q, type, pick]);

  function open(c: Customer) {
    const name = encodeURIComponent(c.name);
    if (pick === 'order') router.push(`/catalog?customer=${c.id}&name=${name}` as any);
    else if (pick === 'payment') router.push(`/payment/new?customer=${c.id}&name=${name}` as any);
    else router.push(`/customer/${c.id}` as any);
  }

  return (
    <Screen
      title={pick === 'order' ? 'Who is the order for?' : pick === 'payment' ? 'Who paid?' : 'Customers'}
      top={!pick && me.role === 'order_taker'}
      back="/"
      onRefresh={list.refresh}
      refreshing={list.refreshing}
      right={admin && !pick ? <IconBtn icon="add-circle" color={C.blue} label="Add customer" onPress={() => router.push('/customer/form')} /> : undefined}>
      <SearchBox value={q} onChangeText={setQ} placeholder="Search by name, city or phone" />
      <Chips
        value={type}
        onChange={setType}
        options={[
          { value: 'all', label: 'All' },
          ...CUSTOMER_TYPES.filter((t) => (list.data ?? []).some((c) => c.type === t.value)).map((t) => ({ value: t.value as string, label: t.plural })),
        ]}
      />
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && items.length === 0 ? (
        <Empty
          icon="storefront-outline"
          title={list.data.length === 0 ? 'No customers yet' : 'No customer matches'}
          hint={list.data.length === 0 ? (admin ? 'Add your medical stores and distributors here.' : 'The admin has not assigned any customers to you yet.') : undefined}
          action={admin && list.data.length === 0 ? <Btn title="Add customer" icon="add" onPress={() => router.push('/customer/form')} /> : undefined}
        />
      ) : null}
      {items.map((c) => <CustomerCard key={c.id} c={c} onPress={() => open(c)} />)}
    </Screen>
  );
}
