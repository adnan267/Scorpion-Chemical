// Creates and manages login accounts. Runs with the project's secret key, so every request
// is checked here: only a signed-in, active admin may use it (except the one-time setup).
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
// must be the same value as EXPO_PUBLIC_AUTH_EMAIL_DOMAIN in the app
const EMAIL_DOMAIN = Deno.env.get("AUTH_EMAIL_DOMAIN") ?? "login.scorpionchemical.app";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function normPhone(p: string): string {
  let d = (p ?? "").replace(/\D/g, "");
  if (d.startsWith("0092")) d = d.slice(4);
  else if (d.startsWith("92") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith("3")) d = "0" + d;
  return d;
}

class Refuse extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    async function createLogin(role: string, fullName: string, phoneRaw: string, password: string, customerId: string | null) {
      const phone = normPhone(phoneRaw);
      if (!/^03\d{9}$/.test(phone)) throw new Refuse("Enter a valid mobile number, e.g. 03001234567");
      if (!password || password.length < 6) throw new Refuse("Password needs at least 6 characters");
      const { data, error } = await admin.auth.admin.createUser({
        email: `${phone}@${EMAIL_DOMAIN}`,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, phone },
      });
      if (error || !data.user) {
        if (/already|registered|exists/i.test(error?.message ?? "")) throw new Refuse("This mobile number already has a login");
        throw new Refuse(error?.message ?? "Could not create the login");
      }
      const { error: perr } = await admin.rpc("service_create_profile", {
        p_user_id: data.user.id,
        p_role: role,
        p_full_name: fullName,
        p_phone: phone,
        p_customer_id: customerId,
      });
      if (perr) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw new Refuse(/duplicate|unique/i.test(perr.message) ? "This mobile number already has a login" : perr.message);
      }
      return data.user.id;
    }

    // ---- one-time setup: create the first admin with the setup code ----
    if (body.action === "bootstrap") {
      const { data: ok, error } = await admin.rpc("service_bootstrap_allowed", { p_code: String(body.setup_code ?? "") });
      if (error) throw new Refuse(error.message, 500);
      if (!ok) throw new Refuse("Setup is already done, or the setup code is wrong", 403);
      const id = await createLogin("admin", String(body.full_name ?? "").trim(), String(body.phone ?? ""), String(body.password ?? ""), null);
      await admin.rpc("service_bootstrap_done");
      return json({ id });
    }

    // ---- everything else needs a signed-in, active admin ----
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who, error: werr } = await admin.auth.getUser(token);
    if (werr || !who?.user) throw new Refuse("Please sign in again", 401);
    const { data: me } = await admin.from("profiles").select("role, is_active").eq("id", who.user.id).maybeSingle();
    if (!me || me.role !== "admin" || !me.is_active) throw new Refuse("You are not allowed to do this", 403);

    if (body.action === "create") {
      const role = String(body.role ?? "");
      if (!["admin", "order_taker", "store", "distributor"].includes(role)) throw new Refuse("Invalid role");
      const id = await createLogin(role, String(body.full_name ?? "").trim(), String(body.phone ?? ""), String(body.password ?? ""), body.customer_id ?? null);
      return json({ id });
    }

    if (body.action === "set_password") {
      const password = String(body.password ?? "");
      if (password.length < 6) throw new Refuse("Password needs at least 6 characters");
      const { error } = await admin.auth.admin.updateUserById(String(body.user_id), { password });
      if (error) throw new Refuse(error.message);
      return json({ ok: true });
    }

    if (body.action === "set_phone") {
      const phone = normPhone(String(body.phone ?? ""));
      if (!/^03\d{9}$/.test(phone)) throw new Refuse("Enter a valid mobile number, e.g. 03001234567");
      const userId = String(body.user_id);
      const { data: before } = await admin.from("profiles").select("phone").eq("id", userId).maybeSingle();
      if (!before) throw new Refuse("User not found");
      const { error } = await admin.auth.admin.updateUserById(userId, { email: `${phone}@${EMAIL_DOMAIN}`, email_confirm: true });
      if (error) throw new Refuse(/already|registered|exists/i.test(error.message) ? "This mobile number already has a login" : error.message);
      const { error: perr } = await admin.rpc("service_set_phone", { p_user_id: userId, p_phone: phone });
      if (perr) {
        await admin.auth.admin.updateUserById(userId, { email: `${before.phone}@${EMAIL_DOMAIN}`, email_confirm: true });
        throw new Refuse(/duplicate|unique/i.test(perr.message) ? "This mobile number already has a login" : perr.message);
      }
      return json({ ok: true });
    }

    throw new Refuse("Unknown action");
  } catch (e) {
    if (e instanceof Refuse) return json({ error: e.message }, e.status);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
