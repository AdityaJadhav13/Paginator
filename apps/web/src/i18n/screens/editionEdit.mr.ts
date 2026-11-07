/** Marathi strings for the Editions screen's correction of an edition's date and pages (A12, L2-350) (spread into mr.ts): a first draft for the native reviewer (review.ts, D-5). */
import type { EDITION_EDIT_EN } from "./editionEdit.en.ts";

export const EDITION_EDIT_MR: Readonly<Record<keyof typeof EDITION_EDIT_EN, string>> = {
  "editionEdit.open": "तारीख आणि पाने दुरुस्त करा",
  "editionEdit.explain":
    "या अंकाच्या आधी केलेल्या मांडण्या बाजूला ठेवल्या जातात: यानंतर पुन्हा मांडणी करा. नवीन तारखेसाठी बुक झालेल्या जाहिराती त्याच्यात ठेवल्या जातात. पाने कमी केल्यास, काढलेल्या पानांचे नियोजन रिकामे होते.",
  "editionEdit.save": "दुरुस्ती जतन करा",
  "editionEdit.saving": "जतन करत आहे…",
  "editionEdit.nothing": "अजून काहीच बदललेले नाही.",
  "editionEdit.done": "अंक दुरुस्त झाला: {date}, {pages}.",
  "editionEdit.released": "हा अंक प्रकाशित झाला आहे: त्याची तारीख आणि पाने आता बदलता येत नाहीत.",
  "error.edition_released": "हा अंक प्रकाशित झाला आहे: त्याची तारीख आणि पाने आता बदलता येत नाहीत.",
};
