import { Vemetric } from "@vemetric/node";
import { config } from "./config";

let client: Vemetric | null = null;

function getClient(): Vemetric | null {
  if (!config.vemetric.token) return null;
  if (!client) client = new Vemetric({ token: config.vemetric.token });
  return client;
}

/**
 * Server-side conversion events. Complements the browser SDK, which handles pageviews.
 * Always fire-and-forget: analytics must never break a paid flow.
 */
export async function trackServerEvent(
  name: string,
  eventData?: Record<string, string | number | boolean>,
  userIdentifier?: string,
): Promise<void> {
  const vemetric = getClient();
  if (!vemetric) return;
  try {
    await vemetric.trackEvent(name, {
      userIdentifier: userIdentifier ?? "anonymous",
      eventData,
    });
  } catch (err) {
    console.error("vemetric event failed", err);
  }
}
