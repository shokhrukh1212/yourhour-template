/**
 * The Wall treats every page on the same product domain as the same listing. Protocol,
 * www, paths, trailing slashes and query strings are deliberately not part of identity.
 */
export function normalizeWallDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;

  try {
    const candidate = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    const hostname = new URL(candidate).hostname.toLowerCase();
    return hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
