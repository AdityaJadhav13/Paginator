/** The brand screen's Marathi strings (spread into mr.ts): a first draft for the native reviewer (review.ts, D-5). */
import type { BRAND_EN } from "./brand.en.ts";

export const BRAND_MR: Readonly<Record<keyof typeof BRAND_EN, string>> = {
  "brand.loading": "ब्रँड उघडत आहे…",
  "brand.masthead.heading": "मास्टहेड आणि फोलिओ",
  "brand.masthead.explain":
    "मास्टहेड आणि फोलिओ हे पहिल्या पानाच्या टेम्प्लेटचाच भाग आहेत. प्रत्येक पहिले पान त्या पानाचे स्वतःचे मास्टहेड छापते; लेआउट इंजिन फक्त फोलिओतील तारीख, पान क्रमांक, वर्ष, अंक आणि किंमत बदलते.",
  "brand.masthead.from": "{date} च्या आवृत्तीच्या पान १ वर छापल्याप्रमाणे (लेआउट {time}).",
  "brand.masthead.alt": "{date} च्या आवृत्तीच्या पान १ चा वरचा भाग, मास्टहेडसह",
  "brand.masthead.none":
    "अजून एकही पहिले पान लेआउट झालेले नाही, म्हणून दाखवण्यासाठी मास्टहेड नाही. एखाद्या आवृत्तीचा लेआउट करा, ते इथे दिसेल.",
  "brand.masthead.noPreview": "त्या पानाचे पूर्वदृश्य उघडता आले नाही.",
  "brand.masthead.templates": "पहिल्या पानाचे टेम्प्लेट टेम्प्लेट्स स्क्रीनवर बदला",
  "brand.settings.heading": "नाव आणि आवृत्तीची पूर्वनिश्चित माहिती",
  "brand.name.label": "दाखवायचे नाव",
  "brand.name.hint": "पेजिनेटरमध्ये सगळीकडे दिसते. ते छापले जात नाही: छापलेले मास्टहेड टेम्प्लेटचेच असते.",
  "brand.name.required": "नाव लिहा.",
  "brand.defaults.explain":
    "“आवृत्ती तयार करा” ही माहिती भरते, आणि आवृत्ती तयार करणारी व्यक्ती ती बदलू शकते. प्रत्येक आवृत्ती स्वतःचे वर्ष, अंक आणि किंमत ठेवते; पहिल्या पानाचा फोलिओ ती {words} या शब्दांनंतर, टेम्प्लेटच्याच अंकांत छापतो, जिथे पहिल्या पानाच्या टेम्प्लेटमध्ये हे शब्द आहेत.",
  "brand.defaults.volume": "वर्ष",
  "brand.defaults.price": "किंमत",
  "brand.defaults.nextIssue": "पुढचा अंक क्रमांक",
  "brand.defaults.nextIssue.hint":
    "या क्रमांकाने आवृत्ती तयार झाली की तो एकने वाढतो; मोठ्या क्रमांकाने आवृत्ती तयार झाली तर तो त्या क्रमांकाच्या पुढे जातो. प्रत्येक अंक क्रमांक स्वतः लिहायचा असेल तर रिकामा ठेवा.",
  "brand.defaults.nextIssue.invalid": "1 ते 999999 मधील पूर्ण संख्या लिहा, किंवा रिकामे ठेवा.",
  "brand.notSet": "ठरवलेले नाही",
  "brand.save": "जतन करा",
  "brand.saving": "जतन करत आहे…",
  "brand.saved": "जतन झाले.",
  "brand.prefilled": "वर्ष, अंक क्रमांक आणि किंमत ओळखचिन्ह स्क्रीनवरून भरले आहेत.",
};
