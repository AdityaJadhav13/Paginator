/** Transport-independent result vocabulary for Pageinator UI services. */

export type UnavailableResource =
  | "user"
  | "organization"
  | "publication"
  | "edition";

/**
 * A service's answer. The placeholder workspace services fail with `ServiceError`; the real ones (session, account)
 * with an `ApiProblem` (problem.ts).
 */
export type ServiceResult<T, E = ServiceError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type ServiceError =
  | {
      readonly code: "unavailable";
      readonly resource: UnavailableResource;
      readonly displayMessage: string;
    }
  | {
      readonly code: "denied";
      readonly displayMessage: "This demonstration action is not available in the current context.";
      readonly qualification: "Demonstration only — production authorization is not evaluated here";
    }
  | {
      readonly code: "temporary-failure";
      readonly displayMessage: "The demonstration service is temporarily unavailable. Try again.";
    };
