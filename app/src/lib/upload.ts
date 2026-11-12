import { decode } from 'base64-arraybuffer';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

export type Picked = { base64: string; mime: string; ext: string; uri: string };

export async function pickImage(source: 'camera' | 'library'): Promise<Picked | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Allow camera access in your phone settings to take a photo.');
  }
  const launch = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const res = await launch({ mediaTypes: ['images'], quality: 0.6, base64: true });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const a = res.assets[0];
  let base64 = a.base64 ?? '';
  if (!base64 && a.uri.startsWith('data:')) base64 = a.uri.slice(a.uri.indexOf(',') + 1);
  if (!base64) throw new Error('Could not read that photo. Try another one.');
  const mime = a.mimeType && a.mimeType.startsWith('image/') ? a.mimeType : 'image/jpeg';
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return { base64, mime, ext, uri: a.uri };
}

async function upload(bucket: string, path: string, file: Picked): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(path, decode(file.base64), { contentType: file.mime, upsert: true });
  if (error) throw new Error(/fetch|network/i.test(error.message) ? 'Could not upload the photo. Check your internet and try again.' : error.message);
  return path;
}

/** Receipts go in the user's own folder: <user id>/<time>.jpg */
export function uploadProof(userId: string, file: Picked): Promise<string> {
  return upload('payment-proofs', `${userId}/${Date.now()}.${file.ext}`, file);
}

export function uploadProductImage(file: Picked): Promise<string> {
  return upload('product-images', `products/${Date.now()}.${file.ext}`, file);
}

export function productImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}

export async function proofUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 3600);
  if (error || !data) throw new Error('Could not load the receipt photo.');
  return data.signedUrl;
}
