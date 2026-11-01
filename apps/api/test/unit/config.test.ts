import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadMigratorConfig } from "../../src/config.ts";
import { PASSWORDS } from "./helpers.ts";

/** The settings from env, with the database passwords that every test but theirs leaves aside. */
function load(env: Record<string, string>) {
  return loadConfig({ ...PASSWORDS, ...env });
}

function problems(env: Record<string, string>, read: (env: Record<string, string>) => unknown = load): string {
  try {
    read(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.message;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("config", () => {
  it("uses the development defaults when nothing is set", () => {
    expect(load({})).toMatchObject({
      host: "127.0.0.1",
      port: 8780,
      trustProxy: [],
      shutdownGraceSeconds: 10,
      logLevel: "info",
      engineSweep: { staleMs: 7_200_000, deadlineMs: 1_800_000 },
    });
    expect(load({ PGN_ENGINE_STALE_S: "3600", PGN_ENGINE_DEADLINE_S: "60" }).engineSweep).toEqual({
      staleMs: 3_600_000,
      deadlineMs: 60_000,
    });
    // never below the hour the database's policy waits before a locked spent job may be removed
    expect(problems({ PGN_ENGINE_STALE_S: "600" })).toContain("PGN_ENGINE_STALE_S must be a whole number from 3600");
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
    expect(load(env)).toMatchObject({
      host: "0.0.0.0",
      port: 9000,
      trustProxy: ["10.0.0.5", "fd00:1234::/32"],
      shutdownGraceSeconds: 0,
      logLevel: "warn",
    });
    expect(load(env)).not.toHaveProperty("HOME");
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
    expect(load({ PGN_TRUST_PROXY: proxies.join(",") }).trustProxy).toEqual(proxies);
  });

  it.each(["0", "65536", "-1", "8780.5", "", " 8780"])("refuses the port %j", (port) => {
    expect(problems({ PGN_API_PORT: port })).toContain("PGN_API_PORT must be a whole number from 1 to 65535");
  });
});

describe("config: security settings", () => {
  it("defaults to the development web app's origin and 60 requests a minute", () => {
    expect(load({})).toMatchObject({ allowedOrigins: ["http://127.0.0.1:5180"], rateLimitPerMinute: 60 });
  });

  it("reads a list of origins and the limit", () => {
    const env = {
      PGN_ALLOWED_ORIGINS: "https://app.example.test, http://127.0.0.1:5180",
      PGN_RATE_LIMIT_PER_MINUTE: "300",
    };
    expect(load(env)).toMatchObject({
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

describe("config: database settings", () => {
  it("defaults to the development compose's database, and needs every password", () => {
    expect(load({}).database).toEqual({
      host: "127.0.0.1",
      port: 55432,
      name: "pageinator",
      passwords: { app: "test-app", auth: "test-auth", listen: "test-listen" },
    });
    expect(problems({}, loadConfig)).toBe(
      [
        "The API's settings are not right:",
        "  - PGN_APP_PASSWORD must be set: it is a password, so it has no default",
        "  - PGN_AUTH_PASSWORD must be set: it is a password, so it has no default",
        "  - PGN_LISTEN_PASSWORD must be set: it is a password, so it has no default",
        "  - PGN_AUTH_SECRET must be set: it is a secret, so it has no default",
      ].join("\n"),
    );
  });

  it("reads where the database is", () => {
    const env = { PGN_DB_HOST: "db.example.test", PGN_DB_PORT: "5432", PGN_DB_NAME: "kalpaniknagar" };
    expect(load(env).database).toMatchObject({ host: "db.example.test", port: 5432, name: "kalpaniknagar" });
    expect(problems({ PGN_DB_PORT: "0", PGN_DB_HOST: "", PGN_DB_NAME: "" })).toBe(
      [
        "The API's settings are not right:",
        "  - PGN_DB_HOST must not be empty",
        "  - PGN_DB_PORT must be a whole number from 1 to 65535",
        "  - PGN_DB_NAME must not be empty",
      ].join("\n"),
    );
  });

  it("refuses an empty or blank password, and never shows a password's value", () => {
    const message = problems({ PGN_APP_PASSWORD: "", PGN_AUTH_PASSWORD: " \t ", PGN_LISTEN_PASSWORD: "s3cret-listen" });
    expect(message).toBe(
      [
        "The API's settings are not right:",
        "  - PGN_APP_PASSWORD must not be empty or only white space",
        "  - PGN_AUTH_PASSWORD must not be empty or only white space",
      ].join("\n"),
    );
    expect(problems({ PGN_API_PORT: "x", PGN_APP_PASSWORD: "s3cret-app" })).not.toContain("s3cret");
  });

  it("the migration command needs only where the database is and the migrator's password", () => {
    expect(loadMigratorConfig({ PGN_MIGRATOR_PASSWORD: "test-migrator", PGN_APP_PASSWORD: "" })).toEqual({
      host: "127.0.0.1",
      port: 55432,
      name: "pageinator",
      password: "test-migrator",
    });
    expect(problems({}, loadMigratorConfig)).toBe(
      [
        "The migration command's settings are not right:",
        "  - PGN_MIGRATOR_PASSWORD must be set: it is a password, so it has no default",
      ].join("\n"),
    );
  });
});

describe("config: TLS to the database in production", () => {
  const rds = { NODE_ENV: "production", PGN_DB_HOST: "pgn-pilot.example.ap-south-1.rds.amazonaws.com" };
  it("refuses any PGSSLMODE but verify-full or verify-ca, in the API and the migration command", () => {
    for (const mode of ["disable", "no-verify", "require", "prefer"]) {
      expect(problems({ ...rds, PGSSLMODE: mode })).toBe(
        `The API's settings are not right:\n  - PGSSLMODE must be verify-full or verify-ca in production, not ${mode}`,
      );
    }
    expect(problems(rds)).toContain("PGSSLMODE must be verify-full or verify-ca in production, not unset");
    expect(problems({ ...rds, PGN_MIGRATOR_PASSWORD: "m", PGSSLMODE: "disable" }, loadMigratorConfig)).toContain(
      "PGSSLMODE must be verify-full",
    );
    expect(load({ ...rds, PGSSLMODE: "verify-full" }).database.host).toBe(rds.PGN_DB_HOST);
    expect(load({ ...rds, PGSSLMODE: "verify-ca" }).database.host).toBe(rds.PGN_DB_HOST);
  });

  it("lets a database on this machine or pilot-local's scratch one go without TLS, and development anything", () => {
    for (const host of ["127.0.0.1", "localhost", "db-local"]) {
      expect(load({ NODE_ENV: "production", PGN_DB_HOST: host, PGSSLMODE: "disable" }).database.host).toBe(host);
    }
    expect(load({ PGN_DB_HOST: rds.PGN_DB_HOST, PGSSLMODE: "disable" }).database.host).toBe(rds.PGN_DB_HOST);
  });
});

describe("config: sign-in and email settings", () => {
  it("defaults to the first allowed origin, Mailpit, and a sender at example.test", () => {
    const config = load({ PGN_ALLOWED_ORIGINS: "https://app.example.test, http://127.0.0.1:5180" });
    expect(config.publicOrigin).toBe("https://app.example.test");
    expect(config.authSecret).toBe(PASSWORDS.PGN_AUTH_SECRET);
    expect(config.mail).toEqual({
      host: "127.0.0.1",
      port: 51025,
      tls: "none",
      from: "Pageinator <no-reply@example.test>",
    });
  });

  it("needs the public origin among the allowed origins, and a secret of at least 32 characters", () => {
    const secret = "s3cret-too-short";
    const message = problems({ PGN_PUBLIC_ORIGIN: "https://elsewhere.example.test", PGN_AUTH_SECRET: secret });
    expect(message).toContain("  - PGN_AUTH_SECRET must be at least 32 characters");
    expect(message).toContain("  - PGN_PUBLIC_ORIGIN must be one of PGN_ALLOWED_ORIGINS");
    expect(message).not.toContain(secret);
    expect(problems({ PGN_PUBLIC_ORIGIN: "https://app.example.test/path" })).toContain(
      "PGN_PUBLIC_ORIGIN must be an origin",
    );
  });

  it("uses STARTTLS for a mail server elsewhere, and refuses to send in the clear to it", () => {
    expect(load({ PGN_SMTP_HOST: "smtp.example.test", PGN_SMTP_PORT: "587" }).mail).toMatchObject({ tls: "starttls" });
    expect(load({ PGN_SMTP_HOST: "smtp.example.test", PGN_SMTP_TLS: "implicit" }).mail).toMatchObject({
      tls: "implicit",
    });
    expect(problems({ PGN_SMTP_HOST: "smtp.example.test", PGN_SMTP_TLS: "none" })).toContain(
      "  - PGN_SMTP_TLS may be none only for a server on this machine",
    );
  });

  it("takes a mail server's user and password together, and never shows the password", () => {
    const pass = "s3cret-smtp-pass";
    expect(load({ PGN_SMTP_USER: "desk", PGN_SMTP_PASSWORD: pass }).mail).toMatchObject({
      auth: { user: "desk", pass },
    });
    const message = problems({ PGN_SMTP_USER: "desk" });
    expect(message).toContain("  - PGN_SMTP_USER and PGN_SMTP_PASSWORD go together");
    expect(problems({ PGN_SMTP_PASSWORD: pass })).not.toContain(pass);
  });

  it.each(["Pageinator <no-reply@example.test>", "no-reply@example.test"])("accepts the sender %j", (from) => {
    expect(load({ PGN_MAIL_FROM: from }).mail.from).toBe(from);
  });

  it.each(['"Pageinator" <no-reply@example.test>', "a@example.test, b@example.test", "Pageinator"])(
    "refuses the sender %j",
    (from) => {
      expect(problems({ PGN_MAIL_FROM: from })).toContain("PGN_MAIL_FROM must be an address, or a name and <address>");
    },
  );
});

describe("config: Better Auth's own variables", () => {
  it.each(["BETTER_AUTH_TELEMETRY", "BETTER_AUTH_TELEMETRY_ENDPOINT"])("refuses to start with %s set", (name) => {
    expect(problems({ [name]: "1" })).toContain(`  - ${name} must not be set: the API sends no telemetry`);
  });
  it.each([
    [
      "BETTER_AUTH_SECRETS",
      "1:a-rotated-secret-that-would-replace-ours-0123456789",
      "the sign-in secret is PGN_AUTH_SECRET",
    ],
    ["BETTER_AUTH_TRUSTED_ORIGINS", "https://evil.example.test", "the allowed origins are PGN_ALLOWED_ORIGINS"],
  ])("refuses to start with %s set", (name, value, why) => {
    expect(problems({ [name]: value })).toContain(`  - ${name} must not be set: ${why}`);
  });
});
