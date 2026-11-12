import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { isoDate, METHODS, money, toNumber } from '@/lib/format';
import type { Customer } from '@/lib/types';
import { pickImage, Picked, uploadProof } from '@/lib/upload';
import { Btn, Card, DateField, Field, SelectField, T } from '@/ui/kit';
import { Screen } from '@/ui/Shell';
import { C, R, S } from '@/ui/theme';

export default function NewPayment() {
  const me = useMe();
  const dialog = useDialog();
  const params = useLocalSearchParams<{ customer?: string; name?: string; order?: string; amount?: string }>();
  const isCustomer = me.role === 'store' || me.role === 'distributor';
  const [customerId, setCustomerId] = useState<string | null>(params.customer ? String(params.customer) : null);
  const customers = useRpc<Customer[]>('customers_list', {}, !isCustomer && !params.customer);
  const [amount, setAmount] = useState(params.amount ? String(params.amount) : '');
  const [method, setMethod] = useState<string>(me.role === 'order_taker' ? 'cash' : 'bank_transfer');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState<string | null>(isoDate(new Date()));
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // who must attach a receipt: customers always; order takers unless it is cash; admin never
  const receiptRequired = isCustomer || (me.role === 'order_taker' && method !== 'cash');
  const customerName = isCustomer ? me.customer?.name : params.name ? String(params.name) : customers.data?.find((c) => c.id === customerId)?.name;

  async function choose(source: 'camera' | 'library') {
    try {
      const p = await pickImage(source);
      if (p) setPhoto(p);
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    }
  }

  async function submit() {
    setError(null);
    const value = toNumber(amount);
    if (!isCustomer && !customerId) return setError('Choose the customer');
    if (!(value > 0)) return setError('Enter the amount');
    if (!paidOn) return setError('Enter the payment date');
    if (receiptRequired && !photo) return setError('Attach a photo of the receipt');
    setBusy(true);
    try {
      const proofPath = photo ? await uploadProof(me.id, photo) : null;
      const res = await rpc<{ id: string; status: string }>('payment_submit', {
        p_customer_id: isCustomer ? null : customerId,
        p_amount: value,
        p_method: method,
        p_reference_no: reference,
        p_proof_path: proofPath,
        p_note: note,
        p_order_id: params.order ? String(params.order) : null,
        p_paid_on: paidOn,
      });
      dialog.toast(res.status === 'approved' ? 'Payment recorded' : 'Payment sent for approval');
      router.replace(`/payment/${res.id}` as any);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={isCustomer ? 'Send payment' : 'Record payment'} subtitle={customerName ? (isCustomer ? undefined : `From ${customerName}`) : undefined} back="/payments" footer={<Btn title={me.role === 'admin' ? 'Save payment' : 'Send for approval'} onPress={submit} loading={busy} />}>
      {!isCustomer && !params.customer ? (
        <SelectField
          label="Customer"
          value={customerId}
          onChange={setCustomerId}
          placeholder={customers.loading ? 'Loading customers...' : 'Choose customer'}
          options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name, sub: `${c.type === 'distributor' ? 'Distributor' : 'Medical store'}${c.city ? ', ' + c.city : ''}, balance ${money(c.balance)}` }))}
        />
      ) : null}
      <Field label="Amount" prefix="Rs." value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
      <SelectField label="Paid by" value={method} onChange={setMethod} options={METHODS} />
      {method !== 'cash' ? <Field label="Transaction / reference no. (optional)" value={reference} onChangeText={setReference} autoCapitalize="characters" /> : null}
      <DateField label="Payment date" value={paidOn} onChange={setPaidOn} presets={[0]} />

      <View style={{ gap: S.sm }}>
        <T v="smallStrong" color={C.ink}>Receipt photo{receiptRequired ? '' : ' (optional)'}</T>
        {photo ? (
          <Card style={{ gap: S.sm, padding: S.md }}>
            <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 220, borderRadius: R.input, backgroundColor: C.graySoft }} contentFit="contain" />
            <Btn title="Remove photo" kind="ghost" small onPress={() => setPhoto(null)} />
          </Card>
        ) : (
          <View style={{ flexDirection: 'row', gap: S.md }}>
            <Btn title="Take photo" icon="camera-outline" kind="secondary" onPress={() => choose('camera')} style={{ flex: 1 }} />
            <Btn title="Choose photo" icon="image-outline" kind="secondary" onPress={() => choose('library')} style={{ flex: 1 }} />
          </View>
        )}
        <T v="small">
          {isCustomer
            ? 'Attach the bank slip, or a screenshot of the transfer.'
            : me.role === 'order_taker'
              ? method === 'cash'
                ? 'Cash does not need a receipt. It stays in your cash in hand until the admin approves it.'
                : 'A receipt is needed for payments that are not cash.'
              : 'Payments entered by the admin are approved straight away.'}
        </T>
      </View>

      <Field label="Note (optional)" value={note} onChangeText={setNote} multiline />
      {error ? <T color={C.red}>{error}</T> : null}
    </Screen>
  );
}
