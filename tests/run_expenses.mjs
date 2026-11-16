// LOCAL TESTING ONLY: order taker expenses and the admin report
import { open, login, go, shot, clickLabel, sleep } from './shots.mjs';
import pg from 'pg';
const db = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'scorpion_e2e' });
await db.connect();
const one = async (q) => (await db.query(q)).rows[0];
const steps = [];
let page, errors, browser;
const allErrors = [];
const step = async (name, fn) => { try { await fn(); steps.push('ok   ' + name); } catch (e) { steps.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); await shot(page, 'FAIL-' + name.replace(/\W+/g, '-')).catch(() => {}); } };
const hasText = (t) => page.evaluate((x) => document.body.innerText.includes(x), t);
const need = async (...ts) => { for (const t of ts) if (!(await hasText(t))) throw new Error('missing text: ' + t); };
const tap = (t) => page.evaluate((x) => { const els = [...document.querySelectorAll('[role="button"]')].filter((e) => e.innerText.includes(x)).sort((a, b) => a.innerText.length - b.innerText.length); if (!els[0]) throw new Error('no ' + x); els[0].click(); }, t);
const taker = (await one(`select id from profiles where phone='03011111111'`)).id;
await db.query(`insert into expenses(user_id, spent_on, city, category, amount) values ('${taker}', current_date - 1, 'Vehari', 'bus', 400)`);

({ browser, page, errors } = await open());
await login(page, '03011111111', 'taker123');
await step('taker home shows today\'s expenses', async () => { await need("Today's expenses", 'Add expense'); });
await step('taker adds expenses', async () => {
  await go(page, '/expenses');
  if (await hasText('Vehari')) throw new Error('yesterday visible to booker');
  await page.type('input[placeholder="e.g. Khanewal"]', 'Khanewal');
  await tap('Wagon / van'); await page.type('input[placeholder="0"]', '250'); await clickLabel(page, 'Add expense'); await sleep(1200);
  await tap('Stock carriage'); await page.type('input[placeholder="0"]', '300');
  await page.type('input[placeholder^="e.g. 3 cartons"]', '2 cartons'); await clickLabel(page, 'Add expense'); await sleep(1200);
  await tap('Chingchi'); await page.type('input[placeholder="0"]', '40'); await clickLabel(page, 'Add expense'); await sleep(1200);
  await need('Added today: Rs. 590', 'Stock carriage', '2 cartons');
  await shot(page, 'e1-taker-expenses', true);
});
await step('taker removes a wrong entry', async () => {
  await clickLabel(page, 'Remove Chingchi'); await clickLabel(page, 'Remove'); await sleep(1200);
  await need('Added today: Rs. 550');
});
allErrors.push(...errors); await browser.close();

({ browser, page, errors } = await open());
await login(page, '03007334811', 'admin123');
await step('admin expense report', async () => {
  await go(page, '/expenses-report', 1800);
  await need('Order taker expenses', 'Khanewal', 'Vehari', 'Stock carriage', 'a tour');
  await tap('Last month'); await sleep(1200); await tap('This month'); await sleep(1200);
  await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].find((e) => e.innerText.startsWith('Khanewal')).click()); await sleep(600);
  await need('2 cartons');
  await shot(page, 'e2-admin-expenses', true);
});
allErrors.push(...errors); await browser.close();
console.log(steps.join('\n'));
const real = [...new Set(allErrors)].filter((e) => !/status of 40[03]|^400 |tile|NAME_NOT_RESOLVED/.test(e));
console.log(real.length ? 'BROWSER ERRORS:\n' + real.join('\n') : 'no unexpected browser errors');
const r = await one(`select sum(amount)::int s, count(*)::int n from expenses where spent_on = current_date`);
console.log('db:', JSON.stringify(r));
await db.end();
