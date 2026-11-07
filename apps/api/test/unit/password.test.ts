// The argon2id passwords (src/modules/identity/password.ts): Node's own argon2 against RFC 9106's test vector, the
// PHC strings we write and read, what verifying refuses, and that using it never prints a warning.
import { spawnSync } from "node:child_process";
import { argon2Sync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COST, hashPassword, verifyPassword } from "../../src/modules/identity/password.ts";

const MODULE = fileURLToPath(new URL("../../src/modules/identity/password.ts", import.meta.url));

describe("argon2id passwords", () => {
  it("Node's argon2id gives RFC 9106's test vector (§5.3)", () => {
    const tag = argon2Sync("argon2id", {
      message: Buffer.alloc(32, 0x01),
      nonce: Buffer.alloc(16, 0x02),
      secret: Buffer.alloc(8, 0x03),
      associatedData: Buffer.alloc(12, 0x04),
      memory: 32,
      passes: 3,
      parallelism: 4,
      tagLength: 32,
    });
    expect(tag.toString("hex")).toBe("0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659");
  });

  it("writes a PHC string with OWASP's argon2id minimum, and a new salt each time", async () => {
    const first = await hashPassword("काल्पनिकनगर-correct horse");
    const second = await hashPassword("काल्पनिकनगर-correct horse");
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(first).not.toBe(second);
    expect(COST).toEqual({ memory: 19_456, passes: 2, parallelism: 1 });
  });

  it("accepts the right password only", async () => {
    const hash = await hashPassword("काल्पनिकनगर-correct horse");
    expect(await verifyPassword({ hash, password: "काल्पनिकनगर-correct horse" })).toBe(true);
    expect(await verifyPassword({ hash, password: "काल्पनिकनगर-correct hors" })).toBe(false);
    expect(await verifyPassword({ hash, password: "" })).toBe(false);
  });

  it("reads a hash made with other costs, as the reference implementation writes them", async () => {
    const salt = Buffer.from("somesalt0123");
    const tag = argon2Sync("argon2id", {
      message: "password",
      nonce: salt,
      memory: 65_536,
      passes: 3,
      parallelism: 4,
      tagLength: 24,
    });
    const b64 = (bytes: Buffer) => bytes.toString("base64").replace(/=+$/, "");
    const hash = `$argon2id$v=19$m=65536,t=3,p=4$${b64(salt)}$${b64(tag)}`;
    expect(await verifyPassword({ hash, password: "password" })).toBe(true);
  });

  it.each([
    ["another format", "$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012"],
    [
      "argon2i, not argon2id",
      "$argon2i$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g",
    ],
    [
      "an older version",
      "$argon2id$v=16$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g",
    ],
    [
      "memory far above ours",
      "$argon2id$v=19$m=4194304,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g",
    ],
    [
      "too many passes",
      "$argon2id$v=19$m=19456,t=11,p=1$c29tZXNhbHRzb21lc2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g",
    ],
    [
      "memory below 8 per lane",
      "$argon2id$v=19$m=8,t=2,p=4$c29tZXNhbHRzb21lc2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g",
    ],
    ["a short salt", "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g"],
    ["padding", "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA==$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g"],
    ["nothing", ""],
  ])("refuses %s (false, never an error)", async (_why, hash) => {
    expect(await verifyPassword({ hash, password: "password" })).toBe(false);
  });

  it("never prints a warning (an experimental API would print one on first use)", () => {
    const script = `
      process.on("warning", (warning) => console.log("WARNING " + warning.name + ": " + warning.message));
      const { hashPassword, verifyPassword } = await import(${JSON.stringify(MODULE)});
      const hash = await hashPassword("x");
      console.log("verified " + (await verifyPassword({ hash, password: "x" })));`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    expect(child.stderr).toBe("");
    expect(child.stdout.trim()).toBe("verified true");
  });
});
