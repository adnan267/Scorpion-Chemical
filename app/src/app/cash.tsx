import React from 'react';
import { View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useRpc } from '@/lib/api';
import { money, prettyPhone } from '@/lib/format';
import type { PaymentRow } from '@/lib/types';
import { Amount, Card, Empty, ErrorBox, Loading, Section, T } from '@/ui/kit';
import { PaymentCard } from '@/ui/rows';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

type Row = { order_taker_id: string; name: string; phone: string; amount: number; count: number };

export default function Cash() {
  const me = useMe();
  const admin = me.role === 'admin';
  const totals = useRpc<Row[]>('cash_in_hand');
  const pays = useRpc<PaymentRow[]>('payments_list', { p_status: 'cash_in_hand', p_limit: 100 });
  const total = (totals.data ?? []).reduce((s, r) => s + Number(r.amount), 0);

  return (
    <Screen title={admin ? 'Cash with order takers' : 'Cash in hand'} back={admin ? '/more' : '/'} onRefresh={() => { totals.refresh(); pays.reload(); }} refreshing={totals.refreshing}>
      {totals.error ? <ErrorBox message={totals.error} onRetry={totals.reload} /> : null}
      {totals.loading && !totals.data ? <Loading /> : null}
      {totals.data ? (
        <Card style={{ gap: 4 }}>
          <T v="small">{admin ? 'Cash collected by order takers, not yet approved' : 'Cash you collected, not yet approved by the admin'}</T>
          <T v="figure">{money(total)}</T>
          <T v="small">{admin ? 'Approve each payment when the order taker hands the cash over. It then leaves this list and reduces the customer balance.' : 'Hand this cash to the admin. Each payment leaves this list when the admin approves it.'}</T>
        </Card>
      ) : null}

      {admin && totals.data?.length ? (
        <Section title="By order taker">
          <Card style={{ gap: S.md }}>
            {totals.data.map((r) => (
              <View key={r.order_taker_id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md }}>
                <View style={{ flex: 1 }}>
                  <T v="strong">{r.name}</T>
                  <T v="small">{prettyPhone(r.phone)}, {r.count} {r.count === 1 ? 'payment' : 'payments'}</T>
                </View>
                <Amount value={r.amount} color={C.amber} />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Cash payments waiting">
        {pays.data?.length ? pays.data.map((p) => <PaymentCard key={p.id} p={p} showCustomer />) : pays.loading ? <Loading /> : <Empty icon="cash-outline" title="No cash is waiting" hint={admin ? 'All cash collected by order takers has been approved.' : 'Cash payments you record will show here until the admin approves them.'} />}
      </Section>
    </Screen>
  );
}
