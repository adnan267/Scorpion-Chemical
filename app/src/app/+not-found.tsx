import { router } from 'expo-router';
import React from 'react';

import { Btn, Empty } from '@/ui/kit';
import { Screen } from '@/ui/Shell';

export default function NotFound() {
  return (
    <Screen title="Page not found" back="/">
      <Empty icon="help-circle-outline" title="This page does not exist" action={<Btn title="Go to Home" onPress={() => router.replace('/')} />} />
    </Screen>
  );
}
