import pkg from '/Users/karl/pupmanager/node_modules/playwright/index.js';
const { chromium } = pkg;

const OUT = '/Users/karl/Desktop/PupManager Store Assets/ipad';
const EMAIL = 'demo@pupmanager.com';
const PASSWORD = 'DemoPup2026!';

const browser = await chromium.launch({ headless: true });
// iPad 12.9": logical 1024x1366 @ DSF 2 = 2048x2732 (App Store requirement).
const ctx = await browser.newContext({
  viewport: { width: 1024, height: 1366 },
  deviceScaleFactor: 2,
  isMobile: false,   // iPad reports non-mobile; gives the tablet/desktop layout
  hasTouch: true,
});
const page = await ctx.newPage();

await page.goto('https://app.pupmanager.com/login', { waitUntil: 'networkidle' });
await page.getByRole('textbox', { name: 'Email address' }).fill(EMAIL);
await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL('**/dashboard', { timeout: 30000 });
await page.waitForTimeout(2500);

async function shot(name, path) {
  await page.goto(`https://app.pupmanager.com${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file });   // viewport-sized = 2048x2732
  console.log('captured', name, '->', file);
}

await shot('01-dashboard', '/dashboard');
await shot('02-clients', '/clients');
await shot('03-schedule', '/schedule');
await shot('04-packages', '/packages');

// client detail — first client from the list (may be sparse per submission notes)
await page.goto('https://app.pupmanager.com/clients', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const href = await page.evaluate(() => {
  const a = document.querySelector('a[href*="/clients/"]');
  return a ? a.getAttribute('href') : null;
});
if (href) await shot('05-client-detail', href);
else console.log('no client link found for detail shot');

await browser.close();
console.log('done');
