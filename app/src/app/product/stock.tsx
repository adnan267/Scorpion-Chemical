import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { Btn, Card, DateField, ErrorBox, Field, Line, Loading, PackTag, Section, SelectField, T } from '@/ui/kit';
import { Screen } from '@/ui/Shell';
import { C, F, S } from '@/ui/theme';

type Data = {
  product: { id: string; name: string; pack_size: string | null; stock_qty: number; low_stock_level: number } | null;
  entries: { id: string; qty: number; kind: string; note: string | null; batch_no: string | null; expiry_date: string | null; created_at: string; by: string | null }[];
};

const KIND: Record<string, string> = { in: 'Stock received', adjust: 'Correction', order: 'Sold', order_cancel: 'Order cancelled' };

export default function Stock() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dialog = useDialog();
  const q = useRpc<Data>('stock_history', { p_product_id: id });
  const p = q.data?.product;
  const [kind, setKind] = useState<'in' | 'remove'>('in');
  const [qty, setQty] = useState('');
  const [batch, setBatch] = useState('');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = parseInt(qty, 10);
    if (!(n > 0)) return dialog.toast('Enter the quantity', 'error');
    if (kind === 'remove' && !note.trim()) return dialog.toast('Write why stock is being removed', 'error');
    setBusy(true);
    try {
      await rpc('stock_add', {
        p_product_id: id,
        p_qty: kind === 'in' ? n : -n,
        p_kind: kind === 'in' ? 'in' : 'adjust',
        p_note: note,
        p_batch_no: kind === 'in' ? batch : null,
        p_expiry_date: kind === 'in' ? expiry : null,
      });
      setQty('');
      setBatch('');
      setExpiry(null);
      setNote('');
      dialog.toast(kind === 'in' ? `${n} added to stock` : `${n} removed from stock`);
      await q.reload();
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Stock" subtitle={p ? `${p.name}${p.pack_size ? ' ' + p.pack_size : ''}` : undefined} back="/catalog" onRefresh={q.refresh} refreshing={q.refreshing}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <Loading /> : null}
      {p ? (
        <>
          <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ gap: 4 }}>
              <T v="strong">{p.name}</T>
              {p.pack_size ? <PackTag text={p.pack_size} /> : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <T style={{ fontFamily: F.bold, fontSize: 30, lineHeight: 36 }} color={p.stock_qty <= p.low_stock_level ? C.red : C.ink}>{p.stock_qty}</T>
              <T v="small">in stock{p.low_stock_level ? `, warn at ${p.low_stock_level}` : ''}</T>
            </View>
          </Card>

          <Card style={{ gap: S.md }}>
            <SelectField
              label="What happened"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'in', label: 'New stock received' },
                { value: 'remove', label: 'Remove stock', sub: 'Damaged, expired or a counting mistake' },
              ]}
            />
            <Field label="Quantity" value={qty} onChangeText={setQty} keyboardType="number-pad" placeholder="0" />
            {kind === 'in' ? (
              <>
                <Field label="Batch no. (optional)" value={batch} onChangeText={setBatch} autoCapitalize="characters" />
                <DateField label="Expiry date (optional)" value={expiry} onChange={setExpiry} presets={[]} />
              </>
            ) : null}
            <Field label={kind === 'in' ? 'Note (optional)' : 'Reason'} value={note} onChangeText={setNote} />
            <Btn title={kind === 'in' ? 'Add to stock' : 'Remove from stock'} onPress={save} loading={busy} />
          </Card>

          <Section title="Stock history">
            <Card style={{ padding: 0 }}>
              {q.data!.entries.length === 0 ? <T color={C.sub} style={{ padding: S.lg }}>No stock movements yet.</T> : null}
              {q.data!.entries.map((e, n) => (
                <View key={e.id}>
                  {n > 0 ? <Line /> : null}
                  <View style={{ flexDirection: 'row', gap: S.md, padding: S.md }}>
                    <View style={{ flex: 1 }}>
                      <T v="strong">{KIND[e.kind] ?? e.kind}</T>
                      <T v="small">
                        {fmtDateTime(e.created_at)}
                        {e.by ? `, ${e.by}` : ''}
                      </T>
                      {e.note || e.batch_no || e.expiry_date ? (
                        <T v="small">
                          {[e.note, e.batch_no ? `Batch ${e.batch_no}` : null, e.expiry_date ? `Expiry ${fmtDate(e.expiry_date)}` : null].filter(Boolean).join(', ')}
                        </T>
                      ) : null}
                    </View>
                    <T v="strong" color={e.qty > 0 ? C.green : C.red}>
                      {e.qty > 0 ? '+' : ''}
                      {e.qty}
                    </T>
                  </View>
                </View>
              ))}
            </Card>
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
