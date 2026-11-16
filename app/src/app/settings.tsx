import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';

import { useAuth, useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import type { InvoiceSettings } from '@/lib/types';
import { pickImage } from '@/lib/upload';
import { Btn, Card, Field, Loading, T, Toggle } from '@/ui/kit';
import { goBack, Screen } from '@/ui/Shell';
import { C } from '@/ui/theme';

export default function Settings() {
  const me = useMe();
  const { reloadProfile } = useAuth();
  const dialog = useDialog();
  const inv = useRpc<InvoiceSettings>('invoice_settings');
  const [name, setName] = useState(me.company?.name ?? '');
  const [address, setAddress] = useState(me.company?.address ?? '');
  const [phone, setPhone] = useState(me.company?.phone ?? '');
  const [email, setEmail] = useState(me.company?.email ?? '');
  const [warranty, setWarranty] = useState('');
  const [signer, setSigner] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [beforeDue, setBeforeDue] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inv.data || loaded) return;
    setWarranty(inv.data.invoice?.warranty ?? '');
    setSigner(inv.data.invoice?.signer ?? '');
    setSignature(inv.data.invoice?.signature ?? null);
    setBeforeDue(!!inv.data.returns?.before_due);
    setLoaded(true);
  }, [inv.data, loaded]);

  async function chooseSignature() {
    try {
      const p = await pickImage('library');
      if (!p) return;
      const url = `data:${p.mime};base64,${p.base64}`;
      if (url.length > 700000) return dialog.toast('That photo is too large. Crop it to just the signature and try again.', 'error');
      setSignature(url);
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    }
  }

  async function save() {
    setError(null);
    if (!name.trim()) return setError('Enter the company name');
    if (!warranty.trim()) return setError('Enter the warranty text for invoices');
    setBusy(true);
    try {
      await rpc('settings_save', { p_company: { name, address, phone, email } });
      await rpc('invoice_settings_save', { p: { warranty, signer, signature, returns_before_due: beforeDue } });
      await reloadProfile();
      dialog.toast('Settings saved');
      goBack('/more');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Company and invoice" back="/more" footer={<Btn title="Save settings" onPress={save} loading={busy} disabled={!loaded} />}>
      <T color={C.sub}>These details are printed at the top of every invoice.</T>
      <Field label="Company name" value={name} onChangeText={setName} />
      <Field label="Address" value={address} onChangeText={setAddress} />
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />

      {!loaded ? (
        <Loading />
      ) : (
        <>
          <Card style={{ gap: 10 }}>
            <T v="h3">Invoice footer</T>
            <Field label="Warranty" value={warranty} onChangeText={setWarranty} multiline numberOfLines={4} />
            <Field label="Signed by" value={signer} onChangeText={setSigner} placeholder="Name, title" />
            <T v="strong">Signature</T>
            {signature ? (
              <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, backgroundColor: '#fff', alignItems: 'flex-start' }}>
                <Image source={{ uri: signature }} style={{ width: 220, height: 70 }} resizeMode="contain" />
              </View>
            ) : (
              <T color={C.sub}>No signature. Invoices will show a blank line to sign by hand.</T>
            )}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Btn title={signature ? 'Change signature' : 'Add signature'} kind="secondary" small onPress={chooseSignature} />
              {signature ? <Btn title="Remove" kind="ghost" small onPress={() => setSignature(null)} /> : null}
            </View>
            <T v="small">Sign on plain white paper, take a photo, and crop it close around the signature.</T>
          </Card>

          <Card style={{ gap: 6 }}>
            <T v="h3">Returns</T>
            <Toggle
              label="Allow returns before the due date"
              value={beforeDue}
              onChange={setBeforeDue}
              hint="When off, goods can be returned only after the payment due date has passed."
            />
          </Card>
        </>
      )}
      {error ? <T color={C.red}>{error}</T> : null}
    </Screen>
  );
}
