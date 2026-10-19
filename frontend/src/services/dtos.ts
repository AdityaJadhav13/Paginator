/**
 * Minimal UI service DTOs for UI003.
 *
 * These types describe the current browser-facing mock contract. They
 * are not database entities, production API schemas, authorization
 * records, or publishing-engine document types.
 */

export type TextDirection = "ltr" | "rtl";

export interface UserDto {
  readonly id: string;
  readonly displayName: string;
}

export interface OrganizationDto {
  readonly id: string;
  readonly name: string;
}

export interface PublicationDto {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly locale: string;
  readonly direction: TextDirection;
}

export interface EditionDto {
  readonly id: string;
  readonly publicationId: string;
  readonly label: string;
}
