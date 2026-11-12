import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { useRpc } from '@/lib/api';
import { prettyPhone } from '@/lib/format';
import type { UserRow } from '@/lib/types';
import { Btn, Card, ErrorBox, Line, Loading, Section, T } from '@/ui/kit';
import { MenuRow } from '@/ui/rows';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

export default function Users() {
  const q = useRpc<UserRow[]>('users_list', {});
  const all = q.data ?? [];
  const takers = all.filter((u) => u.role === 'order_taker');
  const admins = all.filter((u) => u.role === 'admin');
  const customers = all.filter((u) => u.role === 'store' || u.role === 'distributor');

  const group = (rows: UserRow[], empty: string, sub: (u: UserRow) => string) => (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.length === 0 ? <T color={C.sub} style={{ padding: S.lg }}>{empty}</T> : null}
      {rows.map((u, n) => (
        <View key={u.id}>
          {n > 0 ? <Line /> : null}
          <MenuRow icon="person-circle-outline" label={u.full_name} sub={`${prettyPhone(u.phone)}, ${sub(u)}${u.is_active ? '' : ', deactivated'}`} onPress={() => router.push(`/user/form?id=${u.id}` as any)} />
        </View>
      ))}
    </Card>
  );

  return (
    <Screen title="Staff logins" back="/more" top={false} onRefresh={q.refresh} refreshing={q.refreshing}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <Loading /> : null}
      {q.data ? (
        <>
          <Section title="Order takers" action={<Btn title="Add order taker" small kind="secondary" icon="add" onPress={() => router.push('/user/form?role=order_taker')} />}>
            {group(takers, 'No order takers yet.', (u) => `${u.customers_count} ${u.customers_count === 1 ? 'customer' : 'customers'}`)}
          </Section>
          <Section title="Admins" action={<Btn title="Add admin" small kind="secondary" icon="add" onPress={() => router.push('/user/form?role=admin')} />}>
            {group(admins, '', () => 'Full access')}
          </Section>
          <Section title="Customer logins">
            {group(customers, 'No customer has a login yet. Add one from the customer page.', (u) => u.customer_name ?? '')}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
