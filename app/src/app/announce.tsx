import React, { useState } from 'react';

import { useDialog } from '@/ctx/dialog';
import { rpc } from '@/lib/api';
import { Btn, Field, SelectField, T } from '@/ui/kit';
import { goBack, Screen } from '@/ui/Shell';
import { C } from '@/ui/theme';

export default function Announce() {
  const dialog = useDialog();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    if (!title.trim() || !body.trim()) return setError('Write a title and a message');
    setBusy(true);
    try {
      const n = await rpc<number>('announce', { p_title: title, p_body: body, p_audience: audience });
      dialog.toast(`Sent to ${n} ${n === 1 ? 'user' : 'users'}`);
      goBack('/more');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Send announcement" back="/more" footer={<Btn title="Send announcement" onPress={send} loading={busy} />}>
      <SelectField
        label="Send to"
        value={audience}
        onChange={setAudience}
        options={[
          { value: 'all', label: 'Everyone', sub: 'Medical stores, distributors and order takers' },
          { value: 'store', label: 'Medical stores' },
          { value: 'distributor', label: 'Distributors' },
          { value: 'order_taker', label: 'Order takers' },
        ]}
      />
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. New rates from Monday" />
      <Field label="Message" value={body} onChangeText={setBody} multiline />
      {error ? <T color={C.red}>{error}</T> : null}
    </Screen>
  );
}
