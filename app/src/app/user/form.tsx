import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { adminUsers, rpc, useRpc } from '@/lib/api';
import { isValidPhone, prettyPhone, ROLE_LABEL } from '@/lib/format';
import type { UserRow } from '@/lib/types';
import { Btn, Card, Field, KV, Loading, T, Toggle } from '@/ui/kit';
import { goBack, Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

export default function UserForm() {
  const params = useLocalSearchParams<{ id?: string; role?: string; customer?: string; name?: string }>();
  const id = params.id ? String(params.id) : null;
  const me = useMe();
  const dialog = useDialog();
  const all = useRpc<UserRow[]>('users_list', {}, !!id);
  const existing = all.data?.find((u) => u.id === id);
  const role = existing?.role ?? (params.role ? String(params.role) : 'order_taker');
  const backTo = params.customer ? `/customer/${params.customer}` : '/users';

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [active, setActive] = useState(true);
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing && !filled) {
      setName(existing.full_name);
      setActive(existing.is_active);
      setFilled(true);
    }
  }, [existing, filled]);

  async function create() {
    setError(null);
    if (!name.trim()) return setError('Enter the name');
    if (!isValidPhone(phone)) return setError('Mobile number should look like 03001234567');
    if (password.length < 6) return setError('Password needs at least 6 characters');
    setBusy('save');
    try {
      await adminUsers({ action: 'create', role, full_name: name.trim(), phone, password, customer_id: params.customer ? String(params.customer) : null });
      dialog.toast('Login created');
      goBack(backTo);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit() {
    setError(null);
    if (!name.trim()) return setError('Enter the name');
    setBusy('save');
    try {
      await rpc('user_update', { p_id: id, p_full_name: name, p_is_active: active });
      dialog.toast('Saved');
      goBack(backTo);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword() {
    const pw = await dialog.ask({ title: 'Set a new password', message: `For ${existing?.full_name}. Tell them the new password yourself.`, confirmLabel: 'Set password', input: { label: 'New password (at least 6 characters)', required: true } });
    if (pw === null) return;
    if (pw.length < 6) return dialog.toast('Password needs at least 6 characters', 'error');
    setBusy('pw');
    try {
      await adminUsers({ action: 'set_password', user_id: id, password: pw });
      dialog.toast('Password changed');
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function changePhone() {
    const ph = await dialog.ask({ title: 'Change mobile number', message: 'They will sign in with the new number from now on.', confirmLabel: 'Change number', input: { label: 'New mobile number', required: true, placeholder: '03001234567' } });
    if (ph === null) return;
    if (!isValidPhone(ph)) return dialog.toast('Mobile number should look like 03001234567', 'error');
    setBusy('phone');
    try {
      await adminUsers({ action: 'set_phone', user_id: id, phone: ph });
      dialog.toast('Mobile number changed');
      await all.reload();
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (id && !existing) {
    return (
      <Screen title="Login" back={backTo}>
        {all.error ? <T color={C.red}>{all.error}</T> : all.loading ? <Loading /> : <T>This login was not found.</T>}
      </Screen>
    );
  }

  if (!id) {
    return (
      <Screen title={`New ${ROLE_LABEL[role]?.toLowerCase() ?? 'user'} login`} subtitle={params.name ? String(params.name) : undefined} back={backTo} footer={<Btn title="Create login" onPress={create} loading={busy === 'save'} />}>
        <Field label="Name" value={name} onChangeText={setName} />
        <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="03001234567" hint="They sign in with this number." />
        <Field label="Password" value={password} onChangeText={setPassword} autoCapitalize="none" hint="At least 6 characters. Tell it to them; they can change it later." />
        {role === 'admin' ? <T v="small" color={C.amber}>An admin can see and change everything, including payments and other logins.</T> : null}
        {error ? <T color={C.red}>{error}</T> : null}
      </Screen>
    );
  }

  return (
    <Screen title={existing!.full_name} subtitle={ROLE_LABEL[existing!.role]} back={backTo} footer={<Btn title="Save changes" onPress={saveEdit} loading={busy === 'save'} />}>
      <Card style={{ gap: 2 }}>
        <KV k="Mobile number" v={prettyPhone(existing!.phone)} strong />
        <KV k="Role" v={ROLE_LABEL[existing!.role]} />
        {existing!.customer_name ? <KV k="Customer" v={existing!.customer_name} /> : null}
      </Card>
      <Field label="Name" value={name} onChangeText={setName} />
      {id !== me.id ? <Toggle label="Can sign in" value={active} onChange={setActive} hint="Turn off to block this login without deleting anything." /> : null}
      <View style={{ gap: S.sm }}>
        <Btn title="Set a new password" icon="key-outline" kind="secondary" loading={busy === 'pw'} onPress={resetPassword} />
        <Btn title="Change mobile number" icon="call-outline" kind="secondary" loading={busy === 'phone'} onPress={changePhone} />
      </View>
      {error ? <T color={C.red}>{error}</T> : null}
    </Screen>
  );
}
