import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { customerTypeLabel, fmtDate, fmtDateTime, isoDate, money, num, prettyPhone, ROLE_LABEL } from '@/lib/format';
import { shareInvoice } from '@/lib/invoice';
import type { OrderDetail } from '@/lib/types';
import { Amount, Btn, Card, DateField, ErrorBox, KV, Line, Loading, OrderTag, Section, Sheet, Stepper, T, Tag } from '@/ui/kit';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

const HISTORY_LABEL: Record<string, string> = {
  order_placed: 'Order placed',
  order_edited: 'Quantities changed',
  order_confirmed: 'Confirmed',
  order_dispatched: 'Dispatched',
  order_delivered: 'Delivered',
  order_cancelled: 'Cancelled',
  order_due_date: 'Due date set',
};

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const q = useRpc<OrderDetail>('order_get', { p_id: id });
  const o = q.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [dueSheet, setDueSheet] = useState<null | 'deliver' | 'due'>(null);
  const [due, setDue] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, number> | null>(null);

  const admin = me.role === 'admin';
  const staff = admin || me.role === 'order_taker';
  const mine = !!o && (o.created_by === me.id || me.customer_id === o.customer.id);

  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await fn();
      dialog.toast(done);
      await q.reload();
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  const setStatus = (status: string, dueDate: string | null, done: string) =>
    run(status, () => rpc('order_set_status', { p_id: id, p_status: status, p_due_date: dueDate }), done);

  async function cancel() {
    const reason = await dialog.ask({
      title: `Cancel ${o?.order_no}?`,
      message: o?.status === 'pending' ? 'The order will be cancelled.' : 'The order will be cancelled and its stock put back.',
      confirmLabel: 'Cancel order',
      danger: true,
      input: { label: 'Reason (optional)', placeholder: 'e.g. customer changed the order' },
    });
    if (reason === null) return;
    run('cancel', () => rpc('order_cancel', { p_id: id, p_reason: reason }), 'Order cancelled');
  }

  async function invoice() {
    if (!o) return;
    setBusy('invoice');
    try {
      await shareInvoice(o, me.company);
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  function openDue(kind: 'deliver' | 'due') {
    setDue(o?.due_date ?? null);
    setDueSheet(kind);
  }

  async function saveDue() {
    const kind = dueSheet;
    setDueSheet(null);
    if (kind === 'deliver') await setStatus('delivered', due, 'Marked as delivered');
    else await run('due', () => rpc('order_set_due_date', { p_id: id, p_due_date: due }), due ? 'Due date saved' : 'Due date removed');
  }

  async function saveEdit() {
    if (!editing || !o) return;
    const items = o.items.map((i) => ({ product_id: i.product_id, qty: editing[i.product_id] ?? i.qty })).filter((i) => i.qty > 0);
    setEditing(null);
    if (items.length === 0) {
      dialog.toast('Keep at least one product, or cancel the order instead', 'error');
      return;
    }
    await run('edit', () => rpc('order_update_items', { p_id: id, p_items: items }), 'Order updated');
  }

  const shortItems = o && admin && o.status === 'pending' ? o.items.filter((i) => i.stock_qty !== null && i.qty > Number(i.stock_qty)) : [];
  const remaining = Number(o?.remaining ?? 0);
  const today = isoDate(new Date());
  const overdue = !!o && o.status === 'delivered' && remaining > 0 && !!o.due_date && o.due_date < today;

  return (
    <Screen title={o?.order_no ?? 'Order'} back="/orders" onRefresh={q.refresh} refreshing={q.refreshing}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !o ? <Loading /> : null}
      {o ? (
        <>
          <Card style={{ gap: S.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: S.md }}>
              <View style={{ flex: 1 }}>
                <T v="h2">{o.customer.name}</T>
                <T v="small">
                  {customerTypeLabel(o.customer.type)}
                  {o.customer.city ? `, ${o.customer.city}` : ''}
                  {staff && o.customer.phone ? `, ${prettyPhone(o.customer.phone)}` : ''}
                </T>
              </View>
              <OrderTag status={o.status} />
            </View>
            <Line />
            <KV k="Placed" v={fmtDateTime(o.created_at)} />
            <KV k="Placed by" v={`${o.created_by_name} (${ROLE_LABEL[o.created_by_role] ?? o.created_by_role})`} />
            {o.delivered_at ? <KV k="Delivered" v={fmtDate(o.delivered_at)} /> : null}
            {o.status === 'cancelled' ? <KV k="Cancelled" v={`${fmtDate(o.cancelled_at)}${o.cancel_reason ? `: ${o.cancel_reason}` : ''}`} /> : null}
            {o.notes ? <KV k="Note" v={o.notes} /> : null}
          </Card>

          {shortItems.length ? (
            <Card style={{ borderColor: C.red, gap: 4 }}>
              <T v="strong" color={C.red}>Not enough stock to confirm</T>
              {shortItems.map((i) => (
                <T key={i.id} v="small" color={C.red}>{i.product_name}: ordered {i.qty}, in stock {i.stock_qty}</T>
              ))}
              <T v="small">Add stock, or change the quantities.</T>
            </Card>
          ) : null}

          <Section title="Products">
            <Card style={{ gap: S.sm }}>
              {o.items.map((i, n) => (
                <View key={i.id} style={{ gap: 2 }}>
                  {n > 0 ? <Line /> : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md, paddingTop: n > 0 ? S.sm : 0 }}>
                    <View style={{ flex: 1 }}>
                      <T v="strong">{i.product_name}</T>
                      <T v="small">
                        {i.qty} x {num(i.unit_price)}
                        {Number(i.discount_pct) > 0 ? `, ${num(i.discount_pct)}% off` : ''}
                      </T>
                    </View>
                    <Amount value={i.line_total} />
                  </View>
                </View>
              ))}
              <Line />
              <KV k="Subtotal" v={money(o.subtotal)} />
              {Number(o.discount_total) > 0 ? <KV k="Discount" v={`- ${money(o.discount_total)}`} color={C.green} /> : null}
              <KV k="Total" v={money(o.total)} strong />
            </Card>
          </Section>

          {o.status === 'delivered' ? (
            <Section title="Payment">
              <Card style={{ gap: S.sm }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
                  {remaining <= 0 ? <Tag label="Paid" tone="green" /> : Number(o.paid) > 0 ? <Tag label="Partly paid" tone="amber" /> : <Tag label="Unpaid" tone="amber" />}
                  {overdue ? <Tag label="Overdue" tone="red" /> : null}
                </View>
                <KV k="Paid" v={money(o.paid)} />
                <KV k="Left to pay" v={money(remaining)} strong color={remaining > 0 ? C.red : C.green} />
                <KV k="Due date" v={o.due_date ? fmtDate(o.due_date) : 'Not set'} color={overdue ? C.red : undefined} />
                <T v="small">Payments are applied to the oldest unpaid orders first.</T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
                  {remaining > 0 ? (
                    <Btn title={staff ? 'Record payment' : 'Send payment'} small onPress={() => router.push(`/payment/new?customer=${o.customer.id}&name=${encodeURIComponent(o.customer.name)}&order=${o.id}&amount=${remaining}` as any)} />
                  ) : null}
                  {admin ? <Btn title={o.due_date ? 'Change due date' : 'Set due date'} small kind="secondary" loading={busy === 'due'} onPress={() => openDue('due')} /> : null}
                </View>
              </Card>
            </Section>
          ) : null}

          <View style={{ gap: S.sm }}>
            {admin && o.status === 'pending' ? <Btn title="Confirm order" icon="checkmark" loading={busy === 'confirmed'} onPress={() => setStatus('confirmed', null, 'Order confirmed')} /> : null}
            {admin && o.status === 'confirmed' ? <Btn title="Mark as dispatched" icon="car-outline" loading={busy === 'dispatched'} onPress={() => setStatus('dispatched', null, 'Marked as dispatched')} /> : null}
            {admin && (o.status === 'confirmed' || o.status === 'dispatched') ? (
              <Btn title="Mark as delivered" icon="checkmark-done" kind={o.status === 'dispatched' ? 'primary' : 'secondary'} loading={busy === 'delivered'} onPress={() => openDue('deliver')} />
            ) : null}
            {admin && o.status === 'pending' ? <Btn title="Change quantities" icon="create-outline" kind="secondary" loading={busy === 'edit'} onPress={() => setEditing(Object.fromEntries(o.items.map((i) => [i.product_id, i.qty])))} /> : null}
            {o.status !== 'cancelled' ? <Btn title="Invoice (PDF)" icon="document-text-outline" kind="secondary" loading={busy === 'invoice'} onPress={invoice} /> : null}
            {(admin && ['pending', 'confirmed', 'dispatched'].includes(o.status)) || (!admin && mine && o.status === 'pending') ? (
              <Btn title="Cancel order" kind="ghost" loading={busy === 'cancel'} onPress={cancel} />
            ) : null}
          </View>

          {o.history?.length ? (
            <Section title="History">
              <Card style={{ gap: S.sm }}>
                {o.history.map((h, n) => (
                  <View key={n} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md }}>
                    <T v="small" color={C.ink} style={{ flex: 1 }}>
                      {HISTORY_LABEL[h.action] ?? h.action}
                      {h.by ? ` by ${h.by}` : ''}
                      {h.action === 'order_due_date' && h.details?.due_date ? `: ${fmtDate(h.details.due_date)}` : ''}
                    </T>
                    <T v="small">{fmtDateTime(h.at)}</T>
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}
        </>
      ) : null}

      <Sheet
        visible={!!dueSheet}
        title={dueSheet === 'deliver' ? 'Mark as delivered' : 'Payment due date'}
        onClose={() => setDueSheet(null)}
        footer={<Btn title={dueSheet === 'deliver' ? 'Mark as delivered' : 'Save due date'} onPress={saveDue} />}>
        <View style={{ padding: S.lg, gap: S.md }}>
          {dueSheet === 'deliver' && o ? <T color={C.sub}>{money(o.total)} will be added to {o.customer.name}'s account.</T> : null}
          <DateField label="Payment due date" value={due} onChange={setDue} hint="Leave empty if there is no due date yet." />
        </View>
      </Sheet>

      <Sheet visible={!!editing} title="Change quantities" onClose={() => setEditing(null)} footer={<Btn title="Save changes" onPress={saveEdit} />}>
        <View style={{ padding: S.lg, gap: S.md }}>
          <T v="small">Set a quantity to 0 to remove that product.</T>
          {o?.items.map((i) => (
            <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md }}>
              <View style={{ flex: 1 }}>
                <T v="strong">{i.product_name}</T>
                {i.stock_qty !== null ? <T v="small">{i.stock_qty} in stock</T> : null}
              </View>
              <Stepper typeMin={0} value={editing?.[i.product_id] ?? i.qty} onChange={(v) => setEditing((e) => ({ ...(e ?? {}), [i.product_id]: v }))} />
            </View>
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}
