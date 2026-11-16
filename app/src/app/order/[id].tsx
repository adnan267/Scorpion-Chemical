import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useMe } from '@/ctx/auth';
import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { addDays, customerTypeLabel, fmtDate, fmtDateTime, isOpenStatus, isoDate, money, num, prettyPhone, ROLE_LABEL } from '@/lib/format';
import type { OrderDetail } from '@/lib/types';
import { Amount, Btn, Card, DateField, ErrorBox, Field, KV, Line, Loading, OrderTag, Section, Sheet, Stepper, T, Tag } from '@/ui/kit';
import { Screen } from '@/ui/Shell';
import { C, S } from '@/ui/theme';

const HISTORY_LABEL: Record<string, string> = {
  order_placed: 'Order booked',
  order_edited: 'Quantities changed',
  order_confirmed: 'Confirmed',
  order_dispatched: 'Dispatched',
  order_delivered: 'Delivered',
  order_cancelled: 'Cancelled',
  order_due_date: 'Due date set',
  order_returned: 'Goods returned',
  opening_bill: 'Old bill added',
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
  const [returning, setReturning] = useState<Record<string, number> | null>(null);
  const [returnNote, setReturnNote] = useState('');

  const admin = me.role === 'admin';
  const keeper = me.role === 'stock_keeper';
  const staff = admin || me.role === 'order_taker';
  const mine = !!o && (o.created_by === me.id || me.customer_id === o.customer.id || me.role === 'order_taker');
  const open = !!o && isOpenStatus(o.status);

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

  async function cancel() {
    const reason = await dialog.ask({
      title: `Cancel ${o?.order_no}?`,
      message: 'The order will be cancelled and its stock put back.',
      confirmLabel: 'Cancel order',
      danger: true,
      input: { label: 'Reason (optional)', placeholder: 'e.g. customer changed the order' },
    });
    if (reason === null) return;
    run('cancel', () => rpc('order_cancel', { p_id: id, p_reason: reason }), 'Order cancelled');
  }

  function openDeliver() {
    const days = o?.customer.credit_days;
    setDue(days !== null && days !== undefined ? addDays(days) : null);
    setDueSheet('deliver');
  }

  function openDue() {
    setDue(o?.due_date ?? null);
    setDueSheet('due');
  }

  async function saveDue() {
    const kind = dueSheet;
    setDueSheet(null);
    if (kind === 'deliver') await run('deliver', () => rpc('order_deliver', { p_id: id, p_due_date: due }), 'Marked as delivered');
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

  function openReturn() {
    if (!o) return;
    setReturnNote('');
    setReturning(Object.fromEntries(o.items.map((i) => [i.id, 0])));
  }

  async function saveReturn() {
    if (!returning || !o) return;
    const items = Object.entries(returning).filter(([, qty]) => qty > 0).map(([order_item_id, qty]) => ({ order_item_id, qty }));
    if (!items.length) {
      dialog.toast('Enter how many of each product came back', 'error');
      return;
    }
    setReturning(null);
    await run('return', () => rpc('order_return', { p_order_id: id, p_items: items, p_note: returnNote }), 'Return saved, stock updated');
  }

  const returnValue = o && returning
    ? o.items.reduce((s, i) => s + Math.round((returning[i.id] ?? 0) * Number(i.unit_price) * (100 - Number(i.discount_pct))) / 100, 0)
    : 0;
  const shortItems = o && admin && open ? o.items.filter((i) => i.stock_qty !== null && Number(i.stock_qty) < 0) : [];
  const remaining = Number(o?.remaining ?? 0);
  const returned = Number(o?.returned ?? 0);
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
                  {(staff || keeper) && o.customer.phone ? `, ${prettyPhone(o.customer.phone)}` : ''}
                </T>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <OrderTag status={o.status} />
                {o.is_opening ? <Tag label="Old bill" tone="gray" /> : null}
              </View>
            </View>
            <Line />
            {o.is_opening ? (
              <KV k="Bill date" v={fmtDate(o.delivered_at)} />
            ) : (
              <>
                <KV k="Booked" v={fmtDateTime(o.created_at)} />
                <KV k="Booked by" v={`${o.created_by_name} (${ROLE_LABEL[o.created_by_role] ?? o.created_by_role})`} />
                {o.delivered_at ? <KV k="Delivered" v={fmtDate(o.delivered_at)} /> : null}
              </>
            )}
            {o.status === 'cancelled' ? <KV k="Cancelled" v={`${fmtDate(o.cancelled_at)}${o.cancel_reason ? `: ${o.cancel_reason}` : ''}`} /> : null}
            {o.notes && !o.is_opening ? <KV k="Note" v={o.notes} /> : null}
            {o.customer.licence_expiry && o.customer.licence_expiry < today && staff ? (
              <Tag label={`Licence expired ${fmtDate(o.customer.licence_expiry)}`} tone="red" />
            ) : null}
          </Card>

          {shortItems.length ? (
            <Card style={{ borderColor: C.red }}>
              <T v="small" color={C.red}>Stock of some products in this order has gone below zero. Check the stock.</T>
            </Card>
          ) : null}

          {o.is_opening ? (
            <Card style={{ gap: 2 }}>
              <KV k="Bill amount" v={money(o.total)} strong />
              {Number(o.opening_paid) > 0 ? <KV k="Paid before the app" v={money(o.opening_paid)} /> : null}
              <T v="small">This bill is from before the app, so it has no product list.</T>
            </Card>
          ) : (
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
                        {i.bonus_qty ? <T v="smallStrong" color={C.green}>+ {i.bonus_qty} free</T> : null}
                        {i.lot_no ? <T v="small">Lot {i.lot_no}</T> : null}
                        {i.returned_qty > 0 ? <T v="small" color={C.red}>{i.returned_qty} returned</T> : null}
                      </View>
                      <Amount value={i.line_total} />
                    </View>
                  </View>
                ))}
                <Line />
                <KV k="Subtotal" v={money(o.subtotal)} />
                {Number(o.discount_total) > 0 ? <KV k="Discount" v={`- ${money(o.discount_total)}`} color={C.green} /> : null}
                <KV k="Total" v={money(o.total)} strong />
                {returned > 0 ? (
                  <>
                    <KV k="Goods returned" v={`- ${money(returned)}`} color={C.red} />
                    <KV k="Net total" v={money(Number(o.total) - returned)} strong />
                  </>
                ) : null}
              </Card>
            </Section>
          )}

          {o.status === 'delivered' && o.paid !== null ? (
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
                  {remaining > 0 && !keeper ? (
                    <Btn title={staff ? 'Record payment' : 'Send payment'} small onPress={() => router.push(`/payment/new?customer=${o.customer.id}&name=${encodeURIComponent(o.customer.name)}&order=${o.id}&amount=${remaining}` as any)} />
                  ) : null}
                  {admin ? <Btn title={o.due_date ? 'Change due date' : 'Set due date'} small kind="secondary" loading={busy === 'due'} onPress={openDue} /> : null}
                </View>
              </Card>
            </Section>
          ) : null}

          {o.returns.length ? (
            <Section title="Returns">
              <Card style={{ gap: S.sm }}>
                {o.returns.map((r, n) => (
                  <View key={r.id} style={{ gap: 2 }}>
                    {n > 0 ? <Line /> : null}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md, paddingTop: n > 0 ? S.sm : 0 }}>
                      <View style={{ flex: 1 }}>
                        <T v="strong">{r.return_no}</T>
                        <T v="small">{fmtDateTime(r.created_at)}{r.by ? `, by ${r.by}` : ''}</T>
                        <T v="small" color={C.ink}>{r.items.map((it) => `${it.product_name} x ${it.qty}`).join(', ')}</T>
                        {r.note ? <T v="small">{r.note}</T> : null}
                      </View>
                      <Amount value={r.total} color={C.red} />
                    </View>
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}

          <View style={{ gap: S.sm }}>
            {o.can_deliver ? <Btn title="Mark as delivered" icon="checkmark-done" loading={busy === 'deliver'} onPress={openDeliver} /> : null}
            {admin && open ? <Btn title="Change quantities" icon="create-outline" kind="secondary" loading={busy === 'edit'} onPress={() => setEditing(Object.fromEntries(o.items.map((i) => [i.product_id, i.qty])))} /> : null}
            {o.can_return ? <Btn title="Return goods" icon="return-down-back-outline" kind="secondary" loading={busy === 'return'} onPress={openReturn} /> : null}
            {!o.can_return && o.status === 'delivered' && !o.is_opening && !keeper && o.return_note ? <T v="small">{o.return_note}</T> : null}
            {o.status !== 'cancelled' && !o.is_opening ? <Btn title="Invoice" icon="document-text-outline" kind="secondary" onPress={() => router.push(`/invoice/${o.id}` as any)} /> : null}
            {open && (admin || (mine && !keeper)) ? <Btn title="Cancel order" kind="ghost" loading={busy === 'cancel'} onPress={cancel} /> : null}
          </View>

          {o.history?.length ? (
            <Section title="History">
              <Card style={{ gap: S.sm }}>
                {o.history.map((h, n) => (
                  <View key={n} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md }}>
                    <T v="small" color={C.ink} style={{ flex: 1 }}>
                      {HISTORY_LABEL[h.action] ?? h.action}
                      {h.by ? ` by ${h.by}` : ''}
                      {(h.action === 'order_due_date' || h.action === 'order_delivered') && h.details?.due_date ? `, due ${fmtDate(h.details.due_date)}` : ''}
                      {h.action === 'order_returned' && h.details?.total ? `, ${money(h.details.total)}` : ''}
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
          <DateField
            label="Payment due date"
            value={due}
            onChange={setDue}
            hint={o?.customer.credit_days !== null && o?.customer.credit_days !== undefined ? `Set from ${o.customer.credit_days} credit days. You can change it.` : 'Leave empty if there is no due date yet.'}
          />
        </View>
      </Sheet>

      <Sheet visible={!!editing} title="Change quantities" onClose={() => setEditing(null)} footer={<Btn title="Save changes" onPress={saveEdit} />}>
        <View style={{ padding: S.lg, gap: S.md }}>
          <T v="small">Set a quantity to 0 to remove that product. Stock is adjusted automatically.</T>
          {o?.items.map((i) => (
            <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md }}>
              <View style={{ flex: 1 }}>
                <T v="strong">{i.product_name}</T>
                {i.stock_qty !== null ? <T v="small">{Number(i.stock_qty) + i.qty} available for this order</T> : null}
              </View>
              <Stepper typeMin={0} value={editing?.[i.product_id] ?? i.qty} onChange={(v) => setEditing((e) => ({ ...(e ?? {}), [i.product_id]: v }))} />
            </View>
          ))}
        </View>
      </Sheet>

      <Sheet
        visible={!!returning}
        title="Return goods"
        onClose={() => setReturning(null)}
        footer={
          <View style={{ gap: S.sm }}>
            <T v="strong">Return value: {money(returnValue)}</T>
            <Btn title="Save return" onPress={saveReturn} />
          </View>
        }>
        <View style={{ padding: S.lg, gap: S.md }}>
          <T v="small">Enter how many came back. They go back into stock, and their value comes off the customer's account.</T>
          {o?.items.map((i) => {
            const left = i.qty - i.returned_qty;
            return (
              <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md, opacity: left > 0 ? 1 : 0.5 }}>
                <View style={{ flex: 1 }}>
                  <T v="strong">{i.product_name}</T>
                  <T v="small">{left > 0 ? `Up to ${left} (delivered ${i.qty}${i.returned_qty ? `, ${i.returned_qty} already returned` : ''})` : 'All returned'}</T>
                </View>
                {left > 0 ? (
                  <Stepper typeMin={0} value={returning?.[i.id] ?? 0} onChange={(v) => setReturning((r) => ({ ...(r ?? {}), [i.id]: Math.min(v, left) }))} />
                ) : null}
              </View>
            );
          })}
          <Field label="Note (optional)" value={returnNote} onChangeText={setReturnNote} placeholder="e.g. not sold, near expiry" />
        </View>
      </Sheet>
    </Screen>
  );
}
