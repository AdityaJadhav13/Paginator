/**
 * What a person may do with an edition's layout, from /me and the permission map (07 §12, @pageinator/contracts), as
 * the API's layout routes decide it: a screen hides only what the API would refuse.
 */
import type { OrgAccessDto } from "../../services/index.ts";
import { may } from "../people/navigation.ts";

export interface LayoutAccess {
  /** pages.view: the edition's layout, previews and the check's report */
  readonly view: boolean;
  /** layout.generate: start and cancel a run */
  readonly generate: boolean;
  /** layout.edit: a done page in the page editor (L2.4) */
  readonly edit: boolean;
  /** layout.generate or ads.manage: set and clear an ad slot's picture */
  readonly ads: boolean;
  /** proof.view: a page's PDF and the edition PDF */
  readonly proof: boolean;
  /** export.press: the press ZIP */
  readonly press: boolean;
  /** settings.view / settings.edit: the engine profile */
  readonly settings: boolean;
  readonly settingsEdit: boolean;
}

export function layoutAccess(org: OrgAccessDto | undefined, pubId: string): LayoutAccess {
  // the API refuses every screen of the organisation (403 two_step_required) until this session has two-step
  const open = !!org && !(org.twoStep.required && !org.twoStep.satisfied);
  const can = (permission: Parameters<typeof may>[1]) => open && may(org, permission, pubId);
  return {
    view: can("pages.view"),
    generate: can("layout.generate"),
    edit: can("layout.edit"),
    ads: can("layout.generate") || can("ads.manage"),
    proof: can("proof.view"),
    press: can("export.press"),
    settings: can("settings.view"),
    settingsEdit: can("settings.edit"),
  };
}
