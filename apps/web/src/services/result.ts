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
  /*
   * `displayMessage` and `qualification` are the service's own English note, never shown as they are: the screens show
   * the catalogue's text for the code. The test double's notes say it is a demonstration; the real services' do not.
   */
  | {
      readonly code: "denied";
      readonly displayMessage: string;
      readonly qualification: string;
    }
  | {
      readonly code: "temporary-failure";
      readonly displayMessage: string;
    };
