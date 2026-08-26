import assert from "node:assert/strict";
import test from "node:test";
import { hostnameFallback, productImageFromHtml } from "../metadata";

test("domain fallback creates readable product names when every word is known", () => {
  assert.equal(hostnameFallback("whoisnext.lol"), "Who is next");
  assert.equal(hostnameFallback("screenwar.lol"), "Screen war");
  assert.equal(hostnameFallback("my-product.app"), "My product");
});

test("domain fallback keeps the hostname when a word split would be a guess", () => {
  assert.equal(hostnameFallback("zyphora.io"), "zyphora.io");
});

test("a declared square icon is preferred over a wide social image", () => {
  const html = `<meta property="og:image" content="/wide.png"><link rel="icon" href="/favicon.svg"><link rel="apple-touch-icon" href="/touch.png">`;
  assert.equal(productImageFromHtml(html, "https://example.com/product"), "https://example.com/touch.png");
});

test("social image remains the fallback when a page declares no icon", () => {
  const html = `<meta property="og:image" content="/wide.png">`;
  assert.equal(productImageFromHtml(html, "https://example.com/product"), "https://example.com/wide.png");
});
