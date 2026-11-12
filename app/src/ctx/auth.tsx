import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { rpc } from '@/lib/api';
import { AUTH_EMAIL_DOMAIN } from '@/lib/config';
import { isValidPhone, normPhone } from '@/lib/format';
import { registerForPush, unregisterPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

type AuthState = {
  profile: Profile | null;
  loading: boolean;
  unread: number;
  signIn: (phone: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  reloadProfile: () => Promise<void>;
  refreshUnread: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function emailForPhone(phone: string): string {
  return `${normPhone(phone)}@${AUTH_EMAIL_DOMAIN}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [unread, setUnread] = useState(0);
  const signedIn = useRef(false);

  const loadProfile = useCallback(async () => {
    const p = await rpc<Profile>('my_profile');
    setProfile(p);
    signedIn.current = true;
  }, []);

  const refreshUnread = useCallback(async () => {
    if (!signedIn.current) return;
    try {
      setUnread(await rpc<number>('notifications_unread'));
    } catch {
      // not important enough to interrupt the user
    }
  }, []);

  // restore the saved login when the app opens
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) await loadProfile();
      } catch {
        await supabase.auth.signOut().catch(() => {});
      } finally {
        if (alive) setLoading(false);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        signedIn.current = false;
        setProfile(null);
        setUnread(0);
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // unread badge: check now, every minute, and whenever the app comes back to the front
  useEffect(() => {
    if (!profile) return;
    refreshUnread();
    registerForPush().catch(() => {});
    const timer = setInterval(refreshUnread, 60000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshUnread();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [profile, refreshUnread]);

  const signIn = useCallback(
    async (phone: string, password: string) => {
      if (!isValidPhone(phone)) throw new Error('Enter your mobile number like 03001234567');
      if (!password) throw new Error('Enter your password');
      const { error } = await supabase.auth.signInWithPassword({ email: emailForPhone(phone), password });
      if (error) {
        if (/invalid login credentials/i.test(error.message)) throw new Error('Wrong mobile number or password');
        if (/fetch|network/i.test(error.message)) throw new Error('No internet connection. Check your network and try again.');
        throw new Error(error.message);
      }
      try {
        await loadProfile();
      } catch (e: any) {
        await supabase.auth.signOut().catch(() => {});
        throw e;
      }
    },
    [loadProfile]
  );

  const signOut = useCallback(async () => {
    await unregisterPush().catch(() => {});
    await supabase.auth.signOut().catch(() => {});
    signedIn.current = false;
    setProfile(null);
    setUnread(0);
  }, []);

  const value = useMemo(
    () => ({ profile, loading, unread, signIn, signOut, reloadProfile: loadProfile, refreshUnread }),
    [profile, loading, unread, signIn, signOut, loadProfile, refreshUnread]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

/** For screens that only render when signed in. */
export function useMe(): Profile {
  const { profile } = useAuth();
  if (!profile) throw new Error('Not signed in');
  return profile;
}
