import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';

import { useAuth } from '@/ctx/auth';
import { rpc, useRpc } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { Notice } from '@/lib/types';
import { Card, Empty, ErrorBox, IconName, Line, Loading, T } from '@/ui/kit';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

const ICON: Record<string, IconName> = {
  order: 'receipt-outline',
  payment: 'wallet-outline',
  due: 'alarm-outline',
  stock: 'cube-outline',
  announcement: 'megaphone-outline',
};

export default function Notifications() {
  const { refreshUnread } = useAuth();
  const q = useRpc<{ unread: number; items: Notice[] }>('notifications_list', { p_limit: 100 });

  async function open(n: Notice) {
    if (!n.is_read) {
      rpc('notifications_mark_read', { p_id: n.id })
        .then(() => {
          refreshUnread();
          q.reload();
        })
        .catch(() => {});
    }
    if (n.ref_type === 'order' && n.ref_id) router.push(`/order/${n.ref_id}` as any);
    else if (n.ref_type === 'payment' && n.ref_id) router.push(`/payment/${n.ref_id}` as any);
    else if (n.ref_type === 'product' && n.ref_id) router.push(`/product/stock?id=${n.ref_id}` as any);
    else if (n.ref_type === 'ledger') router.push('/ledger' as any);
  }

  async function markAll() {
    await rpc('notifications_mark_read', { p_id: null }).catch(() => {});
    refreshUnread();
    q.reload();
  }

  return (
    <Screen
      title="Notifications"
      back="/"
      onRefresh={q.refresh}
      refreshing={q.refreshing}
      right={
        q.data?.unread ? (
          <Pressable onPress={markAll} hitSlop={8} style={{ paddingHorizontal: 6 }}>
            <T v="smallStrong" color={C.blue}>Mark all read</T>
          </Pressable>
        ) : undefined
      }>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <Loading /> : null}
      {q.data && q.data.items.length === 0 ? <Empty icon="notifications-outline" title="No notifications yet" hint="Order updates, payment approvals and due-date reminders will show here." /> : null}
      {q.data?.items.length ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {q.data.items.map((n, i) => (
            <View key={n.id}>
              {i > 0 ? <Line /> : null}
              <Pressable onPress={() => open(n)} style={({ pressed }) => [{ flexDirection: 'row', gap: S.md, padding: S.md, backgroundColor: n.is_read ? C.surface : C.blueSoft }, pressed && { opacity: 0.8 }]}>
                <Ionicons name={ICON[n.kind] ?? 'notifications-outline'} size={22} color={n.kind === 'due' ? C.red : C.blue} />
                <View style={{ flex: 1 }}>
                  <T v="strong">{n.title}</T>
                  <T v="small" color={C.ink}>{n.body}</T>
                  <T v="small">{timeAgo(n.created_at)}</T>
                </View>
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
