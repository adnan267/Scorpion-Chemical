// LOCAL TESTING ONLY: dashboard tiles, recovery, recovery sheet, office expenses, prints, delete customer, no customer cash
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

({ browser, page, errors } = await open({ width: 1200, height: 900 }));
// printing opens nothing in headless Chrome; count calls instead
await page.evaluateOnNewDocument(() => { window.__prints = 0; const orig = HTMLIFrameElement.prototype; Object.defineProperty(window, 'onprint', { value: null, writable: true }); });
await login(page, '03007334811', 'admin123');
await step('dashboard: three big tiles', async () => {
  await need('Total balance in market', "Today's recovery", "Today's expenses", 'overdue');
  await shot(page, 'd1-admin-home');
});
await step('today\'s recovery', async () => {
  await go(page, '/recovery', 1500);
  await need('Recovery', 'Received today', 'Waiting for approval');
  await shot(page, 'd2-recovery', true);
});
await step('office expense and expenses report', async () => {
  await go(page, '/office-expense', 1500);
  await tap('Salary'); await page.type('input[placeholder="0"]', '25000'); await page.type('input[placeholder="e.g. Rashid, November"]', 'Rashid, November');
  await clickLabel(page, 'Save expense'); await sleep(1500);
  await go(page, '/expenses-report?period=today', 1800);
  await need('Office expenses', 'Salary', 'Rashid, November');
  await shot(page, 'd3-expenses', true);
  const r = await one(`select sum(amount)::int s from expenses where kind = 'office'`);
  if (r.s !== 25000) throw new Error(JSON.stringify(r));
});
await step('recovery sheet by city with print', async () => {
  await go(page, '/recovery-sheet', 1800);
  await tap('Multan ('); await sleep(1200);
  await need('Recovery sheet', 'Multan', 'Al Shifa Medical Store');
  const frames0 = (await page.$$('iframe')).length;
  await clickLabel(page, 'Print recovery sheet'); await sleep(1200);
  const html = await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.contentDocument?.documentElement?.outerHTML ?? '').find((h) => h.includes('Recovery sheet')) ?? '');
  if (!html.includes('Received') || !html.includes('class=" blank"') && !html.includes('blank')) throw new Error('print page not made');
  await shot(page, 'd4-recovery-sheet', true);
  const p2 = await browser.newPage(); await p2.setViewport({ width: 794, height: 1123 }); await p2.setContent(html); await p2.screenshot({ path: '/tmp/shots/d5-recovery-print.png', fullPage: true }); await p2.close();
});
await step('loading sheet: clear toggle and print', async () => {
  await go(page, '/stock-sheet', 1800);
  await need('Also show orders already delivered', 'Print loading sheet', 'Print all bills');
  await clickLabel(page, 'Print loading sheet'); await sleep(1200);
  const html = await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.contentDocument?.documentElement?.outerHTML ?? '').find((h) => h.includes('Loading sheet')) ?? '');
  if (!html.includes('Take out of the store in total')) throw new Error('loading sheet print not made');
  const p2 = await browser.newPage(); await p2.setViewport({ width: 794, height: 1123 }); await p2.setContent(html); await p2.screenshot({ path: '/tmp/shots/d6-loading-print.png', fullPage: true }); await p2.close();
});
await step('statement print', async () => {
  const ca = (await one(`select id from customers where name='Al Shifa Medical Store'`)).id;
  await go(page, `/ledger?customer=${ca}`, 1800);
  await clickLabel(page, 'Print statement'); await sleep(1000);
  const html = await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.contentDocument?.documentElement?.outerHTML ?? '').find((h) => h.includes('Statement of account')) ?? '');
  if (!html.includes('Balance to pay')) throw new Error('statement print not made');
});
await step('delete a customer', async () => {
  const cb = (await one(`select id from customers where name='City Pharmacy'`)).id;
  await go(page, `/customer/${cb}`, 1800);
  await tap('Delete customer'); await sleep(600);
  await page.evaluate(() => { const i = [...document.querySelectorAll('textarea, input')].pop(); i.focus(); });
  await page.keyboard.type('City Pharmacy');
  await shot(page, 'd7-delete');
  await clickLabel(page, 'Delete for ever'); await sleep(2000);
  const r = await one(`select (select count(*) from customers where id='${cb}')::int c, (select count(*) from orders where customer_id='${cb}')::int o`);
  if (r.c !== 0 || r.o !== 0) throw new Error(JSON.stringify(r));
});
allErrors.push(...errors); await browser.close();

({ browser, page, errors } = await open());
await login(page, '03033333333', 'store123');
await step('customer cannot choose cash', async () => {
  await go(page, '/payment/new', 1500);
  await tap('Bank Transfer'); await sleep(600);
  await need('JazzCash', 'EasyPaisa');
  if (await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].some((e) => e.innerText.trim().startsWith('Cash')))) throw new Error('cash offered');
  await shot(page, 'd8-customer-methods');
});
allErrors.push(...errors); await browser.close();
console.log(steps.join('\n'));
const real = [...new Set(allErrors)].filter((e) => !/status of 40[03]|^400 |tile|NAME_NOT_RESOLVED/.test(e));
console.log(real.length ? 'BROWSER ERRORS:\n' + real.join('\n') : 'no unexpected browser errors');
await db.end();
