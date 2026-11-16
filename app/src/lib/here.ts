import * as Location from 'expo-location';

export type Here = { lat: number; lng: number; accuracy: number | null };

/** The phone's current position, for saving a shop's location while standing at the shop. */
export async function getHere(): Promise<Here> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new Error('Allow location for this app in your phone settings, then try again.');
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null };
}

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
