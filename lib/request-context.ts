export type RequestAnalyticsContext = {
  device: "mobile" | "desktop";
  browser: string;
  country: string | null;
};

export function requestAnalyticsContext(request: Request): RequestAnalyticsContext {
  const userAgent = request.headers.get("user-agent") ?? "";
  return {
    device: /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ? "mobile" : "desktop",
    browser: browserName(userAgent),
    country: cleanCountry(request.headers.get("x-vercel-ip-country") ?? request.headers.get("cf-ipcountry")),
  };
}

function browserName(userAgent: string): string {
  if (/Twitter for|TwitterAndroid|Twitter-iPhone|X\//i.test(userAgent)) return "X in-app browser";
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/CriOS\//i.test(userAgent)) return "Chrome iOS";
  if (/Chrome\//i.test(userAgent)) return "Chrome";
  if (/FxiOS\//i.test(userAgent)) return "Firefox iOS";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "Other";
}

function cleanCountry(value: string | null): string | null {
  const country = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}
