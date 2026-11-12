import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useCart } from '@/ctx/cart';
import { useDialog } from '@/ctx/dialog';
import { rpc } from '@/lib/api';
import { money, num } from '@/lib/format';
import { Amount, Btn, Card, Empty, Field, IconBtn, KV, Line, PackTag, Stepper, T } from '@/ui/kit';
import { ProductThumb } from '@/ui/rows';
import { goBack, Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

export default function Cart() {
  const me = useMe();
  const cart = useCart();
  const dialog = useDialog();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const staff = me.role === 'admin' || me.role === 'order_taker';
  const subtotal = cart.lines.reduce((s, l) => s + l.qty * Number(l.product.net_rate), 0);

  async function place() {
    setBusy(true);
    try {
      const res = await rpc<{ id: string; order_no: string }>('order_place', {
        p_customer_id: cart.customer?.id ?? null,
        p_items: cart.lines.map((l) => ({ product_id: l.product.id, qty: l.qty })),
        p_notes: notes,
      });
      cart.clear();
      dialog.toast(`Order ${res.order_no} placed`);
      router.replace(`/order/${res.id}` as any);
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Review order"
      subtitle={cart.customer ? `For ${cart.customer.name}` : undefined}
      back="/catalog"
      footer={
        cart.lines.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.lg }}>
            <View style={{ flex: 1 }}>
              <T v="small">Total</T>
              <Amount value={cart.total} size={20} />
            </View>
            <Btn title="Place order" onPress={place} loading={busy} style={{ flex: 1 }} />
          </View>
        ) : undefined
      }>
      {cart.lines.length === 0 ? (
        <Empty icon="cart-outline" title="No products in this order" hint="Go back and add products." action={<Btn title="Back to products" kind="secondary" onPress={() => goBack('/catalog')} />} />
      ) : (
        <>
          {cart.lines.map(({ product: p, qty }) => {
            const line = Math.round(qty * Number(p.net_rate) * (100 - Number(p.discount_pct))) / 100;
            const short = staff && p.stock_qty !== null && qty > Number(p.stock_qty);
            return (
              <Card key={p.id} style={{ flexDirection: 'row', gap: S.md, padding: S.md }}>
                <ProductThumb path={p.image_path} size={56} />
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', gap: S.sm }}>
                    <T v="strong" style={{ flex: 1 }}>{p.name}</T>
                    <IconBtn icon="trash-outline" color={C.red} label={`Remove ${p.name}`} onPress={() => cart.setQty(p, 0)} />
                  </View>
                  {p.pack_size ? <PackTag text={p.pack_size} /> : null}
                  <T v="small">
                    {num(p.price)} each{Number(p.discount_pct) > 0 ? ` (${num(p.discount_pct)}% off ${num(p.net_rate)})` : ''}
                  </T>
                  {short ? <T v="small" color={C.red}>Only {p.stock_qty} in stock</T> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Stepper value={qty} min={1} onChange={(v) => cart.setQty(p, v)} />
                    <Amount value={line} size={16} />
                  </View>
                </View>
              </Card>
            );
          })}
          <Card>
            <KV k="Subtotal" v={money(subtotal)} />
            <KV k="Discount" v={`- ${money(subtotal - cart.total)}`} color={C.green} />
            <Line />
            <KV k="Total" v={money(cart.total)} strong />
          </Card>
          <Field label="Note for this order (optional)" value={notes} onChangeText={setNotes} multiline placeholder="e.g. deliver before Friday" />
          <T v="small">Rates and discounts are confirmed by the server when you place the order.</T>
        </>
      )}
    </Screen>
  );
}
