import { Image } from 'expo-image';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/ctx/auth';
import { adminUsers } from '@/lib/api';
import { isValidPhone } from '@/lib/format';

import { Btn, Field, T } from './kit';
import { C, S } from './theme';

function Frame({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.surface }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: S.xl, paddingTop: insets.top + S.xl }}>
        <View style={{ width: '100%', maxWidth: 380, gap: S.lg }}>
          <Image source={require('@/assets/images/logo.png')} style={{ width: 205, height: 90, alignSelf: 'center' }} contentFit="contain" />
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function LoginScreen() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<'login' | 'setup'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'setup') {
        if (!name.trim()) throw new Error('Enter your name');
        if (!isValidPhone(phone)) throw new Error('Enter your mobile number like 03001234567');
        if (password.length < 6) throw new Error('Choose a password with at least 6 characters');
        await adminUsers({ action: 'bootstrap', setup_code: code.trim(), full_name: name.trim(), phone, password });
      }
      await signIn(phone, password);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame>
      <View style={{ gap: 4 }}>
        <T v="title">{mode === 'login' ? 'Sign in' : 'First-time setup'}</T>
        <T color={C.sub}>
          {mode === 'login' ? 'Use the mobile number and password given to you by Scorpion Chemical.' : 'Creates the first admin account. This works only once, with the setup code.'}
        </T>
      </View>
      {mode === 'setup' ? (
        <>
          <Field label="Setup code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} />
          <Field label="Your name" value={name} onChangeText={setName} />
        </>
      ) : null}
      <Field label="Mobile number" value={phone} onChangeText={setPhone} placeholder="03001234567" keyboardType="phone-pad" autoComplete="tel" />
      <View>
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} onSubmitEditing={submit} returnKeyType="go" />
        <Pressable onPress={() => setShow((s) => !s)} hitSlop={8} style={{ alignSelf: 'flex-end', paddingTop: 6 }}>
          <T v="smallStrong" color={C.blue}>{show ? 'Hide password' : 'Show password'}</T>
        </Pressable>
      </View>
      {error ? <T color={C.red}>{error}</T> : null}
      <Btn title={mode === 'login' ? 'Sign in' : 'Create admin account'} onPress={submit} loading={busy} />
      <Pressable onPress={() => { setMode(mode === 'login' ? 'setup' : 'login'); setError(null); }} hitSlop={8} style={{ alignSelf: 'center' }}>
        <T v="smallStrong" color={C.sub}>{mode === 'login' ? 'First-time setup' : 'Back to sign in'}</T>
      </Pressable>
      {mode === 'login' ? <T v="small" style={{ textAlign: 'center' }}>Forgot your password? Ask the admin to reset it.</T> : null}
    </Frame>
  );
}

export function NotConfigured() {
  return (
    <Frame>
      <T v="title">App is not connected yet</T>
      <T color={C.sub}>
        The database address and key are missing. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY (see .env.example), then build the app again.
      </T>
    </Frame>
  );
}
