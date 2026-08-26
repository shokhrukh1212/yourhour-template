/**
 * End-to-end check of the Meta Pixel events, run against a local dev server:
 *   npm run dev   then   node scripts/check-meta-pixel.mjs
 *
 * It stubs `fbq` before the page loads and blocks every request to Meta, so it
 * asserts what the tag *would* send without recording anything in Events Manager.
 * Checkout and payment-status responses are faked at the network layer -- no real
 * checkout is created and nothing is written to the database.
 *
 * Use localhost (not 127.0.0.1): `next dev` blocks its own chunks cross-origin,
 * which leaves the page unhydrated and every event silently missing.
 */
import { chromium } from 'playwright';

const BASE = process.env.PIXEL_CHECK_BASE_URL ?? 'http://localhost:3000';
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN });
const ctx = await b.newContext();
// Never let a test hit Meta for real.
await ctx.route('**://connect.facebook.net/**', (r) => r.abort());
await ctx.route('**://www.facebook.com/tr**', (r) => r.abort());
await ctx.addInitScript(() => {
  const read = () => { try { return JSON.parse(sessionStorage.getItem('__fbq') || '[]'); } catch { return []; } };
  window.__read = read;
  window.fbq = (...args) => {
    const all = read(); all.push(args);
    try { sessionStorage.setItem('__fbq', JSON.stringify(all)); } catch {}
  };
});
const p = await ctx.newPage();
const dump = (page) => page.evaluate(() => window.__read().map((a) => JSON.stringify(a)));
const calls = () => dump(p);
const fail = [];
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + String(extra) : ''}`);
  if (!cond) fail.push(label);
};

// 1. Homepage: init + PageView + ViewContent
await p.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(500);
let c = await calls();
check('init fires once', c.filter((x) => x.includes('"init"')).length === 1, c.find((x) => x.includes('"init"')));
check('PageView on load', c.filter((x) => x.includes('"PageView"')).length === 1);
const vc = c.find((x) => x.includes('ViewContent'));
check('ViewContent once on homepage', c.filter((x) => x.includes('ViewContent')).length === 1, vc);

// 2. Client-side route change -> exactly one more PageView
const link = await p.$('a[href="/rules"], a[href="/about"]');
if (link) {
  await link.click();
  await p.waitForTimeout(1200);
  c = await calls();
  check('PageView on client-side route change', c.filter((x) => x.includes('"PageView"')).length === 2);
  await p.goBack();
  await p.waitForTimeout(800);
} else {
  console.log('SKIP  no in-page link found for route-change test');
}

// 3. InitiateCheckout only when a checkout session comes back
const p2 = await ctx.newPage();
await p2.addInitScript(() => { try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded','1'); sessionStorage.removeItem('__fbq'); } } catch {} });
await p2.route('**/api/preview', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ url: 'https://example.com/', owned: false, existing: null }) }));
await p2.route('**/api/checkout', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ checkoutUrl: '/rules', intentId: '11111111-1111-4111-8111-111111111111', amountDueCents: 900 }) }));
await p2.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 });
await p2.fill('#product-url', 'example.com');
await p2.click('.claim-panel button[type="submit"]');
// The handler ends in location.assign(checkoutUrl); waiting for that navigation is what
// tells us the whole submit path ran, and is far steadier than a fixed sleep.
await p2.waitForURL('**/rules', { timeout: 15000 }).catch(() => {});
await p2.waitForTimeout(500);
const c2 = await dump(p2);
const ic = c2.find((x) => x.includes('InitiateCheckout'));
check('InitiateCheckout once after checkout session created', c2.filter((x) => x.includes('InitiateCheckout')).length === 1, ic);

// 3b. failed checkout must NOT fire InitiateCheckout
const p3 = await ctx.newPage();
await p3.addInitScript(() => { try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded','1'); sessionStorage.removeItem('__fbq'); } } catch {} });
await p3.route('**/api/preview', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ url: 'https://example.com/', owned: false, existing: null }) }));
await p3.route('**/api/checkout', (r) => r.fulfill({ status: 409, contentType: 'application/json',
  body: JSON.stringify({ error: 'That bid no longer beats the product you selected.' }) }));
await p3.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 });
await p3.fill('#product-url', 'example.com');
await p3.click('.claim-panel button[type="submit"]');
// No navigation to wait for here: the checkout was rejected, so give the handler time
// to finish and prove nothing was reported.
await p3.waitForSelector('.form-error', { timeout: 15000 }).catch(() => {});
await p3.waitForTimeout(500);
const c3 = await dump(p3);
check('no InitiateCheckout when checkout fails', !c3.some((x) => x.includes('InitiateCheckout')));

// 4. Purchase only when backend says ready, and never twice
const intent = '22222222-2222-4222-8222-222222222222';
const p4 = await ctx.newPage();
await p4.addInitScript(() => { try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded','1'); sessionStorage.removeItem('__fbq'); } } catch {} });
let ready = false;
await p4.route('**/api/checkout/status**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify(ready
    ? { ready: true, status: 'completed', productName: 'Example', rank: 1, orderId: 'order-abc-1', amountPaidCents: 900 }
    : { ready: false, status: 'pending' }) }));
await p4.goto(`${BASE}/?purchase=${intent}`, { waitUntil: 'networkidle', timeout: 60000 });
await p4.waitForTimeout(1200);
let c4 = await dump(p4);
check('no Purchase while payment is pending', !c4.some((x) => x.includes('Purchase')));
ready = true;
await p4.waitForTimeout(3500);
c4 = await dump(p4);
const pur = c4.find((x) => x.includes('Purchase'));
check('Purchase once after backend confirms', c4.filter((x) => x.includes('Purchase')).length === 1, pur);
check('Purchase value is the amount actually paid', Boolean(pur && pur.includes('"value":9') && pur.includes('USD')));
check('Purchase carries eventID for CAPI dedupe', Boolean(pur && pur.includes('order-abc-1')));
check('Purchase sends no catalog parameters',
  Boolean(pur && !['contents', 'content_ids', 'content_type', 'num_items', 'quantity'].some((k) => pur.includes(k))), pur);
check('no submitted product URL is sent to Meta',
  !(await dump(p4)).concat(await dump(p2)).some((x) => x.includes('example.com') || x.includes('whoisnext')));

// refresh the same confirmation URL
const p5 = await ctx.newPage();
await p5.addInitScript(() => { try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded','1'); sessionStorage.removeItem('__fbq'); } } catch {} });
await p5.route('**/api/checkout/status**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ ready: true, status: 'completed', productName: 'Example', rank: 1, orderId: 'order-abc-1', amountPaidCents: 900 }) }));
await p5.goto(`${BASE}/?purchase=${intent}`, { waitUntil: 'networkidle', timeout: 60000 });
await p5.waitForTimeout(2000);
const c5 = await dump(p5);
check('refresh does not recount Purchase', !c5.some((x) => x.includes('Purchase')));

await b.close();
console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(' | ')}` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
