import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { fmtDate, fmtDateTime, methodLabel, money, ROLE_LABEL } from '@/lib/format';
import type { PaymentDetail } from '@/lib/types';
import { proofUrl } from '@/lib/upload';
import { Btn, Card, ErrorBox, KV, Line, Loading, PaymentTag, Section, T } from '@/ui/kit';
import { Screen } from '@/ui/Shell';
import { C, R, S } from '@/ui/theme';

export default function PaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const q = useRpc<PaymentDetail>('payment_get', { p_id: id });
  const p = q.data;
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const admin = me.role === 'admin';

  useEffect(() => {
    let alive = true;
    if (p?.proof_path) {
      proofUrl(p.proof_path)
        .then((u) => alive && setPhoto(u))
        .catch((e) => alive && setPhotoError(e.message));
    }
    return () => {
      alive = false;
    };
  }, [p?.proof_path]);

  async function review(approve: boolean) {
    if (!p) return;
    const remarks = await dialog.ask({
      title: approve ? `Approve ${money(p.amount)}?` : `Reject ${money(p.amount)}?`,
      message: approve ? `${money(p.amount)} will be taken off ${p.customer.name}'s balance.` : 'The balance will not change. The customer will see your reason.',
      confirmLabel: approve ? 'Approve payment' : 'Reject payment',
      danger: !approve,
      input: approve ? { label: 'Remarks (optional)' } : { label: 'Reason for rejecting', required: true, placeholder: 'e.g. amount not received in bank' },
    });
    if (remarks === null) return;
    setBusy(approve ? 'approve' : 'reject');
    try {
      await rpc('payment_review', { p_id: id, p_approve: approve, p_remarks: remarks });
      dialog.toast(approve ? 'Payment approved' : 'Payment rejected');
      await q.reload();
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title={p?.payment_no ?? 'Payment'} back="/payments" onRefresh={q.refresh} refreshing={q.refreshing}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !p ? <Loading /> : null}
      {p ? (
        <>
          <Card style={{ gap: S.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: S.md }}>
              <View style={{ flex: 1 }}>
                <T v="figure">{money(p.amount)}</T>
                <T color={C.sub}>{p.customer.name}</T>
              </View>
              <PaymentTag status={p.status} />
            </View>
            <Line />
            <KV k="Method" v={methodLabel(p.method)} />
            {p.reference_no ? <KV k="Reference no." v={p.reference_no} /> : null}
            <KV k="Paid on" v={fmtDate(p.paid_on)} />
            <KV k="Entered by" v={`${p.entered_by_name} (${ROLE_LABEL[p.entered_by_role] ?? p.entered_by_role})`} />
            <KV k="Entered at" v={fmtDateTime(p.created_at)} />
            {p.order ? (
              <KV
                k="For order"
                v={
                  <Pressable onPress={() => router.push(`/order/${p.order!.id}` as any)} hitSlop={8}>
                    <T v="strong" color={C.blue}>{p.order.order_no}</T>
                  </Pressable>
                }
              />
            ) : null}
            {p.note ? <KV k="Note" v={p.note} /> : null}
            {p.status !== 'pending' ? (
              <>
                <Line />
                <KV k={p.status === 'approved' ? 'Approved by' : 'Rejected by'} v={`${p.reviewed_by_name ?? 'Admin'}, ${fmtDate(p.reviewed_at)}`} />
                {p.admin_remarks ? <KV k="Remarks" v={p.admin_remarks} color={p.status === 'rejected' ? C.red : undefined} /> : null}
              </>
            ) : null}
            {me.role !== 'store' && me.role !== 'distributor' ? <KV k="Customer balance now" v={money(p.customer.balance)} /> : null}
          </Card>

          <Section title="Receipt">
            {p.proof_path ? (
              photo ? (
                <Pressable accessibilityLabel="Open receipt photo" onPress={() => Linking.openURL(photo)}>
                  <Image source={{ uri: photo }} style={{ width: '100%', height: 360, borderRadius: R.card, backgroundColor: C.graySoft }} contentFit="contain" />
                  <T v="small" style={{ marginTop: 6 }}>Tap the photo to open it full size.</T>
                </Pressable>
              ) : photoError ? (
                <ErrorBox message={photoError} />
              ) : (
                <Loading />
              )
            ) : (
              <Card>
                <T color={C.sub}>{p.method === 'cash' ? 'Cash payment, no receipt attached.' : 'No receipt attached.'}</T>
              </Card>
            )}
          </Section>

          {admin && p.status === 'pending' ? (
            <View style={{ flexDirection: 'row', gap: S.md }}>
              <Btn title="Reject" kind="secondary" loading={busy === 'reject'} onPress={() => review(false)} style={{ flex: 1 }} />
              <Btn title="Approve" icon="checkmark" loading={busy === 'approve'} onPress={() => review(true)} style={{ flex: 1 }} />
            </View>
          ) : null}
          {!admin && p.status === 'pending' ? <T v="small">The balance changes after the admin approves this payment.</T> : null}
        </>
      ) : null}
    </Screen>
  );
}
