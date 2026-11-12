import React, { useState } from 'react';

import { useAuth, useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { rpc } from '@/lib/api';
import { Btn, Field, T } from '@/ui/kit';
import { goBack, Screen } from '@/ui/Shell';
import { C } from '@/ui/theme';

export default function Settings() {
  const me = useMe();
  const { reloadProfile } = useAuth();
  const dialog = useDialog();
  const [name, setName] = useState(me.company?.name ?? '');
  const [address, setAddress] = useState(me.company?.address ?? '');
  const [phone, setPhone] = useState(me.company?.phone ?? '');
  const [email, setEmail] = useState(me.company?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim()) return setError('Enter the company name');
    setBusy(true);
    try {
      await rpc('settings_save', { p_company: { name, address, phone, email } });
      await reloadProfile();
      dialog.toast('Company details saved');
      goBack('/more');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Company details" back="/more" footer={<Btn title="Save details" onPress={save} loading={busy} />}>
      <T color={C.sub}>These details are printed at the top of every invoice.</T>
      <Field label="Company name" value={name} onChangeText={setName} />
      <Field label="Address" value={address} onChangeText={setAddress} />
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      {error ? <T color={C.red}>{error}</T> : null}
    </Screen>
  );
}
