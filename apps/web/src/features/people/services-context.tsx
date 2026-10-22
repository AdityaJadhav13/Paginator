import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SecurityService, TeamService } from "../../services/index.ts";

interface PeopleServices {
  readonly security: SecurityService;
  readonly team: TeamService;
}

const PeopleContext = createContext<PeopleServices | null>(null);

/** The services of the account's security page and of Team. */
export function PeopleProvider({
  security,
  team,
  children,
}: PeopleServices & { readonly children: ReactNode }) {
  const value = useMemo(() => ({ security, team }), [security, team]);
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
