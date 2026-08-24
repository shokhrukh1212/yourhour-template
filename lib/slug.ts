/** A slug that is safe in a URL, a filename and an email body. */
const MAX_LENGTH = 40;

/** Everything a slug is allowed to contain, and the only shape lookups accept. */
export const SLUG_PATTERN = /^[a-z0-9-]{1,64}$/;

/**
 * The permanent public identity of a campaign. Derived from the product name once, at
 * sale time, and then frozen -- a posted link and a cached card both stop working if a
 * slug is ever recomputed, so nothing outside the sale path may call this on a live row.
 *
 * A name made entirely of punctuation or non-Latin script slugifies to nothing. That is
 * not an error: it falls back to "product" and the collision suffix supplies the identity.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    // Combining marks, so that "Café" becomes "cafe" rather than "caf".
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    // Truncation can land on a dash.
    .replace(/-+$/g, "");

  return slug || "product";
}

/**
 * The first free slug in the ladder base, base-2, base-3, ... given the slugs already
 * taken. Separated from the database so the collision rule is unit-testable.
 */
export function firstFreeSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
