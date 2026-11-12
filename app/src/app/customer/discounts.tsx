import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { num, toNumber } from '@/lib/format';
import { Btn, Card, ErrorBox, Field, Line, Loading, PackTag, T } from '@/ui/kit';
import { goBack, Screen } from '@/ui/Shell';
import { C, F, R, S } from '@/ui/theme';

type Data = {
  customer: { id: string; name: string; type: string };
  default_discount_pct: number;
  items: { product_id: string; name: string; pack_size: string | null; net_rate: number; discount_pct: number | null }[];
};

export default function Discounts() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dialog = useDialog();
  const q = useRpc<Data>('customer_discounts_get', { p_customer_id: id });
  const [def, setDef] = useState('0');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.data && !filled) {
      setDef(String(Number(q.data.default_discount_pct)));
      setVals(Object.fromEntries(q.data.items.filter((i) => i.discount_pct !== null).map((i) => [i.product_id, String(Number(i.discount_pct))])));
      setFilled(true);
    }
  }, [q.data, filled]);

  const defNum = toNumber(def || '0');

  async function save() {
    setError(null);
    if (isNaN(defNum) || defNum < 0 || defNum > 100) return setError('Default discount must be between 0 and 100');
    const items = [];
    for (const i of q.data?.items ?? []) {
      const raw = (vals[i.product_id] ?? '').trim();
      if (raw === '') continue;
      const v = toNumber(raw);
      if (isNaN(v) || v < 0 || v > 100) return setError(`Discount for ${i.name} ${i.pack_size ?? ''} must be between 0 and 100`);
      items.push({ product_id: i.product_id, discount_pct: v });
    }
    setBusy(true);
    try {
      await rpc('customer_discounts_set', { p_customer_id: id, p_default: defNum, p_items: items });
      dialog.toast('Discounts saved');
      goBack(`/customer/${id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Discounts" subtitle={q.data?.customer.name} back={`/customer/${id}`} footer={<Btn title="Save discounts" onPress={save} loading={busy} />}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <Loading /> : null}
      {q.data ? (
        <>
          <Field label="Default discount on every product" value={def} onChangeText={setDef} keyboardType="decimal-pad" prefix="%" />
          <T v="small">To give a different discount on one product, type it next to that product. Leave it empty to use the default.</T>
          <Card style={{ padding: 0 }}>
            {q.data.items.map((i, n) => {
              const raw = (vals[i.product_id] ?? '').trim();
              const pct = raw === '' ? defNum : toNumber(raw);
              const ok = !isNaN(pct) && pct >= 0 && pct <= 100;
              return (
                <View key={i.product_id}>
                  {n > 0 ? <Line /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.md }}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <T v="strong">{i.name}</T>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {i.pack_size ? <PackTag text={i.pack_size} /> : null}
                        <T v="small">
                          {num(i.net_rate)} {ok ? `becomes ${num(Math.round(Number(i.net_rate) * (100 - pct)) / 100)}` : ''}
                        </T>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: raw !== '' && !ok ? C.red : C.line, borderRadius: R.input, paddingHorizontal: 8, backgroundColor: C.surface }}>
                      <TextInput
                        accessibilityLabel={`Discount for ${i.name} ${i.pack_size ?? ''}`}
                        value={vals[i.product_id] ?? ''}
                        onChangeText={(t) => setVals((v) => ({ ...v, [i.product_id]: t }))}
                        placeholder={String(isNaN(defNum) ? 0 : defNum)}
                        placeholderTextColor={C.faint}
                        keyboardType="decimal-pad"
                        style={{ width: 52, textAlign: 'right', fontFamily: F.semi, fontSize: 16, color: C.ink, paddingVertical: 8 }}
                      />
                      <T color={C.sub}> %</T>
                    </View>
                  </View>
                </View>
              );
            })}
            {q.data.items.length === 0 ? <T color={C.sub} style={{ padding: S.lg }}>Add products first, then set discounts here.</T> : null}
          </Card>
          {error ? <T color={C.red}>{error}</T> : null}
        </>
      ) : null}
    </Screen>
  );
}
