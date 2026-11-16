// LOCAL TESTING ONLY: v2 walkthrough (returns, loading sheet, stock keeper, settings, opening data, Excel import)
import { open, login, go, shot, clickLabel, sleep } from './shots.mjs';
import pg from 'pg';
import fs from 'node:fs';
import writeXlsxFile from '/home/claude/scorpion/app/node_modules/write-excel-file/node/index.js';
import readXlsxFile from '/home/claude/scorpion/app/node_modules/read-excel-file/node/index.js';

const db = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'scorpion_e2e' });
await db.connect();
const one = async (q) => (await db.query(q)).rows[0];
const ids = await one(`select (select id from orders where order_no='INV-1002') o2, (select id from orders where order_no='INV-1004') o4,
  (select id from customers where name='Al Shifa Medical Store') ca, (select id from customers where name='Rehman Medicos') cc`);
const steps = [];
let page, errors, browser;
const allErrors = [];
const step = async (name, fn) => { try { await fn(); steps.push('ok   ' + name); } catch (e) { steps.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); await shot(page, 'FAIL-' + name.replace(/\W+/g, '-')).catch(() => {}); } };
const hasText = (t) => page.evaluate((x) => document.body.innerText.includes(x), t);
const need = async (...ts) => { for (const t of ts) if (!(await hasText(t))) throw new Error('missing text: ' + t); };

// Excel files for the import
const H = (a) => a.map((v) => ({ value: v, fontWeight: 'bold' }));
const custHead = H(['Name', 'Type', 'Owner name', 'Phone', 'Address', 'City', 'Order taker', 'Discount %', 'Credit days', 'Opening balance', 'Licence no.', 'Licence issue date', 'Licence expiry date']);
const billHead = H(['Customer', 'Bill no.', 'Bill date', 'Amount', 'Already paid', 'Due date']);
const stockHead = H(['Product ID', 'Product', 'Pack size', 'Stock now', 'New stock']);
const mk = async (file, customers, bills, stock) => {
  await writeXlsxFile([{ sheet: 'Customers', dateFormat: 'dd/mm/yyyy', data: [custHead, ...customers] }, { sheet: 'Old bills', dateFormat: 'dd/mm/yyyy', data: [billHead, ...bills] }, { sheet: 'Stock', data: [stockHead, ...stock] }]).toFile(file);
};
await mk('/tmp/opening-bad.xlsx',
  [['Madina Dawakhana', 'Dawakhana', 'Hakeem Saeed', '0306-1234567', 'Hussain Agahi', 'Multan', 'Nobody Here', 3, 20, 7000, 'DL-9', '10/01/2024', '09/01/2026']],
  [['Unknown Store', 'OLD-1', '05/10/2026', 5000, null, '05/11/2026']],
  [[null, 'Gloves', '', 2, 'many']]);
await mk('/tmp/opening-good.xlsx',
  [['Madina Dawakhana', 'Dawakhana', 'Hakeem Saeed', '0306-1234567', 'Hussain Agahi', 'Multan', 'Bilal Ahmed', 3, 20, 7000, 'DL-9', '10/01/2024', new Date(Date.UTC(2026, 0, 9))],
   ['Shifa Clinic', 'Clinic', null, null, null, 'Khanewal', '03011111111', null, null, null, null, null, null]],
  [['Madina Dawakhana', 'OLD-1', '05/10/2026', 5000, 1000, '05/11/2026'], ['Rehman Medicos', null, new Date(Date.UTC(2026, 9, 20)), 2500, null, null]],
  [[null, 'Gloves', '', 2, 150]]);

// ================= admin =================
({ browser, page, errors } = await open());
await login(page, '03007334811', 'admin123');
await step('home: quick buttons, licence warning, week/month', async () => {
  await shot(page, 'v01-admin-home', true);
  await need('Take an order', 'Record payment', 'expired licence', 'Orders this week', 'Orders this month');
});
await step('orders: month view with booked-by summary', async () => {
  await go(page, '/orders'); await shot(page, 'v02-orders', true);
  await need('This month', 'Bilal Ahmed', 'To deliver');
});
await step('loading sheet and all invoices', async () => {
  await go(page, '/stock-sheet'); await shot(page, 'v03-loading-sheet', true);
  await need('Take out in total', 'Bilal Ahmed', 'Blue Guard Face Mask');
  await clickLabel(page, 'Print all bills'); await sleep(3000);
  const html = await page.$eval('iframe', (f) => f.srcdoc);
  for (const n of ['INV-1003', 'INV-1004', 'INV-1005']) if (!html.includes(n)) throw new Error('missing ' + n);
  await shot(page, 'v04-all-invoices');
});
await step('settings: warranty, signature upload, returns toggle', async () => {
  await go(page, '/settings', 2000);
  await need('Allow returns before the due date');
  if (!(await page.$eval('textarea', (t) => t.value)).includes('JULIUS YOUNAS')) throw new Error('warranty text missing');
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), page.click('[aria-label="Add signature"]')]);
  await chooser.accept(['/home/claude/sig/signature.png']); await sleep(1500);
  await page.evaluate(() => { [...document.querySelectorAll('[role="switch"], input[type="checkbox"]')].forEach((e) => e.click()); });
  await sleep(400); await shot(page, 'v05-settings', true);
  await clickLabel(page, 'Save settings'); await sleep(1500);
  const r = await one(`select (select value->>'signature' from app_settings where key='invoice') like 'data:image/%' sig, (select value->>'before_due' from app_settings where key='returns') bd`);
  if (!r.sig || r.bd !== 'true') throw new Error(JSON.stringify(r));
});
await step('return goods before due date (now allowed)', async () => {
  await go(page, `/order/${ids.o2}`);
  await clickLabel(page, 'Return goods');
  await page.click('[aria-label="Increase quantity"]'); await sleep(200);
  await page.click('[aria-label="Increase quantity"]'); await sleep(300);
  await shot(page, 'v06-return-sheet');
  await clickLabel(page, 'Save return'); await sleep(1800);
  await shot(page, 'v07-after-return', true);
  await need('Returns');
  const r = await one(`select count(*)::int n, sum(i.qty)::int q from order_returns r join order_return_items i on i.return_id = r.id`);
  if (r.n !== 1 || r.q !== 2) throw new Error(JSON.stringify(r));
});
await step('customer page: licence, credit days, opening balance', async () => {
  await go(page, `/customer/${ids.ca}`); await need('Licence expired', 'DL-MLN-0457', '30 days');
  await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].find((e) => e.innerText.includes('What was owed before the app')).click());
  await sleep(900); await shot(page, 'v08a-dialog');
  await page.evaluate(() => { const i = [...document.querySelectorAll('input')].pop(); i.focus(); i.select(); });
  await page.keyboard.type('6000'); await shot(page, 'v08-opening-balance');
  await clickLabel(page, 'Save'); await sleep(1500);
  const r = await one(`select sum(debit - credit)::int b from ledger_entries where customer_id='${ids.ca}' and kind='opening'`);
  if (r.b !== 6000) throw new Error('opening ' + r.b);
});
await step('taking an order for an expired licence shows a warning', async () => {
  await go(page, `/catalog?customer=${ids.ca}&name=Al%20Shifa%20Medical%20Store`); await need('Drug licence expired', 'You can still take the order');
  await shot(page, 'v09-licence-warning');
});
await step('opening data: old bill', async () => {
  await go(page, `/opening/bill?customer=${ids.cc}&name=Rehman%20Medicos`);
  const inputs = await page.$$('input');
  await inputs[0].type('B-778');
  await inputs[1].evaluate((e) => { e.focus(); e.select(); }); await page.keyboard.press('Backspace'); await page.keyboard.type('01/10/2026');
  await inputs[2].type('8400'); await inputs[3].type('400'); await inputs[4].type('15/11/2026');
  await shot(page, 'v10-old-bill');
  await clickLabel(page, 'Save bill'); await sleep(1500);
  const r = await one(`select o.total::int t, o.is_opening, o.due_date::text d, (select debit::int from ledger_entries where ref_order_id=o.id) debit from orders o where order_no='B-778'`);
  if (!r || r.t !== 8400 || !r.is_opening || r.d !== '2026-11-15' || r.debit !== 8000) throw new Error(JSON.stringify(r));
});
await step('opening data: stock count', async () => {
  await go(page, '/opening/stock');
  const box = await page.$('input[aria-label="New stock for Surgical Cap"]'); await box.type('75');
  await shot(page, 'v11-stock-count');
  await clickLabel(page, 'Save 1 change'); await sleep(1500);
  const r = await one(`select stock_qty from products where name='Surgical Cap'`);
  if (r.stock_qty !== 75) throw new Error('stock ' + r.stock_qty);
});
await step('excel: template download', async () => {
  fs.rmSync('/tmp/dl', { recursive: true, force: true }); fs.mkdirSync('/tmp/dl');
  const cdp = await page.createCDPSession(); await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/dl' });
  await go(page, '/opening/import'); await shot(page, 'v12-import');
  await clickLabel(page, 'Download template'); await sleep(3000);
  const f = fs.readdirSync('/tmp/dl').find((x) => x.endsWith('.xlsx'));
  if (!f) throw new Error('no file downloaded');
  const sheets = await readXlsxFile('/tmp/dl/' + f);
  const names = sheets.map((s) => s.sheet).join(',');
  if (names !== 'Customers,Old bills,Stock,Help') throw new Error(names);
  const stock = sheets[2].data;
  if (stock.length < 10 || !stock.some((r) => r[1] === 'Gloves')) throw new Error('stock sheet not filled');
});
await step('excel: file with mistakes is rejected with row errors', async () => {
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), page.click('[aria-label="Choose Excel file"]')]);
  await chooser.accept(['/tmp/opening-bad.xlsx']); await sleep(2500);
  await shot(page, 'v13-import-errors', true);
  await need('Order taker "Nobody Here" not found', 'Customer "Unknown Store" not found', 'Stock must be a whole number');
  if (await page.$('[aria-label="Import now"]')) throw new Error('import offered despite errors');
});
await step('excel: good file imports', async () => {
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), page.click('[aria-label="Choose another file"]')]);
  await chooser.accept(['/tmp/opening-good.xlsx']); await sleep(2500);
  await need('Found 2 new customers, 2 old bills');
  await clickLabel(page, 'Import now'); await clickLabel(page, 'Import'); await sleep(2500);
  await shot(page, 'v14-imported', true);
  await need('Imported');
  const r = await one(`select c.type, c.credit_days, c.licence_expiry::text le, (select full_name from profiles where id=c.order_taker_id) taker,
     (select sum(debit-credit)::int from ledger_entries where customer_id=c.id) bal,
     (select count(*)::int from orders where customer_id=c.id and is_opening) bills,
     (select stock_qty from products where name='Gloves') gloves,
     (select count(*)::int from orders o join customers x on x.id=o.customer_id where x.name='Rehman Medicos' and o.is_opening and o.created_at::date = '2026-10-20') rb
     from customers c where c.name='Madina Dawakhana'`);
  if (!r || r.type !== 'dawakhana' || r.credit_days !== 20 || r.le !== '2026-01-09' || r.taker !== 'Bilal Ahmed' || r.bal !== 11000 || r.bills !== 1 || r.gloves !== 150 || r.rb !== 1) throw new Error(JSON.stringify(r));
});
await step('staff logins: add a stock keeper', async () => {
  await go(page, '/users'); await need('Stock keepers', 'Kashif Store');
  await clickLabel(page, 'Add stock keeper');
  const inputs = await page.$$('input');
  await inputs[0].type('Naveed'); await inputs[1].type('03077777777'); await inputs[2].type('naveed123');
  await clickLabel(page, 'Create login'); await sleep(1500);
  const r = await one(`select role from profiles where phone='03077777777'`);
  if (r?.role !== 'stock_keeper') throw new Error(JSON.stringify(r));
});
allErrors.push(...errors); await browser.close();

// ================= stock keeper =================
({ browser, page, errors } = await open());
await login(page, '03044444444', 'keeper123');
await step('stock keeper home is the loading sheet', async () => { await shot(page, 'v20-keeper-home', true); await need('Take out in total', 'Print all bills'); });
await step('stock keeper delivers an order, sees no balances', async () => {
  await go(page, `/order/${ids.o4}`);
  if (await hasText('Balance')) throw new Error('balance visible to stock keeper');
  await clickLabel(page, 'Mark as delivered');
  const btns = await page.$$('[aria-label="Mark as delivered"]'); await btns[btns.length - 1].click(); await sleep(1500);
  await shot(page, 'v21-keeper-delivered', true);
  const r = await one(`select status, due_date - app.today() d from orders where id='${ids.o4}'`);
  if (r.status !== 'delivered' || r.d !== 15) throw new Error(JSON.stringify(r));
});
await step('stock keeper cannot open customers or payments', async () => {
  await go(page, '/payments'); await shot(page, 'v22-keeper-payments');
  if (await hasText('PAY-1001')) throw new Error('payments visible');
});
allErrors.push(...errors); await browser.close();

console.log(steps.join('\n'));
const real = [...new Set(allErrors)].filter((e) => !/status of 40[03]/.test(e));
console.log(real.length ? 'BROWSER ERRORS:\n' + real.join('\n') : 'no unexpected browser errors');
await db.end();
