import type { Invitation, InvitationCreate, Member, MemberPatch } from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** The API's own shapes (@pageinator/contracts), as the Team endpoints send and take them (plan §5.2). */
export type MemberDto = Member;
export type MemberPatchDto = MemberPatch;
export type InvitationDetailDto = Invitation;
export type InvitationCreateDto = InvitationCreate;

/** Team (07 §Team, plan §5.2): an organisation's members and its pending invitations. */
export interface TeamService {
  listMembers(input: { readonly orgId: string }): Promise<ServiceResult<readonly MemberDto[], ApiProblem>>;
  updateMember(input: {
    readonly orgId: string;
    readonly userId: string;
    readonly patch: MemberPatchDto;
  }): Promise<ServiceResult<MemberDto, ApiProblem>>;
  /** Their work stays; they reach nothing of the organisation any more. */
  removeMember(input: { readonly orgId: string; readonly userId: string }): Promise<ServiceResult<void, ApiProblem>>;
  listInvitations(input: { readonly orgId: string }): Promise<ServiceResult<readonly InvitationDetailDto[], ApiProblem>>;
  /** The key makes a retry of the same invitation safe (plan §5.1). */
  invite(input: {
    readonly orgId: string;
    readonly invitation: InvitationCreateDto;
    readonly idempotencyKey: string;
  }): Promise<ServiceResult<InvitationDetailDto, ApiProblem>>;
  resendInvitation(input: { readonly orgId: string; readonly id: string }): Promise<ServiceResult<InvitationDetailDto, ApiProblem>>;
  cancelInvitation(input: { readonly orgId: string; readonly id: string }): Promise<ServiceResult<void, ApiProblem>>;
}
