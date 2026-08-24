"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatClickRate, formatPrice } from "@/lib/pricing";

export function SuccessActions({ slug, siteUrl, clicks, priceCents, campaignId, jumpPriceCents }: { slug: string; siteUrl: string; clicks: number; priceCents: number; campaignId: string; jumpPriceCents: number | null }) {
  const [copied, setCopied] = useState(false);
  const [jumping, setJumping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = `${siteUrl}/u/${slug}`;
  const text = `Just bought ${clicks} guaranteed clicks on yourhour.lol for ${formatPrice(priceCents)}. ${formatClickRate()} a click. ${link}`;
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }
  async function jump() {
    setJumping(true); setError(null);
    try {
      const response = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "jump", campaignId }) });
      const json = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (!response.ok || !json.checkoutUrl) { setError(json.error ?? "Could not start checkout."); return; }
      window.location.assign(json.checkoutUrl);
    } catch { setError("Network error. Try again."); } finally { setJumping(false); }
  }
  return <div className="mt-8"><div className="flex flex-wrap gap-3"><button type="button" onClick={copy} className="rounded-full border border-border px-6 py-2.5 text-sm font-medium transition hover:border-accent hover:text-accent">{copied ? "Copied" : "Copy link"}</button>{clicks > 0 ? <a href={`https://x.com/intent/post?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener" className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-ink transition hover:opacity-90">Share on X</a> : null}</div>{jumpPriceCents ? <button type="button" onClick={jump} disabled={jumping} className="mt-7 text-sm font-semibold text-accent hover:underline disabled:opacity-50">{jumping ? "Starting checkout…" : `Want to start now? Jump the queue for ${formatPrice(jumpPriceCents)}.`}</button> : null}{error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}</div>;
}

export function WaitingForPayment({ intentId, name }: { intentId: string; name: string }) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      if (attempts > 30) { setSlow(true); clearInterval(timer); return; }
      try {
        const response = await fetch(`/api/checkout/status?r=${intentId}`, { cache: "no-store" });
        if (!response.ok) return;
        const json = (await response.json()) as { ready?: boolean };
        if (json.ready) { clearInterval(timer); router.refresh(); }
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  }, [intentId, router]);
  return <><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Confirming your payment…</h1><p className="mt-6 flex items-center gap-3 text-muted"><span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />Adding {name} to the queue.</p>{slow ? <p className="mt-6 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">This is taking longer than usual. Reload in a moment, or get in touch and we&apos;ll sort it out.</p> : null}</>;
}
