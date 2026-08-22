import { DISPLAY_NAME_MAX, PITCH_MAX } from "@/lib/validate";

export type UrlMetadata = {
  productName: string;
  pitch: string | null;
};

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 300_000;

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

function hostnameFallback(hostname: string): string {
  const base = hostname.replace(/^www\./, "").split(".")[0] || hostname;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function deriveProductName(html: string, hostname: string): string {
  const siteName = getMetaContent(html, "og:site_name");
  if (siteName) return clampName(siteName);

  const title = getMetaContent(html, "og:title") ?? getTitle(html);
  if (title) {
    // Titles are often "Brand | Tagline" or "Brand - Tagline" — the brand is what we want.
    const segment = title.split(/\s+[|–—·-]\s+/)[0].trim();
    if (segment) return clampName(segment);
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
  const fallback: UrlMetadata = { productName: clampName(hostnameFallback(hostname)), pitch: null };

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
      productName: deriveProductName(html, hostname),
      pitch: derivePitch(html),
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
