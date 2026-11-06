/** The legal pages' own English strings (spread into en.ts; keys start with "public.legal."): their titles, the
 * footer's Legal group, and what a page says while the owner's text is not there (03 §4.2 `/legal/*`; doc 11 L2-230).
 * The legal texts themselves are never here: they are the owner's files, served from the host (LegalPage.tsx). */
export const DEPLOY_EN = {
  "public.legal.group": "Legal",
  "public.legal.privacy": "Privacy notice",
  "public.legal.terms": "Terms of use",
  "public.legal.grievance": "Grievance officer",
  "public.legal.privacy.pending":
    "The privacy notice will be published here. Its text is to be supplied by the owner of Pageinator, and it has not been supplied yet.",
  "public.legal.terms.pending":
    "The terms of use will be published here. Their text is to be supplied by the owner of Pageinator, and it has not been supplied yet.",
  "public.legal.grievance.pending":
    "The grievance officer's name and contact details will be published here. They are to be supplied by the owner of Pageinator, and they have not been supplied yet.",
  "public.legal.otherLanguage": "This text is published in Marathi only.",
  "public.legal.failed": "The text could not be loaded. Reload the page to try again.",
} as const;
