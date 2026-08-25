import type { CampaignProof } from "@/lib/campaigns";

export function ScreenwarProof({ proof }: { proof: CampaignProof }) {
  if (proof.purchased_clicks === null || proof.guaranteed_clicks_delivered === null) return null;
  const purchased = proof.purchased_clicks;
  const guaranteed = proof.guaranteed_clicks_delivered;
  const bonus = proof.bonus_clicks_delivered;
  const total = proof.total_clicks_delivered;
  return (
    <article className="buyer-proof relative overflow-hidden rounded-[26px] border border-violet/35 bg-[radial-gradient(circle_at_82%_12%,rgba(155,124,255,.22),transparent_38%),linear-gradient(145deg,#13151d,#0e1016)] p-6 sm:p-8">
      <div className="landing-grid-mask pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
      <div className="relative">
        <span className="landing-eyebrow">Delivered proof</span>
        <h2 className="mt-3 text-[clamp(28px,3vw,42px)] font-normal leading-[1.02] tracking-[-.05em]">
          Launch customer Screenwar prepaid for {purchased} visits and received {total} in total.
        </h2>
        <dl className="mt-7 grid grid-cols-3 gap-2 border-y border-border py-5 text-center">
          <div><dt className="text-[10px] uppercase tracking-[.12em] text-faint">Delivered</dt><dd className="mt-1 text-2xl font-semibold tabular">{guaranteed}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-[.12em] text-faint">Bonus</dt><dd className="mt-1 text-2xl font-semibold text-violet tabular">{bonus}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-[.12em] text-faint">Total</dt><dd className="mt-1 text-2xl font-semibold text-accent tabular">{total}</dd></div>
        </dl>
        <p className="mt-4 text-sm text-muted">Bonus visits are extra and are never charged for.</p>
      </div>
    </article>
  );
}
