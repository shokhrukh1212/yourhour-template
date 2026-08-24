import assert from "node:assert/strict";
import { test } from "node:test";
import { firstFreeSlug, slugify } from "../slug";

test("a product name becomes a readable slug", () => {
  assert.equal(slugify("Uiwize"), "uiwize");
  assert.equal(slugify("My App!!"), "my-app");
  assert.equal(slugify("  --Hello--World--  "), "hello-world");
});

test("accents are folded rather than dropped", () => {
  assert.equal(slugify("Café Noir"), "cafe-noir");
  assert.equal(slugify("Zoë"), "zoe");
});

test("a name with no Latin characters still yields a usable slug", () => {
  // The collision ladder supplies the identity from here.
  assert.equal(slugify("日本語"), "product");
  assert.equal(slugify("!!!"), "product");
});

test("long names are capped and never end on a dash", () => {
  const slug = slugify("a".repeat(60));
  assert.equal(slug.length, 40);
  const cut = slugify(`${"a".repeat(39)} tail`);
  assert.ok(!cut.endsWith("-"), `expected no trailing dash, got ${cut}`);
});

test("duplicate names climb the suffix ladder", () => {
  assert.equal(firstFreeSlug("uiwize", []), "uiwize");
  assert.equal(firstFreeSlug("uiwize", ["uiwize"]), "uiwize-2");
  assert.equal(firstFreeSlug("uiwize", ["uiwize", "uiwize-2"]), "uiwize-3");
  // A gap is reused rather than skipped past.
  assert.equal(firstFreeSlug("uiwize", ["uiwize", "uiwize-3"]), "uiwize-2");
});
