import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { supabase } from './supabase';

function friendly(message: string | undefined): string {
  const m = message || 'Something went wrong. Try again.';
  if (/failed to fetch|network request failed|networkerror|load failed/i.test(m)) {
    return 'No internet connection. Check your network and try again.';
  }
  if (/jwt expired|invalid jwt|invalid claim/i.test(m)) return 'Please sign in again';
  return m;
}

/** Calls one of the database API functions. Throws an Error with a readable message. */
export async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw new Error(friendly(error.message));
  return data as T;
}

/** Account management that needs the server's secret key (create login, reset password...). */
export async function adminUsers<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try {
      const j = await (error as any).context?.json?.();
      if (j?.error) msg = j.error;
    } catch {
      // keep the original message
    }
    throw new Error(friendly(msg));
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

type State<T> = { data: T | undefined; error: string | null; loading: boolean; refreshing: boolean };

/**
 * Loads data from an API function, and loads it again every time the screen comes back
 * into view, so lists are fresh after you approve/add something on another screen.
 */
export function useRpc<T = any>(fn: string, args?: Record<string, unknown>, enabled = true) {
  const [state, setState] = useState<State<T>>({ data: undefined, error: null, loading: true, refreshing: false });
  const key = JSON.stringify([fn, args ?? {}, enabled]);
  const latest = useRef(key);
  latest.current = key;

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
      if (!enabled) {
        setState({ data: undefined, error: null, loading: false, refreshing: false });
        return;
      }
      if (mode === 'refresh') setState((s) => ({ ...s, refreshing: true }));
      try {
        const data = await rpc<T>(fn, args);
        if (latest.current === key) setState({ data, error: null, loading: false, refreshing: false });
      } catch (e: any) {
        if (latest.current === key) {
          setState((s) => ({ ...s, error: e.message, loading: false, refreshing: false }));
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );

  useFocusEffect(
    useCallback(() => {
      load('silent');
    }, [load])
  );

  return {
    ...state,
    reload: () => load('silent'),
    refresh: () => load('refresh'),
  };
}
