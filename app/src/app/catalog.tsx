import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useCart } from '@/ctx/cart';
import { useRpc } from '@/lib/api';
import { bonusFor, fmtDate, money, num, schemeText } from '@/lib/format';
import type { Customer, Product } from '@/lib/types';
import { Amount, Btn, Card, Chips, Empty, ErrorBox, IconBtn, Loading, PackTag, SearchBox, Stepper, T, Tag } from '@/ui/kit';
import { ProductThumb } from '@/ui/rows';
import { Screen } from '@/ui/Shell';
import { C, F, S } from '@/ui/theme';

/**
 * One screen, two jobs:
 *  - ordering: a store/distributor (or staff ordering for ?customer=) adds products to the order
 *  - managing: admin without ?customer= sees stock and edits products
 */
export default function Catalog() {
  const me = useMe();
  const params = useLocalSearchParams<{ customer?: string; name?: string; filter?: string }>();
  const isCustomer = me.role === 'store' || me.role === 'distributor';
  const orderingFor = !isCustomer && params.customer ? { id: String(params.customer), name: String(params.name ?? 'Customer') } : null;
  const managing = me.role === 'admin' && !orderingFor;

  if (me.role === 'order_taker' && !orderingFor) return <Redirect href={'/customers?pick=order' as any} />;
  return managing ? <Manage initialFilter={params.filter === 'low' ? 'low' : 'all'} /> : <Shop orderingFor={orderingFor} />;
}

function matches(p: Product, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return `${p.name} ${p.pack_size ?? ''} ${p.category ?? ''} ${p.colour ?? ''}`.toLowerCase().includes(s);
}

// ------------------------------------------------------------------ ordering
function Shop({ orderingFor }: { orderingFor: { id: string; name: string } | null }) {
  const me = useMe();
  const cart = useCart();
  const [q, setQ] = useState('');
  const list = useRpc<Product[]>('products_list', { p_customer_id: orderingFor?.id ?? null });
  const staff = me.role === 'admin' || me.role === 'order_taker';
  const cust = useRpc<Customer>('customer_get', { p_id: orderingFor?.id }, !!orderingFor);

  // the order belongs to one customer; switching customer starts a new one
  useEffect(() => {
    cart.setCustomer(orderingFor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderingFor?.id]);

  const items = useMemo(() => (list.data ?? []).filter((p) => matches(p, q)), [list.data, q]);
  // colours of one product are shown together
  const groups = useMemo(() => {
    const out: Product[][] = [];
    const at = new Map<string, number>();
    for (const p of items) {
      const k = p.group_id ?? p.id;
      if (at.has(k)) out[at.get(k)!].push(p);
      else {
        at.set(k, out.length);
        out.push([p]);
      }
    }
    for (const g of out) if (g.length > 1) g.sort((a, b) => (a.colour ?? '').localeCompare(b.colour ?? ''));
    return out;
  }, [items]);

  return (
    <Screen
      title={orderingFor ? 'Take order' : 'Products'}
      subtitle={orderingFor ? `For ${orderingFor.name}` : undefined}
      top={!orderingFor}
      back="/customers"
      onRefresh={list.refresh}
      refreshing={list.refreshing}
      footer={
        cart.count > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/cart')} style={{ backgroundColor: C.blue, borderRadius: 8, paddingHorizontal: S.lg, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T v="strong" color={C.white}>
              {cart.lines.length} {cart.lines.length === 1 ? 'product' : 'products'}, {money(cart.total)}
            </T>
            <T v="strong" color={C.white}>Review order</T>
          </Pressable>
        ) : undefined
      }>
      {cust.data?.licence_expired ? (
        <Card style={{ backgroundColor: C.redSoft, borderColor: C.red }}>
          <T v="strong" color={C.red}>Drug licence expired</T>
          <T v="small" color={C.ink}>
            {cust.data.name}'s licence{cust.data.licence_no ? ` ${cust.data.licence_no}` : ''} expired on {fmtDate(cust.data.licence_expiry)}. You can still take the order; ask for the renewed licence.
          </T>
        </Card>
      ) : null}
      <SearchBox value={q} onChangeText={setQ} placeholder="Search products" />
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && items.length === 0 ? <Empty icon="cube-outline" title={q ? 'No product matches your search' : 'No products yet'} hint={q ? undefined : 'Products will show here once the admin adds them.'} /> : null}
      {groups.map((g) => {
        const p = g[0];
        const colours = g.length > 1 || !!p.colour;
        const off = Number(p.discount_pct) > 0;
        const scheme = schemeText(p.bonus_per, p.bonus_free);
        const stockText = (x: Product) =>
          staff ? (
            <T v="small" color={Number(x.stock_qty) <= 0 ? C.red : C.sub}>{Number(x.stock_qty) <= 0 ? 'Out of stock' : `${x.stock_qty} in stock`}</T>
          ) : !x.in_stock ? (
            <Tag label="Out of stock, may be delayed" tone="amber" />
          ) : null;
        const stepper = (x: Product) => {
          const qty = cart.qtyOf(x.id);
          const free = bonusFor(qty, x.bonus_per, x.bonus_free);
          return (
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              {qty > 0 ? <Stepper value={qty} onChange={(v) => cart.setQty(x, v)} /> : <Btn title="Add" small kind="secondary" icon="add" onPress={() => cart.setQty(x, 1)} />}
              {free ? <T v="smallStrong" color={C.green}>+ {free} free</T> : null}
            </View>
          );
        };
        return (
          <Card key={p.group_id ?? p.id} style={{ flexDirection: 'row', gap: S.md, padding: S.md }}>
            <ProductThumb path={p.image_path} size={72} />
            <View style={{ flex: 1, gap: 4 }}>
              <T v="strong">{p.name}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {p.pack_size ? <PackTag text={p.pack_size} /> : null}
                {p.packing ? <T v="small">{p.packing}</T> : null}
                {scheme ? <Tag label={`Scheme ${scheme}`} tone="green" /> : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <Amount value={p.price} size={17} color={C.blue} />
                {off ? <T v="small" style={{ textDecorationLine: 'line-through' }}>{num(p.net_rate)}</T> : null}
                {off ? <T v="smallStrong" color={C.green}>{num(p.discount_pct)}% off</T> : null}
              </View>
              {colours ? (
                <View style={{ gap: 8, marginTop: 4 }}>
                  {g.map((x) => (
                    <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T v="strong">{x.colour ?? 'Plain'}</T>
                        {stockText(x)}
                      </View>
                      {stepper(x)}
                    </View>
                  ))}
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, flexWrap: 'wrap' }}>
                  {stockText(p) ?? (p.retail_price ? <T v="small">Retail {money(p.retail_price)}</T> : <View />)}
                  {stepper(p)}
                </View>
              )}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

// ------------------------------------------------------------------ managing (admin)
function Manage({ initialFilter }: { initialFilter: 'all' | 'low' }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'inactive'>(initialFilter);
  const list = useRpc<Product[]>('products_list', { p_include_inactive: true });
  const all = list.data ?? [];
  const low = all.filter((p) => p.is_active && Number(p.stock_qty) <= Number(p.low_stock_level));
  const inactive = all.filter((p) => !p.is_active);
  const items = (filter === 'low' ? low : filter === 'inactive' ? inactive : all).filter((p) => matches(p, q));

  return (
    <Screen title="Products" top onRefresh={list.refresh} refreshing={list.refreshing} right={<IconBtn icon="add-circle" color={C.blue} label="Add product" onPress={() => router.push('/product/form')} />}>
      <SearchBox value={q} onChangeText={setQ} placeholder="Search products" />
      <Chips
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All', count: all.length },
          { value: 'low', label: 'Low stock', count: low.length },
          { value: 'inactive', label: 'Hidden', count: inactive.length },
        ]}
      />
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && items.length === 0 ? (
        <Empty
          icon="cube-outline"
          title={filter === 'low' ? 'No product is low on stock' : filter === 'inactive' ? 'No hidden products' : q ? 'No product matches your search' : 'No products yet'}
          action={filter === 'all' && !q ? <Btn title="Add product" icon="add" onPress={() => router.push('/product/form')} /> : undefined}
        />
      ) : null}
      {items.map((p) => {
        const isLow = Number(p.stock_qty) <= Number(p.low_stock_level);
        return (
          <Card key={p.id} onPress={() => router.push(`/product/form?id=${p.id}` as any)} style={{ flexDirection: 'row', gap: S.md, padding: S.md, opacity: p.is_active ? 1 : 0.65 }}>
            <ProductThumb path={p.image_path} size={56} />
            <View style={{ flex: 1, gap: 4 }}>
              <T v="strong">{p.name}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {p.pack_size ? <PackTag text={p.pack_size} /> : null}
                {p.colour ? <Tag label={p.colour} tone="blue" /> : null}
                {schemeText(p.bonus_per, p.bonus_free) ? <Tag label={`Scheme ${schemeText(p.bonus_per, p.bonus_free)}`} tone="green" /> : null}
                {!p.is_active ? <Tag label="Hidden" tone="gray" /> : null}
                {p.is_active && Number(p.net_rate) === 0 ? <Tag label="Rate not set" tone="red" /> : null}
              </View>
              <T v="small">Net rate {money(p.net_rate)}{p.retail_price ? `, retail ${money(p.retail_price)}` : ''}</T>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Stock of ${p.name}`} onPress={() => router.push(`/product/stock?id=${p.id}` as any)} style={{ alignItems: 'flex-end', justifyContent: 'center', paddingLeft: S.sm }}>
              <T style={{ fontFamily: F.bold, fontSize: 20 }} color={isLow && p.is_active ? C.red : C.ink}>{p.stock_qty}</T>
              <T v="small" color={C.blue}>Stock</T>
            </Pressable>
          </Card>
        );
      })}
    </Screen>
  );
}
