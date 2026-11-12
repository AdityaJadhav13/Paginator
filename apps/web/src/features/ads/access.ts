/**
 * What a person may do on the ads desk and the edition plan, from /me and the permission map (07 §12 rows "Ads desk",
 * "Ads desk (view)", "Editions: create, Plan tab"), as the API's routes decide it (@pageinator/contracts ads.ts): a
 * screen hides only what the API would refuse.
 */
import { reach } from "@pageinator/contracts";
import type { OrgAccessDto } from "../../services/index.ts";
import { may } from "../people/navigation.ts";
import { pubAccess } from "../stories/access.ts";

export interface AdsAccess {
  /** ads.view: the desk, its bookings, advertisers, sizes and cut-off */
  readonly view: boolean;
  /** ads.manage: advertisers, bookings and their artwork */
  readonly manage: boolean;
  /** media.upload or ads.manage: a new picture uploaded to the library as artwork */
  readonly upload: boolean;
  /** ads.manage or settings.edit: the cut-off settings */
  readonly settings: boolean;
  /** ads.manage or layout.generate: place booked ads, put one in a slot or take it out */
  readonly place: boolean;
  /** edition.view: an edition's plan */
  readonly plan: boolean;
  /** a full edition.edit: a plan page's section and note, "Copy plan from…" */
  readonly planEdit: boolean;
}

export function adsAccess(org: OrgAccessDto | undefined, pubId: string): AdsAccess {
  // the API refuses every screen of the organisation (403 two_step_required) until this session has two-step
  const open = !!org && !(org.twoStep.required && !org.twoStep.satisfied);
  const can = (permission: Parameters<typeof may>[1]) => open && may(org, permission, pubId);
  return {
    view: can("ads.view"),
    manage: can("ads.manage"),
    upload: can("media.upload") || can("ads.manage"),
    settings: can("ads.manage") || can("settings.edit"),
    place: can("ads.manage") || can("layout.generate"),
    plan: can("edition.view"),
    planEdit: open && reach("edition.edit", org.orgRole, pubAccess(org, pubId)) === "full",
  };
}
