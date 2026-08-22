import { Resend } from "resend";
import { config } from "./config";
import { formatPrice } from "./pricing";

let client: Resend | null = null;
function getClient(): Resend | null {
  if (!config.resend.apiKey) return null;
  if (!client) client = new Resend(config.resend.apiKey);
  return client;
}

type SlotEmail = {
  to: string;
  displayName: string;
  startsAt: Date;
  /** The permanent page, /u/{slug}. Never the numeric id -- that URL only redirects. */
  slug: string;
};

type CompletionEmail = SlotEmail & {
  clicks: number;
  pricePaid: number | null;
  boardPrice: number;
  /** Consecutive hours this summary covers. One sale, one email. */
  blockHours?: number;
};

/**
 * Just the clock time, for "starts at 2:00 AM" and the "from X to Y" range. The zone is
 * dropped on the opening half of a range so "UTC" is not printed twice in one sentence.
 */
function timeLabel(at: Date, withZone = true): string {
  return at.toLocaleString("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    ...(withZone ? { timeZoneName: "short" as const } : {}),
  });
}

/** Just the calendar day, for "through Aug 29". */
function dateLabel(at: Date): string {
  return at.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function hourLabel(startsAt: Date): string {
  return startsAt.toLocaleString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

async function send(to: string, subject: string, html: string): Promise<boolean> {
  const resend = getClient();
  if (!resend) {
    console.warn(`[email skipped: RESEND_API_KEY unset] to=${to} subject=${subject}`);
    return false;
  }
  try {
    const { error } = await resend.emails.send({
      from: config.resend.from,
      to,
      subject,
      html,
    });
    if (error) {
      console.error("resend error", error);
      return false;
    }
    return true;
  } catch (err) {
    // Email must never break a paid checkout.
    console.error("resend threw", err);
    return false;
  }
}

export async function sendConfirmation(
  slot: SlotEmail & { blockHours?: number; standingDays?: number; endsAt?: Date },
): Promise<boolean> {
  const url = `${config.siteUrl}/u/${slot.slug}`;
  const hours = slot.blockHours ?? 1;
  const days = slot.standingDays ?? 0;
  // A standing hour is one hour a day for N days, so "3 hours in a row" would be a lie.
  const span =
    days > 0
      ? `${timeLabel(slot.startsAt)} every day for ${days} days`
      : hours > 1
        ? `${hours} hours in a row`
        : "one hour";
  const plural = days > 0 || hours > 1;

  return send(
    slot.to,
    days > 0
      ? `Your standing hour is booked — ${days} days from ${hourLabel(slot.startsAt)}`
      : hours > 1
        ? `Your ${hours} hours are booked — from ${hourLabel(slot.startsAt)}`
        : `Your hour is booked — ${hourLabel(slot.startsAt)}`,
    `<div style="font-family:system-ui,sans-serif;line-height:1.6;max-width:520px">
      <h2 style="margin:0 0 16px">${plural ? "Your hours are" : "Your hour is"} locked in.</h2>
      <p><strong>${escapeHtml(slot.displayName)}</strong> owns the entire homepage of
      ${config.siteName} for ${span}, starting
      <strong>${hourLabel(slot.startsAt)}</strong>${
        days > 0 && slot.endsAt ? ` and running through <strong>${dateLabel(slot.endsAt)}</strong>` : ""
      }.</p>
      <p>Your permanent page: <a href="${url}">${url}</a></p>
      <p>You're on The Wall too, ranked by what you paid. That never resets.</p>
      <p>We'll email you again 30 minutes before ${plural ? "each hour" : "it"} starts so
      you're ready to post. The hour converts best when you send your own audience to it.</p>
      <p style="color:#888;font-size:13px">No refunds — you're buying a time slot.</p>
    </div>`,
  );
}

/**
 * Sent once, 30 minutes before the run begins. A block of consecutive hours gets ONE
 * reminder: a second one half an hour before its own second hour would arrive while the
 * buyer is already live.
 */
export async function sendReminder(
  slot: SlotEmail & { blockHours?: number },
): Promise<boolean> {
  const hours = Math.max(1, slot.blockHours ?? 1);
  const endsAt = new Date(slot.startsAt.getTime() + hours * 60 * 60 * 1000);

  return send(
    slot.to,
    `You're live in 30 minutes`,
    `<div style="font-family:system-ui,sans-serif;line-height:1.6;max-width:520px">
      <p>Your ${hours > 1 ? `${hours} hours` : "hour"} on ${config.siteName}.lol
      ${hours > 1 ? "start" : "starts"} at
      <strong>${timeLabel(slot.startsAt)}</strong>${
        hours > 1 ? ` and run until <strong>${timeLabel(endsAt)}</strong>` : ""
      }.</p>
      <p>We'll post about it from ${escapeHtml(config.x.handle)} the moment it begins.</p>
      <p>Have something ready to share — the ${
        hours > 1 ? "time" : "hour"
      } is worth more when you bring your own people.</p>
      <p><a href="${config.siteUrl}">${config.siteUrl}</a></p>
    </div>`,
  );
}

/**
 * Sent the moment the hour closes. The two prices side by side are the whole point:
 * what they paid, against what the same hour costs now.
 */
export async function sendHourComplete(slot: CompletionEmail): Promise<boolean> {
  const hours = Math.max(1, slot.blockHours ?? 1);
  const endsAt = new Date(slot.startsAt.getTime() + hours * 60 * 60 * 1000);
  const page = `${config.siteUrl}/u/${slot.slug}`;
  const clicks = `${slot.clicks.toLocaleString()} ${slot.clicks === 1 ? "click" : "clicks"}`;

  return send(
    slot.to,
    hours > 1 ? `Your ${hours} hours are done — ${clicks}` : `Your hour is done — ${clicks}`,
    `<div style="font-family:system-ui,sans-serif;line-height:1.6;max-width:520px">
      <p>You owned ${config.siteName}.lol from
      <strong>${timeLabel(slot.startsAt, false)}</strong> to
      <strong>${timeLabel(endsAt)}</strong>.</p>
      <p>You got <strong>${clicks}</strong>.</p>
      ${
        slot.pricePaid
          ? `<p>You paid <strong>${formatPrice(slot.pricePaid)}</strong>. An hour now costs
             <strong>${formatPrice(slot.boardPrice)}</strong>.</p>`
          : `<p>An hour now costs <strong>${formatPrice(slot.boardPrice)}</strong>.</p>`
      }
      <p>Your page is live forever: <a href="${page}">${page}</a></p>
      <p>Post that link and your card shows up automatically.</p>
      <p>Want another hour? <a href="${config.siteUrl}">${config.siteUrl}</a></p>
    </div>`,
  );
}

/**
 * Sent when an hour is bought for somebody else. Addressed to the recipient but
 * delivered to the BUYER -- their handle is all we have of them, never an inbox -- so
 * it closes with a line asking the buyer to pass it on.
 */
export async function sendGift(gift: {
  to: string;
  recipientHandle: string;
  gifterHandle: string;
  startsAt: Date;
  slug: string;
}): Promise<boolean> {
  const page = `${config.siteUrl}/u/${gift.slug}`;

  return send(
    gift.to,
    `Someone bought you an hour on yourhour.lol`,
    `<div style="font-family:system-ui,sans-serif;line-height:1.6;max-width:520px">
      <p>${escapeHtml(gift.gifterHandle)} bought you an hour on yourhour.lol.</p>
      <p>Your product owns the entire homepage on
      <strong>${dateLabel(gift.startsAt)}</strong> at
      <strong>${timeLabel(gift.startsAt)}</strong>.</p>
      <p>You didn't pay anything.</p>
      <p>We'll post about it from our account when your hour starts.</p>
      <p>Your permanent page: <a href="${page}">${page}</a></p>
      <p style="color:#888;font-size:13px">You're getting this because you paid for it —
      forward it to ${escapeHtml(gift.recipientHandle)}.</p>
    </div>`,
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
