// LOCAL TESTING ONLY: booker adds customers, admin route plan, shop location, visits
import { open, login, go, shot, clickLabel, sleep, BASE } from './shots.mjs';
import pg from 'pg';
const db = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'scorpion_e2e' });
await db.connect();
const one = async (q) => (await db.query(q)).rows[0];
const ids = await one(`select (select id from profiles where phone='03011111111') taker, (select id from customers where name='Al Shifa Medical Store') ca`);
const steps = [];
let page, errors, browser;
const allErrors = [];
const step = async (name, fn) => { try { await fn(); steps.push('ok   ' + name); } catch (e) { steps.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); await shot(page, 'FAIL-' + name.replace(/\W+/g, '-')).catch(() => {}); } };
const hasText = (t) => page.evaluate((x) => document.body.innerText.includes(x), t);
const need = async (...ts) => { for (const t of ts) if (!(await hasText(t))) throw new Error('missing text: ' + t); };

// ---------- order taker adds a customer ----------
({ browser, page, errors } = await open());
await browser.defaultBrowserContext().overridePermissions(BASE, ['geolocation']);
await page.setGeolocation({ latitude: 30.21001, longitude: 71.47002, accuracy: 12 });
await login(page, '03011111111', 'taker123');
await step('taker home: no route plan yet', async () => { await need("Today's route", 'No route plan yet'); await shot(page, 'r01-taker-home'); });
await step('taker adds a customer with shop location', async () => {
  await go(page, '/customer/form');
  if (await hasText('Default discount')) throw new Error('discount field shown to booker');
  if (await hasText('App login')) throw new Error('login section shown to booker');
  const inputs = await page.$$('input');
  await inputs[0].type('Madni Medical'); await inputs[2].type('0300-5556667'); await inputs[3].type('Bosan Road');
  await clickLabel(page, 'I am at the shop: save location'); await sleep(1500);
  await need('Saved: 30.21001');
  await shot(page, 'r02-taker-add-customer', true);
  await clickLabel(page, 'Add customer'); await sleep(2000);
  const r = await one(`select order_taker_id::text t, default_discount_pct::int d, round(lat::numeric, 5)::text lat from customers where name='Madni Medical'`);
  if (!r || r.t !== ids.taker || r.d !== 0 || r.lat !== '30.21001') throw new Error(JSON.stringify(r));
  await need('Shop location', 'Saved');
  await shot(page, 'r03-taker-new-customer', true);
});
allErrors.push(...errors); await browser.close();

// ---------- admin makes the plan ----------
({ browser, page, errors } = await open());
await browser.defaultBrowserContext().overridePermissions(BASE, ['geolocation']);
await page.setGeolocation({ latitude: 30.15752, longitude: 71.44402, accuracy: 10 });
await login(page, '03007334811', 'admin123');
await step('admin: new-customer notification', async () => { await go(page, '/notifications'); await need('New customer: Madni Medical'); });
await step('admin: route plan settings', async () => {
  await go(page, `/user/form?id=${ids.taker}`); await clickLabel(page, 'Route plan'); await sleep(800);
  await need('No plan yet', 'Plan settings', 'Day 30');
  await clickLabel(page, 'Save plan settings'); await sleep(1500);
  await need('Today is Day 1');
  await shot(page, 'r04-route-plan', true);
});
await step('admin: set Day 1 customers', async () => {
  await go(page, `/route-day?user=${ids.taker}&day=1`, 1800);
  await page.type('input[placeholder^="e.g. Nishtar"]', 'Nishtar Road');
  await clickLabel(page, 'Add customers'); await sleep(800);
  for (const n of ['Al Shifa Medical Store', 'Madni Medical']) {
    await page.evaluate((x) => { [...document.querySelectorAll('[role="button"]')].find((e) => e.innerText.split('\n')[0] === x).click(); }, n);
    await sleep(300);
  }
  await shot(page, 'r05-add-customers');
  await clickLabel(page, 'Done'); await sleep(500);
  await shot(page, 'r06-route-day', true);
  await clickLabel(page, 'Save Day 1'); await sleep(1500);
  const r = await one(`select count(*)::int n, (select label from route_days where day_no=1) l from route_stops where day_no=1`);
  if (r.n !== 2 || r.l !== 'Nishtar Road') throw new Error(JSON.stringify(r));
});
await step('admin saves Al Shifa shop location', async () => {
  await go(page, `/customer/${ids.ca}`);
  await clickLabel(page, 'I am at the shop: save location'); await clickLabel(page, 'Save location'); await sleep(1500);
  const r = await one(`select round(lat::numeric, 5)::text lat from customers where id='${ids.ca}'`);
  if (r.lat !== '30.15752') throw new Error(JSON.stringify(r));
  await need('Open in Google Maps', 'On the route plan: Day 1');
  await shot(page, 'r07-customer-location', true);
});
allErrors.push(...errors); await browser.close();

// a location point at Al Shifa for the booker today
await db.query(`insert into location_points(user_id, lat, lng, accuracy, recorded_at) values ('${ids.taker}', 30.15770, 71.44420, 15, now() - interval '5 minutes')`);

// ---------- booker sees the route with the visit ----------
({ browser, page, errors } = await open());
await login(page, '03011111111', 'taker123');
await step('taker home shows today\'s route with visit', async () => {
  await sleep(800);
  await need('Day 1: Nishtar Road', 'Al Shifa Medical Store', 'Madni Medical', 'Visited', 'Not yet');
  await shot(page, 'r08-taker-route', true);
});
await step('taker: my route plan', async () => { await go(page, '/route-plan'); await need('Today is Day 1', 'Day 1: Nishtar Road'); if (await hasText('Plan settings')) throw new Error('booker sees settings'); await shot(page, 'r09-taker-plan'); });
allErrors.push(...errors); await browser.close();

// ---------- admin sees visits on the map ----------
({ browser, page, errors } = await open({ width: 1200, height: 900 }));
await login(page, '03007334811', 'admin123');
await step('admin: route and visits for the day', async () => {
  await go(page, `/team-route?id=${ids.taker}`, 2500);
  await need('Route plan for this day', 'Visited', 'Not yet');
  await shot(page, 'r10-admin-route', true);
});
allErrors.push(...errors); await browser.close();

console.log(steps.join('\n'));
const real = [...new Set(allErrors)].filter((e) => !/status of 40[03]|^400 /.test(e));
console.log(real.length ? 'BROWSER ERRORS:\n' + real.join('\n') : 'no unexpected browser errors');
await db.end();
