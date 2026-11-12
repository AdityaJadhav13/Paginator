// Passwords are kept as argon2id hashes (doc 11 §1), made by Node's own crypto.argon2 (no extra package), in the PHC
// string format the reference implementation writes: $argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>, in base64 without
// padding. New hashes use OWASP's argon2id minimum: 19 MiB of memory, 2 passes, 1 lane. Better Auth calls these
// through emailAndPassword.password.
import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

type Cost = { memory: number; passes: number; parallelism: number };
export const COST: Readonly<Cost> = { memory: 19_456, passes: 2, parallelism: 1 };
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const PHC =
  /^\$argon2id\$v=19\$m=([0-9]{1,7}),t=([0-9]{1,3}),p=([0-9]{1,3})\$([A-Za-z0-9+/]{11,88})\$([A-Za-z0-9+/]{22,88})$/;

const unpadded = (bytes: Buffer) => bytes.toString("base64").replace(/=+$/, "");

function derive(password: string, salt: Buffer, cost: Cost, tagLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", { message: password, nonce: salt, ...cost, tagLength }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, COST, HASH_BYTES);
  return `$argon2id$v=19$m=${COST.memory},t=${COST.passes},p=${COST.parallelism}$${unpadded(salt)}$${unpadded(hash)}`;
}

/** True only for the right password. A hash that is not one of ours (another format, or a cost far outside what we
 * make, which could make one sign-in very slow) is false, never an error. */
export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const parts = PHC.exec(hash);
  if (!parts) return false;
  const cost = { memory: Number(parts[1]), passes: Number(parts[2]), parallelism: Number(parts[3]) };
  const fair =
    cost.memory >= 8 * cost.parallelism &&
    cost.memory <= 262_144 &&
    cost.passes >= 1 &&
    cost.passes <= 10 &&
    cost.parallelism >= 1 &&
    cost.parallelism <= 8;
  if (!fair) return false;
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");
  if (salt.length < 8 || expected.length < 16 || expected.length > 64) return false;
  const actual = await derive(password, salt, cost, expected.length);
  return timingSafeEqual(actual, expected);
}
