import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** A browser where this account is signed in (Better Auth's list-sessions). */
export interface DeviceDto {
  /** What signs it out (revoke-session); kept in memory only, never shown. */
  readonly token: string;
  readonly id: string;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  /** ISO-8601: when it signed in, and when it was last used. */
  readonly signedInAt: string;
  readonly lastActiveAt: string;
  /** This browser's own session. */
  readonly current: boolean;
}

/** What turning two-step on starts with: the authenticator app's setup link, and the one-time backup codes. */
export interface TwoStepSetupDto {
  /** otpauth://totp/… (shown as a QR code, and its secret as text). */
  readonly totpUri: string;
  readonly backupCodes: readonly string[];
}

/**
 * Account → Security (03 §5.2, plan §4.4–4.5): two-step sign-in with an authenticator app, backup codes, and the
 * browsers where the account is signed in. Every change that matters asks for the password again.
 */
export interface SecurityService {
  /** Starts two-step: not on until confirmTwoStep accepts a code from the app. */
  startTwoStep(input: { readonly password: string }): Promise<ServiceResult<TwoStepSetupDto, ApiProblem>>;
  /** The first code from the app turns two-step on, and ends every other session of the account. */
  confirmTwoStep(input: { readonly code: string }): Promise<ServiceResult<void, ApiProblem>>;
  turnOffTwoStep(input: { readonly password: string }): Promise<ServiceResult<void, ApiProblem>>;
  /** New backup codes; the old ones stop working. */
  newBackupCodes(input: { readonly password: string }): Promise<ServiceResult<readonly string[], ApiProblem>>;
  listDevices(): Promise<ServiceResult<readonly DeviceDto[], ApiProblem>>;
  signOutDevice(input: { readonly token: string }): Promise<ServiceResult<void, ApiProblem>>;
  signOutOtherDevices(): Promise<ServiceResult<void, ApiProblem>>;
}
