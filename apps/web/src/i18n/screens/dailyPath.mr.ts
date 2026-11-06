/** Marathi strings for Marathi on the daily path: refusal details (detail.<reason>), audit targets (A14) (spread into mr.ts): a first draft for the native reviewer (review.ts, D-5). */
import type { DAILY_PATH_EN } from "./dailyPath.en.ts";

export const DAILY_PATH_MR: Readonly<Record<keyof typeof DAILY_PATH_EN, string>> = {
  "detail.docx.over_size": "ही Word फाइल {mb} MB पेक्षा मोठी आहे.",
  "detail.docx.size_mismatch": "ही फाइल अपलोडमध्ये सांगितलेल्या {bytes} बाइट्सची नाही.",
  "detail.docx.protected":
    "ही Word फाइल पासवर्डने सुरक्षित आहे, किंवा ही जुनी .doc फाइल आहे: ती पासवर्डशिवाय .docx म्हणून जतन करा आणि पुन्हा प्रयत्न करा.",
  "detail.bundle.subheading_hash":
    "“{headline}” मधील उपशीर्षक “## {subheading}” # ने सुरू होते, आणि Desk ते उपशीर्षक म्हणून छापू शकत नाही: बातमीत ते बदला.",
  "detail.bundle.photo_unusable":
    "“{headline}” चे छायाचित्र नाकारले गेले आहे किंवा काढून टाकले आहे: ते बातमीवरून काढा, किंवा दुसरे द्या, मग पुन्हा पाठवा.",

  "auditLog.target.publication": "प्रकाशन",
  "auditLog.target.release": "प्रकाशित आवृत्ती",
  "auditLog.target.layout_run": "मांडणी",
  "auditLog.target.ad_booking": "जाहिरातीचे बुकिंग",
  "auditLog.target.ad_slot_artwork": "जाहिरात-जागेचे चित्र",
  "auditLog.target.advertiser": "जाहिरातदार",
  "auditLog.target.engine_profile": "इंजिन प्रोफाइल",
  "auditLog.target.print_profile": "छपाई प्रोफाइल",
  "auditLog.target.news_source": "बातमीचा स्रोत",
  "auditLog.target.news_run": "बातम्यांचे संकलन",
  "auditLog.target.news_draft": "बातमीचा मसुदा",
};
