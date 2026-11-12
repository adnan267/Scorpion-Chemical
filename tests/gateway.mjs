// LOCAL TESTING ONLY. A tiny stand-in for Supabase so the built web app can be clicked
// through against the local test database: login, API functions, account management
// and file storage. It is not part of the app and is never deployed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const PORT = Number(process.env.PORT || 54400);
const WEB = process.env.WEB_DIR || '/home/claude/scorpion/web-dist';
const FILES = process.env.FILES_DIR || '/tmp/scorpion-storage';
const DOMAIN = 'login.scorpionchemical.app';
const SECRET = 'local-test-secret';
const pool = new pg.Pool({ host: '127.0.0.1', port: 54329, user: 'postgres', database: process.env.DB || 'scorpion_e2e' });
const refresh = new Map();

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function jwt(user) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 });
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function userFromToken(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const parts = t.split('.');
  if (parts.length !== 3) return null;
  const sig = crypto.createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (sig !== parts[2]) return null;
  const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  return p.exp > Date.now() / 1000 ? p : null;
}
function session(user) {
  const rt = crypto.randomUUID();
  refresh.set(rt, user);
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: jwt(user), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: rt,
    user: { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
const send = (res, status, body, headers = {}) => {
  const data = body === undefined ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', ...headers });
  res.end(data);
};
const readBody = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
const normPhone = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('0092')) d = d.slice(4); else if (d.startsWith('92') && d.length === 12) d = d.slice(2); if (d.length === 10 && d.startsWith('3')) d = '0' + d; return d; };

async function asUser(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims || {})]);
    await c.query(`set local role ${claims ? 'authenticated' : 'anon'}`);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function adminUsers(req, body) {
  const q = (sql, args) => pool.query(sql, args);
  const create = async (role, name, phoneRaw, password, customerId) => {
    const phone = normPhone(phoneRaw);
    if (!/^03\d{9}$/.test(phone)) throw new Error('Enter a valid mobile number, e.g. 03001234567');
    if (!password || password.length < 6) throw new Error('Password needs at least 6 characters');
    const c = await pool.connect();
    try {
      await c.query('begin');
      const u = await c.query(`insert into auth.users(email, encrypted_password) values ($1, crypt($2, gen_salt('bf'))) returning id`, [`${phone}@${DOMAIN}`, password]);
      await c.query('select public.service_create_profile($1,$2,$3,$4,$5)', [u.rows[0].id, role, name, phone, customerId]);
      await c.query('commit');
      return u.rows[0].id;
    } catch (e) {
      await c.query('rollback');
      throw new Error(/duplicate|unique/i.test(e.message) ? 'This mobile number already has a login' : e.message);
    } finally { c.release(); }
  };
  if (body.action === 'bootstrap') {
    const ok = (await q('select public.service_bootstrap_allowed($1) ok', [String(body.setup_code || '')])).rows[0].ok;
    if (!ok) return [403, { error: 'Setup is already done, or the setup code is wrong' }];
    const id = await create('admin', body.full_name, body.phone, body.password, null);
    await q('select public.service_bootstrap_done()');
    return [200, { id }];
  }
  const who = userFromToken(req);
  if (!who) return [401, { error: 'Please sign in again' }];
  const me = (await q('select role, is_active from public.profiles where id = $1', [who.sub])).rows[0];
  if (!me || me.role !== 'admin' || !me.is_active) return [403, { error: 'You are not allowed to do this' }];
  if (body.action === 'create') return [200, { id: await create(body.role, body.full_name, body.phone, body.password, body.customer_id || null) }];
  if (body.action === 'set_password') {
    if (String(body.password || '').length < 6) return [400, { error: 'Password needs at least 6 characters' }];
    await q(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where id = $1`, [body.user_id, body.password]);
    return [200, { ok: true }];
  }
  if (body.action === 'set_phone') {
    const phone = normPhone(body.phone);
    await q('update auth.users set email = $2 where id = $1', [body.user_id, `${phone}@${DOMAIN}`]);
    await q('select public.service_set_phone($1,$2)', [body.user_id, phone]);
    return [200, { ok: true }];
  }
  return [400, { error: 'Unknown action' }];
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'OPTIONS') return send(res, 204);

    // ---------- auth ----------
    if (p === '/auth/v1/token') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const u = refresh.get(body.refresh_token);
        if (!u) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', msg: 'Invalid Refresh Token' });
        refresh.delete(body.refresh_token);
        return send(res, 200, session(u));
      }
      const r = await pool.query('select id, email from auth.users where email = $1 and encrypted_password = crypt($2, encrypted_password)', [body.email, body.password]);
      if (!r.rows[0]) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(res, 200, session(r.rows[0]));
    }
    if (p === '/auth/v1/user') {
      const who = userFromToken(req);
      if (!who) return send(res, 401, { msg: 'invalid JWT' });
      if (req.method === 'PUT') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        if (body.password) await pool.query(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where id = $1`, [who.sub, body.password]);
      }
      return send(res, 200, { id: who.sub, aud: 'authenticated', role: 'authenticated', email: who.email, app_metadata: {}, user_metadata: {} });
    }
    if (p === '/auth/v1/logout') return send(res, 204);

    // ---------- API functions ----------
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length);
      if (!/^[a-z_]+$/.test(fn)) return send(res, 404, { message: 'not found' });
      const args = JSON.parse((await readBody(req)).toString() || '{}');
      const keys = Object.keys(args);
      const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      const vals = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
      try {
        const out = await asUser(userFromToken(req), (c) => c.query(sql, vals));
        const r = out.rows[0]?.r;
        return send(res, 200, JSON.stringify(r === undefined || r === '' ? null : r));
      } catch (e) {
        return send(res, e.code === '42501' ? 403 : 400, { code: e.code, message: e.message, details: null, hint: null });
      }
    }

    // ---------- account management (edge function) ----------
    if (p === '/functions/v1/admin-users') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      try {
        const [status, out] = await adminUsers(req, body);
        return send(res, status, out);
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }

    // ---------- storage ----------
    if (p.startsWith('/storage/v1/object/')) {
      let rest = p.slice('/storage/v1/object/'.length);
      if (req.method === 'POST' && rest.startsWith('sign/')) {
        rest = rest.slice(5);
        return send(res, 200, { signedURL: `/object/sign/${rest}?token=local` });
      }
      if (req.method === 'GET') {
        rest = rest.replace(/^(public|sign|authenticated)\//, '');
        const file = path.join(FILES, rest);
        if (!file.startsWith(FILES) || !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
        return send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        const file = path.join(FILES, rest);
        if (!file.startsWith(FILES)) return send(res, 400, { error: 'bad path' });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, await readBody(req));
        return send(res, 200, { Key: rest, path: rest.split('/').slice(1).join('/'), Id: crypto.randomUUID() });
      }
    }

    // ---------- the built web app ----------
    let file = path.join(WEB, p === '/' ? 'index.html' : p);
    if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB, 'index.html');
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  } catch (e) {
    console.error(p, e);
    send(res, 500, { message: e.message });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`gateway on http://127.0.0.1:${PORT}`));
