"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";

const VISITOR_POLL_MS = 5_000;

export function SiteHeader({ initialVisitors }: { initialVisitors: number }) {
  const [open, setOpen] = useState(false);
  const [visitors, setVisitors] = useState(initialVisitors);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let controller: AbortController | null = null;

    const read = async (register: boolean) => {
      if (inFlight) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const response = await fetch(register ? "/api/visitors" : "/api/visitors?peek=1", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json() as { visitors?: number };
        if (active && typeof data.visitors === "number") setVisitors(data.visitors);
      } catch {
        // A transient network failure should not disturb the header; the next poll retries.
      } finally {
        inFlight = false;
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void read(false);
    };

    void read(true);
    const timer = window.setInterval(() => {
      refreshWhenVisible();
    }, VISITOR_POLL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return (
    <header className="site-header">
      <div className="site-shell site-header-inner">
        <Link href="/" className="brand" aria-label="YourHour home"><Logo className="brand-mark" /><span>YourHour</span></Link>
        <p className="visitor-total"><strong>{visitors.toLocaleString()}</strong> visitors so far</p>
        <nav className="desktop-nav" aria-label="Main navigation"><a href="#leaderboard">Leaderboard</a><Link href="/rules">Rules</Link><a className="nav-cta" href="https://bidindex.dev/submit" target="_blank" rel="noopener noreferrer">List on BidIndex — free ↗</a></nav>
        <button className="menu-button" type="button" aria-expanded={open} aria-controls="mobile-menu" aria-label="Toggle menu" onClick={() => setOpen((value) => !value)}><span /><span /><span /></button>
      </div>
      {open ? <nav id="mobile-menu" className="mobile-nav" aria-label="Mobile navigation"><a href="#leaderboard" onClick={() => setOpen(false)}>Leaderboard</a><Link href="/rules" onClick={() => setOpen(false)}>Rules</Link><a className="nav-cta" href="https://bidindex.dev/submit" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>BidIndex ↗</a></nav> : null}
    </header>
  );
}
