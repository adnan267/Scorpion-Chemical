import { Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AuthProvider, useAuth } from '@/ctx/auth';
import { CartProvider } from '@/ctx/cart';
import { DialogProvider } from '@/ctx/dialog';
import { isConfigured } from '@/lib/config';
import { LoginScreen, NotConfigured } from '@/ui/Login';
import { C } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useFonts({ Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold });
  if (!loaded && !error) return null;
  return (
    <DialogProvider>
      <AuthProvider>
        <CartProvider>
          <StatusBar style="dark" />
          <Gate />
        </CartProvider>
      </AuthProvider>
    </DialogProvider>
  );
}

function Gate() {
  const { profile, loading } = useAuth();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);

  if (!isConfigured) return <NotConfigured />;
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface }}>
        <ActivityIndicator color={C.blue} />
      </View>
    );
  }
  if (!profile) return <LoginScreen />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.paper } }} />;
}
