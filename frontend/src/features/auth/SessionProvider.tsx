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
  ServiceError,
  ServiceResult,
  SessionSnapshot,
  SimulatedRole,
  SimulatedSessionDto,
  SimulatedSessionService,
  UserDto,
  UserQueryService,
} from "../../services/index.ts";

export interface SimulatedProfileView {
  readonly user: UserDto;
}

export type SessionViewState =
  | { readonly status: "loading" }
  | { readonly status: "signed-out"; readonly profiles: readonly SimulatedProfileView[] }
  | {
      readonly status: "ready";
      readonly session: SimulatedSessionDto;
      readonly user: UserDto;
      readonly profiles: readonly SimulatedProfileView[];
    }
  | { readonly status: "denied"; readonly error: Extract<ServiceError, { code: "denied" }> }
  | {
      readonly status: "temporary-failure";
      readonly error: Extract<ServiceError, { code: "temporary-failure" }>;
      readonly assertive: boolean;
    };

interface SessionContextValue {
  readonly state: SessionViewState;
  readonly intentionalSignOut: boolean;
  retry(): Promise<void>;
  signIn(userId: string): Promise<ServiceResult<SessionSnapshot>>;
  signOut(): Promise<ServiceResult<SessionSnapshot>>;
  selectOrganization(organizationId: string): Promise<ServiceResult<SessionSnapshot>>;
  selectPublication(
    organizationId: string,
    publicationId: string
  ): Promise<ServiceResult<SessionSnapshot>>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function errorState(error: ServiceError, assertive: boolean): SessionViewState {
  if (error.code === "temporary-failure") {
    return { status: "temporary-failure", error, assertive };
  }
  if (error.code === "denied") return { status: "denied", error };
  return {
    status: "denied",
    error: {
      code: "denied",
      displayMessage: "This demonstration action is not available in the current context.",
      qualification: "Demonstration only — production authorization is not evaluated here",
    },
  };
}

export interface SessionProviderProps {
  readonly session: SimulatedSessionService;
  readonly users: UserQueryService;
  readonly invalidatePendingMutations?: () => void;
  readonly children: ReactNode;
}

export function SessionProvider({
  session,
  users,
  invalidatePendingMutations,
  children,
}: SessionProviderProps) {
  const [state, setState] = useState<SessionViewState>({ status: "loading" });
  const [intentionalSignOut, setIntentionalSignOut] = useState(false);
  const profilesRef = useRef<readonly SimulatedProfileView[]>([]);
  const requestRef = useRef(0);
  const mountedRef = useRef(false);

  const isCurrent = useCallback(
    (request: number) => mountedRef.current && request === requestRef.current,
    []
  );

  const resolveSnapshot = useCallback(
    async (snapshot: SessionSnapshot, request: number, assertive: boolean) => {
      // A superseded request must not keep issuing service calls: after
      // teardown, retry, or a newer mutation, further lookups are both
      // wasted work and a forbidden post-unmount side effect.
      if (!isCurrent(request)) return;
      let profiles = profilesRef.current;
      if (profiles.length === 0) {
        const profileResult = await session.listProfiles();
        if (!profileResult.ok) {
          if (isCurrent(request)) setState(errorState(profileResult.error, assertive));
          return;
        }
        const userResults = await Promise.all(
          profileResult.value.map((profile) => users.getUser({ userId: profile.userId }))
        );
        const failed = userResults.find((result) => !result.ok);
        if (failed && !failed.ok) {
          if (isCurrent(request)) setState(errorState(failed.error, assertive));
          return;
        }
        profiles = userResults.flatMap((result) =>
          result.ok ? [{ user: result.value }] : []
        );
        if (!isCurrent(request)) return;
        profilesRef.current = profiles;
      }

      if (snapshot.status === "signed-out") {
        if (isCurrent(request)) setState({ status: "signed-out", profiles });
        return;
      }

      if (!isCurrent(request)) return;
      const userResult = await users.getUser({ userId: snapshot.session.userId });
      if (!userResult.ok) {
        if (isCurrent(request)) setState(errorState(userResult.error, assertive));
        return;
      }
      if (isCurrent(request)) {
        setState({
          status: "ready",
          session: snapshot.session,
          user: userResult.value,
          profiles,
        });
      }
    },
    [isCurrent, session, users]
  );

  const loadSession = useCallback(async (assertive: boolean, invalidate: boolean) => {
    const request = ++requestRef.current;
    if (invalidate) invalidatePendingMutations?.();
    if (mountedRef.current) setState({ status: "loading" });
    const result = await session.getSession();
    if (!result.ok) {
      if (isCurrent(request)) setState(errorState(result.error, assertive));
      return;
    }
    await resolveSnapshot(result.value, request, assertive);
  }, [invalidatePendingMutations, isCurrent, resolveSnapshot, session]);

  const retry = useCallback(
    () => loadSession(true, true),
    [loadSession]
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadSession(false, false);
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      invalidatePendingMutations?.();
    };
  }, [invalidatePendingMutations, loadSession]);

  const perform = useCallback(
    async (operation: () => Promise<ServiceResult<SessionSnapshot>>) => {
      const request = ++requestRef.current;
      if (mountedRef.current) setState({ status: "loading" });
      const result = await operation();
      if (!result.ok) {
        if (isCurrent(request)) setState(errorState(result.error, true));
        return result;
      }
      await resolveSnapshot(result.value, request, true);
      return result;
    },
    [isCurrent, resolveSnapshot]
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      intentionalSignOut,
      retry,
      signIn: (userId) => {
        setIntentionalSignOut(false);
        return perform(() => session.signIn({ userId }));
      },
      signOut: async () => {
        setIntentionalSignOut(true);
        return perform(() => session.signOut());
      },
      selectOrganization: (organizationId) =>
        perform(() => session.selectOrganization({ organizationId })),
      selectPublication: (organizationId, publicationId) =>
        perform(() => session.selectPublication({ organizationId, publicationId })),
    }),
    [intentionalSignOut, perform, retry, session, state]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession() called outside SessionProvider.");
  return value;
}

export function activeRole(session: SimulatedSessionDto): SimulatedRole {
  return (
    session.access.find(
      (grant) => grant.organizationId === session.activeOrganizationId
    )?.role ?? "reviewer"
  );
}
