import { DISPLAY_NAME_MAX, PITCH_MAX } from "@/lib/validate";

export type UrlMetadata = {
  productName: string;
  pitch: string | null;
  imageUrl: string | null;
  /** Whether the product page supplied readable HTML metadata. */
  scraped: boolean;
};

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 300_000;

const PRODUCT_OVERRIDES: Record<string, { productName: string; pitch: string }> = {
  "safeelephant.co.uk": {
    productName: "Most expensive link",
    pitch: "The most expensive link on the internet.",
  },
};

// Used only when a page exposes no usable metadata. A complete, confident split is
// required; otherwise the hostname is kept intact instead of inventing a bad name.
const DOMAIN_WORDS = new Set([
  "a", "ai", "app", "ask", "be", "best", "board", "book", "box", "build",
  "buy", "can", "chat", "click", "cloud", "code", "daily", "data", "deal",
  "design", "dev", "do", "docs", "easy", "find", "flow", "for", "get", "go",
  "help", "home", "hour", "how", "hub", "in", "is", "it", "lab", "launch",
  "link", "list", "live", "maker", "market", "meet", "my", "next", "note",
  "now", "of", "on", "one", "page", "pay", "product", "screen", "shop",
  "simple", "site", "space", "stack", "store", "studio", "task", "team", "the",
  "time", "to", "tool", "top", "track", "up", "use", "war", "web", "what",
  "where", "who", "why", "with", "work", "you", "your",
]);

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function getMetaContent(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]*(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    const value = match?.[1] ? decodeEntities(match[1]).trim() : "";
    if (value) return value;
  }
  return null;
}

function getTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const value = match?.[1] ? decodeEntities(match[1]).trim() : "";
  return value || null;
}

function clampName(name: string): string {
  return name.length > DISPLAY_NAME_MAX ? name.slice(0, DISPLAY_NAME_MAX).trim() : name;
}

function titleCase(words: string[]): string {
  const phrase = words.join(" ").toLowerCase();
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function splitKnownWords(value: string): string[] | null {
  const best: Array<string[] | null> = Array(value.length + 1).fill(null);
  best[0] = [];
  for (let end = 1; end <= value.length; end += 1) {
    for (let start = 0; start < end; start += 1) {
      const prefix = best[start];
      const word = value.slice(start, end);
      if (!prefix || !DOMAIN_WORDS.has(word)) continue;
      const candidate = [...prefix, word];
      const current = best[end];
      if (!current || candidate.length < current.length) best[end] = candidate;
    }
  }
  const result = best[value.length];
  return result && result.length > 1 ? result : null;
}

function knownDomainName(hostname: string): string | null {
  const base = hostname.toLowerCase().replace(/^www\./, "").split(".")[0] ?? "";
  const segmented = splitKnownWords(base);
  return segmented ? titleCase(segmented) : null;
}

function polishMetadataName(name: string, hostname: string): string {
  const base = hostname.toLowerCase().replace(/^www\./, "").split(".")[0] ?? "";
  const compactName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return compactName === base ? knownDomainName(hostname) ?? name : name;
}

export function hostnameFallback(hostname: string): string {
  const cleanHostname = hostname.toLowerCase().replace(/^www\./, "");
  const base = cleanHostname.split(".")[0] || cleanHostname;
  const visibleParts = base
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (visibleParts.length > 1) return titleCase(visibleParts);
  const segmented = splitKnownWords(base);
  return segmented ? titleCase(segmented) : cleanHostname;
}

function deriveProductName(html: string, hostname: string): string {
  const siteName = getMetaContent(html, "og:site_name");
  if (siteName) return clampName(polishMetadataName(siteName, hostname));

  const title = getMetaContent(html, "og:title") ?? getTitle(html);
  if (title) {
    // Titles are often "Brand | Tagline" or "Brand - Tagline" — the brand is what we want.
    const segment = title.split(/\s+[|–—·-]\s+/)[0].trim();
    if (segment) return clampName(polishMetadataName(segment, hostname));
  }

  return clampName(hostnameFallback(hostname));
}

function derivePitch(html: string): string | null {
  const description =
    getMetaContent(html, "og:description") ??
    getMetaContent(html, "description") ??
    getMetaContent(html, "twitter:description");
  if (!description) return null;
  if (description.length <= PITCH_MAX) return description;
  // Break on a word boundary. A pitch cut mid-word ("routes every response throug…")
  // goes out in the X announcement and onto the buyer's card, where it reads as broken.
  const cut = description.slice(0, PITCH_MAX - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const body = (lastSpace > PITCH_MAX / 2 ? cut.slice(0, lastSpace) : cut)
    .replace(/[\s,;:.\-]+$/, "");
  return `${body}…`;
}

function deriveImageUrl(html: string, pageUrl: string): string | null {
  const raw =
    getMetaContent(html, "og:image") ??
    getMetaContent(html, "twitter:image") ??
    getMetaContent(html, "twitter:image:src");
  if (!raw) return null;

  try {
    const image = new URL(raw, pageUrl);
    return image.protocol === "http:" || image.protocol === "https:" ? image.toString() : null;
  } catch {
    return null;
  }
}

function tagAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  const value = decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
  return value || null;
}

function deriveIconUrl(html: string, pageUrl: string): string | null {
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const candidates = links.flatMap((tag) => {
    const rel = tagAttribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const href = tagAttribute(tag, "href");
    if (!href) return [];
    if (rel.includes("apple-touch-icon")) return [{ priority: 0, href }];
    if (rel.includes("icon")) return [{ priority: 1, href }];
    return [];
  }).sort((a, b) => a.priority - b.priority);

  for (const { href } of candidates) {
    try {
      const icon = new URL(href, pageUrl);
      if (icon.protocol === "http:" || icon.protocol === "https:") return icon.toString();
    } catch {}
  }
  return null;
}

export function productImageFromHtml(html: string, pageUrl: string): string | null {
  return deriveIconUrl(html, pageUrl) ?? deriveImageUrl(html, pageUrl);
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (received >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8");
}

/** Fetches the listing's landing page and derives a product name and pitch from it. */
export async function fetchUrlMetadata(url: string): Promise<UrlMetadata> {
  const hostname = new URL(url).hostname;
  const override = PRODUCT_OVERRIDES[hostname.replace(/^www\./, "").toLowerCase()];
  const fallback: UrlMetadata = {
    productName: clampName(override?.productName ?? hostnameFallback(hostname)),
    pitch: override?.pitch ?? null,
    imageUrl: null,
    scraped: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; yourhourbot/1.0; +https://yourhour.lol)",
        accept: "text/html",
      },
    });

    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("text/html")) return fallback;

    const html = await readLimited(res, MAX_BYTES);
    return {
      productName: override?.productName ?? deriveProductName(html, hostname),
      pitch: override?.pitch ?? derivePitch(html),
      imageUrl: productImageFromHtml(html, res.url || url),
      scraped: true,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
