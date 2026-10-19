/** Transport-independent result vocabulary for Pageinator UI services. */

export type UnavailableResource =
  | "user"
  | "organization"
  | "publication"
  | "edition";

export type ServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ServiceError };

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
