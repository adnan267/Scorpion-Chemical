import { open, login, go, shot, clickLabel, sleep, BASE } from './shots.mjs';
import pg from 'pg';
const db = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'scorpion_e2e' });
await db.connect();
const one = async (q) => (await db.query(q)).rows[0];
const ca = (await one(`select id from customers where name='Al Shifa Medical Store'`)).id;
const steps = [];
let page, errors, browser;
const step = async (name, fn) => { try { await fn(); steps.push('ok   ' + name); } catch (e) { steps.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); await shot(page, 'FAIL-' + name.replace(/\W+/g, '-')).catch(() => {}); } };
const hasText = (t) => page.evaluate((x) => document.body.innerText.includes(x), t);
const clickText = async (t) => {
  const ok = await page.evaluate((x) => {
    const els = [...document.querySelectorAll('div[tabindex="0"], [role="button"], [role="link"]')].filter((e) => e.innerText && e.innerText.includes(x));
    const el = els.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!el) return false; el.click(); return true;
  }, t);
  if (!ok) throw new Error('no clickable element with text ' + t);
  await sleep(1100);
};
const allErrors = [];

// ============ order taker ============
({ browser, page, errors } = await open());
await login(page, '03011111111', 'taker123');
await step('taker home', async () => { await shot(page, '80-taker-home'); if (!(await hasText('Cash in your hand'))) throw new Error('taker dashboard missing'); });
await step('taker: pick customer for order', async () => { await clickLabel(page, 'Take an order'); await shot(page, '81-taker-pick'); await clickText('Al Shifa Medical Store'); });
await step('taker: catalog for customer shows stock + discount', async () => {
  await sleep(600); await shot(page, '82-taker-catalog');
  if (!(await hasText('For Al Shifa Medical Store'))) throw new Error('not ordering for customer');
  if (!(await hasText('in stock'))) throw new Error('stock not shown to order taker');
  if (!(await hasText('10% off'))) throw new Error('customer discount not shown');
});
await step('taker: add two products and place order', async () => {
  const adds = await page.$$('[aria-label="Add"]'); await adds[0].click(); await sleep(300);
  const adds2 = await page.$$('[aria-label="Add"]'); await adds2[2].click(); await sleep(300);
  await clickText('Review order'); await shot(page, '83-taker-cart');
  await clickLabel(page, 'Place order'); await sleep(1800); await shot(page, '84-taker-order-placed');
  if (!(await hasText('Pending'))) throw new Error('order page not shown');
});
await step('taker: cash payment without receipt', async () => {
  await go(page, `/payment/new?customer=${ca}&name=Al%20Shifa%20Medical%20Store`);
  await page.type('input[placeholder="0"]', '500'); await shot(page, '85-taker-payment-form');
  await clickLabel(page, 'Send for approval'); await sleep(1800);
  if (!(await hasText('Awaiting approval'))) throw new Error('payment not created');
});
await step('taker: cannot open admin pages', async () => { await go(page, '/users'); if (!(await hasText('You are not allowed to do this'))) throw new Error('admin page not blocked'); });
await step('taker: sees only assigned customers', async () => { await go(page, '/customers'); if (await hasText('Rehman Medicos')) throw new Error('unassigned customer visible'); if (!(await hasText('City Pharmacy'))) throw new Error('assigned customer missing'); await shot(page, '86-taker-customers'); });
await step('taker: cash in hand', async () => { await go(page, '/cash'); await shot(page, '87-taker-cash'); if (!(await hasText('4,000'))) throw new Error('cash in hand should be 2000+1500+500'); });
allErrors.push(...errors); await browser.close();

// ============ medical store ============
({ browser, page, errors } = await open());
await login(page, '03033333333', 'store123');
await step('store home', async () => { await shot(page, '90-store-home'); if (!(await hasText('You have to pay'))) throw new Error('balance card missing'); });
await step('store: catalog hides stock numbers, shows own price', async () => {
  await go(page, '/catalog'); await shot(page, '91-store-catalog');
  if (await hasText('500 in stock')) throw new Error('stock numbers visible to customer');
  if (!(await hasText('10% off'))) throw new Error('own discount missing');
  if (await hasText('White Phenyl')) throw new Error('hidden product visible');
});
await step('store: order via cart', async () => {
  const adds = await page.$$('[aria-label="Add"]'); await adds[9].click(); await sleep(300);
  await page.click('input[aria-label="Quantity"]'); await sleep(250); await page.keyboard.type('24', { delay: 60 }); await sleep(300);
  await clickText('Review order'); await shot(page, '92-store-cart');
  await clickLabel(page, 'Place order'); await sleep(1800);
  if (!(await hasText('Pending'))) throw new Error('order page not shown');
});
await step('store: payment needs a receipt', async () => {
  await go(page, '/payment/new'); await page.type('input[placeholder="0"]', '2500');
  await clickLabel(page, 'Send for approval'); await sleep(600);
  if (!(await hasText('Attach a photo of the receipt'))) throw new Error('receipt rule not enforced');
});
await step('store: attach receipt photo and send payment', async () => {
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), page.click('[aria-label="Choose photo"]')]);
  const ua = (await one(`select id from profiles where role='store'`)).id;
  await chooser.accept([`/tmp/scorpion-storage/payment-proofs/${ua}/receipt1.jpg`]); await sleep(1500);
  await shot(page, '93-store-payment-with-photo');
  await clickLabel(page, 'Send for approval'); await sleep(2500); await shot(page, '94-store-payment-sent');
  if (!(await hasText('Awaiting approval'))) throw new Error('payment not sent');
});
await step('store: statement', async () => { await go(page, '/ledger'); await shot(page, '95-store-ledger'); if (!(await hasText('Opening balance'))) throw new Error('ledger entries missing'); });
await step('store: notifications', async () => { await go(page, '/notifications'); await shot(page, '96-store-notifications'); if (!(await hasText('Payment due in 2 days'))) throw new Error('due reminder missing'); });
await step('store: cannot see another customer', async () => {
  const cb = (await one(`select id from customers where name='City Pharmacy'`)).id;
  await go(page, `/customer/${cb}`); if (!(await hasText('You do not have access'))) throw new Error('other customer not blocked');
  const o4 = (await one(`select id from orders where order_no='ORD-1004'`)).id;
  await go(page, `/order/${o4}`); if (!(await hasText('You do not have access'))) throw new Error('other order not blocked');
});
await step('store: change password, sign out, sign in again', async () => {
  await go(page, '/password');
  const pw = await page.$$('input[type="password"]'); await pw[0].type('newpass99'); await pw[1].type('newpass99');
  await clickLabel(page, 'Change password'); await sleep(1500);
  await go(page, '/more'); await shot(page, '97-store-more');
  await clickText('Sign out'); await clickLabel(page, 'Sign out'); await sleep(1500);
  if (!(await page.$('input[type="password"]'))) throw new Error('not signed out');
  await page.type('input[placeholder="03001234567"]', '0303-3333333'); await page.type('input[type="password"]', 'store123');
  await page.click('[aria-label="Sign in"]'); await sleep(1500);
  if (!(await hasText('Wrong mobile number or password'))) throw new Error('old password still works');
  await page.click('input[type="password"]', { clickCount: 3 }); await page.keyboard.press('Backspace');
  await page.$eval('input[type="password"]', (e) => e.value) ;
  await page.evaluate(() => { const e = document.querySelector('input[type="password"]'); e.focus(); e.select(); });
  await page.keyboard.type('newpass99'); await page.click('[aria-label="Sign in"]'); await sleep(2500);
  if (!(await hasText('You have to pay'))) throw new Error('new password did not work');
});
allErrors.push(...errors); await browser.close();

// ============ distributor ============
({ browser, page, errors } = await open());
await login(page, '03055555555', 'dist123');
await step('distributor home + own price', async () => {
  await shot(page, '98-dist-home');
  await go(page, '/catalog'); await shot(page, '99-dist-catalog');
  if (!(await hasText('15% off'))) throw new Error('distributor discount missing');
});
allErrors.push(...errors); await browser.close();

console.log(steps.join('\n'));
const real = [...new Set(allErrors)].filter((e) => !/status of 40[03]/.test(e));
console.log(real.length ? 'BROWSER ERRORS:\n' + real.join('\n') : 'no unexpected browser errors');
const chk = await one(`select (select count(*) from orders) orders, (select count(*) from payments) payments,
  (select count(*) from payments where proof_path is not null and created_at > now() - interval '5 minutes' and amount = 2500) new_proof,
  (select string_agg(qty::text, ',') from order_items i join orders o on o.id = i.order_id where o.order_no = 'ORD-1007') store_qty`);
console.log('db check:', JSON.stringify(chk));
await db.end();
