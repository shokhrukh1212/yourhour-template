import { chromium } from 'playwright';
const SP = process.argv[2];
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN });
for (const scheme of ['light','dark']) {
  const ctx = await b.newContext({ viewport:{width:1280,height:900}, colorScheme: scheme, deviceScaleFactor:1 });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/', { waitUntil:'networkidle', timeout:60000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path:`${SP}/home-${scheme}-fold.png` });
  await p.screenshot({ path:`${SP}/home-${scheme}-full.png`, fullPage:true });
  await ctx.close();
}
const m = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
const mp = await m.newPage();
await mp.goto('http://localhost:3000/', { waitUntil:'networkidle', timeout:60000 });
await mp.waitForTimeout(1200);
await mp.screenshot({ path:`${SP}/home-mobile.png` });
// horizontal overflow check
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
console.log('mobile horizontal overflow:', overflow);
await b.close();
