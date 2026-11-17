import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useDialog } from '@/ctx/dialog';
import { rpc } from '@/lib/api';
import { OFFICE_EXPENSE_TYPES } from '@/lib/expenses';
import { addDays, money, toNumber } from '@/lib/format';
import { Btn, DateField, Field, T } from '@/ui/kit';
import { goBack, Screen } from '@/ui/Shell';
import { C, R, S } from '@/ui/theme';

export default function OfficeExpense() {
  const dialog = useDialog();
  const [date, setDate] = useState<string | null>(addDays(0));
  const [cat, setCat] = useState('electricity');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsNote = cat === 'salary' || cat === 'office_other';

  async function save(another: boolean) {
    setError(null);
    const n = toNumber(amount);
    if (!(n > 0)) return setError('Enter the amount');
    if (needsNote && !note.trim()) return setError(cat === 'salary' ? 'Write whose salary it is' : 'Write what the expense was for');
    setBusy(true);
    try {
      await rpc('office_expense_add', { p: { date, category: cat, amount: n, note } });
      dialog.toast(`${money(n)} added`);
      if (another) {
        setAmount('');
        setNote('');
      } else goBack('/expenses-report');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Office expense"
      back="/expenses-report"
      footer={
        <View style={{ gap: 8, width: '100%' }}>
          <Btn title="Save expense" onPress={() => save(false)} loading={busy} />
          <Btn title="Save and add another" kind="secondary" onPress={() => save(true)} disabled={busy} />
        </View>
      }>
      <DateField label="Date" value={date} onChange={setDate} presets={[0, -1]} />
      <View style={{ gap: 6 }}>
        <T v="smallStrong" color={C.ink}>What was it for?</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
          {OFFICE_EXPENSE_TYPES.map((t) => {
            const on = t.value === cat;
            return (
              <Pressable key={t.value} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setCat(t.value)} style={{ flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: R.input, borderWidth: 1, borderColor: on ? C.blue : C.line, backgroundColor: on ? C.blueSoft : C.surface }}>
                <Ionicons name={t.icon} size={20} color={on ? C.blue : C.sub} />
                <T v={on ? 'strong' : 'body'} color={on ? C.blue : C.ink} style={{ flex: 1 }}>{t.label}</T>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Field label="Amount (Rs.)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
      <Field label={cat === 'salary' ? 'Whose salary, which month' : needsNote ? 'What was it for?' : 'Note (optional)'} value={note} onChangeText={setNote} placeholder={cat === 'salary' ? 'e.g. Rashid, November' : undefined} />
      {error ? <T color={C.red}>{error}</T> : null}
    </Screen>
  );
}
