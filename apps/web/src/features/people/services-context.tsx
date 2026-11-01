import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AuditService, SecurityService, TeamService } from "../../services/index.ts";

interface PeopleServices {
  readonly security: SecurityService;
  readonly team: TeamService;
  readonly audit: AuditService;
}

const PeopleContext = createContext<PeopleServices | null>(null);

/** The services of the account's security page, of Team and of the audit log. */
export function PeopleProvider({
  security,
  team,
  audit,
  children,
}: PeopleServices & { readonly children: ReactNode }) {
  const value = useMemo(() => ({ security, team, audit }), [security, team, audit]);
  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

function usePeople(): PeopleServices {
  const services = useContext(PeopleContext);
  if (!services) throw new Error("usePeople() called outside PeopleProvider.");
  return services;
}

export function useSecurity(): SecurityService {
  return usePeople().security;
}

export function useTeam(): TeamService {
  return usePeople().team;
}

export function useAudit(): AuditService {
  return usePeople().audit;
}
