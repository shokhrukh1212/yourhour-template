"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Copy the link, or post it. The buyer posting their own spot reaches more people than
 * our account does, which is why there is no automatic announcement any more.
 */
export function SuccessActions({
  slug,
  rank,
  siteUrl,
  startsAtIso,
}: {
  slug: string;
  rank: number;
  siteUrl: string;
  startsAtIso: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const link = `${siteUrl}/u/${slug}`;

  // Built on the client so the time in the post is the buyer's own, matching what the
  // rest of the page just told them.
  const when = startsAtIso
    ? new Date(startsAtIso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const host = siteUrl.replace(/^https?:\/\//, "");
  const text = when
    ? `Just claimed rank #${rank} on ${host}. My product owns their homepage at ${when} today. ${link}`
    : `Just claimed rank #${rank} on ${host}. ${link}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked in some embedded browsers; the link is on screen anyway.
    }
  }

  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={copy}
        className="rounded-full border border-border px-6 py-2.5 text-sm font-medium transition hover:border-accent hover:text-accent"
      >
        {copied ? "Copied" : "Copy link"}
      </button>
      <a
        href={`https://x.com/intent/post?text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noopener"
        className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
      >
        Share on X
      </a>
    </div>
  );
}

/**
 * The webhook usually lands before the buyer's browser gets back here, but not always.
 * Poll rather than 404 -- a paid buyer seeing "not found" is the worst possible moment
 * for this site to look broken.
 */
export function WaitingForPayment({
  reservationId,
  name,
}: {
  reservationId: string;
  name: string;
}) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      if (attempts > 30) {
        setSlow(true);
        clearInterval(timer);
        return;
      }
      try {
        const res = await fetch(`/api/checkout/status?r=${reservationId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { ready?: boolean };
        if (json.ready) {
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // Keep trying; a dropped poll is not a failed payment.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [reservationId, router]);

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Confirming your payment…
      </h1>
      <p className="mt-6 flex items-center gap-3 text-muted">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
        Putting {name} on the Wall.
      </p>
      {slow ? (
        <p className="mt-6 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
          This is taking longer than usual. Your payment went through — reload in a
          moment, or get in touch and we&apos;ll sort it out.
        </p>
      ) : null}
    </>
  );
}
