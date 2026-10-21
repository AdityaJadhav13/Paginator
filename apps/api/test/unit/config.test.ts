import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config.ts";

function problems(env: Record<string, string>): string {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.message;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("config", () => {
  it("uses the development defaults when nothing is set", () => {
    expect(loadConfig({})).toMatchObject({
      host: "127.0.0.1",
      port: 8780,
      trustProxy: [],
      shutdownGraceSeconds: 10,
      logLevel: "info",
    });
  });

  it("reads every setting, and ignores the rest of the environment", () => {
    const env = {
      PGN_API_HOST: "0.0.0.0",
      PGN_API_PORT: "9000",
      PGN_TRUST_PROXY: "10.0.0.5,fd00:1234::/32",
      PGN_SHUTDOWN_GRACE_S: "0",
      PGN_LOG_LEVEL: "warn",
      HOME: "/home/someone",
    };
    expect(loadConfig(env)).toMatchObject({
      host: "0.0.0.0",
      port: 9000,
      trustProxy: ["10.0.0.5", "fd00:1234::/32"],
      shutdownGraceSeconds: 0,
      logLevel: "warn",
    });
    expect(loadConfig(env)).not.toHaveProperty("HOME");
  });

  it("lists every problem at once, in plain words", () => {
    const env = {
      PGN_API_PORT: "80a",
      PGN_TRUST_PROXY: "proxy.example.test",
      PGN_SHUTDOWN_GRACE_S: "601",
      PGN_LOG_LEVEL: "loud",
    };
    expect(problems(env)).toBe(
      [
        "The API's settings are not right:",
        "  - PGN_API_PORT must be a whole number from 1 to 65535",
        "  - PGN_TRUST_PROXY must be IP addresses or CIDR ranges; not proxy.example.test",
        "  - PGN_SHUTDOWN_GRACE_S must be a whole number from 0 to 600",
        "  - PGN_LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent",
      ].join("\n"),
    );
  });

  it.each([
    ["0.0.0.0/0", "0.0.0.0/0"],
    ["::/0", "::/0"],
    ["0.0.0.0/1,128.0.0.0/1", "0.0.0.0/1, 128.0.0.0/1"],
    ["10.0.0.0/7", "10.0.0.0/7"],
    ["2001:db8::/15", "2001:db8::/15"],
    ["::ffff:0:0/96", "::ffff:0:0/96"],
    ["::ffff:0.0.0.0/96", "::ffff:0.0.0.0/96"],
    ["::/80", "::/80"],
    ["10.0.0.5, ::ffff:0:0/97", "::ffff:0:0/97"],
    ["::ffff:10.0.0.0/103", "::ffff:10.0.0.0/103"],
  ])("refuses to trust a range that wide: %j", (proxy, named) => {
    expect(problems({ PGN_TRUST_PROXY: proxy })).toContain(
      "PGN_TRUST_PROXY must not trust a range wider than /8 for IPv4 (or ::ffff:…/104 written as IPv6) or /16 for " +
        `IPv6, nor one holding ::ffff:0:0/96: ranges this wide are refused; not ${named}`,
    );
  });

  it("accepts proxies and ranges no wider than that", () => {
    const proxies = [
      "10.0.0.0/8",
      "2001:db8::/16",
      "fd00:1234::/32",
      "::ffff:10.0.0.0/104",
      "::ffff:10.0.0.1",
      "127.0.0.1",
    ];
    expect(loadConfig({ PGN_TRUST_PROXY: proxies.join(",") }).trustProxy).toEqual(proxies);
  });

  it.each(["0", "65536", "-1", "8780.5", "", " 8780"])("refuses the port %j", (port) => {
    expect(problems({ PGN_API_PORT: port })).toContain("PGN_API_PORT must be a whole number from 1 to 65535");
  });
});

describe("config: security settings", () => {
  it("defaults to the development web app's origin and 60 requests a minute", () => {
    expect(loadConfig({})).toMatchObject({ allowedOrigins: ["http://127.0.0.1:5180"], rateLimitPerMinute: 60 });
  });

  it("reads a list of origins and the limit", () => {
    const env = {
      PGN_ALLOWED_ORIGINS: "https://app.example.test, http://127.0.0.1:5180",
      PGN_RATE_LIMIT_PER_MINUTE: "300",
    };
    expect(loadConfig(env)).toMatchObject({
      allowedOrigins: ["https://app.example.test", "http://127.0.0.1:5180"],
      rateLimitPerMinute: 300,
    });
  });

  it.each(["https://app.example.test/", "app.example.test", "ftp://files.example.test", "null"])(
    "refuses the origin %j",
    (origin) => {
      expect(problems({ PGN_ALLOWED_ORIGINS: origin })).toContain("PGN_ALLOWED_ORIGINS must be origins");
    },
  );

  it("names the entries that are not origins, and needs at least one", () => {
    expect(problems({ PGN_ALLOWED_ORIGINS: "https://app.example.test/desk,http://127.0.0.1:5180" })).toContain(
      "  - PGN_ALLOWED_ORIGINS must be origins such as https://app.example.test (no path); not https://app.example.test/desk",
    );
    expect(problems({ PGN_ALLOWED_ORIGINS: " , " })).toContain("PGN_ALLOWED_ORIGINS must name at least one origin");
    expect(problems({ PGN_RATE_LIMIT_PER_MINUTE: "0" })).toContain(
      "PGN_RATE_LIMIT_PER_MINUTE must be a whole number from 1 to 100000",
    );
  });
});
