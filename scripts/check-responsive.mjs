import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.RESPONSIVE_BASE_URL ?? "http://localhost:3000";
const output = process.env.RESPONSIVE_OUTPUT ?? "/tmp/yourhour-responsive";
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
const sizes = [
  [320, 700], [375, 760], [390, 844], [430, 900],
  [768, 900], [1024, 900], [1280, 900], [1440, 900],
];

for (const [width, height] of sizes) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width <= 430,
    hasTouch: width <= 430,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const response = await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
  assert.equal(response?.status(), 200, `${width}px homepage should load`);

  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector)?.getBoundingClientRect();
      return value ? { left: value.left, right: value.right, top: value.top, width: value.width } : null;
    };
    const rows = [...document.querySelectorAll(".leader-row")];
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      rows: rows.length,
      rowLinks: document.querySelectorAll(".leader-row > .leaderboard-row-link").length,
      nestedRowActions: document.querySelectorAll(".leader-row .row-actions,.leader-row .beat,.leader-row .row-visit").length,
      clippedAmounts: rows.some((row) => {
        const paid = row.querySelector(".row-paid")?.getBoundingClientRect();
        return !paid || paid.right > document.documentElement.clientWidth + 0.5 || paid.left < 0;
      }),
      featured: rect(".homepage-featured"),
      leaderboard: rect(".homepage-leaderboard"),
      claim: rect(".claim-panel"),
      sponsors: rect(".sponsors-section"),
      desktopSponsors: getComputedStyle(document.querySelector(".desktop-sponsor-list")).display,
      mobilePromote: getComputedStyle(document.querySelector(".mobile-promote-card")).display,
    };
  });
  assert.equal(layout.overflow, false, `${width}px must not overflow horizontally`);
  assert.ok(layout.rows > 0, `${width}px should render leaderboard products`);
  assert.equal(layout.rowLinks, layout.rows, `${width}px every leaderboard row should be one semantic link`);
  assert.equal(layout.nestedRowActions, 0, `${width}px row buttons should remain commented out`);
  assert.equal(layout.clippedAmounts, false, `${width}px paid amounts must remain visible`);

  if (width >= 901) {
    assert.ok(layout.featured && layout.leaderboard && Math.abs(layout.featured.left - layout.leaderboard.left) < 1, `${width}px left column should align`);
    assert.ok(layout.featured && layout.leaderboard && Math.abs(layout.featured.width - layout.leaderboard.width) < 1, `${width}px leaderboard width should match #1`);
    assert.ok(layout.claim && layout.sponsors && Math.abs(layout.claim.left - layout.sponsors.left) < 1, `${width}px sponsor rail should align`);
    assert.ok(layout.claim && layout.sponsors && Math.abs(layout.claim.width - layout.sponsors.width) < 1, `${width}px sponsor rail widths should match`);
    assert.notEqual(layout.desktopSponsors, "none", `${width}px should show four desktop sponsor positions`);
  } else if (width <= 768) {
    assert.equal(layout.desktopSponsors, "none", `${width}px should hide four-card sponsor stack`);
    assert.notEqual(layout.mobilePromote, "none", `${width}px should show compact promote card`);
  }

  await page.locator(".row-title").first().evaluate((element) => {
    element.textContent = "A deliberately extremely long product name that must truncate without moving the paid amount";
  });
  await page.locator(".row-description").first().evaluate((element) => {
    element.textContent = "A deliberately long description that should remain inside its flexible text column even on the smallest supported screen width.";
  }).catch(() => {});
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    false,
    `${width}px stress content must not overflow`,
  );

  if (width === 390 || width === 1280) {
    await page.route("**/api/sponsorship/preview", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "https://example.com/",
        productName: "Example product",
        description: "Automatically extracted product description.",
        logoUrl: null,
      }),
    }));
    const trigger = page.locator(width <= 768 ? ".mobile-promote-card" : ".sponsor-card-available").first();
    await trigger.click();
    const dialog = page.locator(".sponsor-dialog");
    await assert.doesNotReject(() => dialog.waitFor({ state: "visible" }));
    await assert.doesNotReject(() => page.getByText("Sponsorship adds temporary visibility. It does not change your leaderboard rank or take the homepage.").waitFor());
    assert.equal(await dialog.locator("input").count(), 1, `${width}px sponsorship should have only the URL input`);
    assert.equal(await dialog.locator("input").getAttribute("type"), "text", `${width}px URL should accept domains without a scheme`);
    await dialog.locator("input").fill("example.com");
    await page.locator("#sponsor-dialog-title").click();
    await page.getByText("Example product", { exact: true }).waitFor();
    assert.equal(await dialog.locator("input").count(), 1, `${width}px metadata preview must not add editable fields`);
    assert.match(await page.locator(".sponsor-checkout-button").textContent(), /Continue to checkout — \$/);
    await page.screenshot({ path: `${output}/modal-${width}.png`, fullPage: false });
    await page.locator(".sponsor-dialog-close").click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(await dialog.count(), 0, `${width}px modal should close`);
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true, `${width}px focus should return to modal trigger`);
  }

  await page.screenshot({ path: `${output}/home-${width}.png`, fullPage: true });
  await context.close();
}

await browser.close();
console.log(`responsive checks passed at ${sizes.map(([width]) => width).join(", ")}px`);
