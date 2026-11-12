import { open, login, go, shot, clickLabel, sleep, BASE } from './shots.mjs';
import pg from 'pg';
const db = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'scorpion_e2e' });
await db.connect();
const one = async (q) => (await db.query(q)).rows[0];
const ca = (await one(`select id from customers where name='Al Shifa Medical Store'`)).id;
const o1 = (await one(`select id from orders where order_no='ORD-1001'`)).id;
const taker = (await one(`select id from profiles where role='order_taker'`)).id;
const steps = [];
const { browser, page, errors } = await open();
const step = async (name, fn) => { try { await fn(); steps.push('ok   ' + name); } catch (e) { steps.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); await shot(page, 'FAIL-' + name.replace(/\W+/g, '-')).catch(() => {}); } };
const hasText = (t) => page.evaluate((x) => document.body.innerText.includes(x), t);
await login(page, '03007334811', 'admin123');

await step('discounts: change default and one product', async () => {
  await go(page, `/customer/discounts?id=${ca}`);
  const def = (await page.$$('input'))[0];
  await def.click(); await sleep(200); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type('7.5');
  const cyc = await page.$('input[aria-label="Discount for Cyclone Toilet Cleaner 500ml"]');
  await cyc.click(); await sleep(200); await page.keyboard.type('12');
  await shot(page, 'a1-discounts-edit');
  await clickLabel(page, 'Save discounts'); await sleep(1500);
  const r = await one(`select default_discount_pct d, (select discount_pct from customer_discounts cd join products p on p.id = cd.product_id where cd.customer_id = c.id and p.pack_size = '500ml') cyc, (select count(*) from customer_discounts where customer_id = c.id) n from customers c where id = '${ca}'`);
  if (Number(r.d) !== 7.5 || Number(r.cyc) !== 12 || Number(r.n) !== 2) throw new Error('saved ' + JSON.stringify(r));
});
await step('ledger: add adjustment', async () => {
  await go(page, `/ledger?customer=${ca}`);
  await clickLabel(page, 'Add adjustment');
  await page.type('input[placeholder="0"], input[inputmode="decimal"]', '300');
  await page.type('textarea', 'Damaged bottles returned');
  await shot(page, 'a2-adjust-sheet');
  await clickLabel(page, 'Save adjustment'); await sleep(1500);
  if (!(await hasText('15,000'))) throw new Error('balance should be 15,000 after 300 credit');
  await shot(page, 'a3-ledger-after-adjust');
});
await step('invoice opens for printing', async () => {
  await go(page, `/order/${o1}`);
  const popup = new Promise((res) => browser.once('targetcreated', async (t) => res(await t.page())));
  await clickLabel(page, 'Invoice (PDF)');
  const p2 = await Promise.race([popup, sleep(6000).then(() => null)]);
  if (!p2) throw new Error('invoice window did not open');
  await sleep(800);
  await p2.evaluate(() => { window.print = () => {}; });
  const text = await p2.evaluate(() => document.body.innerText);
  if (!/Invoice/.test(text) || !/ORD-1001/.test(text) || !/Al Shifa Medical Store/.test(text) || !/11,100/.test(text) || !/Remaining/.test(text)) throw new Error('invoice content wrong: ' + text.slice(0, 200));
  await p2.setViewport({ width: 800, height: 1000 });
  await p2.screenshot({ path: '/tmp/shots/a4-invoice.png' });
  await p2.close();
});
await step('add customer with app login', async () => {
  await go(page, '/customer/form');
  const inputs = await page.$$('input');
  // order: name, owner, phone, address, city, discount, opening, login phone, login password
  await inputs[0].type('Noor Pharmacy'); await inputs[1].type('Noor Ahmed'); await inputs[2].type('0304-4444444'); await inputs[3].type('Bosan Road');
  await inputs[5].click(); await sleep(150); await page.keyboard.type('4');
  await inputs[6].type('1200'); await inputs[7].type('03044444444'); await inputs[8].type('noor1234');
  await clickLabel(page, 'Add customer'); await sleep(2500);
  await shot(page, 'a5-new-customer');
  const r = await one(`select c.default_discount_pct d, (select sum(debit - credit) from ledger_entries where customer_id = c.id) bal, (select count(*) from profiles where customer_id = c.id and role = 'store' and phone = '03044444444') logins from customers c where name = 'Noor Pharmacy'`);
  if (!r || Number(r.d) !== 4 || Number(r.bal) !== 1200 || Number(r.logins) !== 1) throw new Error('saved ' + JSON.stringify(r));
});
await step('reset an order taker password', async () => {
  await go(page, `/user/form?id=${taker}`);
  await clickLabel(page, 'Set a new password');
  await page.type('textarea', 'bilal999'); await clickLabel(page, 'Set password'); await sleep(1200);
  const ok = await one(`select encrypted_password = crypt('bilal999', encrypted_password) ok from auth.users where id = '${taker}'`);
  if (!ok.ok) throw new Error('password not changed');
});
await step('new customer can sign in and sees 4% price', async () => {
  await go(page, '/more');
  await page.evaluate(() => { [...document.querySelectorAll('[role="button"]')].find((e) => e.innerText.includes('Sign out')).click(); });
  await sleep(600); await clickLabel(page, 'Sign out'); await sleep(1500);
  await page.type('input[placeholder="03001234567"]', '03044444444'); await page.type('input[type="password"]', 'noor1234');
  await page.click('[aria-label="Sign in"]'); await sleep(2500);
  if (!(await hasText('Noor Pharmacy')) || !(await hasText('1,200'))) throw new Error('new customer home wrong');
  await go(page, '/catalog');
  if (!(await hasText('4% off'))) throw new Error('4% discount not applied');
  await shot(page, 'a6-new-customer-catalog');
});
console.log(steps.join('\n'));
const real = [...new Set(errors)].filter((e) => !/status of 40[03]|logout/.test(e));
console.log(real.length ? 'BROWSER ERRORS:\n' + real.join('\n') : 'no unexpected browser errors');
await db.end(); await browser.close();
