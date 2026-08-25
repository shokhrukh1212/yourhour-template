import { createHash } from "node:crypto";
import { config } from "./config";

export const VISITOR_RATE_LIMIT = 5;
export const IP_RATE_LIMIT = 20;
export const RATE_WINDOW_MINUTES = 10;

const BOT_USER_AGENT = /(?:\b(?:bot|crawler|spider|slurp)\b|googlebot|bingpreview|bingbot|duckduckbot|baiduspider|yandexbot|facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|skypeuripreview|embedly|quora link preview|pinterestbot)/i;

/** Raw IPs are never stored. Spec section 7 dedupes on a hashed IP. */
export function hashIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip =
    forwarded.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return createHash("sha256").update(`${config.ipHashSalt}:${ip}`).digest("hex").slice(0, 32);
}

export function requestUserAgent(request: Request): string {
  return (request.headers.get("user-agent") ?? "").trim().slice(0, 512);
}

export function isObviousBot(request: Request): boolean {
  const userAgent = requestUserAgent(request);
  if (!userAgent || BOT_USER_AGENT.test(userAgent)) return true;
  const purpose = `${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`;
  return /prefetch|preview/i.test(purpose);
}
