import { type App, buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import type { Checks } from "../../src/http/health.ts";

export const ORIGIN = "https://app.example.test";
/** What the web app sends with every request that changes something. */
export const FROM_APP = { origin: ORIGIN, "x-pageinator": "1" } as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** The secrets the settings require: the database passwords (these tests never connect) and the sign-in secret. */
export const PASSWORDS = {
  PGN_APP_PASSWORD: "test-app",
  PGN_AUTH_PASSWORD: "test-auth",
  PGN_LISTEN_PASSWORD: "test-listen",
  PGN_AUTH_SECRET: "test-only-sign-in-secret-0123456789abcdef",
} as const;

export function testApp(env: Record<string, string> = {}, checks: Checks = {}): Promise<App> {
  const config = loadConfig({ PGN_LOG_LEVEL: "silent", PGN_ALLOWED_ORIGINS: ORIGIN, ...PASSWORDS, ...env });
  return buildApp({ config, checks });
}
