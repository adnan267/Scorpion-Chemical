export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';
export const AUTH_EMAIL_DOMAIN =
  process.env.EXPO_PUBLIC_AUTH_EMAIL_DOMAIN ?? 'login.scorpionchemical.app';
export const isConfigured = SUPABASE_URL.length > 0 && SUPABASE_KEY.length > 0;
