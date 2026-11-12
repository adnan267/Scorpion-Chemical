import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { fmtDate, money, num, toNumber } from '@/lib/format';
import type { Ledger } from '@/lib/types';
import { Btn, Card, Empty, ErrorBox, Field, KV, Line, Loading, SelectField, Sheet, T } from '@/ui/kit';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

const KIND: Record<string, string> = { opening: 'Opening balance', order: 'Order delivered', payment: 'Payment', adjustment: 'Adjustment' };

export default function LedgerScreen() {
  const me = useMe();
  const dialog = useDialog();
  const params = useLocalSearchParams<{ customer?: string }>();
  const isCustomer = me.role === 'store' || me.role === 'distributor';
  const customerId = isCustomer ? null : params.customer ? String(params.customer) : null;
  const q = useRpc<Ledger>('ledger_get', { p_customer_id: customerId }, isCustomer || !!customerId);
  const l = q.data;
  const bal = Number(l?.balance ?? 0);
  const [adjust, setAdjust] = useState(false);
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveAdjust() {
    const v = toNumber(amount);
    if (!(v > 0)) return dialog.toast('Enter the amount', 'error');
    if (!note.trim()) return dialog.toast('Write the reason', 'error');
    setBusy(true);
    try {
      await rpc('ledger_adjust', { p_customer_id: customerId, p_amount: v, p_direction: direction, p_note: note });
      setAdjust(false);
      setAmount('');
      setNote('');
      dialog.toast('Adjustment saved');
      await q.reload();
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Statement" subtitle={isCustomer ? undefined : l?.customer.name} back={isCustomer ? '/' : customerId ? `/customer/${customerId}` : '/customers'} onRefresh={q.refresh} refreshing={q.refreshing}>
      {!isCustomer && !customerId ? <Empty title="Choose a customer first" action={<Btn title="Customers" onPress={() => router.replace('/customers')} />} /> : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !l ? <Loading /> : null}
      {l ? (
        <>
          <Card style={{ gap: 4 }}>
            <T v="small">{bal > 0 ? (isCustomer ? 'You have to pay' : 'To receive') : bal < 0 ? 'Advance' : 'Account is clear'}</T>
            <T v="figure" color={bal > 0 ? C.red : bal < 0 ? C.green : C.ink}>{money(Math.abs(bal))}</T>
            <Line />
            <KV k="Total billed" v={money(l.total_debit)} />
            <KV k="Total paid and credited" v={money(l.total_credit)} />
            {me.role === 'admin' ? <Btn title="Add adjustment" kind="secondary" small onPress={() => setAdjust(true)} style={{ alignSelf: 'flex-start', marginTop: S.sm }} /> : null}
          </Card>

          {l.entries.length === 0 ? <Empty icon="document-text-outline" title="Nothing on this account yet" hint="Delivered orders and approved payments will show here." /> : null}
          {l.entries.length ? (
            <Card style={{ padding: 0 }}>
              {l.entries.map((e, n) => {
                const isDebit = Number(e.debit) > 0;
                const target = e.order_id ? `/order/${e.order_id}` : e.payment_id ? `/payment/${e.payment_id}` : null;
                return (
                  <View key={e.id}>
                    {n > 0 ? <Line /> : null}
                    <Pressable disabled={!target} onPress={() => target && router.push(target as any)} style={({ pressed }) => [{ flexDirection: 'row', gap: S.md, padding: S.md }, pressed && { backgroundColor: C.paper }]}>
                      <View style={{ flex: 1 }}>
                        <T v="strong">{KIND[e.kind] ?? e.kind}</T>
                        <T v="small">{fmtDate(e.created_at)}{e.note ? `, ${e.note}` : ''}</T>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <T v="strong" color={isDebit ? C.red : C.green}>
                          {isDebit ? '+' : '-'} {num(isDebit ? e.debit : e.credit)}
                        </T>
                        <T v="small">Balance {num(e.balance)}</T>
                      </View>
                    </Pressable>
                  </View>
                );
              })}
            </Card>
          ) : null}
          <T v="small">Red amounts increase what is owed, green amounts reduce it. Entries are never changed; a mistake is fixed with a new adjustment.</T>
        </>
      ) : null}

      <Sheet visible={adjust} title="Add adjustment" onClose={() => setAdjust(false)} footer={<Btn title="Save adjustment" onPress={saveAdjust} loading={busy} />}>
        <View style={{ padding: S.lg, gap: S.md }}>
          <SelectField
            label="What should happen"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'credit', label: 'Reduce what the customer owes', sub: 'e.g. damaged goods, special discount' },
              { value: 'debit', label: 'Increase what the customer owes', sub: 'e.g. old bill, correction' },
            ]}
          />
          <Field label="Amount" prefix="Rs." value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="Reason" value={note} onChangeText={setNote} multiline placeholder="The customer will see this" />
        </View>
      </Sheet>
    </Screen>
  );
}
