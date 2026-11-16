import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { adminUsers, rpc, useRpc } from '@/lib/api';
import { CUSTOMER_TYPES, customerTypeLabel, isValidPhone, loginRoleFor, toNumber } from '@/lib/format';
import { getHere, type Here } from '@/lib/here';
import { pickImage, type Picked, uploadLicencePhoto } from '@/lib/upload';
import type { Customer, UserRow } from '@/lib/types';
import { Btn, Card, DateField, ErrorBox, Field, Loading, SelectField, T, Toggle } from '@/ui/kit';
import { goBack, Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

export default function CustomerForm() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? String(params.id) : null;
  const dialog = useDialog();
  const existing = useRpc<Customer>('customer_get', { p_id: id }, !!id);
  const me = useMe();
  const admin = me.role === 'admin';
  const takers = useRpc<UserRow[]>('users_list', { p_role: 'order_taker' }, admin);

  const [type, setType] = useState<string>('store');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Multan');
  const [taker, setTaker] = useState<string>('');
  const [discount, setDiscount] = useState('0');
  const [opening, setOpening] = useState('');
  const [creditDays, setCreditDays] = useState('');
  const [licenceNo, setLicenceNo] = useState('');
  const [licenceIssued, setLicenceIssued] = useState<string | null>(null);
  const [licenceExpiry, setLicenceExpiry] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const [here, setHere] = useState<Here | null>(null);
  const [licPhoto, setLicPhoto] = useState<Picked | null>(null);

  async function chooseLicence(source: 'camera' | 'library') {
    try {
      const p = await pickImage(source);
      if (p) setLicPhoto(p);
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    }
  }
  const [locating, setLocating] = useState(false);

  async function takeLocation() {
    setLocating(true);
    try {
      const h = await getHere();
      setHere(h);
      if (h.accuracy && h.accuracy > 100) dialog.toast(`Location is rough (about ${Math.round(h.accuracy)} m). Step outside and try again for a better fix.`, 'error');
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setLocating(false);
    }
  }

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
      setCreditDays(c.credit_days !== null && c.credit_days !== undefined ? String(c.credit_days) : '');
      setLicenceNo(c.licence_no ?? '');
      setLicenceIssued(c.licence_issued ?? null);
      setLicenceExpiry(c.licence_expiry ?? null);
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
    const days = creditDays.trim() === '' ? null : Number(creditDays.trim());
    if (days !== null && (!Number.isInteger(days) || days < 0 || days > 365)) return setError('Credit days must be a whole number from 0 to 365');
    const wantsLogin = admin && !id && (loginPhone.trim() !== '' || loginPassword !== '');
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
          credit_days: days,
          licence_no: licenceNo,
          licence_issued: licenceIssued,
          licence_expiry: licenceExpiry,
          is_active: active,
          opening_balance: id ? null : open,
          ...(here && !id ? { lat: here.lat, lng: here.lng } : {}),
        },
      });
      if (licPhoto) {
        try {
          const path = await uploadLicencePhoto(newId, licPhoto);
          await rpc('customer_set_licence_photo', { p_customer_id: newId, p_path: path });
        } catch (e: any) {
          dialog.toast(`Customer saved, but the licence photo was not: ${e.message}`, 'error');
        }
      }
      if (wantsLogin) {
        try {
          await adminUsers({ action: 'create', role: loginRoleFor(type), full_name: owner.trim() || name.trim(), phone: loginPhone, password: loginPassword, customer_id: newId });
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
      <SelectField label="Type" value={type} onChange={setType} options={CUSTOMER_TYPES.map((t) => ({ value: t.value as string, label: t.label }))} />
      <Field label={`${customerTypeLabel(type)} name`} value={name} onChangeText={setName} />
      <Field label="Owner name (optional)" value={owner} onChangeText={setOwner} />
      <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Address (optional)" value={address} onChangeText={setAddress} />
      <Field label="City" value={city} onChangeText={setCity} />
      {admin ? (
      <SelectField
        label="Order taker"
        value={taker}
        onChange={setTaker}
        options={[{ value: '', label: 'Not assigned' }, ...(takers.data ?? []).filter((u) => u.is_active || u.id === taker).map((u) => ({ value: u.id, label: u.full_name, sub: `${u.customers_count} customers` }))]}
        hint="Only the assigned order taker can order and collect payment for this customer."
      />
      ) : null}
      {admin ? <Field label="Default discount" value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" prefix="%" hint="Applies to every product unless you set a product-wise discount." /> : null}
      {admin ? <Field label="Credit days (optional)" value={creditDays} onChangeText={setCreditDays} keyboardType="number-pad" placeholder="e.g. 15" hint="When an order is delivered, the payment due date is set this many days later." /> : null}
      {!admin && !id ? <T v="small">The customer is added to your list. The admin sets the discount and credit days.</T> : null}
      {!id ? (
        <Card style={{ gap: S.sm }}>
          <T v="h3">Shop location (optional)</T>
          <T v="small">{here ? `Saved: ${here.lat.toFixed(5)}, ${here.lng.toFixed(5)}${here.accuracy ? `, within about ${Math.round(here.accuracy)} m` : ''}` : 'If you are at the shop now, save its location. It is used for the route plan and visits.'}</T>
          <View style={{ flexDirection: 'row' }}>
            <Btn title={here ? 'Take location again' : 'I am at the shop: save location'} icon="locate-outline" small kind="secondary" onPress={takeLocation} loading={locating} />
          </View>
        </Card>
      ) : null}
      <Card style={{ gap: S.md }}>
        <View>
          <T v="h3">Drug licence (optional)</T>
          <T v="small">Printed on this customer's invoices.</T>
        </View>
        <Field label="Licence number" value={licenceNo} onChangeText={setLicenceNo} autoCapitalize="characters" />
        <DateField label="Issue date" value={licenceIssued} onChange={setLicenceIssued} presets={[]} />
        <DateField label="Expiry date" value={licenceExpiry} onChange={setLicenceExpiry} presets={[]} />
        <T v="smallStrong" color={C.ink}>Licence photo</T>
        {licPhoto ? <Image source={{ uri: licPhoto.uri }} style={{ width: '100%', height: 180, borderRadius: 8, backgroundColor: C.paper }} resizeMode="contain" /> : existing.data?.licence_photo ? <T v="small">A photo is saved. Choose a new one to replace it.</T> : null}
        <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
          <Btn title="Take photo" icon="camera-outline" small kind="secondary" onPress={() => chooseLicence('camera')} />
          <Btn title="Choose photo" icon="image-outline" small kind="ghost" onPress={() => chooseLicence('library')} />
        </View>
      </Card>
      {admin && !id ? <Field label="Opening balance (optional)" value={opening} onChangeText={setOpening} keyboardType="numbers-and-punctuation" prefix="Rs." hint="What this customer already owes you today. Use a minus sign for an advance." /> : null}
      {admin && id ? <Toggle label="Active" value={active} onChange={setActive} hint="Inactive customers cannot place new orders." /> : null}

      {admin && !id ? (
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
