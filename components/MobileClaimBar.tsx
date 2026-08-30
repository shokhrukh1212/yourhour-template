"use client";

import { useEffect, useState } from "react";
import { useBid } from "@/components/BidProvider";

/** Mobile-only sticky CTA that mirrors the claim form's submit button once it scrolls out of view. */
export function MobileClaimBar() {
  const [passedClaim, setPassedClaim] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [sponsorDockVisible, setSponsorDockVisible] = useState(false);
  const { chooseTopBid, topMinimumBidCents } = useBid();

  useEffect(() => {
    const form = document.getElementById("claim");
    if (!form) return;
    const observer = new IntersectionObserver(([entry]) => {
      setPassedClaim(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
    }, { threshold: 0 });
    observer.observe(form);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const readOverlayState = () => setOverlayOpen(Boolean(document.querySelector(
      '.menu-button[aria-expanded="true"], dialog[open], [role="dialog"][aria-modal="true"]',
    )));
    readOverlayState();
    const observer = new MutationObserver(readOverlayState);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-expanded", "aria-modal", "open"],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const update = (event: Event) => {
      setSponsorDockVisible(Boolean((event as CustomEvent<{ visible?: boolean }>).detail?.visible));
    };
    window.addEventListener("yourhour:sponsor-dock", update);
    return () => window.removeEventListener("yourhour:sponsor-dock", update);
  }, []);

  const visible = passedClaim && !overlayOpen && !sponsorDockVisible;

  return (
    <button
      type="button"
      className={`mobile-claim-bar${visible ? " is-visible" : ""}`}
      aria-controls="product-url"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={() => { setPassedClaim(false); chooseTopBid(); }}
    >
      Take #1 for ${topMinimumBidCents / 100}
    </button>
  );
}
