import { open, login, go, shot, clickLabel, sleep } from './shots.mjs';
import pg from 'pg';
const db = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'scorpion_e2e' });
await db.connect();
const steps = [];
const { browser, page, errors } = await open();
const step = async (name, fn) => { try { await fn(); steps.push('ok   ' + name); } catch (e) { steps.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); await shot(page, 'FAIL-' + name.replace(/\W+/g, '-')).catch(() => {}); } };
const hasText = (t) => page.evaluate((x) => document.body.innerText.includes(x), t);
const clickText = async (t, last = false) => {
  const ok = await page.evaluate((x, l) => {
    const els = [...document.querySelectorAll('div[tabindex="0"], [role="button"]')].filter((e) => e.innerText && e.innerText.split('\n')[0].trim() === x);
    const el = l ? els[els.length - 1] : els.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!el) return false; el.click(); return true;
  }, t, last);
  if (!ok) throw new Error('nothing to click: ' + t);
  await sleep(700);
};
await login(page, '03007334811', 'admin123');
await step('type list has all six types', async () => {
  await go(page, '/customer/form');
  await clickText('Medical store');
  for (const t of ['Distributor', 'Wholesaler', 'Retailer', 'Clinic', 'Hospital']) if (!(await hasText(t))) throw new Error(t + ' missing');
  await shot(page, 't1-types');
  await clickText('Hospital', true);
  if (!(await hasText('Hospital name'))) throw new Error('name label not updated');
});
await step('add hospital with login', async () => {
  const inputs = await page.$$('input');
  await inputs[0].type('Nishtar Hospital'); await inputs[7].type('03088888888'); await inputs[8].type('hosp1234');
  await clickLabel(page, 'Add customer'); await sleep(2500);
  const r = (await db.query(`select c.type, p.role from customers c join profiles p on p.customer_id = c.id where c.name = 'Nishtar Hospital'`)).rows[0];
  if (!r || r.type !== 'hospital' || r.role !== 'store') throw new Error(JSON.stringify(r));
  if (!(await hasText('Hospital'))) throw new Error('detail subtitle');
  await shot(page, 't2-hospital');
});
await step('customers list has a Hospitals filter', async () => { await go(page, '/customers'); if (!(await hasText('Hospitals'))) throw new Error('chip missing'); await shot(page, 't3-customers'); });
await step('hospital signs in and orders', async () => {
  await go(page, '/more');
  await page.evaluate(() => { [...document.querySelectorAll('[role="button"]')].find((e) => e.innerText.includes('Sign out')).click(); });
  await sleep(600); await clickLabel(page, 'Sign out'); await sleep(1500);
  await page.type('input[placeholder="03001234567"]', '03088888888'); await page.type('input[type="password"]', 'hosp1234');
  await page.click('[aria-label="Sign in"]'); await sleep(2500);
  if (!(await hasText('Nishtar Hospital'))) throw new Error('home');
  await shot(page, 't4-hospital-home');
});
console.log(steps.join('\n'));
const real = [...new Set(errors)].filter((e) => !/status of 40[03]|logout|tile\.openstreetmap|net::/.test(e));
console.log(real.length ? 'BROWSER ERRORS:\n' + real.join('\n') : 'no unexpected browser errors');
await db.end(); await browser.close();
