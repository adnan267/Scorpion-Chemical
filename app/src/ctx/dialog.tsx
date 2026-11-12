import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { Btn, Field, Sheet, T } from '@/ui/kit';
import { C, R, S } from '@/ui/theme';

type ConfirmOpts = {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Ask for a line of text (a reason, remarks). */
  input?: { label: string; placeholder?: string; required?: boolean; initial?: string };
};

type DialogApi = {
  /** Resolves true/false, or the typed text (string) / null when `input` is used. */
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  ask: (o: ConfirmOpts) => Promise<string | null>;
  toast: (message: string, kind?: 'ok' | 'error') => void;
};

const Ctx = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState<{ message: string; kind: 'ok' | 'error' } | null>(null);
  const resolver = useRef<((v: string | null) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback((o: ConfirmOpts) => {
    setText(o.input?.initial ?? '');
    setOpts(o);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  }, []);

  const toast = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    if (timer.current) clearTimeout(timer.current);
    setNote({ message, kind });
    timer.current = setTimeout(() => setNote(null), kind === 'error' ? 5000 : 2600);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: async (o) => (await open(o)) !== null,
      ask: (o) => open(o),
      toast,
    }),
    [open, toast]
  );

  const needText = !!opts?.input?.required && text.trim() === '';

  return (
    <Ctx.Provider value={api}>
      {children}
      <Sheet visible={!!opts} title={opts?.title} onClose={() => close(null)}>
        <View style={{ padding: S.lg, gap: S.lg }}>
          {opts?.message ? <T color={C.sub}>{opts.message}</T> : null}
          {opts?.input ? (
            <Field label={opts.input.label} placeholder={opts.input.placeholder} value={text} onChangeText={setText} multiline autoFocus />
          ) : null}
          <View style={{ flexDirection: 'row', gap: S.md }}>
            <Btn title="Cancel" kind="secondary" onPress={() => close(null)} style={{ flex: 1 }} />
            <Btn
              title={opts?.confirmLabel ?? 'OK'}
              kind={opts?.danger ? 'danger' : 'primary'}
              disabled={needText}
              onPress={() => close(opts?.input ? text.trim() : '')}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </Sheet>
      {note ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 84, alignItems: 'center', paddingHorizontal: S.lg }}>
          <View style={{ backgroundColor: note.kind === 'error' ? C.red : C.ink, borderRadius: R.input, paddingHorizontal: S.lg, paddingVertical: S.md, maxWidth: 480 }}>
            <T color={C.white} v="strong">{note.message}</T>
          </View>
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

export function useDialog(): DialogApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDialog must be used inside DialogProvider');
  return v;
}
