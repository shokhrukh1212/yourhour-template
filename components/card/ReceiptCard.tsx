import type { PublicCampaign } from "@/lib/campaigns";
import { formatClickRate, formatPrice } from "@/lib/pricing";

export const CARD_SIZE = { width: 1200, height: 630 };
const INK = "#f5f6ef";
const DIM = "#686d79";
const LINE = "#252832";
const ACCENT = "#d7ff67";

export function ReceiptCard({ entry }: { entry: PublicCampaign }) {
  const name = entry.product_name.toUpperCase();
  const nameSize = name.length > 26 ? 52 : name.length > 18 ? 64 : name.length > 11 ? 74 : 86;
  const status = entry.status === "live" ? "LIVE NOW" : entry.status === "queued" ? "IN THE QUEUE" : "DELIVERED";
  const verified = entry.accounting_status !== "legacy_total_only" && entry.purchased_clicks !== null;
  return <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", background: "#101219", color: INK, padding: "52px 80px", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: DIM }}>yourhour.lol</div>
    <div style={{ display: "flex", flexGrow: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div style={{ display: "flex", fontSize: nameSize, fontWeight: 700, lineHeight: 1.1 }}>{name}</div>
      <div style={{ display: "flex", marginTop: 12, fontSize: 26, letterSpacing: 4, color: ACCENT }}>{status}</div>
      <div style={{ display: "flex", alignItems: "baseline", marginTop: 26 }}><span style={{ fontSize: 52, fontWeight: 600 }}>{entry.total_clicks_delivered.toLocaleString()}</span><span style={{ marginLeft: 8, fontSize: 30, color: DIM }}>{verified ? `total clicks · ${entry.purchased_clicks} purchased` : "total clicks received"}</span></div>
      <div style={{ display: "flex", marginTop: 12, fontSize: 28, color: DIM }}>{`Leaderboard rank #${entry.rank}`}</div>
    </div>
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}><div style={{ display: "flex", height: 1, width: "100%", background: LINE }} /><div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "flex-end", marginTop: 28 }}><div style={{ display: "flex", flexDirection: "column" }}><div style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: DIM }}>PAID</div><div style={{ display: "flex", marginTop: 8, fontSize: 64, fontWeight: 700 }}>{formatPrice(entry.amount_paid_cents)}</div></div><div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}><div style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: DIM }}>{verified ? "RATE" : "ACCOUNTING"}</div><div style={{ display: "flex", marginTop: 8, fontSize: verified ? 64 : 38, fontWeight: 700, color: ACCENT }}>{verified ? `${formatClickRate()} / CLICK` : "TOTAL RECEIVED"}</div></div></div></div>
  </div>;
}
