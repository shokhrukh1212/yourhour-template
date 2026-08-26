import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const SP = process.argv[2];
const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000';
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN });

for (const scheme of ['light','dark']) {
  const ctx = await b.newContext({ viewport:{width:1280,height:900}, colorScheme: scheme, deviceScaleFactor:1 });
  const p = await ctx.newPage();
  await p.goto(`${BASE_URL}/`, { waitUntil:'networkidle', timeout:60000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path:`${SP}/home-${scheme}-fold.png` });
  await p.screenshot({ path:`${SP}/home-${scheme}-full.png`, fullPage:true });
  await ctx.close();
}

for (const [width,height] of [[320,568],[375,667],[390,844],[430,932]]) {
  const context = await b.newContext({
    viewport:{width,height},
    isMobile:true,
    hasTouch:true,
    deviceScaleFactor:2,
  });
  const page = await context.newPage();
  const conversionRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/preview' || url.pathname === '/api/checkout') {
      conversionRequests.push(url.pathname);
    }
  });
  await page.goto(`${BASE_URL}/`, { waitUntil:'networkidle', timeout:60000 });

  const initial = await page.evaluate(() => {
    const box = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? { width:rect.width, height:rect.height } : null;
    };
    return {
      overflow:document.documentElement.scrollWidth > document.documentElement.clientWidth,
      error:document.querySelector('.form-error')?.textContent ?? null,
      minusDisabled:document.querySelector('.stepper-btn')?.disabled ?? false,
      minusLabel:document.querySelector('.stepper-btn')?.getAttribute('aria-label') ?? '',
      minus:box('.stepper-btn'),
      visit:box('.visit-link'),
      take:box('.mobile-take-inline'),
      metrics:document.querySelector('.row-metrics')?.textContent ?? '',
      lineClamp:getComputedStyle(document.querySelector('.row-copy h3')).webkitLineClamp,
    };
  });
  assert.equal(initial.overflow, false, `${width}x${height} must not overflow horizontally`);
  assert.equal(initial.error, null, `${width}x${height} must not show an initial validation error`);
  assert.equal(initial.minusDisabled, true, `${width}x${height} minimum decrement must be disabled`);
  assert.match(initial.minusLabel, /Minimum bid reached/, `${width}x${height} needs an accessible minimum label`);
  assert.ok(initial.minus && initial.minus.width >= 44 && initial.minus.height >= 44, `${width}x${height} stepper must be at least 44px`);
  assert.ok(initial.take && initial.visit && initial.take.width > initial.visit.width, `${width}x${height} Take #1 must be wider than Visit`);
  assert.match(initial.metrics, /paid/, `${width}x${height} metrics must label paid value`);
  assert.match(initial.metrics, /clicks/, `${width}x${height} metrics must label clicks`);
  assert.equal(initial.lineClamp, '2', `${width}x${height} product names must allow two lines`);
  await page.screenshot({ path:`${SP}/home-mobile-${width}x${height}.png`, fullPage:true });

  await page.locator('.mobile-take-inline').click();
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'product-url');
  assert.deepEqual(conversionRequests, [], 'focusing the form must not begin conversion requests');
  await page.locator('.claim-button').click();
  assert.equal(await page.locator('.form-error').count(), 0, 'empty submission must not show an initial validation error');
  assert.deepEqual(conversionRequests, [], 'empty submission must not begin checkout');
  await page.locator('#product-url').fill('not a public URL');
  await page.locator('.claim-button').click();
  assert.equal(await page.locator('.form-error').count(), 1, 'invalid URL must show validation after submission');
  assert.deepEqual(conversionRequests, [], 'invalid URL must not begin checkout');
  await page.locator('#product-url').fill('');

  await page.locator('.row-copy h3 a').first().evaluate((element) => {
    element.textContent = 'An extremely long product name that needs two lines without horizontal overflow';
  });
  await page.locator('.row-clicks b').first().evaluate((element) => {
    element.textContent = '987,654,321';
  });
  await page.locator('.beat').first().evaluate((element) => {
    element.textContent = 'Beat for $10,001';
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `${width}x${height} stress content must not overflow`);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(450);
  const reachability = await page.evaluate(() => {
    const form = document.querySelector('#claim')?.getBoundingClientRect();
    const original = document.querySelector('.claim-button')?.getBoundingClientRect();
    const sticky = document.querySelector('.mobile-claim-bar');
    return {
      formPassed:Boolean(form && form.bottom <= 0),
      originalVisible:Boolean(original && original.bottom > 0 && original.top < innerHeight),
      stickyVisible:sticky?.classList.contains('is-visible') ?? false,
    };
  });
  assert.ok(
    reachability.formPassed ? reachability.stickyVisible : reachability.originalVisible,
    `${width}x${height} must keep a Take #1 action reachable`,
  );

  if (reachability.stickyVisible) {
    await page.evaluate(() => document.querySelector('.menu-button')?.click());
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.mobile-claim-bar').getAttribute('aria-hidden'), 'true', 'open navigation must hide the sticky claim action');
    await page.evaluate(() => document.querySelector('.menu-button')?.click());
    await page.evaluate(() => {
      const modal = document.createElement('div');
      modal.id = 'mobile-check-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      document.body.append(modal);
    });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.mobile-claim-bar').getAttribute('aria-hidden'), 'true', 'open modals must hide the sticky claim action');
    await page.evaluate(() => document.querySelector('#mobile-check-modal')?.remove());
    await page.waitForTimeout(100);
    await page.locator('.mobile-claim-bar').click();
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'product-url', 'sticky action must focus the URL field');
    assert.deepEqual(conversionRequests, [], 'sticky focus must not begin conversion requests');
  }

  await context.close();
}

await b.close();
console.log('desktop and mobile homepage checks passed');
