import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Linking, Pressable, View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useRpc } from '@/lib/api';
import { money, num, prettyPhone } from '@/lib/format';
import type { Customer, OrderRow } from '@/lib/types';
import { Btn, Card, ErrorBox, IconBtn, KV, Line, Loading, Section, T, Tag } from '@/ui/kit';
import { MenuRow, OrderCard } from '@/ui/rows';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const q = useRpc<Customer>('customer_get', { p_id: id });
  const orders = useRpc<OrderRow[]>('orders_list', { p_customer_id: id, p_limit: 5 });
  const c = q.data;
  const admin = me.role === 'admin';
  const bal = Number(c?.balance ?? 0);
  const name = encodeURIComponent(c?.name ?? '');

  return (
    <Screen
      title={c?.name ?? 'Customer'}
      subtitle={c ? (c.type === 'distributor' ? 'Distributor' : 'Medical store') : undefined}
      back="/customers"
      onRefresh={() => { q.refresh(); orders.reload(); }}
      refreshing={q.refreshing}
      right={admin && c ? <IconBtn icon="create-outline" label="Edit customer" onPress={() => router.push(`/customer/form?id=${id}` as any)} /> : undefined}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !c ? <Loading /> : null}
      {c ? (
        <>
          <Card style={{ gap: S.sm }}>
            <T v="small">{bal > 0 ? 'To receive' : bal < 0 ? 'Advance received' : 'Account is clear'}</T>
            <T v="figure" color={bal > 0 ? C.red : bal < 0 ? C.green : C.ink}>{money(Math.abs(bal))}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {Number(c.overdue_amount) > 0 ? <Tag label={`${money(c.overdue_amount)} overdue`} tone="red" /> : null}
              {!c.is_active ? <Tag label="Inactive" tone="gray" /> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: S.md, marginTop: S.sm }}>
              <Btn title="Take order" icon="cart-outline" onPress={() => router.push(`/catalog?customer=${id}&name=${name}` as any)} style={{ flex: 1 }} disabled={!c.is_active} />
              <Btn title="Record payment" icon="cash-outline" kind="secondary" onPress={() => router.push(`/payment/new?customer=${id}&name=${name}` as any)} style={{ flex: 1 }} />
            </View>
          </Card>

          <Card style={{ gap: 2 }}>
            {c.owner_name ? <KV k="Owner" v={c.owner_name} /> : null}
            {c.phone ? (
              <KV
                k="Phone"
                v={
                  <Pressable onPress={() => Linking.openURL(`tel:${c.phone}`)} hitSlop={8}>
                    <T v="strong" color={C.blue}>{prettyPhone(c.phone)}</T>
                  </Pressable>
                }
              />
            ) : null}
            {c.address || c.city ? <KV k="Address" v={[c.address, c.city].filter(Boolean).join(', ')} /> : null}
            <KV k="Order taker" v={c.order_taker_name ?? 'Not assigned'} />
            <KV k="Default discount" v={`${num(c.default_discount_pct)}%`} />
          </Card>

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <MenuRow icon="document-text-outline" label="Statement" sub="Every order, payment and adjustment" onPress={() => router.push(`/ledger?customer=${id}` as any)} />
            <Line />
            <MenuRow icon="receipt-outline" label="All orders" sub={`${c.open_orders} in progress`} onPress={() => router.push(`/orders?customer=${id}&name=${name}` as any)} />
            <Line />
            <MenuRow icon="wallet-outline" label="All payments" onPress={() => router.push(`/payments?customer=${id}&name=${name}` as any)} />
            {admin ? (
              <>
                <Line />
                <MenuRow icon="pricetags-outline" label="Discounts" sub="Default discount and product-wise discounts" onPress={() => router.push(`/customer/discounts?id=${id}` as any)} />
              </>
            ) : null}
          </Card>

          {admin ? (
            <Section title="App logins" action={<Pressable hitSlop={8} onPress={() => router.push(`/user/form?role=${c.type}&customer=${id}&name=${name}` as any)}><T v="smallStrong" color={C.blue}>Add login</T></Pressable>}>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {c.logins?.length ? (
                  c.logins.map((u, n) => (
                    <View key={u.id}>
                      {n > 0 ? <Line /> : null}
                      <MenuRow icon="person-circle-outline" label={u.full_name} sub={`${prettyPhone(u.phone)}${u.is_active ? '' : ', deactivated'}`} onPress={() => router.push(`/user/form?id=${u.id}` as any)} />
                    </View>
                  ))
                ) : (
                  <T color={C.sub} style={{ padding: S.lg }}>No login yet. Add one so this customer can use the app.</T>
                )}
              </Card>
            </Section>
          ) : null}

          <Section title="Recent orders">
            {orders.data?.length ? orders.data.map((o) => <OrderCard key={o.id} o={o} showCustomer={false} />) : <Card><T color={C.sub}>No orders yet.</T></Card>}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
