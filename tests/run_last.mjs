import { open, login, go, shot, clickLabel, sleep, BASE } from './shots.mjs';
import pg from 'pg';
import fs from 'node:fs';
const db = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'scorpion_e2e' });
await db.connect();
const one = async (q) => (await db.query(q)).rows[0];
const steps = [];
const { browser, page, errors } = await open();
const step = async (name, fn) => { try { await fn(); steps.push('ok   ' + name); } catch (e) { steps.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); await shot(page, 'FAIL-' + name.replace(/\W+/g, '-')).catch(() => {}); } };
const hasText = (t) => page.evaluate((x) => document.body.innerText.includes(x), t);

if (process.argv[2] === 'setup') {
  await step('first-time setup creates the admin and signs in', async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    await page.evaluate(() => { [...document.querySelectorAll('div[tabindex="0"]')].find((e) => e.innerText === 'First-time setup').click(); });
    await sleep(500);
    const inputs = await page.$$('input');
    await inputs[0].type('WRONG'); await inputs[1].type('Muhammad Adnan'); await inputs[2].type('0300-7334811'); await inputs[3].type('secret123');
    await clickLabel(page, 'Create admin account'); await sleep(1500);
    if (!(await hasText('setup code is wrong'))) throw new Error('wrong code accepted');
    await inputs[0].click({ clickCount: 3 }); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type('SC-SETUP-1');
    await shot(page, 'b0-setup');
    await clickLabel(page, 'Create admin account'); await sleep(3000);
    if (!(await hasText('Orders today'))) throw new Error('admin home not shown');
    const r = await one(`select (select count(*) from profiles where role = 'admin' and phone = '03007334811') admins, (select count(*) from app_settings where key = 'setup_code') code`);
    if (Number(r.admins) !== 1 || Number(r.code) !== 0) throw new Error(JSON.stringify(r));
  });
} else {
  await login(page, '03007334811', 'admin123');
  await step('add a product with a photo', async () => {
    await go(page, '/product/form');
    const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), page.click('[aria-label="Choose photo"]')]);
    await chooser.accept(['/home/claude/scorpion/seed/product-images/seed/white-phenyl-3l.jpg']); await sleep(1200);
    const inputs = await page.$$('input');
    await inputs[0].type('Blue Guard Hand Wash'); await inputs[1].type('500ml'); await inputs[2].type('Cleaners');
    await inputs[3].type('180'); await inputs[4].type('260'); await inputs[5].type('24 pc per carton'); await inputs[6].type('120');
    await shot(page, 'b1-product-form-filled');
    await clickLabel(page, 'Add product'); await sleep(2500);
    await shot(page, 'b2-product-added');
    const r = await one(`select net_rate, retail_price, stock_qty, image_path from products where name = 'Blue Guard Hand Wash'`);
    if (!r || Number(r.net_rate) !== 180 || Number(r.stock_qty) !== 120 || !r.image_path) throw new Error('saved ' + JSON.stringify(r));
    if (!fs.existsSync('/tmp/scorpion-storage/product-images/' + r.image_path)) throw new Error('photo file not stored');
    if (!(await hasText('120'))) throw new Error('stock page not shown');
  });
  await step('hidden product: set rate and show to customers', async () => {
    const id = (await one(`select id from products where pack_size = '3 litre'`)).id;
    await go(page, `/product/form?id=${id}`);
    const inputs = await page.$$('input');
    await inputs[3].click(); await sleep(200); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type('450');
    await page.click('[role="switch"]'); await sleep(200);
    await clickLabel(page, 'Save changes'); await sleep(1800);
    const r = await one(`select net_rate, is_active from products where id = '${id}'`);
    if (Number(r.net_rate) !== 450 || !r.is_active) throw new Error('saved ' + JSON.stringify(r));
  });
}
console.log(steps.join('\n'));
const real = [...new Set(errors)].filter((e) => !/status of 40[03]|logout/.test(e));
console.log(real.length ? 'BROWSER ERRORS:\n' + real.join('\n') : 'no unexpected browser errors');
await db.end(); await browser.close();
