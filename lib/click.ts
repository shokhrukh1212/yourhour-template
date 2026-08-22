import { createHash } from "node:crypto";
import { config } from "./config";

/** Raw IPs are never stored. Spec section 7 dedupes on a hashed IP. */
export function hashIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip =
    forwarded.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return createHash("sha256").update(`${config.ipHashSalt}:${ip}`).digest("hex").slice(0, 32);
}
