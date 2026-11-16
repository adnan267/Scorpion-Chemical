import { Platform } from 'react-native';

import { rpc } from './api';
import { addDays } from './format';
import type { RouteVisits } from './types';

const ID = 'scorpion-route-reminder';
const HOUR = 20; // 8 pm

/**
 * Sets a phone notification for 8 pm today with tomorrow's route. It is set on the phone itself,
 * so it works without internet at 8 pm and without push setup. Called whenever the order taker
 * opens the home screen; it replaces the previous one.
 */
export async function scheduleRouteReminder(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.cancelScheduledNotificationAsync(ID).catch(() => {});
    const at = new Date();
    at.setHours(HOUR, 0, 0, 0);
    if (Date.now() > at.getTime() - 60_000) return;
    const r = await rpc<RouteVisits>('route_visits', { p_user_id: null, p_date: addDays(1) });
    if (!r.has_plan || !r.day_no) return;
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await Notifications.setNotificationChannelAsync('route', { name: 'Route plan', importance: Notifications.AndroidImportance.HIGH });
    await Notifications.scheduleNotificationAsync({
      identifier: ID,
      content: {
        title: `Tomorrow's route: Day ${r.day_no}${r.label ? `, ${r.label}` : ''}`,
        body: `${r.stops.length} ${r.stops.length === 1 ? 'customer' : 'customers'} to visit${r.stops.length ? `: ${r.stops.slice(0, 4).map((s) => s.name).join(', ')}${r.stops.length > 4 ? '…' : ''}` : ''}`,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'route' },
    });
  } catch {
    // notifications blocked or offline: the in-app notification still arrives at 8 pm
  }
}
