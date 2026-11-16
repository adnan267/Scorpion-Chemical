import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { EXPENSE_TYPES } from '@/lib/expenses';
import { fmtDate, fmtDateTime, money, toNumber } from '@/lib/format';
import type { ExpensesToday } from '@/lib/types';
import { Btn, Card, ErrorBox, Field, Line, Loading, Section, T } from '@/ui/kit';
import { Screen } from '@/ui/Shell';
import { C, F, R, S } from '@/ui/theme';

export default function MyExpenses() {
  const dialog = useDialog();
  const q = useRpc<ExpensesToday>('expenses_today');
  const d = q.data;
  const [city, setCity] = useState('');
  const [cat, setCat] = useState<string>('van');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cityFilled, setCityFilled] = useState(false);

  useEffect(() => {
    if (d && !cityFilled) {
      if (d.city) setCity(d.city);
      setCityFilled(true);
    }
  }, [d, cityFilled]);

  const type = EXPENSE_TYPES.find((t) => t.value === cat);

  async function add() {
    setError(null);
    const n = toNumber(amount);
    if (!city.trim()) return setError("Write the city of today's tour");
    if (!(n > 0)) return setError('Enter the amount');
    if (cat === 'other' && !note.trim()) return setError('Write what the expense was for');
    setBusy(true);
    try {
      await rpc('expense_add', { p: { city, category: cat, amount: n, note } });
      dialog.toast(`${type?.label ?? 'Expense'} ${money(n)} added`);
      setAmount('');
      setNote('');
      q.reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, label: string) {
    const ok = await dialog.confirm({ title: 'Remove this expense?', message: label, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try {
      await rpc('expense_delete', { p_id: id });
      q.reload();
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    }
  }

  return (
    <Screen title="Today's expenses" subtitle={d ? fmtDate(d.date) : undefined} back="/" onRefresh={q.refresh} refreshing={q.refreshing}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      <Field label="City of today's tour" value={city} onChangeText={setCity} placeholder="e.g. Khanewal" />
      <View style={{ gap: 6 }}>
        <T v="smallStrong" color={C.ink}>What was it for?</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
          {EXPENSE_TYPES.map((t) => {
            const on = t.value === cat;
            return (
              <Pressable
                key={t.value}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setCat(t.value)}
                style={{ flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: R.input, borderWidth: 1, borderColor: on ? C.blue : C.line, backgroundColor: on ? C.blueSoft : C.surface }}>
                <Ionicons name={t.icon} size={20} color={on ? C.blue : C.sub} />
                <T v={on ? 'strong' : 'body'} color={on ? C.blue : C.ink} style={{ fontFamily: on ? F.semi : undefined }}>
                  {t.label}
                </T>
              </Pressable>
            );
          })}
        </View>
        {type?.hint ? <T v="small">{type.hint}</T> : null}
      </View>
      <Field label="Amount (Rs.)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
      <Field label={cat === 'other' ? 'What was it for?' : 'Note (optional)'} value={note} onChangeText={setNote} placeholder={cat === 'stock_carriage' ? 'e.g. 3 cartons on the Khanewal wagon' : undefined} />
      {error ? <T color={C.red}>{error}</T> : null}
      <Btn title="Add expense" icon="add" onPress={add} loading={busy} />

      <Section title={`Added today${d ? `: ${money(d.total)}` : ''}`}>
        {q.loading && !d ? <Loading /> : null}
        {d && d.items.length === 0 ? (
          <Card>
            <T color={C.sub}>Nothing added today. Add each fare, petrol, food and stock carriage as you spend it.</T>
          </Card>
        ) : null}
        {d?.items.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {d.items.map((e, n) => (
              <View key={e.id}>
                {n > 0 ? <Line /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 10, paddingHorizontal: S.lg }}>
                  <View style={{ flex: 1 }}>
                    <T v="strong">{e.label}</T>
                    <T v="small">{[e.city, fmtDateTime(e.created_at).split(', ')[1], e.note].filter(Boolean).join(', ')}</T>
                  </View>
                  <T v="strong">{money(e.amount)}</T>
                  <Pressable accessibilityLabel={`Remove ${e.label}`} onPress={() => remove(e.id, `${e.label}, ${money(e.amount)}`)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={20} color={C.red} />
                  </Pressable>
                </View>
              </View>
            ))}
          </Card>
        ) : null}
        <T v="small">Expenses go to the admin. Only today's list shows here.</T>
      </Section>
    </Screen>
  );
}
