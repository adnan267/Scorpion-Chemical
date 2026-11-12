import { router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useRpc } from '@/lib/api';
import { fmtDate, money, num } from '@/lib/format';
import type { OrderRow, PaymentRow } from '@/lib/types';
import { Btn, Card, Empty, ErrorBox, Loading, Section, Stat, T } from '@/ui/kit';
import { OrderCard, PaymentCard } from '@/ui/rows';
import { Screen } from '@/ui/Shell';
import { C, R, S } from '@/ui/theme';

export default function Home() {
  const me = useMe();
  if (me.role === 'admin') return <AdminHome />;
  if (me.role === 'order_taker') return <TakerHome />;
  return <CustomerHome />;
}

function SeeAll({ href }: { href: string }) {
  return (
    <Pressable onPress={() => router.push(href as any)} hitSlop={8}>
      <T v="smallStrong" color={C.blue}>See all</T>
    </Pressable>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md }}>{children}</View>;
}

// ---------------------------------------------------------------- admin
function AdminHome() {
  const dash = useRpc<any>('dashboard');
  const orders = useRpc<OrderRow[]>('orders_list', { p_status: 'pending', p_limit: 5 });
  const pays = useRpc<PaymentRow[]>('payments_list', { p_status: 'pending', p_limit: 5 });
  const d = dash.data;
  const refresh = () => {
    dash.refresh();
    orders.reload();
    pays.reload();
  };

  return (
    <Screen title="Scorpion Chemical" subtitle="Admin" top onRefresh={refresh} refreshing={dash.refreshing}>
      {dash.error ? <ErrorBox message={dash.error} onRetry={dash.reload} /> : null}
      {!d && dash.loading ? <Loading /> : null}
      {d ? (
        <>
          <Grid>
            <Stat label="Orders today" value={String(d.today_orders)} sub={money(d.today_sales)} onPress={() => router.push('/orders')} />
            <Stat label="Sales this month" value={money(d.month_sales)} />
            <Stat label="Orders to confirm" value={String(d.pending_orders)} tone={d.pending_orders ? 'amber' : undefined} sub={`${d.to_deliver} to deliver`} onPress={() => router.push('/orders?status=pending')} />
            <Stat label="Payments to approve" value={String(d.pending_payments)} tone={d.pending_payments ? 'amber' : undefined} sub={money(d.pending_payments_amount)} onPress={() => router.push('/payments?status=pending')} />
            <Stat label="To receive from customers" value={money(d.total_outstanding)} tone="blue" onPress={() => router.push('/customers')} />
            <Stat label="Overdue" value={money(d.overdue_amount)} tone={d.overdue_orders ? 'red' : undefined} sub={`${d.overdue_orders} ${d.overdue_orders === 1 ? 'order' : 'orders'}`} onPress={() => router.push('/orders?status=overdue')} />
            <Stat label="Cash with order takers" value={money(d.cash_with_takers)} onPress={() => router.push('/cash')} />
            <Stat label="Low stock products" value={String(d.low_stock)} tone={d.low_stock ? 'red' : undefined} onPress={() => router.push('/catalog?filter=low')} />
          </Grid>

          <Section title="Orders to confirm" action={<SeeAll href="/orders?status=pending" />}>
            {orders.data?.length ? orders.data.map((o) => <OrderCard key={o.id} o={o} showCustomer />) : <Card><T color={C.sub}>No orders are waiting.</T></Card>}
          </Section>

          <Section title="Payments to approve" action={<SeeAll href="/payments?status=pending" />}>
            {pays.data?.length ? pays.data.map((p) => <PaymentCard key={p.id} p={p} showCustomer />) : <Card><T color={C.sub}>No payments are waiting.</T></Card>}
          </Section>

          <T v="small">
            {d.stores} medical {d.stores === 1 ? 'store' : 'stores'}, {d.distributors} {d.distributors === 1 ? 'distributor' : 'distributors'}, {d.order_takers} order {d.order_takers === 1 ? 'taker' : 'takers'}
          </T>
        </>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------- order taker
function TakerHome() {
  const me = useMe();
  const dash = useRpc<any>('dashboard');
  const orders = useRpc<OrderRow[]>('orders_list', { p_limit: 5 });
  const d = dash.data;

  return (
    <Screen title={`Hello, ${me.full_name.split(' ')[0]}`} subtitle="Order Taker" top onRefresh={() => { dash.refresh(); orders.reload(); }} refreshing={dash.refreshing}>
      <View style={{ flexDirection: 'row', gap: S.md }}>
        <Btn title="Take an order" icon="cart-outline" onPress={() => router.push('/customers?pick=order')} style={{ flex: 1 }} />
        <Btn title="Record payment" icon="cash-outline" kind="secondary" onPress={() => router.push('/customers?pick=payment')} style={{ flex: 1 }} />
      </View>
      {dash.error ? <ErrorBox message={dash.error} onRetry={dash.reload} /> : null}
      {!d && dash.loading ? <Loading /> : null}
      {d ? (
        <Grid>
          <Stat label="Your orders today" value={String(d.today_orders)} sub={money(d.today_sales)} />
          <Stat label="Your sales this month" value={money(d.month_sales)} />
          <Stat label="Cash in your hand" value={money(d.cash_in_hand)} tone={Number(d.cash_in_hand) ? 'amber' : undefined} sub="Not yet handed to admin" onPress={() => router.push('/cash')} />
          <Stat label="Your customers owe" value={money(d.customers_outstanding)} sub={`${d.customers} ${d.customers === 1 ? 'customer' : 'customers'}`} onPress={() => router.push('/customers')} />
        </Grid>
      ) : null}
      <Section title="Recent orders" action={<SeeAll href="/orders" />}>
        {orders.data?.length ? (
          orders.data.map((o) => <OrderCard key={o.id} o={o} showCustomer />)
        ) : orders.loading ? (
          <Loading />
        ) : (
          <Empty icon="receipt-outline" title="No orders yet" hint="Choose a customer and take your first order." />
        )}
      </Section>
    </Screen>
  );
}

// ---------------------------------------------------------------- store / distributor
function CustomerHome() {
  const me = useMe();
  const dash = useRpc<any>('dashboard');
  const orders = useRpc<OrderRow[]>('orders_list', { p_limit: 5 });
  const d = dash.data;
  const balance = Number(d?.balance ?? 0);
  const overdue = Number(d?.overdue_amount ?? 0);

  return (
    <Screen title={me.customer?.name ?? me.full_name} subtitle={me.role === 'distributor' ? 'Distributor' : 'Medical Store'} top onRefresh={() => { dash.refresh(); orders.reload(); }} refreshing={dash.refreshing}>
      {dash.error ? <ErrorBox message={dash.error} onRetry={dash.reload} /> : null}
      {!d && dash.loading ? <Loading /> : null}
      {d ? (
        <View style={{ backgroundColor: C.blue, borderRadius: R.card, padding: S.lg, gap: S.sm }}>
          <T color="#CFE2F5">{balance > 0 ? 'You have to pay' : balance < 0 ? 'Advance with Scorpion Chemical' : 'Your account is clear'}</T>
          <T v="figure" color={C.white}>Rs. {num(Math.abs(balance))}</T>
          {overdue > 0 ? (
            <View style={{ backgroundColor: C.white, borderRadius: R.tag, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' }}>
              <T v="smallStrong" color={C.red}>{money(overdue)} is overdue</T>
            </View>
          ) : null}
          {d.next_due ? (
            <T color="#CFE2F5">
              Next payment: {money(d.next_due.remaining)} by {fmtDate(d.next_due.due_date)} ({d.next_due.order_no})
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', gap: S.md, marginTop: S.sm }}>
            <Pressable accessibilityRole="button" onPress={() => router.push('/payment/new')} style={{ flex: 1, backgroundColor: C.white, borderRadius: R.input, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <T v="strong" color={C.blue}>Send payment</T>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.push('/ledger')} style={{ flex: 1, borderWidth: 1, borderColor: C.white, borderRadius: R.input, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <T v="strong" color={C.white}>Statement</T>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Btn title="Order products" icon="cart-outline" onPress={() => router.push('/catalog')} />

      {d ? (
        <Grid>
          <Stat label="Orders in progress" value={String(d.open_orders)} onPress={() => router.push('/orders?status=open')} />
          <Stat label="Payments awaiting approval" value={String(d.pending_payments)} sub={money(d.pending_payments_amount)} tone={d.pending_payments ? 'amber' : undefined} onPress={() => router.push('/payments?status=pending')} />
          <Stat label="Ordered this month" value={money(d.month_purchases)} />
        </Grid>
      ) : null}

      <Section title="Recent orders" action={<SeeAll href="/orders" />}>
        {orders.data?.length ? (
          orders.data.map((o) => <OrderCard key={o.id} o={o} showCustomer={false} />)
        ) : orders.loading ? (
          <Loading />
        ) : (
          <Empty icon="receipt-outline" title="No orders yet" hint="Your orders will show here after you place one." />
        )}
      </Section>
    </Screen>
  );
}
