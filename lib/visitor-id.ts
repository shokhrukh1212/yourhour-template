import { randomUUID } from "node:crypto";

export const VISITOR_COOKIE = "yourhour_visitor";
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AnonymousVisitor = { id: string; isNew: boolean };

export function visitorIdFromRequest(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== VISITOR_COOKIE) continue;
    const value = decodeURIComponent(rest.join("="));
    return UUID.test(value) ? value : null;
  }
  return null;
}

export function ensureVisitorId(request: Request): AnonymousVisitor {
  const existing = visitorIdFromRequest(request);
  return existing ? { id: existing, isNew: false } : { id: randomUUID(), isNew: true };
}

export const visitorCookieOptions = {
  httpOnly: true,
  maxAge: VISITOR_COOKIE_MAX_AGE,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

