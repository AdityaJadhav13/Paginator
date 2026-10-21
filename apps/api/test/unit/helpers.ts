import { type App, buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import type { Checks } from "../../src/http/health.ts";

export const ORIGIN = "https://app.example.test";
/** What the web app sends with every request that changes something. */
export const FROM_APP = { origin: ORIGIN, "x-pageinator": "1" } as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function testApp(env: Record<string, string> = {}, checks: Checks = {}): Promise<App> {
  return buildApp({ config: loadConfig({ PGN_LOG_LEVEL: "silent", ...env }), checks });
}
