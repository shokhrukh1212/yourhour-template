export type SponsorshipPaymentFields = {
  providerSubtotalCents: number;
  providerTotalCents: number;
  providerCurrency: string;
};

export function sponsorshipPaymentValidationError(
  expectedAmountCents: number,
  expectedCurrency: string,
  input: SponsorshipPaymentFields,
): string | null {
  if (input.providerCurrency.toUpperCase() !== expectedCurrency.toUpperCase()) return "INVALID_CURRENCY";
  if (input.providerSubtotalCents !== expectedAmountCents) return "PAYMENT_AMOUNT_MISMATCH";
  if (input.providerTotalCents < input.providerSubtotalCents) return "PAYMENT_TOO_SMALL";
  return null;
}
