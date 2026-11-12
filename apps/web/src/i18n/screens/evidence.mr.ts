/** The G2 evidence's Marathi strings (spread into mr.ts): a first draft for the native reviewer (review.ts, D-5). */
import type { EVIDENCE_EN } from "./evidence.en.ts";

export const EVIDENCE_MR: Readonly<Record<keyof typeof EVIDENCE_EN, string>> = {
  "evidence.pressTest.title": "छापखान्यासाठी चाचणी पान",
  "evidence.pressTest.lede":
    "छापखान्याला पाठवण्यासाठी 347 × 540 मिमीचे PDF/X-1a चाचणी पान: एक काल्पनिक छायाचित्र आणि एक काल्पनिक जाहिरात, रेषा, छटा आणि रजिस्ट्रेशन खुणा. इंजिन ते तयार करते आणि स्वतंत्र PDF/X-1a तपासणी ते तपासते; पहिल्यांदा काही मिनिटे लागू शकतात.",
  "evidence.pressTest.download": "छापखान्यासाठी चाचणी पान डाउनलोड करा",
  "evidence.pressTest.making": "चाचणी पान तयार होत आहे…",
  "evidence.pressTest.sha": "डाउनलोड झाले. त्याचा SHA-256:",
  "evidence.pressTest.note":
    "त्यावरील छायाचित्र आणि जाहिरात काल्पनिक आहेत. छायाचित्रे किंवा जाहिराती असलेली पाने छपाईला जाण्याआधी छापखान्याने हे पान स्वीकारले पाहिजे: त्यांना त्याचा SHA-256 द्या, आणि त्यांनी स्वीकारल्यावर तो प्रकाशित आवृत्ती टॅबवर नोंदवा.",
  "error.press_test_unavailable": "चाचणी पान आत्ता तयार करता येत नाही. काही मिनिटांनी पुन्हा प्रयत्न करा.",
  "error.press_test_refused":
    "चाचणी पान दिले नाही: ते तपासणीत अनुत्तीर्ण झाले, किंवा ते या वृत्तपत्राच्या पानाच्या आकाराशी किंवा रंग प्रोफाइलशी जुळत नाही.",
};
