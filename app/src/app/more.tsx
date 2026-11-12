import { router } from 'expo-router';
import React from 'react';
import { Linking, View } from 'react-native';

import { useAuth, useMe } from '@/ctx/auth';
import { useCart } from '@/ctx/cart';
import { useDialog } from '@/ctx/dialog';
import { rpc } from '@/lib/api';
import { prettyPhone, ROLE_LABEL } from '@/lib/format';
import { Card, Line, T } from '@/ui/kit';
import { MenuRow } from '@/ui/rows';
import { Screen } from '@/ui/Shell';
import { C } from '@/ui/theme';

export default function More() {
  const me = useMe();
  const { signOut } = useAuth();
  const cart = useCart();
  const dialog = useDialog();
  const admin = me.role === 'admin';
  const taker = me.role === 'order_taker';
  const customer = me.role === 'store' || me.role === 'distributor';

  async function logout() {
    const ok = await dialog.confirm({ title: 'Sign out?', message: 'You will need your mobile number and password to sign in again.', confirmLabel: 'Sign out' });
    if (!ok) return;
    cart.setCustomer(null);
    cart.clear();
    router.replace('/');
    await signOut();
  }

  async function runReminders() {
    try {
      const n = await rpc<number>('reminders_run_now');
      dialog.toast(n ? `Reminders checked: ${n} ${n === 1 ? 'order' : 'orders'} due` : 'No reminders are due today');
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    }
  }

  return (
    <Screen title="More" top>
      <Card style={{ gap: 2 }}>
        <T v="h2">{me.customer?.name ?? me.full_name}</T>
        {me.customer ? <T color={C.sub}>{me.full_name}</T> : null}
        <T v="small">
          {ROLE_LABEL[me.role]}, {prettyPhone(me.phone)}
        </T>
      </Card>

      {admin ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <MenuRow icon="storefront-outline" label="Customers" sub="Medical stores and distributors, discounts, statements" onPress={() => router.push('/customers')} />
          <Line />
          <MenuRow icon="people-outline" label="Staff logins" sub="Order takers and admins" onPress={() => router.push('/users')} />
          <Line />
          <MenuRow icon="cash-outline" label="Cash with order takers" sub="Cash collected but not yet handed over" onPress={() => router.push('/cash')} />
          <Line />
          <MenuRow icon="megaphone-outline" label="Send announcement" sub="A notification to all users or one group" onPress={() => router.push('/announce')} />
          <Line />
          <MenuRow icon="alarm-outline" label="Check due-date reminders now" sub="They also run by themselves every morning" onPress={runReminders} />
          <Line />
          <MenuRow icon="business-outline" label="Company details" sub="Shown on invoices" onPress={() => router.push('/settings')} />
        </Card>
      ) : null}

      {taker ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <MenuRow icon="cash-outline" label="Cash in hand" sub="Cash you collected that the admin has not approved yet" onPress={() => router.push('/cash')} />
        </Card>
      ) : null}

      {customer ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <MenuRow icon="document-text-outline" label="Statement" sub="Every order, payment and adjustment" onPress={() => router.push('/ledger')} />
          {me.company?.phone ? (
            <>
              <Line />
              <MenuRow icon="call-outline" label={`Call ${me.company.name}`} sub={me.company.phone} onPress={() => Linking.openURL(`tel:${me.company!.phone!.replace(/[^\d+]/g, '')}`)} />
            </>
          ) : null}
        </Card>
      ) : null}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <MenuRow icon="notifications-outline" label="Notifications" onPress={() => router.push('/notifications')} />
        <Line />
        <MenuRow icon="key-outline" label="Change password" onPress={() => router.push('/password')} />
        <Line />
        <MenuRow icon="log-out-outline" label="Sign out" danger onPress={logout} />
      </Card>
      <View />
    </Screen>
  );
}
