/**
 * Account → Security over Better Auth's own endpoints (docs/product/10-l2-newsroom-plan.md §4.4–4.5, §5.2): the
 * twoFactor plugin's enable, verify-totp (which turns two-step on, and with it ends every other session), disable and
 * generate-backup-codes, and the session list. Each change that matters carries the password.
 */
import type { ApiProblem, DeviceDto, SecurityService, ServiceResult } from "../services/index.ts";
import { isObject, type ApiClient } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

function codesFrom(value: unknown): string[] | undefined {
  if (!isObject(value) || !Array.isArray(value["backupCodes"])) return undefined;
  const codes = value["backupCodes"].filter((code): code is string => typeof code === "string");
  return codes.length > 0 ? codes : undefined;
}

function devicesFrom(value: unknown, currentId: string | null): DeviceDto[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const devices: DeviceDto[] = [];
  for (const item of value) {
    if (!isObject(item)) return undefined;
    const { token, id, createdAt, updatedAt, userAgent, ipAddress } = item;
    if (typeof token !== "string" || typeof id !== "string" || typeof createdAt !== "string" || typeof updatedAt !== "string") {
      return undefined;
    }
    devices.push({
      token,
      id,
      userAgent: typeof userAgent === "string" && userAgent !== "" ? userAgent : null,
      ipAddress: typeof ipAddress === "string" && ipAddress !== "" ? ipAddress : null,
      signedInAt: createdAt,
      lastActiveAt: updatedAt,
      current: id === currentId,
    });
  }
  return devices;
}

export function createApiSecurityService(client: ApiClient): SecurityService {
  async function done(path: string, body: unknown): Promise<ServiceResult<void, ApiProblem>> {
    const answer = await client.post(path, body);
    return answer.ok ? { ok: true, value: undefined } : { ok: false, error: answer.problem };
  }

  return {
    async startTwoStep({ password }) {
      const answer = await client.post("/api/auth/two-factor/enable", { password });
      if (!answer.ok) return { ok: false, error: answer.problem };
      const value = answer.value;
      const codes = codesFrom(value);
      const uri = isObject(value) && typeof value["totpURI"] === "string" ? value["totpURI"] : undefined;
      return uri?.startsWith("otpauth://totp/") && codes
        ? { ok: true, value: { totpUri: uri, backupCodes: codes } }
        : { ok: false, error: UNEXPECTED };
    },
    confirmTwoStep: ({ code }) => done("/api/auth/two-factor/verify-totp", { code: code.trim() }),
    turnOffTwoStep: ({ password }) => done("/api/auth/two-factor/disable", { password }),
    async newBackupCodes({ password }) {
      const answer = await client.post("/api/auth/two-factor/generate-backup-codes", { password });
      if (!answer.ok) return { ok: false, error: answer.problem };
      const codes = codesFrom(answer.value);
      return codes ? { ok: true, value: codes } : { ok: false, error: UNEXPECTED };
    },
    async listDevices() {
      const answer = await client.get("/api/auth/list-sessions");
      if (!answer.ok) return { ok: false, error: answer.problem };
      // which of them is this browser: its own session's id
      const here = await client.get("/api/auth/get-session");
      const session = here.ok && isObject(here.value) ? here.value["session"] : undefined;
      const currentId = isObject(session) && typeof session["id"] === "string" ? session["id"] : null;
      const devices = devicesFrom(answer.value, currentId);
      return devices ? { ok: true, value: devices } : { ok: false, error: UNEXPECTED };
    },
    signOutDevice: ({ token }) => done("/api/auth/revoke-session", { token }),
    signOutOtherDevices: () => done("/api/auth/revoke-other-sessions", {}),
  };
}
