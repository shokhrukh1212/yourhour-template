import Link from "next/link";
import { Logo } from "@/components/Logo";

export function Footer() {
  return (
    <footer className="landing-shell grid min-h-[120px] items-center gap-5 py-8 text-xs text-faint sm:grid-cols-[1fr_auto] lg:grid-cols-[1fr_auto_1fr]">
      <Link href="/#now" className="inline-flex items-center gap-2.5 text-[17px] font-bold tracking-[-.035em] text-foreground">
        <Logo className="h-[25px] w-[25px]" />
        <span>
          yourhour<span className="text-faint">.lol</span>
        </span>
      </Link>
      <p className="hidden lg:block">One product owns the homepage every hour.</p>
      <nav className="flex flex-wrap gap-5 sm:justify-end">
        <a href="#wall" className="hover:text-foreground">
          Leaderboard
        </a>
        <a href="#hours" className="hover:text-foreground">
          Hours
        </a>
        <Link href="/rules" className="hover:text-foreground">
          Rules
        </Link>
        <a
          href="https://x.com/shokhkarim1212"
          target="_blank"
          rel="noopener"
          className="hover:text-foreground"
        >
          X / Twitter
        </a>
      </nav>
    </footer>
  );
}
