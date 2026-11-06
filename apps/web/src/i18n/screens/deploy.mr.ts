/** The legal pages' own Marathi strings (spread into mr.ts): a first draft for the native reviewer (review.ts, D-5). */
import type { DEPLOY_EN } from "./deploy.en.ts";

export const DEPLOY_MR: Readonly<Record<keyof typeof DEPLOY_EN, string>> = {
  "public.legal.group": "कायदेशीर",
  "public.legal.privacy": "गोपनीयता सूचना",
  "public.legal.terms": "वापराच्या अटी",
  "public.legal.grievance": "तक्रार निवारण अधिकारी",
  "public.legal.privacy.pending":
    "गोपनीयता सूचना इथे प्रकाशित केली जाईल. तिचा मजकूर Pageinator चे मालक देणार आहेत; तो अजून मिळालेला नाही.",
  "public.legal.terms.pending":
    "वापराच्या अटी इथे प्रकाशित केल्या जातील. त्यांचा मजकूर Pageinator चे मालक देणार आहेत; तो अजून मिळालेला नाही.",
  "public.legal.grievance.pending":
    "तक्रार निवारण अधिकाऱ्यांचे नाव आणि संपर्क तपशील इथे प्रकाशित केले जातील. ते Pageinator चे मालक देणार आहेत; ते अजून मिळालेले नाहीत.",
  // the text shown is the other language's: on the Marathi page, English
  "public.legal.otherLanguage": "हा मजकूर फक्त इंग्रजीत प्रकाशित आहे.",
  "public.legal.failed": "मजकूर उघडता आला नाही. पुन्हा प्रयत्न करण्यासाठी पान पुन्हा उघडा.",
};
