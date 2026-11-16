// LOCAL TESTING ONLY: colours, bonus scheme, lot no. on invoice, licence photo, cities
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
const ids = await one(`select (select id from products where name='Face Mask (Adult)') fm, (select id from products where name='Blue Guard Face Mask (Adult)') bg, (select id from customers where name='Al Shifa Medical Store') ca`);
await db.query(`update stock_entries set batch_no = 'LOT-BG-11' where product_id = '${ids.bg}' and kind = 'in'`);

({ browser, page, errors } = await open());
await login(page, '03007334811', 'admin123');
await step('admin adds colours to Face Mask (Adult)', async () => {
  await go(page, `/product/form?id=${ids.fm}`, 1800);
  await page.type('input[placeholder="Black, Blue, Green, White"]', 'Black, Blue, Green, White');
  await clickLabel(page, 'Add colours'); await sleep(1500);
  await shot(page, 'c1-product-colours', true);
  const r = await one(`select string_agg(colour || ':' || stock_qty, ',' order by colour) s from products where group_id = '${ids.fm}'`);
  if (r.s !== 'Black:500,Blue:0,Green:0,White:0') throw new Error(r.s);
  await db.query(`update products set stock_qty = 120 where group_id = '${ids.fm}' and colour = 'Blue'`);
});
await step('admin sets a 100+2 scheme on Blue Guard mask', async () => {
  await go(page, `/product/form?id=${ids.bg}`, 1800);
  await page.type('input[placeholder="2"]', '2'); await page.type('input[placeholder="100"]', '100');
  await need('Scheme 100+2');
  await clickLabel(page, 'Save changes'); await sleep(1500);
  const r = await one(`select bonus_per, bonus_free from products where id = '${ids.bg}'`);
  if (r.bonus_per !== 100 || r.bonus_free !== 2) throw new Error(JSON.stringify(r));
});
await step('ordering shows colours and free pieces', async () => {
  await go(page, `/catalog?customer=${ids.ca}&name=Al%20Shifa`, 1800);
  await need('Black', 'Blue', 'Green', 'White', 'Scheme 100+2');
  // add Blue face mask: the Add button in the Blue row
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('div')].find((d) => d.innerText && d.innerText.startsWith('Blue\n') && d.querySelector('[aria-label="Add"]'));
    row.querySelector('[aria-label="Add"]').click();
  }); await sleep(400);
  const qtyInputs = await page.$$('input[aria-label="Quantity"]');
  await qtyInputs[0].evaluate((e) => { e.focus(); e.select(); }); await page.keyboard.type('10'); await sleep(300);
  // Blue Guard: first product card's Add
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('div')].find((d) => d.innerText && d.innerText.startsWith('Blue Guard Face Mask (Adult)') && d.querySelector('[aria-label="Add"]'));
    card.querySelector('[aria-label="Add"]').click();
  }); await sleep(400);
  const q2 = await page.$$('input[aria-label="Quantity"]');
  await q2[0].evaluate((e) => { e.focus(); e.select(); }); await page.keyboard.type('150'); await sleep(500);
  await need('+ 2 free');
  await shot(page, 'c2-catalog-colours', true);
  await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].find((e) => e.innerText.includes('Review order')).click()); await sleep(1500);
  await need('(Blue)', 'scheme 100+2');
  await shot(page, 'c3-cart', true);
  await clickLabel(page, 'Place order'); await sleep(2000);
  const r = await one(`select string_agg(product_name || '=' || qty || '+' || bonus_qty || ':' || coalesce(lot_no, '-'), ' | ' order by product_name) s from order_items where order_id = (select id from orders order by created_at desc limit 1)`);
  if (r.s !== 'Blue Guard Face Mask (Adult) Box of 50=150+2:LOT-BG-11 | Face Mask (Adult) Pouch of 10 (Blue)=10+0:-') throw new Error(r.s);
});
await step('invoice: lot no., free pieces, warranty at the bottom', async () => {
  await clickLabel(page, 'Invoice'); await sleep(2000);
  const html = await page.$eval('iframe', (f) => f.srcdoc);
  for (const t of ['Lot no.', 'LOT-BG-11', '+ 2 free', 'class="bottom"', '(Blue)']) if (!html.includes(t)) throw new Error('invoice missing ' + t);
  const p2 = await browser.newPage(); await p2.setViewport({ width: 794, height: 1123 }); await p2.setContent(html); await sleep(500);
  await p2.emulateMediaType('print');
  await p2.screenshot({ path: '/tmp/shots/c4-invoice.png', fullPage: true }); await p2.close();
});
await step('customer scheme on discounts page', async () => {
  await go(page, `/customer/discounts?id=${ids.ca}`, 1800);
  await page.type('input[aria-label="Scheme for Gloves Pair"]', '50+1').catch(async () => { const el = await page.$('input[aria-label^="Scheme for Gloves"]'); await el.type('50+1'); });
  await clickLabel(page, 'Save discounts'); await sleep(1500);
  const r = await one(`select bonus_per, bonus_free from customer_schemes where customer_id = '${ids.ca}'`);
  if (!r || r.bonus_per !== 50 || r.bonus_free !== 1) throw new Error(JSON.stringify(r));
});
await step('licence photo on the customer', async () => {
  await go(page, `/customer/form?id=${ids.ca}`, 1800);
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), page.click('[aria-label="Choose photo"]')]);
  const ua = (await one(`select id from profiles where role='store'`)).id;
  await chooser.accept([`/tmp/scorpion-storage/payment-proofs/${ua}/receipt1.jpg`]); await sleep(1200);
  await clickLabel(page, 'Save changes'); await sleep(2500);
  const r = await one(`select licence_photo from customers where id = '${ids.ca}'`);
  if (!r.licence_photo || !r.licence_photo.startsWith(ids.ca + '/')) throw new Error(JSON.stringify(r));
  await go(page, `/customer/${ids.ca}`); await need('View photo');
  await shot(page, 'c5-customer-licence', true);
});
allErrors.push(...errors); await browser.close();

({ browser, page, errors } = await open());
await login(page, '03011111111', 'taker123');
await step('booker: customers by city', async () => {
  await go(page, '/cities', 1800);
  await need('My cities', 'Multan', 'to receive');
  await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].find((e) => e.innerText.startsWith('Multan')).click()); await sleep(600);
  await need('Al Shifa Medical Store', 'City Pharmacy');
  await shot(page, 'c6-cities', true);
});
allErrors.push(...errors); await browser.close();
console.log(steps.join('\n'));
const real = [...new Set(allErrors)].filter((e) => !/status of 40[03]|^400 |tile|NAME_NOT_RESOLVED/.test(e));
console.log(real.length ? 'BROWSER ERRORS:\n' + real.join('\n') : 'no unexpected browser errors');
await db.end();
