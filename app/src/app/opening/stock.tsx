import React, { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';

import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { num } from '@/lib/format';
import type { Product } from '@/lib/types';
import { Btn, Card, Empty, ErrorBox, Line, Loading, SearchBox, T } from '@/ui/kit';
import { goBack, Screen } from '@/ui/Shell';
import { C, F, S } from '@/ui/theme';

export default function StockCount() {
  const dialog = useDialog();
  const list = useRpc<Product[]>('products_list', { p_customer_id: null });
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list.data ?? []).filter((p) => !s || `${p.name} ${p.pack_size ?? ''}`.toLowerCase().includes(s));
  }, [list.data, q]);

  const changed = (list.data ?? []).filter((p) => {
    const v = counts[p.id];
    return v !== undefined && v.trim() !== '' && Number(v) !== Number(p.stock_qty ?? 0);
  });

  async function save() {
    setError(null);
    const bad = changed.find((p) => !/^\d+$/.test(counts[p.id].trim()));
    if (bad) return setError(`Stock for ${bad.name} must be a whole number`);
    if (changed.length === 0) return setError('Type the new stock for at least one product');
    setBusy(true);
    try {
      const n = await rpc<number>('stock_set_bulk', { p_items: changed.map((p) => ({ product_id: p.id, qty: Number(counts[p.id]) })), p_note: 'Stock count' });
      dialog.toast(`Stock updated for ${n} ${n === 1 ? 'product' : 'products'}`);
      goBack('/opening');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Stock count"
      back="/opening"
      footer={<Btn title={changed.length ? `Save ${changed.length} ${changed.length === 1 ? 'change' : 'changes'}` : 'Save stock'} onPress={save} loading={busy} />}>
      <T color={C.sub}>Type how many of each product you have now. Leave a box empty to keep its stock as it is.</T>
      <SearchBox value={q} onChangeText={setQ} placeholder="Search products" />
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && items.length === 0 ? <Empty icon="cube-outline" title="No product matches your search" /> : null}
      {items.length ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {items.map((p, n) => (
            <View key={p.id}>
              {n > 0 ? <Line /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 10, paddingHorizontal: S.lg }}>
                <View style={{ flex: 1 }}>
                  <T v="strong">{p.name}</T>
                  <T v="small">
                    {p.pack_size ? `${p.pack_size}, ` : ''}now {num(p.stock_qty ?? 0)}
                  </T>
                </View>
                <TextInput
                  value={counts[p.id] ?? ''}
                  onChangeText={(t) => setCounts((c) => ({ ...c, [p.id]: t.replace(/[^\d]/g, '') }))}
                  placeholder={String(p.stock_qty ?? 0)}
                  placeholderTextColor={C.faint}
                  keyboardType="number-pad"
                  accessibilityLabel={`New stock for ${p.name}`}
                  style={{ width: 90, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontFamily: F.semi, fontSize: 16, color: C.ink, textAlign: 'right', backgroundColor: C.surface }}
                />
              </View>
            </View>
          ))}
        </Card>
      ) : null}
      {error ? <T color={C.red}>{error}</T> : null}
    </Screen>
  );
}
