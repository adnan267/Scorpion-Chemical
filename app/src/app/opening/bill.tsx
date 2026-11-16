import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useDialog } from '@/ctx/dialog';
import { rpc } from '@/lib/api';
import { addDays, money, toNumber } from '@/lib/format';
import { Btn, Card, DateField, Field, T } from '@/ui/kit';
import { MenuRow } from '@/ui/rows';
import { goBack, Screen } from '@/ui/Shell';
import { C } from '@/ui/theme';

export default function OldBill() {
  const params = useLocalSearchParams<{ customer?: string; name?: string }>();
  const customerId = params.customer ? String(params.customer) : null;
  const customerName = params.name ? String(params.name) : null;
  const dialog = useDialog();
  const [billNo, setBillNo] = useState('');
  const [date, setDate] = useState<string | null>(addDays(0));
  const [amount, setAmount] = useState('');
  const [paid, setPaid] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backTo = customerId ? `/customer/${customerId}` : '/opening';

  async function save(another: boolean) {
    setError(null);
    if (!customerId) return setError('Choose the customer');
    if (!date) return setError('Enter the bill date');
    const amt = toNumber(amount);
    if (!(amt > 0)) return setError('Enter the bill amount');
    const pd = paid.trim() ? toNumber(paid) : 0;
    if (isNaN(pd) || pd < 0 || pd > amt) return setError('Amount already paid must be between 0 and the bill amount');
    setBusy(true);
    try {
      await rpc('opening_bill_add', { p: { customer_id: customerId, bill_no: billNo.trim() || null, date, amount: amt, paid: pd, due_date: due } });
      dialog.toast(`Old bill of ${money(amt - pd)} added`);
      if (another) {
        setBillNo('');
        setAmount('');
        setPaid('');
        setDue(null);
      } else goBack(backTo);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Add old bill"
      subtitle={customerName ?? undefined}
      back={backTo}
      footer={
        <View style={{ gap: 8, width: '100%' }}>
          <Btn title="Save bill" onPress={() => save(false)} loading={busy} disabled={!customerId} />
          <Btn title="Save and add another" kind="secondary" onPress={() => save(true)} disabled={busy || !customerId} />
        </View>
      }>
      <T color={C.sub}>An unpaid bill from before the app. Only the amount is needed, not the products. It is added to the customer's account and gets due-date reminders.</T>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <MenuRow icon="storefront-outline" label={customerName ?? 'Choose the customer'} sub={customerName ? 'Tap to change' : undefined} onPress={() => router.push('/customers?pick=bill' as any)} />
      </Card>
      <Field label="Bill number (optional)" value={billNo} onChangeText={setBillNo} autoCapitalize="characters" hint="Your old bill book number. Left blank, the app gives it a number starting with OB-." />
      <DateField label="Bill date" value={date} onChange={setDate} presets={[]} />
      <Field label="Bill amount (Rs.)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Field label="Already paid (Rs., optional)" value={paid} onChangeText={setPaid} keyboardType="decimal-pad" hint="If part of this bill was paid before the app." />
      <DateField label="Payment due date (optional)" value={due} onChange={setDue} presets={[0, 7, 15, 30]} />
      {error ? <T color={C.red}>{error}</T> : null}
    </Screen>
  );
}
