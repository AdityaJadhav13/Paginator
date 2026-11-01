import type { AuditEvent, AuditList } from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** The API's own shapes (@pageinator/contracts audit.ts). */
export type AuditEventDto = AuditEvent;
export type AuditPageDto = AuditList;

/** The filters the audit screen offers (the API takes an actor and a target too; nothing asks for them yet). */
export interface AuditFilterDto {
  /** One action of AUDIT_ACTIONS; anything else is refused (400). */
  readonly action?: string;
  readonly publication?: string;
  /** Inclusive, an ISO time with an offset. */
  readonly from?: string;
  /** Exclusive, an ISO time with an offset. */
  readonly to?: string;
}

/**
 * The organisation's audit log (plan §3.4, §5.2; permission audit.view), newest first. Owner and Admin see every event
 * with the client's address and browser; a Chief Editor sees their publications' events only, without them.
 */
export interface AuditService {
  list(
    input: {
      readonly orgId: string;
      readonly cursor?: string;
      /** 1–200; the API's default is 50. */
      readonly limit?: number;
    } & AuditFilterDto,
  ): Promise<ServiceResult<AuditPageDto, ApiProblem>>;
}

/** The API's own filter checks and the Chief Editor's actions, for the test double to answer as the API does. */
export { AuditQuery, PUBLICATION_AUDIT_ACTIONS } from "@pageinator/contracts";
