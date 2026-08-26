import assert from "node:assert/strict";
import test from "node:test";
import { isObviousBot } from "../click";

test("obvious bots and preview fetches are excluded", () => {
  assert.equal(isObviousBot(new Request("https://yourhour.test", { headers:{ "user-agent":"Googlebot/2.1" } })),true);
  assert.equal(isObviousBot(new Request("https://yourhour.test", { headers:{ "user-agent":"Mozilla/5.0", purpose:"prefetch" } })),true);
});

test("a normal browser navigation remains eligible", () => {
  assert.equal(isObviousBot(new Request("https://yourhour.test", { headers:{ "user-agent":"Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36" } })),false);
});
