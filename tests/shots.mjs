// LOCAL TESTING ONLY: opens the built web app in headless Chrome, signs in and takes screenshots.
import puppeteer from 'puppeteer-core';

const BASE = 'http://127.0.0.1:54400';
const OUT = '/tmp/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function open({ width = 412, height = 880 } = {}) {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 300)); });
  page.on('requestfailed', (r) => errors.push('REQFAILED ' + r.url().slice(0, 120)));
  return { browser, page, errors };
}

export async function login(page, phone, password) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[placeholder="03001234567"]');
  await page.type('input[placeholder="03001234567"]', phone);
  await page.type('input[type="password"]', password);
  await page.click('[aria-label="Sign in"]');
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 15000 });
  await sleep(1200);
}

export async function go(page, path, wait = 1300) {
  await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  await sleep(wait);
}

export async function shot(page, name, full = false) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
}

export async function clickLabel(page, label) {
  await page.waitForSelector(`[aria-label="${label}"]`, { timeout: 8000 });
  await page.click(`[aria-label="${label}"]`);
  await sleep(900);
}

export { sleep, BASE };
