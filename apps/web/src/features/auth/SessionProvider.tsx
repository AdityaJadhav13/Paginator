/**
 * Who is signed in, for every screen: the session service's answer (the real one over the API, or the test double),
 * then, where something provides it, the placeholder workspace's access for that person.
 *
 * Every operation is numbered; an answer that arrives after a newer operation began is dropped, so a slow sign-in
 * can never overwrite a later sign-out. A failed sign-in leaves the state as it was: the form shows why.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ApiProblem,
  ServiceError,
  ServiceResult,
  SessionDto,
  SessionService,
  SessionSnapshot,
  SignInInput,
  TwoStepInput,
  WorkspaceAccessDto,
  WorkspaceAccessError,
  WorkspaceAccessService,
} from "../../services/index.ts";

/** Why the session could not be read: the API's problem, or the placeholder workspace's error. */
export type SessionProblem =
  | { readonly source: "session"; readonly problem: ApiProblem }
  | { readonly source: "workspace"; readonly error: ServiceError };

export type SessionViewState =
  | { readonly status: "loading" }
  /** `expired`: the API ended the session (401 signed_out), not the person. */
  | { readonly status: "signed-out"; readonly expired: boolean }
  | {
      readonly status: "ready";
      readonly session: SessionDto;
      /** The placeholder workspace this person may open, or null (always null in the deployed app, until `/me`). */
      readonly workspace: WorkspaceAccessDto | null;
    }
  | { readonly status: "unavailable"; readonly reason: SessionProblem; readonly assertive: boolean };

interface SessionContextValue {
  readonly state: SessionViewState;
  readonly intentionalSignOut: boolean;
  /** Reads the session again, showing the loading state. */
  retry(): Promise<void>;
  /** Reads the session again quietly (after a confirmation link or a password reset). */
  refresh(): Promise<void>;
  /** Answers "two-step" when the password was right and a code comes next (TwoStepScreen). */
  signIn(input: SignInInput): Promise<ServiceResult<SessionSnapshot, ApiProblem>>;
  verifyTwoStep(input: TwoStepInput): Promise<ServiceResult<SessionSnapshot, ApiProblem>>;
  signOut(): Promise<ServiceResult<SessionSnapshot, ApiProblem>>;
  /** The API answered 401 signed_out: the session ended on the server. */
  expire(): void;
  selectOrganization(organizationId: string): Promise<ServiceResult<WorkspaceAccessDto, WorkspaceAccessError>>;
  selectPublication(
    organizationId: string,
    publicationId: string
  ): Promise<ServiceResult<WorkspaceAccessDto, WorkspaceAccessError>>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** An error of the workspace's access: the API's problem (from /me), or the placeholder workspace's own. */
function workspaceReason(error: WorkspaceAccessError): SessionProblem {
  return "kind" in error ? { source: "session", problem: error } : { source: "workspace", error };
}

/** A workspace choice with no signed-in person (or no workspace): the API's own answer for it. */
const NOT_SIGNED_IN: ApiProblem = { kind: "answer", status: 401, code: "signed_out", message: "" };

export interface SessionProviderProps {
  readonly session: SessionService;
  /** The placeholder workspace's access; without it, a signed-in person has no workspace. */
  readonly access?: WorkspaceAccessService;
  readonly invalidatePendingMutations?: () => void;
  /** Subscribes to the API's 401 signed_out answers (ServiceEnvironment.onSignedOut). */
  readonly onSignedOut?: (listener: () => void) => () => void;
  readonly children: ReactNode;
}

export function SessionProvider({
  session,
  access,
  invalidatePendingMutations,
  onSignedOut,
  children,
}: SessionProviderProps) {
  const [state, setState] = useState<SessionViewState>({ status: "loading" });
  const [intentionalSignOut, setIntentionalSignOut] = useState(false);
  const requestRef = useRef(0);
  const mountedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const isCurrent = useCallback(
    (request: number) => mountedRef.current && request === requestRef.current,
    []
  );

  /** The state a session snapshot leads to, unless a newer operation began meanwhile. */
  const settle = useCallback(
    async (snapshot: SessionSnapshot, request: number, assertive: boolean) => {
      if (!isCurrent(request)) return;
      if (snapshot.status !== "signed-in") {
        // signed out, or a sign-in still waiting for its two-step code: no session yet
        setState({ status: "signed-out", expired: false });
        return;
      }
      if (!access) {
        setState({ status: "ready", session: snapshot.session, workspace: null });
        return;
      }
      const result = await access.getAccess({ userId: snapshot.session.user.id });
      if (!isCurrent(request)) return;
      setState(
        result.ok
          ? { status: "ready", session: snapshot.session, workspace: result.value }
          : { status: "unavailable", reason: workspaceReason(result.error), assertive }
      );
    },
    [access, isCurrent]
  );

  const load = useCallback(
    async (options: { readonly assertive: boolean; readonly invalidate: boolean; readonly showLoading: boolean }) => {
      const request = ++requestRef.current;
      if (options.invalidate) invalidatePendingMutations?.();
      if (options.showLoading && mountedRef.current) setState({ status: "loading" });
      const result = await session.getSession();
      if (!isCurrent(request)) return;
      if (!result.ok) {
        setState({
          status: "unavailable",
          reason: { source: "session", problem: result.error },
          assertive: options.assertive,
        });
        return;
      }
      await settle(result.value, request, options.assertive);
    },
    [invalidatePendingMutations, isCurrent, session, settle]
  );

  useEffect(() => {
    mountedRef.current = true;
    void load({ assertive: false, invalidate: false, showLoading: true });
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      invalidatePendingMutations?.();
    };
  }, [invalidatePendingMutations, load]);

  const expire = useCallback(() => {
    requestRef.current += 1;
    invalidatePendingMutations?.();
    setIntentionalSignOut(false);
    setState({ status: "signed-out", expired: true });
  }, [invalidatePendingMutations]);

  useEffect(() => onSignedOut?.(expire), [onSignedOut, expire]);

  const signIn = useCallback(
    async (input: SignInInput) => {
      setIntentionalSignOut(false);
      const request = ++requestRef.current;
      const result = await session.signIn(input);
      if (result.ok) await settle(result.value, request, true);
      return result;
    },
    [session, settle]
  );

  const verifyTwoStep = useCallback(
    async (input: TwoStepInput) => {
      setIntentionalSignOut(false);
      const request = ++requestRef.current;
      const result = await session.verifyTwoStep(input);
      if (result.ok) await settle(result.value, request, true);
      return result;
    },
    [session, settle]
  );

  const signOut = useCallback(async () => {
    setIntentionalSignOut(true);
    const request = ++requestRef.current;
    const result = await session.signOut();
    if (!isCurrent(request)) return result;
    if (!result.ok) {
      // still signed in: the control that asked shows why
      setIntentionalSignOut(false);
      return result;
    }
    setState({ status: "signed-out", expired: false });
    return result;
  }, [isCurrent, session]);

  const select = useCallback(
    async (change: (userId: string) => Promise<ServiceResult<WorkspaceAccessDto, WorkspaceAccessError>>) => {
      const current = stateRef.current;
      if (current.status !== "ready" || !current.workspace) {
        return { ok: false as const, error: { ...NOT_SIGNED_IN } };
      }
      const request = ++requestRef.current;
      setState({ status: "loading" });
      const result = await change(current.session.user.id);
      if (!isCurrent(request)) return result;
      setState(
        result.ok
          ? { status: "ready", session: current.session, workspace: result.value }
          : { status: "unavailable", reason: workspaceReason(result.error), assertive: true }
      );
      return result;
    },
    [isCurrent]
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      intentionalSignOut,
      retry: () => load({ assertive: true, invalidate: true, showLoading: true }),
      refresh: () => load({ assertive: true, invalidate: false, showLoading: false }),
      signIn,
      verifyTwoStep,
      signOut,
      expire,
      selectOrganization: (organizationId) =>
        access
          ? select((userId) => access.selectOrganization({ userId, organizationId }))
          : Promise.resolve({ ok: false, error: { ...NOT_SIGNED_IN } }),
      selectPublication: (organizationId, publicationId) =>
        access
          ? select((userId) => access.selectPublication({ userId, organizationId, publicationId }))
          : Promise.resolve({ ok: false, error: { ...NOT_SIGNED_IN } }),
    }),
    [access, expire, intentionalSignOut, load, select, signIn, signOut, state, verifyTwoStep]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession() called outside SessionProvider.");
  return value;
}

/**
 * The role to name for the person in the active organisation: Owner or Admin when they are one, otherwise their first
 * role on the active publication (or "member").
 */
export function activeRole(workspace: WorkspaceAccessDto): string {
  const org = workspace.organizations.find((candidate) => candidate.org.id === workspace.activeOrganizationId);
  if (!org) return "member";
  if (org.orgRole !== "member") return org.orgRole;
  const publication =
    org.publications.find((candidate) => candidate.id === workspace.activePublicationId) ?? org.publications[0];
  return publication?.roles[0] ?? "member";
}
