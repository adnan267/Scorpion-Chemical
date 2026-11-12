import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useDialog } from '@/ctx/dialog';
import { adminUsers, rpc, useRpc } from '@/lib/api';
import { isValidPhone, toNumber } from '@/lib/format';
import type { Customer, UserRow } from '@/lib/types';
import { Btn, Card, ErrorBox, Field, Loading, SelectField, T, Toggle } from '@/ui/kit';
import { goBack, Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

export default function CustomerForm() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? String(params.id) : null;
  const dialog = useDialog();
  const existing = useRpc<Customer>('customer_get', { p_id: id }, !!id);
  const takers = useRpc<UserRow[]>('users_list', { p_role: 'order_taker' });

  const [type, setType] = useState<'store' | 'distributor'>('store');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Multan');
  const [taker, setTaker] = useState<string>('');
  const [discount, setDiscount] = useState('0');
  const [opening, setOpening] = useState('');
  const [active, setActive] = useState(true);
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    const c = existing.data;
    if (c && !filled) {
      setType(c.type);
      setName(c.name);
      setOwner(c.owner_name ?? '');
      setPhone(c.phone ?? '');
      setAddress(c.address ?? '');
      setCity(c.city ?? '');
      setTaker(c.order_taker_id ?? '');
      setDiscount(String(Number(c.default_discount_pct)));
      setActive(c.is_active);
      setFilled(true);
    }
  }, [existing.data, filled]);

  async function save() {
    setError(null);
    const disc = toNumber(discount || '0');
    const open = opening.trim() ? toNumber(opening) : 0;
    if (!name.trim()) return setError('Enter the name');
    if (isNaN(disc) || disc < 0 || disc > 100) return setError('Discount must be between 0 and 100');
    if (isNaN(open)) return setError('Opening balance must be a number');
    const wantsLogin = !id && (loginPhone.trim() !== '' || loginPassword !== '');
    if (wantsLogin) {
      if (!isValidPhone(loginPhone)) return setError('Login mobile number should look like 03001234567');
      if (loginPassword.length < 6) return setError('Login password needs at least 6 characters');
    }
    setBusy(true);
    try {
      const newId = await rpc<string>('customer_save', {
        p: {
          id,
          type,
          name,
          owner_name: owner,
          phone,
          address,
          city,
          order_taker_id: taker || null,
          default_discount_pct: disc,
          is_active: active,
          opening_balance: id ? null : open,
        },
      });
      if (wantsLogin) {
        try {
          await adminUsers({ action: 'create', role: type, full_name: owner.trim() || name.trim(), phone: loginPhone, password: loginPassword, customer_id: newId });
        } catch (e: any) {
          dialog.toast(`Customer saved, but the login was not created: ${e.message}`, 'error');
          router.replace(`/customer/${newId}` as any);
          return;
        }
      }
      dialog.toast(id ? 'Customer saved' : 'Customer added');
      if (id) goBack(`/customer/${id}`);
      else router.replace(`/customer/${newId}` as any);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (id && existing.loading && !existing.data) {
    return (
      <Screen title="Edit customer" back="/customers">
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen title={id ? 'Edit customer' : 'Add customer'} back="/customers" footer={<Btn title={id ? 'Save changes' : 'Add customer'} onPress={save} loading={busy} />}>
      {existing.error ? <ErrorBox message={existing.error} /> : null}
      {!id ? (
        <SelectField
          label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: 'store', label: 'Medical store' },
            { value: 'distributor', label: 'Distributor' },
          ]}
        />
      ) : null}
      <Field label={type === 'distributor' ? 'Distributor name' : 'Store name'} value={name} onChangeText={setName} />
      <Field label="Owner name (optional)" value={owner} onChangeText={setOwner} />
      <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Address (optional)" value={address} onChangeText={setAddress} />
      <Field label="City" value={city} onChangeText={setCity} />
      <SelectField
        label="Order taker"
        value={taker}
        onChange={setTaker}
        options={[{ value: '', label: 'Not assigned' }, ...(takers.data ?? []).filter((u) => u.is_active || u.id === taker).map((u) => ({ value: u.id, label: u.full_name, sub: `${u.customers_count} customers` }))]}
        hint="Only the assigned order taker can order and collect payment for this customer."
      />
      <Field label="Default discount" value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" prefix="%" hint="Applies to every product unless you set a product-wise discount." />
      {!id ? <Field label="Opening balance (optional)" value={opening} onChangeText={setOpening} keyboardType="numbers-and-punctuation" prefix="Rs." hint="What this customer already owes you today. Use a minus sign for an advance." /> : null}
      {id ? <Toggle label="Active" value={active} onChange={setActive} hint="Inactive customers cannot place new orders." /> : null}

      {!id ? (
        <Card style={{ gap: S.md }}>
          <View>
            <T v="h3">App login (optional)</T>
            <T v="small">Fill this in if the customer will use the app. You can also add it later.</T>
          </View>
          <Field label="Login mobile number" value={loginPhone} onChangeText={setLoginPhone} keyboardType="phone-pad" placeholder="03001234567" />
          <Field label="Password" value={loginPassword} onChangeText={setLoginPassword} autoCapitalize="none" hint="At least 6 characters. Tell it to the customer." />
        </Card>
      ) : null}
      {error ? <T color={C.red}>{error}</T> : null}
    </Screen>
  );
}
