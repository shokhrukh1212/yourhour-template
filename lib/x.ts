import { createHmac } from "node:crypto";
import OAuth from "oauth-1.0a";
import { config, isXConfigured } from "./config";
import { query } from "./db";
import { xPostCounterKey } from "./counters";
import { formatPrice } from "./pricing";

const TWEETS_ENDPOINT = "https://api.x.com/2/tweets";

/**
 * X removed the free tier for new developers in February 2026. Posting is pay-per-use
 * and a post CONTAINING A LINK costs $0.20 (versus $0.015 without). The board posts one
 * link per sold hour, so spend is capped in the database before any request is made.
 */
export async function tryConsumeDailyBudget(): Promise<boolean> {
  const rows = await query<{ value: string }>(
    `INSERT INTO counters (key, value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
       WHERE counters.value < $2
     RETURNING value::text AS value`,
    [xPostCounterKey(), config.x.dailyPostCap],
  );
  return rows.length > 0;
}

async function refundDailyBudget(): Promise<void> {
  await query(
    `UPDATE counters SET value = GREATEST(value - 1, 0) WHERE key = $1`,
    [xPostCounterKey()],
  );
}

export function buildAnnouncement(input: {
  displayName: string;
  pitch: string | null;
  slotId: string;
  /** The Nth hour to go live, assigned when this post is sent. */
  postNumber: number;
  xHandle: string | null;
  /** Set when somebody else paid for this hour. Credits them beside the recipient. */
  gifterHandle?: string | null;
  /** How many consecutive hours this ONE post covers. 1 for an ordinary hour. */
  blockHours?: number;
  pricePaid: number | null;
  nextPrice: number;
}): string {
  const link = `${config.siteUrl}/r/${input.slotId}`;
  const excerpt = input.pitch?.split(/(?<=[.!?])\s/)[0]?.trim();
  const owner = input.xHandle ?? input.displayName;

  // A block of consecutive hours is one sale and gets one post, so the copy has to
  // describe the whole run rather than repeat itself once an hour.
  const hours = Math.max(1, input.blockHours ?? 1);
  const subject = hours > 1 ? `The next ${hours} hours belong to` : "This hour belongs to";
  const verb = hours > 1 ? `the next ${hours} hours` : "the next 60 minutes";

  const lines = [
    `⚡ YOURHOUR #${String(input.postNumber).padStart(3, "0")}`,
    "",
    input.gifterHandle
      ? `${subject} ${owner} — gifted by ${input.gifterHandle}.`
      : `${subject} ${owner}.`,
  ];
  if (excerpt) lines.push("", `“${excerpt}”`);
  lines.push("", `The only product on our homepage for ${verb}.`);

  // The climbing price is the story. Showing both numbers makes early buyers look smart.
  // pricePaid is what THIS POST covers: one hour's share, or a whole block's total when
  // the post covers the block -- so the number always matches the airtime named above it.
  //
  // nextPrice is what the next OPEN hour actually costs, tier and clearance included,
  // rather than the base floor. It is worded "open" because under peak pricing the
  // literal next hour is often sold, and quoting a price nobody can buy helps no one.
  if (input.pricePaid) {
    lines.push(
      "",
      `They paid ${formatPrice(input.pricePaid)}. The next open hour costs ${formatPrice(input.nextPrice)}.`,
    );
  }

  lines.push(
    "",
    `Live now → ${link}`,
    "",
    "—",
    "",
    "Powered by YourHour",
    "yourhour.lol",
  );
  return lines.join("\n");
}

export type PostResult =
  | { ok: true; id: string }
  | { ok: false; reason: "disabled" | "capped" | "error"; detail?: string };

export async function postAnnouncement(text: string): Promise<PostResult> {
  if (!isXConfigured()) return { ok: false, reason: "disabled" };

  if (!(await tryConsumeDailyBudget())) {
    console.warn(`X daily post cap of ${config.x.dailyPostCap} reached; skipping`);
    return { ok: false, reason: "capped" };
  }

  const oauth = new OAuth({
    consumer: { key: config.x.apiKey, secret: config.x.apiSecret },
    signature_method: "HMAC-SHA1",
    hash_function(base, key) {
      return createHmac("sha1", key).update(base).digest("base64");
    },
  });

  // The JSON body is not part of an OAuth 1.0a signature base string; only method and URL.
  const authHeader = oauth.toHeader(
    oauth.authorize(
      { url: TWEETS_ENDPOINT, method: "POST" },
      { key: config.x.accessToken, secret: config.x.accessSecret },
    ),
  );

  try {
    const res = await fetch(TWEETS_ENDPOINT, {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      await refundDailyBudget();
      return { ok: false, reason: "error", detail: `${res.status} ${detail}` };
    }

    const json = (await res.json()) as { data?: { id?: string } };
    return { ok: true, id: json.data?.id ?? "unknown" };
  } catch (err) {
    await refundDailyBudget();
    return { ok: false, reason: "error", detail: (err as Error).message };
  }
}
