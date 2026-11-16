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
  items: { product_id: string; name: string; pack_size: string | null; colour: string | null; net_rate: number; discount_pct: number | null; bonus_per: number | null; bonus_free: number | null; product_bonus_per: number | null; product_bonus_free: number | null }[];
};

export default function Discounts() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dialog = useDialog();
  const q = useRpc<Data>('customer_discounts_get', { p_customer_id: id });
  const [def, setDef] = useState('0');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [schemes, setSchemes] = useState<Record<string, string>>({});
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.data && !filled) {
      setDef(String(Number(q.data.default_discount_pct)));
      setVals(Object.fromEntries(q.data.items.filter((i) => i.discount_pct !== null).map((i) => [i.product_id, String(Number(i.discount_pct))])));
      setSchemes(Object.fromEntries(q.data.items.filter((i) => i.bonus_per).map((i) => [i.product_id, i.bonus_free ? `${i.bonus_per}+${i.bonus_free}` : '0'])));
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
      const sc = (schemes[i.product_id] ?? '').replace(/\s/g, '');
      if (raw === '' && sc === '') continue;
      const v = raw === '' ? null : toNumber(raw);
      if (v !== null && (isNaN(v) || v < 0 || v > 100)) return setError(`Discount for ${i.name} ${i.pack_size ?? ''} must be between 0 and 100`);
      let per: number | null = null;
      let free: number | null = null;
      if (sc === '0') {
        per = 1;
        free = 0;
      } else if (sc !== '') {
        const m = sc.match(/^(\d+)\+(\d+)$/);
        if (!m || Number(m[1]) <= 0) return setError(`Write the scheme for ${i.name} like 100+2, or 0 for no scheme`);
        per = Number(m[1]);
        free = Number(m[2]);
      }
      items.push({ product_id: i.product_id, discount_pct: v, bonus_per: per, bonus_free: free });
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
          <T v="small">To give a different discount on one product, type it next to that product. Leave it empty to use the default. Scheme: free pieces like 100+2 (2 free with every 100); empty uses the product's own scheme, 0 means no scheme for this customer.</T>
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
                      <T v="strong">{i.name}{i.colour ? ` (${i.colour})` : ''}</T>
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
                    <TextInput
                      accessibilityLabel={`Scheme for ${i.name} ${i.pack_size ?? ''}`}
                      value={schemes[i.product_id] ?? ''}
                      onChangeText={(t) => setSchemes((v) => ({ ...v, [i.product_id]: t }))}
                      placeholder={i.product_bonus_per && i.product_bonus_free ? `${i.product_bonus_per}+${i.product_bonus_free}` : 'Scheme'}
                      placeholderTextColor={C.faint}
                      keyboardType="numbers-and-punctuation"
                      style={{ width: 74, textAlign: 'center', fontFamily: F.semi, fontSize: 15, color: C.ink, paddingVertical: 8, borderWidth: 1, borderColor: C.line, borderRadius: R.input, backgroundColor: C.surface }}
                    />
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
