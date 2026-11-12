import React, { useState } from 'react';

import { useDialog } from '@/ctx/dialog';
import { supabase } from '@/lib/supabase';
import { Btn, Field, T } from '@/ui/kit';
import { goBack, Screen } from '@/ui/Shell';
import { C } from '@/ui/theme';

export default function ChangePassword() {
  const dialog = useDialog();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (pw.length < 6) return setError('Password needs at least 6 characters');
    if (pw !== again) return setError('The two passwords are not the same');
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(/fetch|network/i.test(err.message) ? 'No internet connection. Try again.' : err.message);
    dialog.toast('Password changed');
    goBack('/more');
  }

  return (
    <Screen title="Change password" back="/more" footer={<Btn title="Change password" onPress={save} loading={busy} />}>
      <Field label="New password" value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" hint="At least 6 characters" />
      <Field label="New password again" value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" />
      {error ? <T color={C.red}>{error}</T> : null}
    </Screen>
  );
}
