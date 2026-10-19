export type SimulatedRole = "editor" | "reviewer";

export interface SimulatedProfileDto {
  readonly userId: string;
}

export interface SimulatedAccessGrantDto {
  readonly organizationId: string;
  readonly role: SimulatedRole;
  readonly publicationIds: readonly string[];
}

export interface SimulatedSessionDto {
  readonly userId: string;
  readonly access: readonly SimulatedAccessGrantDto[];
  readonly activeOrganizationId: string;
  readonly activePublicationId: string;
}

export type SessionSnapshot =
  | { readonly status: "signed-out" }
  | { readonly status: "signed-in"; readonly session: SimulatedSessionDto };
