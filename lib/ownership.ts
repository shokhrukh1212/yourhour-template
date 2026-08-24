import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { config } from "./config";

export const OWNER_COOKIE = "yourhour_owner";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function newOwnerToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashOwnerToken(token: string): string {
  return createHash("sha256")
    .update(`${config.ipHashSalt}:owner:${token}`)
    .digest("hex");
}

export function ownerTokenFromRequest(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== OWNER_COOKIE) continue;
    const token = decodeURIComponent(rest.join("="));
    return TOKEN_PATTERN.test(token) ? token : null;
  }
  return null;
}

export async function ownerHashFromCookies(): Promise<string | null> {
  const token = (await cookies()).get(OWNER_COOKIE)?.value ?? "";
  return TOKEN_PATTERN.test(token) ? hashOwnerToken(token) : null;
}

export function ownerHashesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const ownerCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365 * 5,
};
