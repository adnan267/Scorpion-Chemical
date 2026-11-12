// Sends one notification to the user's phones through Firebase Cloud Messaging (FCM).
// Called by the database (see supabase/later/0005_push_trigger.sql) each time a row is
// added to `notifications`. NOT ENABLED YET: it needs a Firebase project.
//
// Secrets this function needs (Supabase > Edge Functions > Secrets):
//   FIREBASE_SERVICE_ACCOUNT  the full JSON of a Firebase service-account key
//   PUSH_WEBHOOK_SECRET       any long random text; the same value goes in the trigger
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// new-style secret key if the project has one, otherwise the legacy service_role key
const SECRET_KEY = (() => {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default as string;
  } catch {
    // fall through
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
})();
const WEBHOOK_SECRET = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";
const SERVICE_ACCOUNT = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "{}");

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let cached: { token: string; exp: number } | null = null;

// Google access token from the service-account key (signed JWT -> OAuth token)
async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp > now + 60) return cached.token;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: SERVICE_ACCOUNT.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const pem = String(SERVICE_ACCOUNT.private_key).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${claim}.${b64url(sig)}`,
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${JSON.stringify(out)}`);
  cached = { token: out.access_token, exp: now + Number(out.expires_in ?? 3600) };
  return cached.token;
}

Deno.serve(async (req: Request) => {
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const { notification_id } = await req.json();
    const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.rpc("service_push_targets", { p_notification_id: notification_id });
    if (error) throw error;
    const tokens: string[] = data?.tokens ?? [];
    if (tokens.length === 0) return Response.json({ sent: 0 });

    const bearer = await accessToken();
    let sent = 0;
    for (const token of tokens) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${SERVICE_ACCOUNT.project_id}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: data.title, body: data.body },
            data: { kind: String(data.kind ?? ""), ref_type: String(data.ref_type ?? ""), ref_id: String(data.ref_id ?? "") },
            android: { priority: "HIGH", notification: { channel_id: "default" } },
          },
        }),
      });
      if (res.ok) sent++;
      else if (res.status === 404 || res.status === 400) {
        // the phone uninstalled the app or the token expired: forget it
        await admin.rpc("service_drop_push_token", { p_token: token });
      }
    }
    return Response.json({ sent });
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
});
