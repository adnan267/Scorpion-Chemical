import { Platform } from 'react-native';

import { rpc } from './api';

let currentToken: string | null = null;

/**
 * Registers this phone for push notifications. Needs the Firebase file
 * (google-services.json) in the Android build; until that is added this quietly does nothing
 * and the in-app notification list keeps working.
 */
export async function registerForPush(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Orders and payments',
      importance: Notifications.AndroidImportance.HIGH,
    });
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return;
    const token = await Notifications.getDevicePushTokenAsync();
    if (typeof token.data === 'string' && token.data) {
      currentToken = token.data;
      await rpc('register_push_token', { p_token: token.data, p_platform: 'android' });
    }
  } catch {
    // Firebase not set up yet, or notifications blocked: nothing to do
  }
}

export async function unregisterPush(): Promise<void> {
  if (!currentToken) return;
  const t = currentToken;
  currentToken = null;
  await rpc('remove_push_token', { p_token: t });
}
