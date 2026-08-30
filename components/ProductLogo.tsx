"use client";

import { useState } from "react";

const FALLBACK_COLORS = ["#d7ff67", "#77e7ff", "#ff94c8", "#9b7cff", "#ffb86b"];

export function ProductLogo({
  imageUrl,
  productUrl,
  productName,
  compact = false,
  className,
  eager = false,
}: {
  imageUrl: string | null;
  productUrl: string | null;
  productName?: string | null;
  compact?: boolean;
  /** Overrides the default compact/normal sizing, e.g. for a large hero logo. */
  className?: string;
  /** The live hero is above the fold; Wall logos remain lazy. */
  eager?: boolean;
}) {
  const source = productImageUrl(imageUrl, productUrl);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const size = className ?? (compact ? "h-7 w-7 rounded-lg" : "h-12 w-12 rounded-[14px]");
  const color = fallbackColor(productName ?? productUrl ?? "yourhour");

  return (
    <span
      role="img"
      aria-label={`${productName?.trim() || "Product"} logo`}
      className={`grid shrink-0 place-items-center overflow-hidden border bg-background text-xs font-black ${size}`}
      style={{
        color,
        borderColor: `${color}66`,
        backgroundColor: `${color}18`,
      }}
    >
      {source && source !== failedSource ? (
        // Product hosts are arbitrary, so next/image cannot safely enumerate them in
        // remotePatterns. The fixed box still prevents layout shift.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source}
          alt=""
          loading={eager ? "eager" : "lazy"}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailedSource(source)}
        />
      ) : (
        <span>{productInitials(productName, productUrl)}</span>
      )}
    </span>
  );
}

export function productImageUrl(
  imageUrl: string | null,
  productUrl: string | null,
): string | null {
  return imageUrl ?? faviconUrl(productUrl);
}

export function faviconUrl(productUrl: string | null): string | null {
  if (!productUrl) return null;
  try {
    const hostname = new URL(productUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
  } catch {
    return null;
  }
}

function productInitials(name: string | null | undefined, productUrl: string | null): string {
  const value = name?.trim() || hostnameLabel(productUrl) || "?";
  if (value.startsWith("$")) return "$";
  const words = value.match(/[\p{L}\p{N}]+/gu) ?? [];
  const first = words[0]?.[0];
  const second = words[1]?.[0];
  if (first && second) return `${first}${second}`.toUpperCase();
  return (words[0]?.slice(0, 2) || value.slice(0, 1)).toUpperCase();
}

function hostnameLabel(productUrl: string | null): string | null {
  if (!productUrl) return null;
  try {
    return new URL(productUrl).hostname.replace(/^www\./, "").split(".")[0] || null;
  } catch {
    return null;
  }
}

function fallbackColor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}
