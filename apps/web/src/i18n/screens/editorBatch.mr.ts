/** The A-editor batch's Marathi strings (spread into mr.ts): a first draft for the native reviewer (review.ts, D-5). */
import type { EDITOR_BATCH_EN } from "./editorBatch.en.ts";

export const EDITOR_BATCH_MR: Readonly<Record<keyof typeof EDITOR_BATCH_EN, string>> = {
  // ── page editor: photo crop, focal point, rulers, zoom to selection (A6) ──
  "pageEditor.photo.heading": "छायाचित्र",
  "pageEditor.photo.crop": "छायाचित्र कापा",
  "pageEditor.photo.focal": "केंद्रबिंदू ठरवा",
  "pageEditor.photo.reset": "काप रद्द करा",
  "pageEditor.photo.enlarge": "मोठे करा",
  "pageEditor.photo.ppiSoft": "{n} ppi: 150 ppi पेक्षा कमी, छपाई धूसर होऊ शकते",
  "pageEditor.photo.ppiSharp": "{n} ppi: स्पष्ट छापले जाते",
  "pageEditor.photo.zoomFloor":
    "ते आधीच त्याला चालणाऱ्या सर्वात कमी रेझोल्यूशनवर छापले जाते ({ppi} ppi): ते चौकटीत हलवता येते, मोठे करता येत नाही.",
  "pageEditor.photo.zoomSharp": "स्पष्ट छापले जाईल तितके मोठे केले ({ppi} ppi).",
  "pageEditor.photo.zoomMax": "400 % मोठे केले; छायाचित्र यापेक्षा मोठे होत नाही.",
  "pageEditor.photo.cropReset": "{name} चे छायाचित्र बदलले: त्याचा काप पूर्वीसारखा केला आहे.",
  "pageEditor.photo.canvas":
    "पान, छायाचित्र मोड: निवडलेल्या बातमीचे छायाचित्र चौकटीत हलवण्यासाठी ओढा, किंवा बाणांच्या कळांनी हलवा (Shift सोबत जास्त); केंद्रबिंदू ठरवण्यासाठी त्यावर डबल-क्लिक करा. Enter किंवा Esc ने बातम्या निवडण्याकडे परत.",
  "pageEditor.photo.canvasFocal":
    "पान, केंद्रबिंदू: छायाचित्रातील मुख्य विषयावर क्लिक करा; चौकट तो शक्य तितका मध्यभागी ठेवते. Enter किंवा Esc ने संपते.",
  "pageEditor.photo.sayPhoto": "छायाचित्र मोड: {name} चे छायाचित्र चौकटीत हलवण्यासाठी ओढा. थांबण्यासाठी Esc.",
  "pageEditor.photo.sayFocal":
    "छायाचित्रातील मुख्य विषयावर क्लिक करा: चौकट तो शक्य तितका मध्यभागी ठेवते. संपवण्यासाठी Enter किंवा Esc.",
  "pageEditor.photo.saySelect": "बातम्या निवडण्याचा मोड.",
  "pageEditor.adsSet": "या पानावरच्या जाहिराती अंकात आता आहेत तशा मांडल्या.",
  "pageEditor.rulers": "मोजपट्ट्या",
  "pageEditor.zoomSelection": "निवडलेल्या बातमीवर झूम करा",
  // ── Pages board and release (A9, A10) ──
  "editionRelease.check.printsOldArtworkSave": "किंवा मागील पानावरील मजकूर अद्ययावत करून ते जतन करा.",
  "editionRelease.item.downloadAll": "सर्व डाउनलोड करा (ZIP)",
};
