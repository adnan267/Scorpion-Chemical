import { open, login, go, shot, clickLabel, sleep } from './shots.mjs';
import pg from 'pg';
const db = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'scorpion_e2e' });
await db.connect();
const taker = (await db.query(`select id from profiles where phone='03011111111'`)).rows[0].id;
const steps = [];
let { browser, page, errors } = await open();
const step = async (name, fn) => { try { await fn(); steps.push('ok   ' + name); } catch (e) { steps.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); await shot(page, 'FAIL-' + name.replace(/\W+/g, '-')).catch(() => {}); } };
const hasText = (t) => page.evaluate((x) => document.body.innerText.includes(x), t);
const frameInfo = async () => {
  const f = page.frames().find((x) => x !== page.mainFrame());
  if (!f) return null;
  return f.evaluate(() => ({ pins: document.querySelectorAll('.pin').length, lines: document.querySelectorAll('path.leaflet-interactive').length, ends: document.querySelectorAll('.end').length, pinText: [...document.querySelectorAll('.pin')].map((p) => p.textContent) }));
};
await login(page, '03007334811', 'admin123');
await step('admin home shows live count', async () => { await sleep(800); if (!(await hasText('Order takers live'))) throw new Error('stat missing'); if (!(await hasText('1 of 2'))) throw new Error('expected 1 of 2 live'); });
await step('live map shows both order takers', async () => {
  await go(page, '/team-map', 2500);
  const f = await frameInfo();
  if (!f || f.pins !== 2) throw new Error('pins: ' + JSON.stringify(f));
  if (!(await hasText('Live')) || !(await hasText('Off duty'))) throw new Error('status tags missing');
  await shot(page, 'm1-team-map', true);
});
await step('marker tap focuses a taker', async () => {
  const f = page.frames().find((x) => x !== page.mainFrame());
  await f.evaluate(() => document.querySelector('.pin').click());
  await sleep(800);
  await shot(page, 'm2-team-map-focus');
});
await step("today's route draws a line", async () => {
  await go(page, `/team-route?id=${taker}`, 2500);
  const f = await frameInfo();
  if (!f || f.lines < 1 || f.ends !== 2) throw new Error('route: ' + JSON.stringify(f));
  if (!(await hasText('45'))) throw new Error('point count not shown');
  await shot(page, 'm3-route', true);
});
await step('previous day has no route', async () => {
  await clickLabel(page, 'Previous day'); await sleep(1200);
  if (!(await hasText('No location was recorded on this day.'))) throw new Error('expected empty day');
});
await step('desktop map', async () => { await page.setViewport({ width: 1280, height: 800 }); await go(page, '/team-map', 2500); await shot(page, 'm4-desktop-map'); });
await browser.close();
({ browser, page, errors } = await (async () => { const o = await open(); errors.push(...o.errors); return o; })());
await login(page, '03011111111', 'taker123');
await step('order taker sees duty card (web: start from Android app)', async () => {
  if (!(await hasText('On duty'))) throw new Error('duty card missing');
  await shot(page, 'm5-taker-home');
});
await step('order taker cannot open the live map', async () => { await go(page, '/team-map'); if (!(await hasText('You are not allowed to do this'))) throw new Error('not blocked'); });
console.log(steps.join('\n'));
const real = [...new Set(errors)].filter((e) => !/status of 40[03]|logout|tile\.openstreetmap|ERR_TUNNEL|net::/.test(e));
console.log(real.length ? 'BROWSER ERRORS:\n' + real.join('\n') : 'no unexpected browser errors');
await db.end(); await browser.close();
