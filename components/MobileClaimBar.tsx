"use client";

import { useEffect, useState } from "react";
import { useBid } from "@/components/BidProvider";
import { focusClaimForm } from "@/lib/scroll-to-claim";

/** Mobile-only sticky CTA that mirrors the claim form's submit button once it scrolls out of view. */
export function MobileClaimBar() {
  const [visible, setVisible] = useState(false);
  const { bidCents, rank } = useBid();

  useEffect(() => {
    const form = document.getElementById("claim");
    if (!form) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting), { threshold: 0 });
    observer.observe(form);
    return () => observer.disconnect();
  }, []);

  return (
    <button type="button" className={`mobile-claim-bar${visible ? " is-visible" : ""}`} onClick={focusClaimForm}>
      Take #{rank} for ${bidCents / 100}
    </button>
  );
}
