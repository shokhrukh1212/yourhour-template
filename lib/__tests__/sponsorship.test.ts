import assert from "node:assert/strict";
import test from "node:test";
import { chooseWeightedSponsor, type SponsorCampaign } from "../sponsorship-shared";
import { sponsorshipPaymentValidationError } from "../sponsorship-payment";
import { validateSponsorshipCheckout } from "../validate";

const campaigns = [1, 2, 3, 4].map((position) => ({
  id: `00000000-0000-0000-0000-00000000000${position}`,
  position,
  productUrl: `https://example${position}.com/`,
  productName: `Example ${position}`,
  description: null,
  logoUrl: null,
  durationDays: 7,
  amountPaidCents: 1000,
  currency: "USD",
  clickCount: 0,
  startsAt: "2026-08-30T00:00:00.000Z",
  endsAt: "2026-09-06T00:00:00.000Z",
})) as SponsorCampaign[];

test("mobile sponsor draw uses the configured 40/30/20/10 boundaries", () => {
  assert.equal(chooseWeightedSponsor(campaigns, 0)?.position, 1);
  assert.equal(chooseWeightedSponsor(campaigns, 0.399)?.position, 1);
  assert.equal(chooseWeightedSponsor(campaigns, 0.4)?.position, 2);
  assert.equal(chooseWeightedSponsor(campaigns, 0.7)?.position, 3);
  assert.equal(chooseWeightedSponsor(campaigns, 0.9)?.position, 4);
});

test("mobile sponsor draw normalizes across active positions", () => {
  assert.equal(chooseWeightedSponsor([campaigns[1], campaigns[3]], 0)?.position, 2);
  assert.equal(chooseWeightedSponsor([campaigns[1], campaigns[3]], 0.749)?.position, 2);
  assert.equal(chooseWeightedSponsor([campaigns[1], campaigns[3]], 0.75)?.position, 4);
});

test("sponsorship checkout accepts only real positions, durations, and public URLs", () => {
  const valid = validateSponsorshipCheckout({
    position: 1,
    durationDays: 7,
    url: "example.com/product",
  });
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.value.url, "https://example.com/product");
  assert.equal(validateSponsorshipCheckout({ position: 5, durationDays: 7, url: "https://example.com", productName: "x" }).ok, false);
  assert.equal(validateSponsorshipCheckout({ position: 1, durationDays: 14, url: "https://example.com", productName: "x" }).ok, false);
  assert.equal(validateSponsorshipCheckout({ position: 1, durationDays: 7, url: "http://localhost", productName: "x" }).ok, false);
});

test("verified sponsorship payment must match server amount and currency", () => {
  assert.equal(sponsorshipPaymentValidationError(2500, "USD", {
    providerSubtotalCents: 2500,
    providerTotalCents: 2700,
    providerCurrency: "usd",
  }), null);
  assert.equal(sponsorshipPaymentValidationError(2500, "USD", {
    providerSubtotalCents: 2400,
    providerTotalCents: 2400,
    providerCurrency: "USD",
  }), "PAYMENT_AMOUNT_MISMATCH");
  assert.equal(sponsorshipPaymentValidationError(2500, "USD", {
    providerSubtotalCents: 2500,
    providerTotalCents: 2500,
    providerCurrency: "EUR",
  }), "INVALID_CURRENCY");
});
