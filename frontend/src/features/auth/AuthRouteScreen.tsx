import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button, InlineMessage, Stack } from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { activeRole, useSession } from "./SessionProvider.tsx";
import { SessionFailure, SessionLoading } from "./SessionStatus.tsx";

export type AuthRouteKind = "login" | "signup" | "forgot-password" | "verify";

const PUBLIC_OR_AUTH = new Set(["/", "/features", "/pricing", "/security", "/contact", "/login", "/signup", "/forgot-password", "/verify", "/onboarding"]);
const ORG_LEAF = /^(settings|billing|storage)$/;
const PUB_LEAF = /^(overview|editions|stories|media|ads|templates|newsroom|sources|archive|brand|print-profiles|team)$/;
const EDITION_LEAF = /^(content|generate|preflight|export|editor)$/;

export function safeReturnTo(value: string | null, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || PUBLIC_OR_AUTH.has(value)) return fallback;
  const parts = value.split("/").filter(Boolean);
  if (parts[0] !== "org" || !parts[1]) return fallback;
  if (parts.length === 3 && ORG_LEAF.test(parts[2] ?? "")) return value;
  if (parts[2] !== "pub" || !parts[3]) return fallback;
  if (parts.length === 5 && PUB_LEAF.test(parts[4] ?? "")) return value;
  if (parts[4] === "archive" && parts.length === 6 && parts[5]) return value;
  if (parts[4] === "editions" && parts[5] && parts.length === 6) return value;
  if (parts[4] === "editions" && parts[5] && parts.length === 7 && EDITION_LEAF.test(parts[6] ?? "")) return value;
  return fallback;
}

const TITLES: Record<AuthRouteKind, string> = {
  login: "Sign in",
  signup: "Sign up",
  "forgot-password": "Forgot password",
  verify: "Verify",
};

export function AuthRouteScreen({ kind }: { readonly kind: AuthRouteKind }) {
  const { state, signIn, signOut } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [recoveryPreviewed, setRecoveryPreviewed] = useState(false);

  if (state.status === "loading") return <SessionLoading />;
  if (state.status === "denied" || state.status === "temporary-failure") return <SessionFailure />;

  if (state.status === "ready") {
    const workspace = paths.pubOverview(state.session.activeOrganizationId, state.session.activePublicationId);
    return (
      <Stack gap="4">
        <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>Already using a simulated session</h1>
        <p>{state.user.displayName} · {activeRole(state.session)}</p>
        <div className="pg-auth-actions"><Button onClick={() => navigate(workspace)}>Open workspace</Button><Button variant="secondary" onClick={() => void signOut()}>Sign out</Button></div>
      </Stack>
    );
  }

  const activate = async (userId: string, destination?: string) => {
    const result = await signIn(userId);
    if (!result.ok || result.value.status !== "signed-in") return;
    const fallback = paths.pubOverview(result.value.session.activeOrganizationId, result.value.session.activePublicationId);
    const returnTo = new URLSearchParams(location.search).get("returnTo");
    navigate(destination ?? safeReturnTo(returnTo, fallback), { replace: true });
  };

  return (
    <Stack gap="5">
      <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>{TITLES[kind]}</h1>
      {kind === "login" && <>
        <h2 className="pg-type-section-title">Demonstration identity and role</h2>
        <p>Choose a fictional profile. No credentials are requested.</p>
        <div className="pg-auth-profiles">{state.profiles.map(({ user }) => <Button key={user.id} variant="secondary" onClick={() => void activate(user.id)}>{user.displayName}</Button>)}</div>
      </>}
      {kind === "signup" && <><p>This demonstration does not create an account.</p><div><Button onClick={() => void activate("user-demo-sahyadri-editor", paths.onboarding())}>Start fictional signup</Button></div></>}
      {kind === "verify" && <><p>No verification token or email is required.</p><div><Button onClick={() => void activate("user-demo-sahyadri-editor")}>Continue with verified fictional profile</Button></div></>}
      {kind === "forgot-password" && <>
        <p>No email address is collected and no recovery message will be sent.</p>
        <div><Button onClick={() => setRecoveryPreviewed(true)}>Preview fictional recovery</Button></div>
        {recoveryPreviewed && <InlineMessage variant="info" heading="Fictional recovery preview">No message was sent. Your simulated session remains signed out.</InlineMessage>}
      </>}
    </Stack>
  );
}
