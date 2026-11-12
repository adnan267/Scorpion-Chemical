// Order taker live location.
// While on duty, Android sends this app a location every couple of minutes, even when the app
// is closed, through a "foreground service" (a permanent notification says location is on).
// Points are queued on the phone and uploaded; if there is no internet they wait and go later.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { rpc } from './api';

export const LOCATION_TASK = 'scorpion-duty-location';
const QUEUE_KEY = 'scorpion.location-queue';
const LAST_SENT_KEY = 'scorpion.location-last-sent';
const MAX_QUEUE = 2000;

type Point = { lat: number; lng: number; accuracy: number | null; speed: number | null; t: number };

let flushing = false;

async function readQueue(): Promise<Point[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as Point[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(q: Point[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
}

/** Uploads queued points. Returns true when the server says the duty is no longer open. */
export async function flushLocations(): Promise<boolean> {
  if (flushing) return false;
  flushing = true;
  try {
    let q = await readQueue();
    while (q.length) {
      const batch = q.slice(0, 200);
      const saved = await rpc<number>('location_push', { p_points: batch });
      q = (await readQueue()).slice(batch.length);
      await writeQueue(q);
      await AsyncStorage.setItem(LAST_SENT_KEY, String(Date.now()));
      if (saved === 0 && batch.length > 0) {
        // nothing accepted: duty was ended (by the user on another device, or closed by the server)
        const st = await rpc<{ on_duty: boolean }>('duty_status');
        if (!st.on_duty) {
          await writeQueue([]);
          return true;
        }
      }
    }
    return false;
  } catch {
    return false; // offline: keep the queue for next time
  } finally {
    flushing = false;
  }
}

export async function lastSentAt(): Promise<number | null> {
  const v = await AsyncStorage.getItem(LAST_SENT_KEY);
  return v ? Number(v) : null;
}

export async function queuedCount(): Promise<number> {
  return (await readQueue()).length;
}

// ---- background task (must be defined when the JS bundle loads, before any screen) ----
if (Platform.OS === 'android') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TaskManager = require('expo-task-manager');
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: { data?: { locations?: any[] }; error?: unknown }) => {
    if (error || !data?.locations?.length) return;
    const pts: Point[] = data.locations.map((l: any) => ({
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      accuracy: l.coords.accuracy ?? null,
      speed: l.coords.speed ?? null,
      t: Math.round(l.timestamp),
    }));
    await writeQueue([...(await readQueue()), ...pts]);
    const ended = await flushLocations();
    if (ended) await stopTracking().catch(() => {});
  });
}

export const trackingSupported = Platform.OS === 'android';

export async function isTracking(): Promise<boolean> {
  if (!trackingSupported) return false;
  const Location = await import('expo-location');
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
}

export type StartResult = { background: boolean };

/** Asks for permission and starts sending location. Throws an Error with a readable message. */
export async function startTracking(): Promise<StartResult> {
  if (!trackingSupported) throw new Error('Live location works in the Android app only.');
  const Location = await import('expo-location');
  if (!(await Location.hasServicesEnabledAsync())) {
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      throw new Error('Turn on Location (GPS) on your phone, then try again.');
    }
  }
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) {
    throw new Error('Location permission is needed to start duty. Allow it in phone Settings > Apps > Scorpion Chemical > Permissions.');
  }
  let background = (await Location.getBackgroundPermissionsAsync()).granted;
  if (!background) {
    // Opens Android settings on Android 11+; the user picks "Allow all the time". Optional.
    background = (await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }))).granted;
  }
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    return { background };
  }
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 2 * 60 * 1000,
    distanceInterval: 30,
    deferredUpdatesInterval: 2 * 60 * 1000,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'On duty',
      notificationBody: 'Your location is shared with Scorpion Chemical until you end duty.',
      notificationColor: '#0B5CAD',
      killServiceOnDestroy: false,
    },
  });
  // send one point straight away so the admin sees you at once
  try {
    const now = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    await writeQueue([
      ...(await readQueue()),
      { lat: now.coords.latitude, lng: now.coords.longitude, accuracy: now.coords.accuracy ?? null, speed: now.coords.speed ?? null, t: Math.round(now.timestamp) },
    ]);
    await flushLocations();
  } catch {
    // the background updates will send the first point
  }
  return { background };
}

export async function stopTracking(): Promise<void> {
  if (!trackingSupported) return;
  const Location = await import('expo-location');
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}
