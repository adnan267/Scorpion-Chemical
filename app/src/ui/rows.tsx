import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';

import { fmtDate, methodLabel, money, ROLE_LABEL } from '@/lib/format';
import type { Customer, OrderRow, PaymentRow } from '@/lib/types';
import { productImageUrl } from '@/lib/upload';

import { Amount, Card, OrderTag, PaymentTag, T, Tag } from './kit';
import { C, R, S } from './theme';

export function OrderCard({ o, showCustomer }: { o: OrderRow; showCustomer: boolean }) {
  const unpaid = o.status === 'delivered' && Number(o.remaining) > 0;
  return (
    <Card onPress={() => router.push(`/order/${o.id}` as any)} style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md }}>
        <View style={{ flex: 1 }}>
          <T v="strong" numberOfLines={1}>{showCustomer ? o.customer_name : o.order_no}</T>
          <T v="small" numberOfLines={1}>
            {showCustomer ? `${o.order_no}, ` : ''}
            {fmtDate(o.created_at)}, {o.items_count} {o.items_count === 1 ? 'item' : 'items'}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Amount value={o.total} />
          <OrderTag status={o.status} />
        </View>
      </View>
      {unpaid || (o.status === 'delivered' && o.remaining !== null) ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {unpaid ? (
            <Tag label={o.overdue ? `Overdue, ${money(o.remaining)} left` : `${money(o.remaining)} left to pay`} tone={o.overdue ? 'red' : 'amber'} />
          ) : (
            <Tag label="Paid" tone="green" />
          )}
          {unpaid && o.due_date ? <T v="small">Due {fmtDate(o.due_date)}</T> : null}
          {unpaid && !o.due_date ? <T v="small">No due date set</T> : null}
        </View>
      ) : null}
    </Card>
  );
}

export function PaymentCard({ p, showCustomer }: { p: PaymentRow; showCustomer: boolean }) {
  return (
    <Card onPress={() => router.push(`/payment/${p.id}` as any)}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md }}>
        <View style={{ flex: 1 }}>
          <T v="strong" numberOfLines={1}>{showCustomer ? p.customer_name : p.payment_no}</T>
          <T v="small" numberOfLines={1}>
            {showCustomer ? `${p.payment_no}, ` : ''}
            {methodLabel(p.method)}, {fmtDate(p.paid_on)}
          </T>
          <T v="small" numberOfLines={1}>
            Entered by {p.entered_by_name} ({ROLE_LABEL[p.entered_by_role] ?? p.entered_by_role})
          </T>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Amount value={p.amount} />
          <PaymentTag status={p.status} />
          {p.has_proof ? <Ionicons name="image-outline" size={16} color={C.faint} /> : null}
        </View>
      </View>
    </Card>
  );
}

export function CustomerCard({ c, onPress }: { c: Customer; onPress: () => void }) {
  const bal = Number(c.balance);
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="strong" numberOfLines={1}>{c.name}</T>
          <T v="small" numberOfLines={1}>
            {c.type === 'distributor' ? 'Distributor' : 'Medical store'}
            {c.city ? `, ${c.city}` : ''}
          </T>
          {!c.is_active ? <Tag label="Inactive" tone="gray" /> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Amount value={Math.abs(bal)} color={bal > 0 ? C.red : bal < 0 ? C.green : C.sub} />
          <T v="small">{bal > 0 ? 'to receive' : bal < 0 ? 'advance' : 'clear'}</T>
        </View>
      </View>
    </Card>
  );
}

export function ProductThumb({ path, size = 64 }: { path: string | null; size?: number }) {
  const url = productImageUrl(path);
  return (
    <View style={{ width: size, height: size, borderRadius: R.input, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      {url ? <Image source={{ uri: url }} style={{ width: size, height: size }} contentFit="contain" transition={100} /> : <Ionicons name="cube-outline" size={size * 0.4} color={C.faint} />}
    </View>
  );
}

export function MenuRow({ icon, label, sub, onPress, danger }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; sub?: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 14, paddingHorizontal: S.lg }, pressed && { backgroundColor: C.paper }]}>
      <Ionicons name={icon} size={22} color={danger ? C.red : C.blue} />
      <View style={{ flex: 1 }}>
        <T v="strong" color={danger ? C.red : C.ink}>{label}</T>
        {sub ? <T v="small">{sub}</T> : null}
      </View>
      {!danger ? <Ionicons name="chevron-forward" size={18} color={C.faint} /> : null}
    </Pressable>
  );
}
