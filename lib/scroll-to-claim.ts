/** Client-only: scrolls the claim form into view and focuses its URL input. */
export function focusClaimForm() {
  const form = document.getElementById("claim");
  const input = document.getElementById("product-url") as HTMLInputElement | null;
  input?.focus({ preventScroll: true });
  form?.scrollIntoView({ behavior: "smooth", block: "start" });
}
