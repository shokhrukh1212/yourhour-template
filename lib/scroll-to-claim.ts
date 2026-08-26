/** Client-only: scrolls the claim form into view and focuses its URL input. */
export function focusClaimForm() {
  const form = document.getElementById("claim");
  const input = document.getElementById("product-url") as HTMLInputElement | null;
  input?.focus({ preventScroll: true });
  const target = input ?? form;
  if (!target) return;
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  window.requestAnimationFrame(() => target.scrollIntoView({ behavior, block: "center" }));
}
