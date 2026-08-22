import { formatPrice } from "@/lib/pricing";
import type { WallEntryDetail } from "@/lib/wall";

export const CARD_SIZE = { width: 1200, height: 630 };

/** The site's dark palette. Hardcoded: satori has no CSS variables. */
const INK = "#f5f0ea";
const DIM = "#6f665b";
const LINE = "#2a231d";
const ACCENT = "#ff7a45";

const HOUR_MS = 60 * 60 * 1000;

function clock(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(at);
}

function day(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(at);
}

/**
 * The 1200x630 receipt a buyer posts. The bottom row is the reason it gets shared: the
 * gap between what they paid and what the top of the Wall costs now is the whole pitch,
 * so both numbers are set larger than anything else on the card except the name itself.
 *
 * Satori renders a strict flexbox subset -- every element with more than one child needs
 * an explicit display:flex, and there is no grid, float or CSS variable.
 */
export function ReceiptCard({
  entry,
  numberOneCents,
  upcoming,
}: {
  entry: WallEntryDetail;
  numberOneCents: number;
  /** True while the buyer's hour is still ahead of them. Decided by the caller: a
   *  component must not read the clock during render. */
  upcoming: boolean;
}) {
  const name = (entry.display_name ?? "yourhour").toUpperCase();
  // Long names would otherwise run off the frame; step down rather than truncate.
  // Sized against the vertical budget below, not just width: at 630px tall there is
  // only so much room between the wordmark and the price row.
  const nameSize = name.length > 26 ? 52 : name.length > 18 ? 64 : name.length > 11 ? 74 : 86;
  const clicks = entry.total_clicks.toLocaleString();

  const hours = entry.slots;
  const first = hours[0] ? new Date(hours[0].starts_at) : null;
  const last = hours[hours.length - 1]
    ? new Date(new Date(hours[hours.length - 1].starts_at).getTime() + HOUR_MS)
    : null;

  const headline = upcoming ? "is on The Wall" : "owned the homepage";
  const when =
    first && last ? `${clock(first)} – ${clock(last)} · ${day(first)} UTC` : "permanent";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#0e0c0a",
        color: INK,
        padding: "52px 80px",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: DIM }}>
        yourhour.lol
      </div>

      {/* flexGrow, not space-between: a tall name would otherwise ride up over the
          wordmark instead of taking the room left between the two fixed rows. */}
      <div
        style={{
          display: "flex",
          flexGrow: 1,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", fontSize: nameSize, fontWeight: 700, lineHeight: 1.1 }}>
          {name}
        </div>
        <div style={{ display: "flex", marginTop: 10, fontSize: 32, color: DIM }}>
          {headline}
        </div>
        <div style={{ display: "flex", marginTop: 20, fontSize: 28, color: DIM }}>
          {when}
        </div>
        <div style={{ display: "flex", marginTop: 26, fontSize: 52, fontWeight: 600 }}>
          {`${clicks} ${entry.total_clicks === 1 ? "click" : "clicks"}`}
        </div>
        <div style={{ display: "flex", marginTop: 12, fontSize: 28, color: DIM }}>
          {`Wall rank #${entry.rank}`}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <div style={{ display: "flex", height: 1, width: "100%", background: LINE }} />
        <div
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginTop: 28,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: DIM }}>
              PAID
            </div>
            <div style={{ display: "flex", marginTop: 8, fontSize: 64, fontWeight: 700 }}>
              {entry.amount_paid ? formatPrice(entry.amount_paid) : "—"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: DIM }}>
              #1 COSTS NOW
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 8,
                fontSize: 64,
                fontWeight: 700,
                color: ACCENT,
              }}
            >
              {formatPrice(numberOneCents)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
