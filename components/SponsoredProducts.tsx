"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ProductLogo } from "./ProductLogo";
import {
  SPONSOR_POSITION_CONFIG,
  chooseWeightedSponsor,
  type SponsorCampaign,
  type SponsorDuration,
  type SponsorPosition,
  type SponsorSlot,
} from "@/lib/sponsorship-shared";

const DOCK_DISMISSED_KEY = "yourhour:sponsor-dock-dismissed";

function money(amountCents: number | null, currency: string | null): string {
  if (amountCents === null || !currency) return "Unavailable";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
    }).format(amountCents / 100);
  } catch {
    return `${currency} ${(amountCents / 100).toFixed(2)}`;
  }
}

function campaignTime(endsAt: string, nowIso: string): string {
  const remaining = Math.max(0, new Date(endsAt).getTime() - new Date(nowIso).getTime());
  const hours = Math.ceil(remaining / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} left`;
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} left`;
}

function ActiveSponsorCard({ campaign, nowIso }: { campaign: SponsorCampaign; nowIso: string }) {
  return (
    <a
      className="sponsor-card sponsor-card-active"
      href={`/s/${campaign.id}?placement=sponsor_desktop`}
      target="_blank"
      rel="sponsored noopener"
      aria-label={`Sponsored: visit ${campaign.productName} (opens in a new tab)`}
    >
      <ProductLogo
        imageUrl={campaign.logoUrl}
        productUrl={campaign.productUrl}
        productName={campaign.productName}
        className="sponsor-logo"
      />
      <span className="sponsor-card-copy">
        <span className="sponsored-label">Sponsored</span>
        <strong>{campaign.productName}</strong>
        {campaign.description ? <span className="sponsor-description">{campaign.description}</span> : null}
        <span className="sponsor-meta">
          {campaign.clickCount.toLocaleString()} campaign clicks · {campaignTime(campaign.endsAt, nowIso)}
        </span>
      </span>
    </a>
  );
}

function SponsorModal({
  slots,
  selectedPosition,
  onClose,
}: {
  slots: SponsorSlot[];
  selectedPosition: SponsorPosition | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [position, setPosition] = useState<SponsorPosition>(selectedPosition ?? 1);
  const [duration, setDuration] = useState<SponsorDuration>(7);
  const [url, setUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPreviewUrl = useRef("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  }, []);

  const selectedSlot = slots.find((slot) => slot.position === position) ?? slots[0];
  const price = selectedSlot?.prices[duration] ?? null;
  const configured = price !== null && Boolean(selectedSlot?.currency);
  const closeDialog = () => dialogRef.current?.close();

  async function preview() {
    const trimmed = url.trim();
    if (!trimmed || trimmed === lastPreviewUrl.current) return;
    setPreviewing(true);
    setError(null);
    try {
      const response = await fetch("/api/sponsorship/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const json = await response.json() as {
        error?: string;
        url?: string;
        productName?: string;
        description?: string | null;
        logoUrl?: string | null;
      };
      if (!response.ok || !json.url) throw new Error(json.error ?? "Could not read that URL.");
      setUrl(json.url);
      setProductName(json.productName ?? "");
      setDescription(json.description ?? "");
      setLogoUrl(json.logoUrl ?? null);
      lastPreviewUrl.current = json.url;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read that URL.");
    } finally {
      setPreviewing(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !configured) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/sponsorship/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          position,
          durationDays: duration,
          url,
        }),
      });
      const json = await response.json() as { checkoutUrl?: string; error?: string };
      if (!response.ok || !json.checkoutUrl) {
        throw new Error(json.error ?? "Could not start checkout.");
      }
      window.location.assign(json.checkoutUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start checkout.");
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="sponsor-dialog"
      aria-labelledby="sponsor-dialog-title"
      onCancel={(event) => { event.preventDefault(); closeDialog(); }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) closeDialog();
      }}
    >
      <form className="sponsor-form" onSubmit={submit}>
        <div className="sponsor-dialog-heading">
          <div>
            <span className="sponsored-label">Sponsored</span>
            <h2 id="sponsor-dialog-title">Promote your product</h2>
          </div>
          <button autoFocus type="button" className="sponsor-dialog-close" aria-label="Close sponsorship form" onClick={closeDialog}>×</button>
        </div>

        <div className="sponsor-form-grid">
          <label>
            <span>Sponsorship position</span>
            <select value={position} onChange={(event) => setPosition(Number(event.target.value) as SponsorPosition)}>
              {slots.map((slot) => (
                <option key={slot.position} value={slot.position} disabled={Boolean(slot.active || slot.reservedUntil)}>
                  Position {slot.position}{slot.active ? " — occupied" : slot.reservedUntil ? " — checkout in progress" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Duration</span>
            <select value={duration} onChange={(event) => setDuration(Number(event.target.value) as SponsorDuration)}>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
        </div>

        <label>
          <span>Product URL</span>
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            required
            placeholder="yourproduct.com or https://yourproduct.com"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setProductName("");
              setDescription("");
              setLogoUrl(null);
              lastPreviewUrl.current = "";
              setError(null);
            }}
            onBlur={() => void preview()}
          />
          {previewing ? <small role="status">Getting product details…</small> : null}
        </label>

        {productName ? (
          <div className="sponsor-auto-preview" aria-live="polite">
            <ProductLogo imageUrl={logoUrl} productUrl={url || null} productName={productName} className="sponsor-form-logo" />
            <span>
              <small>Automatically found</small>
              <strong>{productName}</strong>
              {description ? <span>{description}</span> : null}
            </span>
          </div>
        ) : null}

        <div className="sponsor-price" aria-live="polite">
          <span>Final price</span>
          <strong>{money(price, selectedSlot?.currency ?? null)}</strong>
          <span>for {duration} days</span>
        </div>
        <p className="sponsor-disclaimer">Sponsorship adds temporary visibility. It does not change your leaderboard rank or take the homepage.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="sponsor-checkout-button" type="submit" disabled={busy || !configured || Boolean(selectedSlot?.active || selectedSlot?.reservedUntil)}>
          {busy ? "Preparing checkout…" : `Continue to checkout — ${money(price, selectedSlot?.currency ?? null)}`}
        </button>
      </form>
    </dialog>
  );
}

function MobileSponsorDock({
  campaigns,
  suppress,
}: {
  campaigns: SponsorCampaign[];
  suppress: boolean;
}) {
  const [selected, setSelected] = useState<SponsorCampaign | null>(null);
  const [claimPassed, setClaimPassed] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setSelected(chooseWeightedSponsor(campaigns));
      try { setDismissed(window.sessionStorage.getItem(DOCK_DISMISSED_KEY) === "1"); }
      catch { setDismissed(false); }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [campaigns]);

  useEffect(() => {
    const form = document.getElementById("claim");
    if (!form) return;
    const observer = new IntersectionObserver(([entry]) => {
      setClaimPassed(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
    });
    observer.observe(form);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const element = event.target as HTMLElement | null;
      setInputFocused(Boolean(element?.matches("input, textarea, select, [contenteditable='true']")));
    };
    const onFocusOut = () => window.setTimeout(() => {
      const element = document.activeElement;
      setInputFocused(Boolean(element?.matches("input, textarea, select, [contenteditable='true']")));
    }, 0);
    const viewport = window.visualViewport;
    const readKeyboard = () => setKeyboardOpen(Boolean(
      viewport && window.innerHeight - viewport.height > 140,
    ));
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    viewport?.addEventListener("resize", readKeyboard);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      viewport?.removeEventListener("resize", readKeyboard);
    };
  }, []);

  useEffect(() => {
    const read = () => setOverlayOpen(Boolean(document.querySelector("dialog[open], .mobile-nav")));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);

  const visible = Boolean(selected && claimPassed && !dismissed && !suppress && !inputFocused && !keyboardOpen && !overlayOpen);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("yourhour:sponsor-dock", { detail: { visible } }));
    return () => {
      window.dispatchEvent(new CustomEvent("yourhour:sponsor-dock", { detail: { visible: false } }));
    };
  }, [visible]);

  if (!selected) return null;
  return (
    <aside className={`mobile-sponsor-dock${visible ? " is-visible" : ""}`} aria-hidden={!visible}>
        <a
          href={`/s/${selected.id}?placement=sponsor_mobile`}
          target="_blank"
          rel="sponsored noopener"
          tabIndex={visible ? 0 : -1}
          aria-label={`Sponsored: visit ${selected.productName} (opens in a new tab)`}
        >
          <ProductLogo imageUrl={selected.logoUrl} productUrl={selected.productUrl} productName={selected.productName} className="mobile-sponsor-logo" />
          <span className="mobile-sponsor-copy">
            <span className="sponsored-label">Sponsored</span>
            <strong>{selected.productName}</strong>
            {selected.description ? <span>{selected.description}</span> : null}
          </span>
        </a>
        <button
          type="button"
          aria-label="Dismiss sponsored product for this session"
          tabIndex={visible ? 0 : -1}
          onClick={() => {
            setDismissed(true);
            try { window.sessionStorage.setItem(DOCK_DISMISSED_KEY, "1"); } catch {}
          }}
        >×</button>
    </aside>
  );
}

export function SponsoredProducts({
  slots,
  nowIso,
  suppressMobileDock = false,
}: {
  slots: SponsorSlot[];
  nowIso: string;
  suppressMobileDock?: boolean;
}) {
  const [modalPosition, setModalPosition] = useState<SponsorPosition | null>(null);
  const active = useMemo(() => slots.flatMap((slot) => slot.active ? [slot.active] : []), [slots]);
  const available = slots.filter((slot) => !slot.active && !slot.reservedUntil);
  const nearestEnd = active.length === 4
    ? [...active].sort((a, b) => a.endsAt.localeCompare(b.endsAt))[0]?.endsAt
    : null;

  return (
    <section className="sponsors-section" aria-labelledby="sponsors-title">
      <div className="sponsors-heading">
        <h2 id="sponsors-title">Sponsored products</h2>
        <p>Temporary exposure, separate from leaderboard rank.</p>
      </div>
      <div className="desktop-sponsor-list">
        {slots.map((slot) => slot.active ? (
          <ActiveSponsorCard key={slot.position} campaign={slot.active} nowIso={nowIso} />
        ) : (
          <button
            key={slot.position}
            type="button"
            className="sponsor-card sponsor-card-available"
            disabled={slot.prices[7] === null || Boolean(slot.reservedUntil)}
            onClick={() => {
              setModalPosition(slot.position);
            }}
          >
            <span className="sponsor-plus" aria-hidden="true">+</span>
            <span className="sponsor-card-copy">
              <strong>{slot.reservedUntil ? "Checkout in progress" : "Sponsor this spot"}</strong>
              <span>Position {slot.position} · {money(slot.prices[7], slot.currency)} / 7 days</span>
              <span className="sponsor-description">{SPONSOR_POSITION_CONFIG[slot.position].visibility}</span>
            </span>
          </button>
        ))}
        {nearestEnd ? (
          <p className="sponsors-sold-out">All positions are occupied. The nearest is expected to reopen <time dateTime={nearestEnd}>{new Date(nearestEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time>.</p>
        ) : null}
      </div>

      <button
        type="button"
        className="mobile-promote-card"
        disabled={!available.length}
        onClick={() => setModalPosition(available[0]?.position ?? null)}
      >
        <span aria-hidden="true">+</span>
        <span><strong>{available.length ? "Promote your product" : "Sponsored positions sold out"}</strong><small>{available.length ? "Choose an available sponsored position" : nearestEnd ? `Nearest opening ${new Date(nearestEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Check back soon"}</small></span>
      </button>

      {modalPosition ? <SponsorModal slots={slots} selectedPosition={modalPosition} onClose={() => setModalPosition(null)} /> : null}
      <MobileSponsorDock campaigns={active} suppress={suppressMobileDock} />
    </section>
  );
}

export function SponsorshipStatus({ sponsorshipId }: { sponsorshipId: string | null }) {
  const [message, setMessage] = useState(sponsorshipId ? "Confirming your sponsorship payment…" : null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!sponsorshipId) return;
    let stopped = false;
    let attempts = 0;
    let timer: number | null = null;
    const cleanUrl = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("sponsorship");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    };
    async function poll() {
      attempts += 1;
      try {
        const response = await fetch(`/api/sponsorship/status?id=${encodeURIComponent(sponsorshipId!)}`, { cache: "no-store" });
        const json = await response.json() as { ready?: boolean; status?: string; position?: number; productName?: string };
        if (stopped) return;
        if (json.ready) {
          setMessage(`${json.productName ?? "Your product"} is now active in sponsored position ${json.position}.`);
          setDone(true);
          cleanUrl();
          return;
        }
        if (["cancelled", "expired", "refunded"].includes(json.status ?? "")) {
          setMessage("This sponsorship is not active. No leaderboard position was changed.");
          setDone(true);
          cleanUrl();
          return;
        }
      } catch {}
      if (!stopped && attempts < 20) timer = window.setTimeout(poll, 1500);
      else if (!stopped) setMessage("Payment is still processing. Refresh this page in a moment.");
    }
    void poll();
    return () => { stopped = true; if (timer !== null) window.clearTimeout(timer); };
  }, [sponsorshipId]);
  if (!message) return null;
  return <div className={`purchase-status${done ? " done" : ""}`} role="status" aria-live="polite">{message}</div>;
}
