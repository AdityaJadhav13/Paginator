/** English strings for Marathi on the daily path: refusal details (detail.<reason>), audit targets (A14) (spread into en.ts). */
export const DAILY_PATH_EN = {
  // the API's refusal details (FieldProblem.reason), as features/auth/ProblemMessage.tsx DetailWords says them
  "detail.docx.over_size": "This Word file is larger than {mb} MB.",
  "detail.docx.size_mismatch": "The file is not the {bytes} bytes the upload said.",
  "detail.docx.protected":
    "This Word file is protected with a password, or is an old .doc file: save it as .docx without a password and try again.",
  "detail.bundle.subheading_hash":
    "The subheading “## {subheading}” in “{headline}” starts with #, which the Desk cannot print as a subheading: change it in the story.",
  "detail.bundle.photo_unusable":
    "“{headline}” has a photo that was rejected or deleted: take it off the story, or give it another, then send again.",
  "detail.bundle.too_many_ads": "This edition has more than {max} ads: the Desk takes at most {max}.",
  "detail.bundle.ad_unusable":
    "The picture of the ad in {slot} (page {page}) was rejected, could not be read or was deleted: set the slot again, or clear it, then send again.",

  // what an audit event is about (features/people/AuditScreen.tsx TARGET_KEYS)
  "auditLog.target.publication": "Publication",
  "auditLog.target.release": "Release",
  "auditLog.target.layout_run": "Layout",
  "auditLog.target.ad_booking": "Ad booking",
  "auditLog.target.ad_slot_artwork": "Ad space picture",
  "auditLog.target.advertiser": "Advertiser",
  "auditLog.target.engine_profile": "Engine profile",
  "auditLog.target.print_profile": "Print profile",
  "auditLog.target.news_source": "News source",
  "auditLog.target.news_run": "News collection",
  "auditLog.target.news_draft": "Story draft",
} as const;
