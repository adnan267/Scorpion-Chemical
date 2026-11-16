import { router } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';

import { Card, Line, T } from '@/ui/kit';
import { MenuRow } from '@/ui/rows';
import { Screen } from '@/ui/Shell';
import { C } from '@/ui/theme';

export default function Opening() {
  return (
    <Screen title="Opening data" back="/more">
      <T color={C.sub}>
        Bring in your accounts from before the app: what each customer owed, unpaid old bills, and the stock in your store. Do this once, before you start taking orders in the app.
      </T>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <MenuRow
          icon="grid-outline"
          label="Import from Excel"
          sub={Platform.OS === 'web' ? 'Customers, opening balances, old bills and stock in one file' : 'Use the web panel on a computer for this'}
          onPress={() => router.push('/opening/import' as any)}
        />
        <Line />
        <MenuRow icon="document-outline" label="Add an old bill" sub="One unpaid bill: amount, date and due date, no products" onPress={() => router.push('/opening/bill' as any)} />
        <Line />
        <MenuRow icon="person-outline" label="Customer opening balance" sub="Open the customer, then Opening balance" onPress={() => router.push('/customers' as any)} />
        <Line />
        <MenuRow icon="cube-outline" label="Stock count" sub="Set how much of each product is in stock now" onPress={() => router.push('/opening/stock' as any)} />
      </Card>
      <Card style={{ gap: 4 }}>
        <T v="strong">Opening balance or old bills?</T>
        <T v="small">
          If you only know the total a customer owes, set an opening balance. If you know the separate unpaid bills, add them as old bills instead: each one gets its own due date and reminders. Payments you record later settle the opening balance first, then the oldest bills.
        </T>
      </Card>
    </Screen>
  );
}
