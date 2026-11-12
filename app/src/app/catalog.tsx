import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useCart } from '@/ctx/cart';
import { useRpc } from '@/lib/api';
import { money, num } from '@/lib/format';
import type { Product } from '@/lib/types';
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
  return `${p.name} ${p.pack_size ?? ''} ${p.category ?? ''}`.toLowerCase().includes(s);
}

// ------------------------------------------------------------------ ordering
function Shop({ orderingFor }: { orderingFor: { id: string; name: string } | null }) {
  const me = useMe();
  const cart = useCart();
  const [q, setQ] = useState('');
  const list = useRpc<Product[]>('products_list', { p_customer_id: orderingFor?.id ?? null });
  const staff = me.role === 'admin' || me.role === 'order_taker';

  // the order belongs to one customer; switching customer starts a new one
  useEffect(() => {
    cart.setCustomer(orderingFor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderingFor?.id]);

  const items = useMemo(() => (list.data ?? []).filter((p) => matches(p, q)), [list.data, q]);

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
      <SearchBox value={q} onChangeText={setQ} placeholder="Search products" />
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && items.length === 0 ? <Empty icon="cube-outline" title={q ? 'No product matches your search' : 'No products yet'} hint={q ? undefined : 'Products will show here once the admin adds them.'} /> : null}
      {items.map((p) => {
        const qty = cart.qtyOf(p.id);
        const off = Number(p.discount_pct) > 0;
        return (
          <Card key={p.id} style={{ flexDirection: 'row', gap: S.md, padding: S.md }}>
            <ProductThumb path={p.image_path} size={72} />
            <View style={{ flex: 1, gap: 4 }}>
              <T v="strong">{p.name}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {p.pack_size ? <PackTag text={p.pack_size} /> : null}
                {p.packing ? <T v="small">{p.packing}</T> : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <Amount value={p.price} size={17} color={C.blue} />
                {off ? <T v="small" style={{ textDecorationLine: 'line-through' }}>{num(p.net_rate)}</T> : null}
                {off ? <T v="smallStrong" color={C.green}>{num(p.discount_pct)}% off</T> : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, flexWrap: 'wrap' }}>
                {staff ? (
                  <T v="small" color={Number(p.stock_qty) <= 0 ? C.red : C.sub}>{Number(p.stock_qty) <= 0 ? 'Out of stock' : `${p.stock_qty} in stock`}</T>
                ) : !p.in_stock ? (
                  <Tag label="Out of stock, may be delayed" tone="amber" />
                ) : p.retail_price ? (
                  <T v="small">Retail {money(p.retail_price)}</T>
                ) : (
                  <View />
                )}
                {qty > 0 ? <Stepper value={qty} onChange={(v) => cart.setQty(p, v)} /> : <Btn title="Add" small kind="secondary" icon="add" onPress={() => cart.setQty(p, 1)} />}
              </View>
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
