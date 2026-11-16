import React from 'react';

import { useMe } from '@/ctx/auth';
import { Screen } from '@/ui/Shell';
import { StockSheet } from '@/ui/StockSheet';

export default function StockSheetScreen() {
  const me = useMe();
  return (
    <Screen title="Loading sheet" subtitle="What to take out for the day's orders" top={me.role === 'stock_keeper'} back="/more">
      <StockSheet />
    </Screen>
  );
}
