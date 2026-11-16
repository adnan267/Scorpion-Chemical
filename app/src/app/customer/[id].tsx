import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { customerTypeLabel, fmtDate, loginRoleFor, money, num, prettyPhone, toNumber } from '@/lib/format';
import { getHere, mapsUrl } from '@/lib/here';
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
  const dialog = useDialog();
  const staff = admin || me.role === 'order_taker';
  const [locating, setLocating] = useState(false);

  async function saveLocation() {
    const ok = await dialog.confirm({
      title: 'Save shop location?',
      message: c?.lat ? 'This replaces the saved location with where your phone is now. Do this only while you are at the shop.' : 'Your phone\'s current location will be saved as this shop. Do this only while you are at the shop.',
      confirmLabel: 'Save location',
    });
    if (!ok) return;
    setLocating(true);
    try {
      const h = await getHere();
      await rpc('customer_set_location', { p_customer_id: id, p_lat: h.lat, p_lng: h.lng });
      dialog.toast(h.accuracy && h.accuracy > 100 ? `Saved, but the location is rough (about ${Math.round(h.accuracy)} m)` : 'Shop location saved');
      q.reload();
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setLocating(false);
    }
  }

  async function setOpening() {
    const v = await dialog.ask({
      title: 'Opening balance',
      message: 'What this customer owed before you started using the app. Use a minus sign for an advance. Old bills with due dates are better added with "Add old bill".',
      confirmLabel: 'Save',
      input: { label: 'Amount (Rs.)', required: true, number: true, initial: String(Number(c?.opening_balance ?? 0)) },
    });
    if (v === null) return;
    const n = toNumber(v);
    if (isNaN(n)) return dialog.toast('Enter a number', 'error');
    try {
      await rpc('customer_set_opening', { p_customer_id: id, p_amount: n });
      dialog.toast('Opening balance saved');
      q.reload();
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    }
  }

  return (
    <Screen
      title={c?.name ?? 'Customer'}
      subtitle={c ? customerTypeLabel(c.type) : undefined}
      back="/customers"
      onRefresh={() => { q.refresh(); orders.reload(); }}
      refreshing={q.refreshing}
      right={c && (admin || (me.role === 'order_taker' && c.order_taker_id === me.id)) ? <IconBtn icon="create-outline" label="Edit customer" onPress={() => router.push(`/customer/form?id=${id}` as any)} /> : undefined}>
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
              {c.licence_expired ? <Tag label="Licence expired" tone="red" /> : null}
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
            <KV k="Credit days" v={c.credit_days !== null && c.credit_days !== undefined ? `${c.credit_days} days` : 'Not set'} />
            {c.licence_no || c.licence_expiry ? (
              <>
                <KV k="Licence no." v={c.licence_no ?? '-'} />
                {c.licence_issued ? <KV k="Licence issued" v={fmtDate(c.licence_issued)} /> : null}
                {c.licence_expiry ? <KV k="Licence expires" v={fmtDate(c.licence_expiry)} color={c.licence_expired ? C.red : undefined} /> : null}
              </>
            ) : null}
          </Card>

          {staff ? (
            <Card style={{ gap: S.sm }}>
              <T v="h3">Shop location</T>
              <T v="small">
                {c.lat !== null && c.lat !== undefined
                  ? `Saved${c.location_at ? ` on ${fmtDate(c.location_at)}` : ''}. Used to check route visits.`
                  : 'Not saved. Save it while standing at the shop, so route visits can be checked.'}
              </T>
              {c.route_days?.length ? <T v="small">On the route plan: Day {c.route_days.join(', ')}</T> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
                {c.lat !== null && c.lat !== undefined ? <Btn title="Open in Google Maps" icon="map-outline" small kind="secondary" onPress={() => Linking.openURL(mapsUrl(c.lat!, c.lng!))} /> : null}
                <Btn title={c.lat !== null && c.lat !== undefined ? 'Update location' : 'I am at the shop: save location'} icon="locate-outline" small kind={c.lat !== null && c.lat !== undefined ? 'ghost' : 'secondary'} onPress={saveLocation} loading={locating} />
              </View>
            </Card>
          ) : null}

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
                <Line />
                <MenuRow icon="time-outline" label="Opening balance" sub={`What was owed before the app: ${money(c.opening_balance ?? 0)}`} onPress={setOpening} />
                <Line />
                <MenuRow icon="document-outline" label="Add old bill" sub="An unpaid bill from before the app" onPress={() => router.push(`/opening/bill?customer=${id}&name=${name}` as any)} />
              </>
            ) : null}
          </Card>

          {admin ? (
            <Section title="App logins" action={<Pressable hitSlop={8} onPress={() => router.push(`/user/form?role=${loginRoleFor(c.type)}&customer=${id}&name=${name}` as any)}><T v="smallStrong" color={C.blue}>Add login</T></Pressable>}>
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
