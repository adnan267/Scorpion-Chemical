import { open, login, go, shot, clickLabel, sleep } from './shots.mjs';
import pg from 'pg';
const db = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'scorpion_e2e' });
await db.connect();
const one = async (q) => (await db.query(q)).rows[0];
const o3 = (await one(`select id from orders where order_no='ORD-1003'`)).id;
const p2 = (await one(`select id from payments where payment_no='PAY-1002'`)).id;
const ca = (await one(`select id from customers where name='Al Shifa Medical Store'`)).id;
const gl = (await one(`select id from products where name='Gloves'`)).id;

const { browser, page, errors } = await open();
await login(page, '03007334811', 'admin123');
const steps = [];
const step = async (name, fn) => { try { await fn(); steps.push('ok   ' + name); } catch (e) { steps.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); await shot(page, 'FAIL-' + name.replace(/\W+/g, '-')); } };

await step('order detail (pending, stock short)', async () => { await go(page, `/order/${o3}`); await shot(page, '10-order-pending', true); });
await step('confirm blocked by stock', async () => { await clickLabel(page, 'Confirm order'); await sleep(800); await shot(page, '11-confirm-blocked'); });
await step('change quantities sheet', async () => { await clickLabel(page, 'Change quantities'); await shot(page, '12-edit-sheet'); });
await step('reduce gloves to 10 and save', async () => {
  const inputs = await page.$$('input[aria-label="Quantity"]');
  // rows are ordered by product name: Blue Guard Face Mask (Adult), Gloves
  await inputs[1].click(); await sleep(200); await page.keyboard.type('10', { delay: 60 }); await sleep(300);
  const v = await page.$$eval('input[aria-label="Quantity"]', (els) => els.map((e) => e.value).join(','));
  if (v !== '20,10') throw new Error('quantities are ' + v);
  await shot(page, '12-edit-sheet');
  await clickLabel(page, 'Save changes'); await sleep(1500);
  const total = await page.evaluate(() => document.body.innerText.includes('4,275'));
  if (!total) throw new Error('new total 4,275 not shown');
});
await step('confirm order', async () => { await clickLabel(page, 'Confirm order'); await sleep(1200); await shot(page, '13-order-confirmed', true); });
await step('deliver with due date', async () => {
  await clickLabel(page, 'Mark as delivered');
  await page.type('input[placeholder="DD/MM/YYYY"]', '28/11/2026');
  await shot(page, '14-deliver-sheet');
  const btns = await page.$$('[aria-label="Mark as delivered"]');
  await btns[btns.length - 1].click(); await sleep(1500);
  await shot(page, '15-order-delivered', true);
});
await step('payments list', async () => { await go(page, '/payments?status=pending'); await shot(page, '20-payments'); });
await step('payment detail with receipt', async () => { await go(page, `/payment/${p2}`, 2200); await shot(page, '21-payment-detail', true); });
await step('approve payment', async () => { await clickLabel(page, 'Approve'); await shot(page, '22-approve-sheet'); await clickLabel(page, 'Approve payment'); await sleep(1500); await shot(page, '23-payment-approved'); });
await step('products (manage)', async () => { await go(page, '/catalog'); await shot(page, '30-products', true); });
await step('product form', async () => { await go(page, `/product/form?id=${gl}`); await shot(page, '31-product-form', true); });
await step('stock screen + add stock', async () => {
  await go(page, `/product/stock?id=${gl}`);
  const qty = await page.$$('input[placeholder="0"]'); await qty[0].type('200');
  await clickLabel(page, 'Add to stock'); await sleep(1200); await shot(page, '32-stock', true);
});
await step('customers', async () => { await go(page, '/customers'); await shot(page, '40-customers'); });
await step('customer detail', async () => { await go(page, `/customer/${ca}`); await shot(page, '41-customer', true); });
await step('discounts', async () => { await go(page, `/customer/discounts?id=${ca}`); await shot(page, '42-discounts'); });
await step('ledger', async () => { await go(page, `/ledger?customer=${ca}`); await shot(page, '43-ledger', true); });
await step('customer form (new)', async () => { await go(page, '/customer/form'); await shot(page, '44-customer-form', true); });
await step('users', async () => { await go(page, '/users'); await shot(page, '50-users'); });
await step('create order taker login', async () => {
  await go(page, '/user/form?role=order_taker');
  const inputs = await page.$$('input');
  await inputs[0].type('Usman Tariq'); await inputs[1].type('0302-2222222'); await inputs[2].type('usman123');
  await clickLabel(page, 'Create login'); await sleep(1500); await shot(page, '51-users-after-create');
});
await step('more', async () => { await go(page, '/more'); await shot(page, '60-more', true); });
await step('notifications', async () => { await go(page, '/notifications'); await shot(page, '61-notifications'); });
await step('cash', async () => { await go(page, '/cash'); await shot(page, '62-cash'); });
await step('announce', async () => {
  await go(page, '/announce');
  const inputs = await page.$$('input'); await inputs[0].type('New rates from Monday');
  await page.type('textarea', 'Please check the updated rate list in the app.');
  await clickLabel(page, 'Send announcement'); await sleep(1200);
});
await step('desktop layout', async () => {
  await page.setViewport({ width: 1280, height: 800 });
  await go(page, '/'); await shot(page, '70-desktop-home');
  await go(page, '/orders'); await shot(page, '71-desktop-orders');
});
console.log(steps.join('\n'));
console.log(errors.length ? 'BROWSER ERRORS:\n' + [...new Set(errors)].join('\n') : 'no browser errors');
const chk = await one(`select (select status from orders where order_no='ORD-1003') s, (select stock_qty from products where name='Gloves') g, (select status from payments where payment_no='PAY-1002') p, (select count(*) from profiles where phone='03022222222') u, (select count(*) from notifications where kind='announcement') a`);
console.log('db check:', JSON.stringify(chk));
await db.end(); await browser.close();
