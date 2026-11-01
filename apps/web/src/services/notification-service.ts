import type { Notification, NOTIFICATION_KINDS } from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** The API's own shapes (@pageinator/contracts notifications.ts). */
export type NotificationDto = Notification;
export type NotificationKindDto = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationPageDto {
  readonly items: readonly NotificationDto[];
  /** Unread notifications in all, not only on this page. */
  readonly unread: number;
  readonly nextCursor: string | null;
}

/**
 * The person's own notifications in an organisation (plan §5.2; 06 §11), newest first, with how many are unread. A
 * notification names what happened by ids only; the screens fetch the story through the routes that check access.
 */
export interface NotificationService {
  list(input: {
    readonly orgId: string;
    readonly unread?: boolean;
    readonly cursor?: string;
    /** 1–100; the API's default is 30. */
    readonly limit?: number;
  }): Promise<ServiceResult<NotificationPageDto, ApiProblem>>;
  /** Marks these read (1–100 of them), or all of the person's in the organisation. */
  markRead(
    input: { readonly orgId: string } & ({ readonly ids: readonly string[] } | { readonly all: true }),
  ): Promise<ServiceResult<void, ApiProblem>>;
}
