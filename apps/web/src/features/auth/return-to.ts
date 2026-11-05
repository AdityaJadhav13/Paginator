/**
 * Where sign-in may send a person back to (`?returnTo=`): only a known workspace route, or an invitation's page.
 * Anything else (another site, a public or sign-in page, a path the app does not have) falls back.
 */
import { paths } from "../../app/routes.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_LEAF = /^(settings|billing|storage|team)$/;
const PUB_LEAF = /^(overview|editions|stories|media|ads|templates|newsroom|sources|archive|brand|print-profiles|team)$/;
const EDITION_LEAF = /^(content|generate|preflight|export|editor)$/;

/** True for an invitation id as the API makes them (a UUID). */
export function isInvitationId(value: string): boolean {
  return UUID.test(value);
}

/** The screens in the interface language with the sign-in chrome (03 §5.1): sign-in, two-step, account security. */
export function isAuthPath(pathname: string): boolean {
  return (
    [
      paths.login(),
      paths.signup(),
      paths.forgotPassword(),
      paths.resetPassword(),
      paths.verify(),
      paths.twoStep(),
      paths.accountSecurity(),
    ].includes(pathname) || /^\/invite\/[^/]+$/.test(pathname)
  );
}

export function safeReturnTo(value: string | null, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("?") || value.includes("#")) return fallback;
  const parts = value.split("/").filter(Boolean);
  if (parts[0] === "invite" && parts.length === 2 && isInvitationId(parts[1] ?? "")) return value;
  if (value === paths.accountSecurity() || value === paths.onboarding()) return value;
  if (parts[0] !== "org" || !parts[1]) return fallback;
  if (parts.length === 2) return value;
  if (parts.length === 3 && ORG_LEAF.test(parts[2] ?? "")) return value;
  if (parts[2] !== "pub" || !parts[3]) return fallback;
  if (parts.length === 5 && PUB_LEAF.test(parts[4] ?? "")) return value;
  if (parts[4] === "archive" && parts.length === 6 && parts[5]) return value;
  if (parts[4] === "stories" && parts.length === 6 && parts[5]) return value;
  if (parts[4] === "editions" && parts[5] && parts.length === 6) return value;
  if (parts[4] === "editions" && parts[5] && parts.length === 7 && EDITION_LEAF.test(parts[6] ?? "")) return value;
  return fallback;
}
