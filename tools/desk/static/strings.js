// Pageinator Desk: the words of the Desk's main screen, in English and Marathi (tools/desk/static/strings.js).
//
// FIRST DRAFT OF THE MARATHI, FOR NATIVE REVIEW. An AI assistant (Claude) wrote the Marathi here as a first draft; no
// machine-translation service was used. A native Marathi editor, whom the owner names (D-5), checks it before it is
// relied on. The terms come from the glossary in docs/product/02-design-system.md §3.9 (अंक, पान, बातमी, मथळा,
// जाहिरात …). Every entry is on the REVIEW list unless it is marked:
//   - GLOSSARY: its Marathi uses only the glossary's terms (the glossary itself still awaits the native editor);
//   - SAME: it is the same in both languages on purpose (names, units, date patterns).
// The reviewer sees each entry's English and Marathi side by side below.
//
// Rules for the entries:
//   - Whole sentences with {name} placeholders, never a sentence built from words: the word order differs between
//     the languages. A sentence whose words change with a number is a plural entry {one, other}, chosen by {n}.
//   - Both languages have the same keys and, form by form, the same placeholders (tools/desk/test/test_strings.mjs).
//   - Numbers and dates keep Latin digits in the interface (02-design-system §3.3). Numbers given to t() are shown
//     with Indian grouping (12,900; 1,23,456); a number that must not be grouped (a year) is passed as text.
//   - Not here: the paper's own content (headlines, article text, edition names) and the server's messages, which
//     are shown as the server sends them (English for now).
//
// Plain ES module: no build step, no dependency. The page editor (editor.html) does not use it yet.

const GLOSSARY = "glossary";
const SAME = "same";

// key: [English, Marathi, mark?]
const TABLE = {
  // ---- the frame: top bar, language, steps
  "app.name": ["Pageinator Desk", "Pageinator Desk", SAME],
  "app.tag": ["internal · own use", "अंतर्गत · स्वतःच्या वापरासाठी"],
  "app.skip": ["Skip to the work area", "थेट कामाच्या भागाकडे जा"],
  "app.sidebar": ["Steps and what this paper needs", "पायऱ्या आणि या अंकाला काय लागते"],
  "lang.legend": ["Language", "भाषा"],
  "lang.en": ["English", "English", SAME], // each language is named in its own script
  "lang.mr": ["मराठी", "मराठी", SAME],
  "top.edition": ["Edition", "अंक", GLOSSARY],
  "top.newEdition": ["New edition", "नवा अंक"],
  "top.loading": ["Loading…", "लोड होत आहे…"],
  "top.notAvailable": ["Not available", "उपलब्ध नाही"],
  "top.noEditions": ["No editions yet", "अजून एकही अंक नाही"],
  "top.engineStatus": ["Engine status:", "इंजिनची स्थिती:"],
  "title.edition": [
    { one: "{date} · {n} page — {app}", other: "{date} · {n} pages — {app}" },
    { one: "{date} · {n} पान — {app}", other: "{date} · {n} पाने — {app}" },
    GLOSSARY,
  ],
  "title.running": ["Laying out {done}/{total} · {title}", "मांडणी {done}/{total} · {title}"],
  "step.nav": ["Steps", "पायऱ्या"],
  "step.edition": ["Edition", "अंक", GLOSSARY],
  "step.articles": ["Articles", "बातम्या", GLOSSARY],
  "step.ads": ["Ads", "जाहिराती", GLOSSARY],
  "step.run": ["Lay out & download", "मांडणी आणि डाउनलोड"],
  "sum.notLaidOut": ["Not laid out yet", "अजून मांडणी झालेली नाही"],
  "sum.layingOutOf": ["Laying out · {done} of {total}", "मांडणी सुरू · {total} पैकी {done}"],
  "sum.doneAt": ["Done · {time}", "पूर्ण · {time}"],
  "sum.laidOutBefore": ["Laid out before", "आधी मांडणी झाली आहे"],
  "sum.edition": [
    { one: "{n} page · {date}", other: "{n} pages · {date}" },
    { one: "{n} पान · {date}", other: "{n} पाने · {date}" },
    GLOSSARY,
  ],
  "sum.adsFilled": [
    { one: "{n} of {total} filled", other: "{n} of {total} filled" },
    { one: "{total} पैकी {n} भरली", other: "{total} पैकी {n} भरल्या" },
  ],
  "sum.noAdSpaces": ["No ad spaces", "जाहिरातींसाठी जागा नाही"],
  "measure.progress": [
    "Measuring stories for layout: {done} of {total}",
    "मांडणीसाठी बातम्यांचे मोजमाप: {total} पैकी {done}",
  ],
  "measure.busy": ["Measuring stories for layout…", "मांडणीसाठी बातम्यांचे मोजमाप सुरू आहे…"],

  // ---- the engine status (top right)
  "engine.checking": ["Checking the engine…", "इंजिन तपासत आहे…"],
  "engine.offline": ["Offline", "ऑफलाइन", GLOSSARY],
  "engine.partly": ["Partly ready", "अंशतः तयार"],
  "engine.partlyWhy": [
    "Photos and ads cannot be converted for print until the colour profile is set up.",
    "रंग-प्रोफाइल बसवेपर्यंत छायाचित्रे आणि जाहिराती छपाईसाठी रूपांतरित करता येत नाहीत.",
  ],
  "engine.ready": ["Engine ready", "इंजिन तयार"],
  "engine.setup": ["Setup needed", "आधी तयारी हवी"],
  "engine.setupWhy": ["The layout engine is not set up yet.", "मांडणी इंजिनची तयारी अजून झालेली नाही."],
  "engine.factEngine": ["Layout engine", "मांडणी इंजिन"],
  "engine.found": ["found", "सापडले"],
  "engine.notFound": ["not found", "सापडले नाही"],
  "engine.factSetup": ["Engine setup", "इंजिनची तयारी"],
  "engine.setupDone": ["done", "झाली"],
  "engine.setupNotDone": ["not done yet", "अजून झालेली नाही"],
  "engine.factIcc": ["Colour profile", "रंग-प्रोफाइल"],
  "engine.iccMissing": ["missing (photos and ads)", "नाही (छायाचित्रे आणि जाहिरातींसाठी हवे)"],
  "engine.factCores": ["Processor cores", "प्रोसेसर कोअर"],
  "engine.cores": ["{n} (pages are laid out in parallel)", "{n} (पानांची मांडणी एकाच वेळी होते)"],
  "engine.factHome": ["Desk home", "डेस्कचे होम फोल्डर"],
  "engine.factVersion": ["Version", "व्हर्जन"],
  "engine.checkAgain": ["Check again", "पुन्हा तपासा"],

  // ---- what this paper needs (sidebar)
  "needs.title": ["What this paper needs", "या अंकाला काय लागते"],
  "needs.note": [
    "Bring about 15–20% extra so the layout has choices. Every ad you sell means fewer stories.",
    "मांडणीला पर्याय मिळावेत म्हणून सुमारे 15–20% जास्त मजकूर आणा. प्रत्येक विकलेल्या जाहिरातीमुळे बातम्यांची जागा कमी होते.",
  ],
  "needs.perPage": ["Per page", "पानानुसार"],
  "needs.for": [
    { one: "For {n} page", other: "For {n} pages" },
    { one: "{n} पानासाठी", other: "{n} पानांसाठी" },
  ],
  "needs.forNoBackAds": [
    { one: "For {n} page · the back page is all news", other: "For {n} pages · the back page is all news" },
    { one: "{n} पानासाठी · शेवटच्या पानावर फक्त बातम्या", other: "{n} पानांसाठी · शेवटच्या पानावर फक्त बातम्या" },
  ],
  "needs.missing": [
    "Not available yet: the page plan needs the layout engine to be set up.",
    "अजून उपलब्ध नाही: पान आराखड्यासाठी आधी मांडणी इंजिनची तयारी व्हायला हवी.",
  ],
  "needs.stories": ["Stories", "बातम्या", GLOSSARY],
  "needs.briefs": ["Short items", "छोट्या बातम्या"],
  "needs.photos": ["Photos", "छायाचित्रे", GLOSSARY],
  "needs.words": ["Words", "शब्द"],
  "needs.noFigure": ["No figure in the plan", "आराखड्यात आकडा नाही"],
  "needs.enough": ["Enough", "पुरेसे"],
  "needs.shortBy": ["Short by {n}", "{n} कमी"],
  "needs.front": ["Front page", "पहिले पान"],
  "needs.inside": ["Inside pages", "आतील पाने"],
  "needs.back": ["Back page", "शेवटचे पान"],
  "needs.timesEach": ["× {n} · each", "× {n} · प्रत्येकी"],
  "needs.backAsInside": [
    "The back page has no ads, so it counts as an inside page.",
    "शेवटच्या पानावर जाहिराती नाहीत, म्हणून ते आतील पान म्हणून मोजले आहे.",
  ],
  "needs.noPerPage": ["The plan has no per-page figures.", "आराखड्यात पानानुसार आकडे नाहीत."],

  // ---- counts (a number with its noun, standing alone)
  "count.article": [
    { one: "{n} article", other: "{n} articles" },
    { one: "{n} बातमी", other: "{n} बातम्या" },
    GLOSSARY,
  ],
  "count.story": [{ one: "{n} story", other: "{n} stories" }, { one: "{n} बातमी", other: "{n} बातम्या" }, GLOSSARY],
  "count.brief": [
    { one: "{n} short item", other: "{n} short items" },
    { one: "{n} छोटी बातमी", other: "{n} छोट्या बातम्या" },
  ],
  "count.photo": [
    { one: "{n} photo", other: "{n} photos" },
    { one: "{n} छायाचित्र", other: "{n} छायाचित्रे" },
    GLOSSARY,
  ],
  "count.word": [
    { one: "{n} word", other: "{n} words" },
    { one: "{n} शब्द", other: "{n} शब्द" },
  ],
  "count.page": [{ one: "{n} page", other: "{n} pages" }, { one: "{n} पान", other: "{n} पाने" }, GLOSSARY],
  "count.adSpace": [
    { one: "{n} ad space", other: "{n} ad spaces" },
    { one: "{n} जाहिरातीची जागा", other: "{n} जाहिरातींच्या जागा" },
  ],
  "count.warning": [
    { one: "{n} warning", other: "{n} warnings" },
    { one: "{n} इशारा", other: "{n} इशारे" },
  ],
  "count.added": [
    { one: "Added {n} article", other: "Added {n} articles" },
    { one: "{n} बातमी जोडली", other: "{n} बातम्या जोडल्या" },
  ],

  // ---- whole-screen states
  "view.loadingEditions": ["Loading editions…", "अंक लोड होत आहेत…"],
  "view.openingEdition": ["Opening the edition…", "अंक उघडत आहे…"],
  "view.offlineTitle": ["The Desk server is not answering", "डेस्क सर्व्हर प्रतिसाद देत नाही"],
  "view.tryAgain": ["Try again", "पुन्हा प्रयत्न करा"],
  "view.noEditionsTitle": ["No editions yet — create today's edition", "अजून एकही अंक नाही — आजचा अंक तयार करा"],
  "view.noEditionsLede": [
    "An edition is one day's paper. You make it in four steps:",
    "अंक म्हणजे एका दिवसाचे वृत्तपत्र. तो चार पायऱ्यांत तयार होतो:",
  ],
  "view.empty1": ["Choose the date and the number of pages.", "तारीख आणि पानांची संख्या निवडा."],
  "view.empty2": [
    "Enter or paste the articles, with their photos.",
    "बातम्या टाइप किंवा पेस्ट करा, त्यांच्या छायाचित्रांसह.",
  ],
  "view.empty3": ["Add the ad images.", "जाहिरातींची चित्रे जोडा."],
  "view.empty4": ["Lay out the paper and download the PDFs.", "अंकाची मांडणी करा आणि PDF फायली डाउनलोड करा."],
  "view.createEdition": ["Create an edition", "अंक तयार करा"],
  "view.cannotOpen": ["This edition could not be opened", "हा अंक उघडता आला नाही"],

  // ---- pages and their roles
  "page.n": ["Page {n}", "पान {n}", GLOSSARY],
  "page.named": ["Page {n} · {role}", "पान {n} · {role}", GLOSSARY],
  "role.front": ["Front", "पहिले"],
  "role.inside": ["Inside", "आतील"],
  "role.back": ["Back", "शेवटचे"],

  // ---- step 1: the edition
  "ed.lede": [
    { one: "{date} · {n} page", other: "{date} · {n} pages" },
    { one: "{date} · {n} पान", other: "{date} · {n} पाने" },
    GLOSSARY,
  ],
  "ed.settings": ["Settings", "सेटिंग्ज", GLOSSARY],
  "ed.settingsLede": [
    "Changing the pages or the back-page ads changes the page plan below.",
    "पाने किंवा शेवटच्या पानावरच्या जाहिराती बदलल्या की खालचा पान आराखडा बदलतो.",
  ],
  "ed.date": ["Date", "तारीख"],
  "ed.pages": ["Pages", "पाने", GLOSSARY],
  "ed.backAds": ["Back page has ads", "शेवटच्या पानावर जाहिराती आहेत"],
  "ed.backAdsNote": ["Untick it when the last page is all news.", "शेवटच्या पानावर फक्त बातम्या असतील तर खूण काढा."],
  // {word}: the folio's own Marathi word (वर्ष, अंक, किंमत), as the page prints it
  "ed.volume": ["{word} / Volume", "{word}"],
  "ed.issue": ["{word} / Issue", "{word} क्रमांक"],
  "ed.price": ["{word} / Price", "{word}"],
  "ed.folioNote": [
    "Volume, issue and price are optional. They are printed in the front-page folio where the template has a place " +
      "for them; leave a box empty to keep the template's own text.",
    "वर्ष, अंक क्रमांक आणि किंमत ऐच्छिक आहेत. साच्यात त्यांची जागा असेल तिथे ते पहिल्या पानाच्या फोलिओ ओळीत छापले " +
      "जातात; साच्याचा स्वतःचा मजकूर ठेवायचा असेल तर चौकट रिकामी ठेवा.",
  ],
  "ed.pinnedBeyond": [
    {
      one: "{n} article is pinned to a page above {pages}. The Desk will place it itself; change its page in step 2 to choose one.",
      other:
        "{n} articles are pinned to a page above {pages}. The Desk will place them itself; change their page in step 2 to choose one.",
    },
    {
      one: "{n} बातमी पान {pages} नंतरच्या पानावर पिन केली आहे. डेस्क ती स्वतः ठेवेल; पान निवडायचे असेल तर पायरी 2 मध्ये तिचे पान बदला.",
      other:
        "{n} बातम्या पान {pages} नंतरच्या पानांवर पिन केल्या आहेत. डेस्क त्या स्वतः ठेवेल; पान निवडायचे असेल तर पायरी 2 मध्ये त्यांचे पान बदला.",
    },
  ],
  "ed.chooseDate": ["Choose the date this edition is for.", "हा अंक कोणत्या तारखेचा आहे ते निवडा."],
  "ed.save": ["Save settings", "सेटिंग्ज जतन करा"],
  "ed.undo": ["Undo changes", "बदल पूर्ववत करा"],
  "ed.saved": ["Edition settings saved", "अंकाची सेटिंग्ज जतन झाली"],
  "ed.deleteTitle": ["Delete", "हटवा", GLOSSARY],
  "ed.deleteLede": [
    "Moves this edition to the trash folder in the Desk home. Nothing is erased from the disk.",
    "हा अंक डेस्कच्या होम फोल्डरमधील कचरापेटी फोल्डरमध्ये हलवला जातो. डिस्कवरून काहीही पुसले जात नाही.",
  ],
  "ed.deleteButton": ["Delete this edition", "हा अंक हटवा"],
  "ed.deleteConfirmTitle": ["Delete this edition?", "हा अंक हटवायचा?"],
  "ed.deleteConfirm": [
    "The edition of {date} — its articles, photos, ads and layouts — moves to the trash folder in the Desk home and " +
      "disappears from this list.",
    "{date} चा अंक — त्यातील बातम्या, छायाचित्रे, जाहिराती आणि मांडण्या — डेस्कच्या होम फोल्डरमधील कचरापेटी " +
      "फोल्डरमध्ये जातो आणि या यादीतून दिसेनासा होतो.",
  ],
  "ed.deleteOk": ["Delete edition", "अंक हटवा", GLOSSARY],
  "ed.deleted": ["Edition moved to the trash", "अंक कचरापेटीत हलवला"],

  // ---- the page plan (step 1)
  "plan.title": ["Page plan", "पान आराखडा", GLOSSARY],
  "plan.missing": ["The page plan is not available yet.", "पान आराखडा अजून उपलब्ध नाही."],
  "plan.missingWhy": ["The page plan is not available yet. {reason}", "पान आराखडा अजून उपलब्ध नाही. {reason}"],
  "plan.none": ["The page plan lists no pages.", "पान आराखड्यात एकही पान नाही."],
  "plan.lede": [
    "One tile per page. Hatched blocks are ad spaces, drawn at their share of the page where the sizes are known.",
    "प्रत्येक पानासाठी एक चौकट. तिरप्या रेघांचे भाग जाहिरातींच्या जागा आहेत; आकार माहीत असेल तिथे ते पानातील त्यांच्या " +
      "वाट्याइतके दाखवले आहेत.",
  ],
  // the mark an empty ad space prints: "जाहिरात · AD" (experiments/phase0/page1/compose_page.py)
  "plan.ad": ["AD", "जाहिरात", GLOSSARY],
  "plan.ads": ["ads: {n}", "जाहिराती: {n}", GLOSSARY],
  "plan.share": ["about {n}% of the page", "पानाचा सुमारे {n}%"],
  "plan.pinned": [
    { one: "{n} pinned", other: "{n} pinned" },
    { one: "{n} पिन केलेली", other: "{n} पिन केलेल्या" },
  ],

  // ---- step 2: the articles
  "arts.ledeEmpty": [
    "Type, paste or import the articles for this edition.",
    "या अंकाच्या बातम्या टाइप करा, पेस्ट करा किंवा आयात करा.",
  ],
  "arts.add": ["Add article", "बातमी जोडा"],
  "arts.paste": ["Paste several", "अनेक पेस्ट करा"],
  "arts.wordTitle": [
    "Add the stories of one or more Word (.docx) files",
    "एक किंवा अधिक Word (.docx) फायलींतील बातम्या जोडा",
  ],
  "arts.word": ["Word files…", "Word फायली…"],
  "arts.bundleTitle": [
    "Add the stories sent from Pageinator (a .zip file)",
    "Pageinator मधून पाठवलेल्या बातम्या जोडा (.zip फाइल)",
  ],
  "arts.bundle": ["Pageinator stories…", "Pageinator बातम्या…"],
  "arts.import": ["Import a past edition (for testing)", "जुना अंक आयात करा (चाचणीसाठी)"],
  "arts.searchLabel": ["Search articles", "बातम्यांमध्ये शोधा"],
  "arts.searchPlaceholder": ["Search headlines and text", "मथळे आणि मजकुरात शोधा"],
  "arts.placementAt": [
    "Placement shown from the last finished layout, {time}.",
    "मागच्या पूर्ण झालेल्या मांडणीतील ({time}) पाने दाखवली आहेत.",
  ],
  "arts.placement": [
    "Placement shown from the last finished layout.",
    "मागच्या पूर्ण झालेल्या मांडणीतील पाने दाखवली आहेत.",
  ],
  "arts.show": ["Show", "दाखवा"],
  "arts.all": ["All", "सर्व"],
  "arts.withPhoto": ["With photo", "छायाचित्रासह"],
  "arts.notPlaced": ["Not placed in last run", "मागच्या मांडणीत पानावर न आलेल्या"],
  "arts.notPlacedTitle": ["Shown after the first finished layout", "पहिली मांडणी पूर्ण झाल्यावर दिसते"],
  "arts.none": ["No articles yet", "अजून एकही बातमी नाही"],
  "arts.noneHint": [
    "Add one with “Add article”, paste several at once, or import a past edition to try the layout.",
    "“बातमी जोडा” वापरून एक बातमी जोडा, अनेक बातम्या एकदम पेस्ट करा, किंवा मांडणी करून पाहण्यासाठी जुना अंक आयात करा.",
  ],
  "arts.count": [
    { one: "{n} article, sorted by priority", other: "{n} articles, sorted by priority" },
    { one: "{n} बातमी, प्राधान्यानुसार क्रमाने", other: "{n} बातम्या, प्राधान्यानुसार क्रमाने" },
  ],
  "arts.showing": [
    { one: "Showing {n} of {total} articles", other: "Showing {n} of {total} articles" },
    { one: "{total} पैकी {n} बातमी दाखवली आहे", other: "{total} पैकी {n} बातम्या दाखवल्या आहेत" },
  ],
  "arts.noMatch": ["No articles match “{query}”.", "“{query}” शी जुळणारी एकही बातमी नाही."],
  "arts.noMatchFilter": ["No articles match this filter.", "या निवडीशी जुळणारी एकही बातमी नाही."],
  "arts.showAll": ["Show all articles", "सर्व बातम्या दाखवा"],
  "arts.noPhoto": ["no photo", "छायाचित्र नाही"],
  "arts.photoNoPreview": ["photo · no preview", "छायाचित्र · पूर्वावलोकन नाही"],
  "arts.warnings": [
    { one: "Warning", other: "{n} warnings" },
    { one: "इशारा", other: "{n} इशारे" },
  ],
  "arts.noHeadline": ["(no headline)", "(मथळा नाही)"],
  "arts.shortTitle": [
    "60 words or fewer and no photo: set in the news-in-brief column",
    "60 किंवा कमी शब्द आणि छायाचित्र नाही: थोडक्यात बातम्यांच्या स्तंभात जाते",
  ],
  "arts.shortChip": ["Short", "छोटी"],
  "arts.pinMissing": ["Page {n} — not in this edition", "पान {n} — या अंकात नाही"],
  "arts.auto": ["Auto", "आपोआप"],
  "arts.testTitle": ["Imported from a past edition for testing", "चाचणीसाठी जुन्या अंकातून आयात केलेली"],
  "arts.test": ["Test import", "चाचणी आयात"],
  "arts.pageSr": ["Page:", "पान:"],
  "arts.editedSince": ["(edited since)", "(नंतर बदलली)"],
  "arts.editAria": ["Edit: {headline}", "संपादित करा: {headline}"],
  "arts.deleteAria": ["Delete: {headline}", "हटवा: {headline}", GLOSSARY],
  "arts.deleteTitle": ["Delete this article?", "ही बातमी हटवायची?"],
  "arts.deleteMessage": [
    "“{headline}” will be removed from this edition, with its photo.",
    "“{headline}” ही बातमी तिच्या छायाचित्रासह या अंकातून काढली जाईल.",
  ],
  "arts.deleteOk": ["Delete article", "बातमी हटवा", GLOSSARY],
  "arts.deleted": ["Article deleted", "बातमी हटवली"],

  // ---- where an article went in the last finished layout
  "result.notPlacedWhy": ["Not placed: {reason}", "पानावर आली नाही: {reason}"],
  "result.notPlaced": ["Not placed", "पानावर आली नाही"],
  "result.pageFailed": ["Page {n} failed in the last layout", "मागच्या मांडणीत पान {n} अयशस्वी झाले"],
  "result.placed": ["Placed on page {n}", "पान {n} वर आली"],
  "result.addedAfter": ["Added after the last layout", "मागच्या मांडणीनंतर जोडली"],
  "result.notInReport": ["Not in the last layout's report", "मागच्या मांडणीच्या अहवालात नाही"],
  "hint.deleted": ["Nothing to do: it was deleted on purpose.", "काही करायची गरज नाही: ती मुद्दाम हटवली आहे."],
  "hint.takenOff": [
    "Bring it back onto a page in the page editor, if it must go in.",
    "ती छापायलाच हवी असेल तर पान संपादनात ती पुन्हा पानावर आणा.",
  ],
  "hint.tooLong": [
    "Too long for the space left — shorten it, pin it to another page, or add pages.",
    "उरलेल्या जागेसाठी खूप मोठी — ती छोटी करा, दुसऱ्या पानावर पिन करा, किंवा पाने वाढवा.",
  ],
  "hint.pinnedFull": [
    "The page it is pinned to is full — pin it to another page, or set it to Auto.",
    "ती पिन केलेले पान भरले आहे — ती दुसऱ्या पानावर पिन करा, किंवा ‘आपोआप’ निवडा.",
  ],
  "hint.photo": [
    "Check its photo — try another one, or remove it.",
    "तिचे छायाचित्र तपासा — दुसरे वापरून पाहा, किंवा ते काढा.",
  ],
  "hint.priority": ["Raise its priority if it must go in.", "ती छापायलाच हवी असेल तर तिचे प्राधान्य वाढवा."],
  "hint.general": [
    "Shorten it, raise its priority, pin it to another page, or add pages.",
    "ती छोटी करा, तिचे प्राधान्य वाढवा, दुसऱ्या पानावर पिन करा, किंवा पाने वाढवा.",
  ],
  "prio.legend": ["Priority", "प्राधान्य"],
  "prio.lead": ["Lead", "मुख्य"],
  "prio.top": ["Top", "महत्त्वाची"],
  "prio.normal": ["Normal", "सामान्य"],
  "prio.minor": ["Minor", "दुय्यम"],

  // ---- the article dialog
  "art.new": ["New article", "नवी बातमी"],
  "art.edit": ["Edit article", "बातमी संपादित करा"],
  "art.required": ["Fields marked * are required.", "* खूण असलेली माहिती भरणे आवश्यक आहे."],
  "art.headline": ["Headline", "मथळा", GLOSSARY],
  "art.kicker": ["Kicker", "वरचे शीर्षक", GLOSSARY],
  "art.kickerNote": ["A few words above the headline (optional).", "मथळ्याच्या वरचे काही शब्द (ऐच्छिक)."],
  "art.byline": ["Byline", "वार्ताहर नाव", GLOSSARY],
  "art.deck": ["Deck (sub-headline)", "उपमथळा", GLOSSARY],
  "art.body": ["Body", "मुख्य मजकूर", GLOSSARY],
  "art.bodyNote": [
    "Separate paragraphs with an empty line. Start a line with ## for a subheading.",
    "परिच्छेदांमध्ये एक रिकामी ओळ सोडा. उपशीर्षकासाठी ओळीची सुरुवात ## ने करा.",
  ],
  "art.shortItem": ["Short item", "छोटी बातमी"],
  "art.shortNote": [
    "60 words or fewer and no photo: it goes in the news-in-brief column.",
    "60 किंवा कमी शब्द आणि छायाचित्र नाही: ही बातमी थोडक्यात बातम्यांच्या स्तंभात जाईल.",
  ],
  "art.page": ["Page", "पान", GLOSSARY],
  "art.pageNote": ["Auto lets the Desk choose the page.", "‘आपोआप’ निवडल्यास डेस्क पान ठरवतो."],
  "art.pageAuto": ["Auto (the Desk chooses)", "आपोआप (डेस्क ठरवेल)"],
  "art.pageMissing": ["Page {n} (not in this edition)", "पान {n} (या अंकात नाही)"],
  "art.photo": ["Photo", "छायाचित्र", GLOSSARY],
  "art.addPhoto": ["Add a photo", "छायाचित्र जोडा"],
  "art.replacePhoto": ["Replace photo", "छायाचित्र बदला"],
  "art.removePhoto": ["Remove photo", "छायाचित्र काढा"],
  "art.photoNote": [
    "JPEG, PNG or WebP, up to 40 MB. It is uploaded when you save.",
    "JPEG, PNG किंवा WebP, 40 MB पर्यंत. जतन करताना ते अपलोड होते.",
  ],
  "art.caption": ["Caption", "छायाचित्र ओळ", GLOSSARY],
  "art.credit": ["Credit", "छायाचित्र सौजन्य", GLOSSARY],
  "art.save": ["Save article", "बातमी जतन करा"],
  "art.fromSample": ["test import from a past edition", "जुन्या अंकातून चाचणी आयात"],
  "art.typed": ["typed in", "टाइप केलेली"],
  "art.pasted": ["pasted", "पेस्ट केलेली"],
  "art.fromWord": ["from a Word file", "Word फाइलमधून"],
  "art.addedAt": ["Added {time}", "{time} ला जोडली"],
  "art.notes": ["The last layout noted:", "मागच्या मांडणीतील नोंदी:"],
  "art.newPhotoAlt": ["The new photo you chose", "तुम्ही निवडलेले नवे छायाचित्र"],
  "art.newPhotoNote": ["{name} ({size}) — uploaded when you save.", "{name} ({size}) — जतन करताना अपलोड होईल."],
  "art.keepOld": ["Keep the old photo", "जुने छायाचित्र ठेवा"],
  "art.dontUse": ["Don't use this photo", "हे छायाचित्र वापरू नका"],
  "art.storedNoPreview": ["Photo stored — no preview available.", "छायाचित्र जतन आहे — पूर्वावलोकन उपलब्ध नाही."],
  "art.photoAlt": ["The article's photo", "बातमीचे छायाचित्र"],
  "art.pixels": ["{w} × {h} pixels", "{w} × {h} पिक्सेल"],
  "art.willRemove": ["The photo will be removed when you save.", "जतन केल्यावर छायाचित्र काढले जाईल."],
  "art.noPhoto": ["No photo", "छायाचित्र नाही"],
  "art.keepPhoto": ["Keep the photo", "छायाचित्र ठेवा"],
  "art.badType": ["Use a JPEG, PNG or WebP photo.", "JPEG, PNG किंवा WebP छायाचित्र वापरा."],
  "art.emptyFile": ["This file is empty.", "ही फाइल रिकामी आहे."],
  "art.discardTitle": ["Discard your changes?", "केलेले बदल टाकून द्यायचे?"],
  "art.discardMessage": [
    "Your changes to this article have not been saved.",
    "या बातमीतील तुमचे बदल जतन झालेले नाहीत.",
  ],
  "art.discardOk": ["Discard changes", "बदल टाकून द्या"],
  "art.keepEditing": ["Keep editing", "संपादन चालू ठेवा"],
  "art.needHeadline": ["Write a headline.", "मथळा लिहा."],
  "art.needBody": ["Write the body text.", "मुख्य मजकूर लिहा."],
  "art.uploading": ["Uploading the photo…", "छायाचित्र अपलोड होत आहे…"],
  "art.saved": ["Article saved", "बातमी जतन झाली"],
  "art.photoNotSaved": [
    "The article text is saved, but the photo change is not: {error}",
    "बातमीचा मजकूर जतन झाला, पण छायाचित्रातील बदल जतन झाला नाही: {error}",
  ],
  "art.deleting": ["Deleting…", "हटवत आहे…"],

  // ---- paste several
  "paste.title": ["Paste several articles", "अनेक बातम्या एकदम पेस्ट करा"],
  "paste.lede": [
    "Paste many articles at once. Each one becomes its own article that you can edit afterwards.",
    "अनेक बातम्या एकाच वेळी पेस्ट करा. प्रत्येक बातमी स्वतंत्र होते आणि ती नंतर संपादित करता येते.",
  ],
  "paste.found": ["Headlines found", "सापडलेले मथळे"],
  "paste.how": ["How to paste", "कसे पेस्ट करावे"],
  "paste.help1": [
    "Put a line with only {code} between two articles.",
    "दोन बातम्यांच्या मध्ये फक्त {code} असलेली ओळ ठेवा.",
  ],
  "paste.help2": ["The first line of each article is its headline.", "प्रत्येक बातमीची पहिली ओळ तिचा मथळा असते."],
  "paste.help3": ["The next line may be {code} (optional).", "पुढची ओळ {code} अशी असू शकते (ऐच्छिक)."],
  "paste.help4": [
    "The rest is the body. Separate paragraphs with an empty line.",
    "उरलेला भाग मुख्य मजकूर असतो. परिच्छेदांमध्ये एक रिकामी ओळ सोडा.",
  ],
  // a byline line's marker: the server reads both (deskserver/store.py), so each language shows its own
  "paste.byline": ["Byline:", "वार्ताहर:", GLOSSARY],
  "paste.example": ["Example", "उदाहरण"],
  "paste.helpNote": [
    "New articles start with Normal priority and the page set to Auto. Add photos afterwards.",
    "नव्या बातम्यांचे प्राधान्य ‘सामान्य’ आणि पान ‘आपोआप’ असते. छायाचित्रे नंतर जोडा.",
  ],
  "paste.submit": ["Add articles", "बातम्या जोडा"],
  "paste.nothing": ["Nothing pasted yet.", "अजून काहीही पेस्ट केलेले नाही."],
  "paste.looksLike": [
    { one: "Looks like {n} article.", other: "Looks like {n} articles." },
    { one: "{n} बातमी दिसते.", other: "{n} बातम्या दिसतात." },
  ],
  "paste.noBody": [
    {
      one: "{n} of them has a headline but no body text yet.",
      other: "{n} of them have a headline but no body text yet.",
    },
    {
      one: "त्यांपैकी {n} बातमीला मथळा आहे, पण अजून मुख्य मजकूर नाही.",
      other: "त्यांपैकी {n} बातम्यांना मथळा आहे, पण अजून मुख्य मजकूर नाही.",
    },
  ],
  "paste.more": ["…and {n} more", "…आणि आणखी {n}"],
  "paste.empty": ["Paste at least one article first.", "आधी किमान एक बातमी पेस्ट करा."],
  "paste.adding": ["Adding…", "जोडत आहे…"],
  "paste.added": [
    { one: "Added {n} article.", other: "Added {n} articles." },
    { one: "{n} बातमी जोडली.", other: "{n} बातम्या जोडल्या." },
  ],
  "paste.notAdded": [
    {
      one: "Not added: {list}. It is still in the box: fix it and add it again.",
      other: "Not added: {list}. They are still in the box: fix them and add again.",
    },
    {
      one: "जोडली नाही: {list}. ती अजून चौकटीत आहे: ती दुरुस्त करून पुन्हा जोडा.",
      other: "जोडल्या नाहीत: {list}. त्या अजून चौकटीत आहेत: त्या दुरुस्त करून पुन्हा जोडा.",
    },
  ],
  "common.notAccepted": ["not accepted", "स्वीकारली नाही"],

  // ---- Word files
  "word.reading": [
    { one: "Reading {n} Word file…", other: "Reading {n} Word files…" },
    { one: "{n} Word फाइल वाचत आहे…", other: "{n} Word फायली वाचत आहे…" },
  ],
  "word.notDocx": [
    "{file}: not a .docx file (save it as .docx in Word)",
    "{file}: ही .docx फाइल नाही (Word मध्ये ती .docx म्हणून जतन करा)",
  ],
  // {from} is word.fromFiles, the file count in the case its sentence needs
  "word.fromFiles": [
    { one: "from {n} Word file", other: "from {n} Word files" },
    { one: "{n} Word फाइलमधून", other: "{n} Word फायलींमधून" },
  ],
  "word.added": [
    { one: "Added {n} article {from}.", other: "Added {n} articles {from}." },
    { one: "{from} {n} बातमी जोडली.", other: "{from} {n} बातम्या जोडल्या." },
  ],
  "word.addedOf": [
    { one: "Added {n} article {from} (of {chosen} chosen).", other: "Added {n} articles {from} (of {chosen} chosen)." },
    {
      one: "{from} {n} बातमी जोडली (निवडलेल्या फायली: {chosen}).",
      other: "{from} {n} बातम्या जोडल्या (निवडलेल्या फायली: {chosen}).",
    },
  ],
  "word.noneAdded": [
    { one: "No article was added from {n} Word file.", other: "No article was added from {n} Word files." },
    {
      one: "{n} Word फाइलमधून एकही बातमी जोडली गेली नाही.",
      other: "{n} Word फायलींमधून एकही बातमी जोडली गेली नाही.",
    },
  ],

  // ---- Pageinator stories: a story bundle from the hosted newsroom (CONTRACT.md §6)
  "bundle.reading": ["Reading the Pageinator stories file…", "Pageinator बातम्यांची फाइल वाचत आहे…"],
  "bundle.notZip": [
    "{file}: not a .zip file (download the stories from Pageinator again)",
    "{file}: ही .zip फाइल नाही (Pageinator मधून बातम्या पुन्हा डाउनलोड करा)",
  ],
  "bundle.refused": ["{file} was not imported: {reason}", "{file} आयात केली नाही: {reason}"],
  // {list} is the counts below that are not zero, joined with "; "
  "bundle.summary": ["From {file}: {list}.", "{file} मधून: {list}."],
  "bundle.nothing": ["{file} holds no stories.", "{file} मध्ये एकही बातमी नाही."],
  "bundle.added": [
    { one: "{n} story added", other: "{n} stories added" },
    { one: "{n} बातमी जोडली", other: "{n} बातम्या जोडल्या" },
  ],
  "bundle.replaced": [
    { one: "{n} replaced by its newer revision", other: "{n} replaced by their newer revisions" },
    { one: "{n} बातमी नव्या आवृत्तीने बदलली", other: "{n} बातम्या नव्या आवृत्तीने बदलल्या" },
  ],
  "bundle.unchanged": [
    { one: "{n} already up to date", other: "{n} already up to date" },
    { one: "{n} आधीच अद्ययावत", other: "{n} आधीच अद्ययावत" },
  ],
  "bundle.kept": [
    { one: "{n} kept as the Desk has it", other: "{n} kept as the Desk has them" },
    { one: "{n} Desk मध्ये आहे तशी ठेवली", other: "{n} Desk मध्ये आहेत तशा ठेवल्या" },
  ],
  "bundle.deleted": [
    { one: "{n} deleted in the Desk, not added again", other: "{n} deleted in the Desk, not added again" },
    { one: "{n} Desk मधून हटवलेली, पुन्हा जोडली नाही", other: "{n} Desk मधून हटवलेल्या, पुन्हा जोडल्या नाहीत" },
  ],
  "bundle.refusedN": [
    { one: "{n} not added", other: "{n} not added" },
    { one: "{n} जोडली नाही", other: "{n} जोडल्या नाहीत" },
  ],
  // a story kept or not added, and why (the reason is the server's, by its code)
  "bundle.line": ["“{headline}”: {reason}", "“{headline}”: {reason}", SAME],

  // ---- import a past edition (testing)
  "imp.lede": [
    "Copies the stories and photos of a past printed edition into this edition, so you can try the layout without " +
      "typing. Imported stories are marked “Test import” in the list. Delete them before you lay out a real edition.",
    "आधी छापलेल्या अंकातील बातम्या आणि छायाचित्रे या अंकात कॉपी होतात, म्हणजे टाइप न करता मांडणी करून पाहता येते. " +
      "आयात केलेल्या बातम्यांवर यादीत “चाचणी आयात” अशी खूण असते. खऱ्या अंकाची मांडणी करण्यापूर्वी त्या हटवा.",
  ],
  "imp.submit": ["Import selected", "निवडलेले आयात करा"],
  "imp.looking": ["Looking for past editions…", "जुने अंक शोधत आहे…"],
  "imp.none": ["No past editions were found in the dataset.", "डेटासेटमध्ये एकही जुना अंक सापडला नाही."],
  "imp.legend": ["Past editions", "जुने अंक"],
  "imp.already": ["Already imported into this edition", "या अंकात आधीच आयात केला आहे"],
  "imp.choose": ["Choose at least one past edition.", "किमान एक जुना अंक निवडा."],
  "imp.importing": ["Importing — this can take a minute.", "आयात होत आहे — याला एखादे मिनिट लागू शकते."],
  "imp.done": ["Imported {stories} and {photos}", "आयात झाले: {stories} आणि {photos}"],

  // ---- step 3: ads
  "ads.lede": [
    "Ad spaces filled: {n} of {total}. Spaces without an image print as a grey box marked AD.",
    "भरलेल्या जाहिरात-जागा: {total} पैकी {n}. चित्र नसलेल्या जागी ‘जाहिरात’ लिहिलेली राखाडी चौकट छापली जाते.",
  ],
  "ads.ledeNone": ["Ad spaces come from the page plan.", "जाहिरातींच्या जागा पान आराखड्यातून येतात."],
  "ads.backAllNews": [
    "The back page is all news (no ad spaces). Change this in step 1.",
    "शेवटच्या पानावर फक्त बातम्या आहेत (जाहिरातींसाठी जागा नाही). हे पायरी 1 मध्ये बदला.",
  ],
  "ads.goStep1": ["Go to step 1", "पायरी 1 वर जा"],
  "ads.none": ["This edition has no ad spaces.", "या अंकात जाहिरातींसाठी जागा नाही."],
  "ads.noPreview": ["Image stored — no preview", "चित्र जतन आहे — पूर्वावलोकन नाही"],
  "ads.imageAlt": ["Ad image for space {slot}", "जागा {slot} साठी जाहिरातीचे चित्र"],
  "ads.space": ["Ad space {slot}", "जाहिरात-जागा {slot}"],
  "ads.size": ["{w} × {h} mm", "{w} × {h} मिमी"],
  "ads.addedPx": ["Image added (fitted at {w} × {h} pixels)", "चित्र जोडले ({w} × {h} पिक्सेलमध्ये बसवले)"],
  "ads.added": ["Image added", "चित्र जोडले"],
  "ads.reserved": [
    "Reserved space — prints as a grey box marked AD",
    "राखीव जागा — इथे ‘जाहिरात’ लिहिलेली राखाडी चौकट छापली जाते",
  ],
  "ads.noteMin": [
    "JPEG, PNG or WebP, up to 40 MB. For a sharp print use at least {w} × {h} pixels. The image is fitted inside the " +
      "space, with white around it if the shapes differ.",
    "JPEG, PNG किंवा WebP, 40 MB पर्यंत. स्पष्ट छपाईसाठी किमान {w} × {h} पिक्सेलचे चित्र वापरा. चित्र जागेत बसवले " +
      "जाते; आकार वेगळा असेल तर भोवती पांढरी जागा राहते.",
  ],
  "ads.note": ["JPEG, PNG or WebP, up to 40 MB.", "JPEG, PNG किंवा WebP, 40 MB पर्यंत."],
  "ads.replace": ["Replace image", "चित्र बदला"],
  "ads.upload": ["Upload image", "चित्र अपलोड करा"],
  "ads.badType": ["Use a JPEG, PNG or WebP image.", "JPEG, PNG किंवा WebP चित्र वापरा."],
  "ads.uploading": ["Uploading and converting…", "अपलोड आणि रूपांतर होत आहे…"],
  "ads.toastAdded": ["Ad image added to space {slot}", "जागा {slot} मध्ये जाहिरातीचे चित्र जोडले"],
  "ads.removeTitle": ["Remove this ad image?", "हे जाहिरातीचे चित्र काढायचे?"],
  "ads.removeMessage": [
    "Space {slot} will print as a grey box marked AD until you upload another image.",
    "दुसरे चित्र अपलोड करेपर्यंत जागा {slot} मध्ये ‘जाहिरात’ लिहिलेली राखाडी चौकट छापली जाईल.",
  ],
  "ads.removeOk": ["Remove image", "चित्र काढा"],
  "ads.toastRemoved": ["Ad image removed from space {slot}", "जागा {slot} मधून जाहिरातीचे चित्र काढले"],

  // ---- step 4: lay out & download
  "run.lede": [
    "Lay out the {n}-page paper, check the pages, then download the PDFs.",
    "{n} पानांच्या अंकाची मांडणी करा, पाने तपासा, मग PDF डाउनलोड करा.",
  ],
  "run.running": [
    "A layout is running. Follow it below, or cancel it to start again.",
    "एक मांडणी सुरू आहे. ती खाली पाहा, किंवा पुन्हा सुरुवात करायची असेल तर ती रद्द करा.",
  ],
  "run.noArticles": [
    "Add articles first (step 2) — there is nothing to lay out yet.",
    "आधी बातम्या जोडा (पायरी 2) — मांडणीसाठी अजून काहीच नाही.",
  ],
  "run.engineSetup": [
    "The layout engine needs setup first: {reason}",
    "मांडणी इंजिनची आधी तयारी करावी लागेल: {reason}",
  ],
  "run.engineSetupDefault": [
    "The layout engine needs setup first: see the engine status at the top right.",
    "मांडणी इंजिनची आधी तयारी करावी लागेल: वर उजवीकडे इंजिनची स्थिती पाहा.",
  ],
  "run.warnStories": [
    {
      one: "You have {n} of about {need} stories — some pages may come out short.",
      other: "You have {n} of about {need} stories — some pages may come out short.",
    },
    {
      one: "सुमारे {need} बातम्यांपैकी तुमच्याकडे {n} बातमी आहे — काही पाने अपुरी राहू शकतात.",
      other: "सुमारे {need} बातम्यांपैकी तुमच्याकडे {n} बातम्या आहेत — काही पाने अपुरी राहू शकतात.",
    },
  ],
  "run.warnPhotos": [
    {
      one: "You have {n} of about {need} photos the paper usually carries.",
      other: "You have {n} of about {need} photos the paper usually carries.",
    },
    {
      one: "अंकात साधारण {need} छायाचित्रे असतात; तुमच्याकडे {n} आहे.",
      other: "अंकात साधारण {need} छायाचित्रे असतात; तुमच्याकडे {n} आहेत.",
    },
  ],
  "run.warnPinned": [
    {
      one:
        "{n} article is pinned to a page this {pages}-page edition does not have — the Desk will place it itself " +
        "(change its page in step 2 to choose one).",
      other:
        "{n} articles are pinned to a page this {pages}-page edition does not have — the Desk will place them " +
        "itself (change their page in step 2 to choose one).",
    },
    {
      one:
        "{n} बातमी या {pages} पानांच्या अंकात नसलेल्या पानावर पिन केली आहे — डेस्क ती स्वतः ठेवेल (पान निवडायचे " +
        "असेल तर पायरी 2 मध्ये तिचे पान बदला).",
      other:
        "{n} बातम्या या {pages} पानांच्या अंकात नसलेल्या पानांवर पिन केल्या आहेत — डेस्क त्या स्वतः ठेवेल (पान " +
        "निवडायचे असेल तर पायरी 2 मध्ये त्यांचे पान बदला).",
    },
  ],
  "run.warnAds": [
    {
      one: "{n} ad space of {total} has no image — it prints as a grey box marked AD.",
      other: "{n} ad spaces of {total} have no image — they print as a grey box marked AD.",
    },
    {
      one: "{total} पैकी {n} जाहिरात-जागेत चित्र नाही — तिथे ‘जाहिरात’ लिहिलेली राखाडी चौकट छापली जाईल.",
      other: "{total} पैकी {n} जाहिरात-जागांमध्ये चित्र नाही — तिथे ‘जाहिरात’ लिहिलेल्या राखाडी चौकटी छापल्या जातील.",
    },
  ],
  "run.warnSamples": [
    {
      one: "{n} article is a test import from a past edition. Delete it before you lay out a real edition.",
      other: "{n} articles are test imports from a past edition. Delete them before you lay out a real edition.",
    },
    {
      one: "{n} बातमी जुन्या अंकातून चाचणीसाठी आयात केलेली आहे. खऱ्या अंकाची मांडणी करण्यापूर्वी ती हटवा.",
      other: "{n} बातम्या जुन्या अंकातून चाचणीसाठी आयात केलेल्या आहेत. खऱ्या अंकाची मांडणी करण्यापूर्वी त्या हटवा.",
    },
  ],
  "run.starting": ["Starting…", "सुरू होत आहे…"],
  "run.go": ["Lay out the {n}-page paper", "{n} पानांच्या अंकाची मांडणी करा"],
  "run.goAgain": ["Lay out the {n}-page paper again", "{n} पानांच्या अंकाची पुन्हा मांडणी करा"],
  "run.beforeStart": ["Before you start", "सुरू करण्यापूर्वी"],
  "run.startLabel": ["Start a layout", "मांडणी सुरू करा"],
  "run.checks": [
    { one: "{n} thing to check before the next layout", other: "{n} things to check before the next layout" },
    { one: "पुढच्या मांडणीपूर्वी तपासायची {n} गोष्ट", other: "पुढच्या मांडणीपूर्वी तपासायच्या {n} गोष्टी" },
  ],
  "run.timeNote": [
    "Laying out pages in parallel — usually 1 to 4 minutes.",
    "सर्व पानांची मांडणी एकाच वेळी होते — साधारण 1 ते 4 मिनिटे लागतात.",
  ],
  "run.keepWorking": [
    "You can keep working in the other steps; changes you make now go into the next layout.",
    "तुम्ही इतर पायऱ्यांमध्ये काम चालू ठेवू शकता; आता केलेले बदल पुढच्या मांडणीत येतील.",
  ],
  "run.started": ["Started laying out the {n}-page paper", "{n} पानांच्या अंकाची मांडणी सुरू झाली"],
  "run.conflict": ["{error} The running layout is shown below.", "{error} सुरू असलेली मांडणी खाली दाखवली आहे."],
  "run.gone": [
    "This layout could not be found on the Desk server any more.",
    "ही मांडणी आता डेस्क सर्व्हरवर सापडत नाही.",
  ],
  "run.retrying": ["{error} Trying again…", "{error} पुन्हा प्रयत्न करत आहे…"],
  "run.sayState": ["Layout: {state}.", "मांडणी: {state}."],
  "run.sayDone": ["Page {n} is done.", "पान {n} पूर्ण झाले."],
  "run.sayFailed": ["Page {n} failed.", "पान {n} अयशस्वी झाले."],
  "run.toastDone": ["The {n}-page paper is laid out", "{n} पानांच्या अंकाची मांडणी झाली"],
  "run.toastFailed": [
    "The layout failed — the details are in step 4",
    "मांडणी अयशस्वी झाली — तपशील पायरी 4 मध्ये आहेत",
  ],
  "run.toastCancelled": ["Layout cancelled", "मांडणी रद्द झाली"],
  "run.soFar": ["{time} so far", "आतापर्यंत {time}"],
  "run.took": ["Took {time}", "{time} लागले"],
  "run.stoppedAfter": ["Stopped after {time}", "{time} नंतर थांबली"],
  "run.cancel": ["Cancel layout", "मांडणी रद्द करा"],
  "run.layoutOf": ["Layout of {time}", "{time} ची मांडणी"],
  "run.layout": ["Layout", "मांडणी"],
  "run.unknownState": ["Unknown state", "अज्ञात स्थिती"],
  "run.progress": [
    { one: "{n} of {total} pages done", other: "{n} of {total} pages done" },
    { one: "{total} पैकी {n} पान पूर्ण", other: "{total} पैकी {n} पाने पूर्ण" },
  ],
  "run.progressFailed": [
    { one: "{n} of {total} pages done, {failed} failed", other: "{n} of {total} pages done, {failed} failed" },
    { one: "{total} पैकी {n} पान पूर्ण, {failed} अयशस्वी", other: "{total} पैकी {n} पाने पूर्ण, {failed} अयशस्वी" },
  ],
  "run.planning": ["Planning the pages…", "पानांचे नियोजन सुरू आहे…"],
  "run.newer": [
    "A newer layout is running. Open it from the list below to follow it.",
    "नवी मांडणी सुरू आहे. ती पाहण्यासाठी खालच्या यादीतून उघडा.",
  ],
  "run.addedAfter": [
    {
      one:
        "{n} article was added after this layout, which does not have it: lay out again to place it (that starts " +
        "every page afresh; page edits are not kept).",
      other:
        "{n} articles were added after this layout, which does not have them: lay out again to place them (that " +
        "starts every page afresh; page edits are not kept).",
    },
    {
      one:
        "या मांडणीनंतर {n} बातमी जोडली गेली; ती या मांडणीत नाही: ती पानावर आणण्यासाठी पुन्हा मांडणी करा (त्यात " +
        "प्रत्येक पान नव्याने मांडले जाते; पानांत केलेले बदल राहत नाहीत).",
      other:
        "या मांडणीनंतर {n} बातम्या जोडल्या गेल्या; त्या या मांडणीत नाहीत: त्या पानांवर आणण्यासाठी पुन्हा मांडणी करा " +
        "(त्यात प्रत्येक पान नव्याने मांडले जाते; पानांत केलेले बदल राहत नाहीत).",
    },
  ],
  "run.noPreview": ["No preview", "पूर्वावलोकन नाही"],
  "run.openPreview": ["{page}: open a large preview", "{page}: मोठे पूर्वावलोकन उघडा"],
  "run.pageFailed": ["This page could not be laid out.", "या पानाची मांडणी होऊ शकली नाही."],
  "run.previewNotReady": ["Preview not ready yet.", "पूर्वावलोकन अजून तयार नाही."],
  "run.changedSave": ["Changed: open the page and save it.", "बदलले आहे: पान उघडून जतन करा."],
  "run.changedUnsaved": [
    "Changed in the editor, not saved: its print file is older.",
    "संपादनात बदलले, पण जतन केले नाही: त्याची छपाईची फाइल जुनी आहे.",
  ],
  "run.editPage": ["Edit page", "पान संपादित करा"],
  "run.editPageEdited": ["Edit page (edited)", "पान संपादित करा (बदललेले)"],
  "run.checkPassed": ["PDF/X-1a check passed", "PDF/X-1a तपासणीत उत्तीर्ण"],
  "run.checkProblems": [
    {
      one: "PDF/X-1a check: {n} problem — do not send to the press",
      other: "PDF/X-1a check: {n} problems — do not send to the press",
    },
    {
      one: "PDF/X-1a तपासणी: {n} समस्या — छापखान्याकडे पाठवू नका",
      other: "PDF/X-1a तपासणी: {n} समस्या — छापखान्याकडे पाठवू नका",
    },
  ],
  "run.checkNotRun": ["PDF/X-1a check did not run", "PDF/X-1a तपासणी झाली नाही"],
  "run.cancelTitle": ["Cancel this layout?", "ही मांडणी रद्द करायची?"],
  "run.cancelMessage": [
    "The Desk stops laying out this edition. You can start a new layout at any time.",
    "डेस्क या अंकाची मांडणी थांबवेल. नवी मांडणी कधीही सुरू करता येईल.",
  ],
  "run.keepGoing": ["Keep going", "चालू ठेवा"],
  "run.cancelling": ["Cancelling the layout…", "मांडणी रद्द होत आहे…"],
  // a layout's state (the server's status.json "state")
  "state.queued": ["Waiting to start", "सुरू होण्याची वाट पाहत आहे"],
  "state.starting": ["Starting", "सुरू होत आहे"],
  "state.planning": ["Planning the pages", "पानांचे नियोजन"],
  "state.layout": ["Laying out pages", "पानांची मांडणी सुरू"],
  "state.finishing": ["Making the PDFs and previews", "PDF आणि पूर्वावलोकने तयार होत आहेत"],
  "state.done": ["Done", "पूर्ण"],
  "state.failed": ["Failed", "अयशस्वी"],
  "state.cancelled": ["Cancelled", "रद्द"],
  // a page's state while it is laid out
  "pstate.waiting": ["Waiting", "प्रतीक्षेत"],
  "pstate.working": ["Laying out", "मांडणी सुरू"],

  // ---- why the press files are not current (joined with "; " into res.mismatch); {pages}: "2, 3"
  "press.notFinished": [
    "this layout did not finish: lay the edition out again",
    "ही मांडणी पूर्ण झाली नाही: अंकाची पुन्हा मांडणी करा",
  ],
  "press.gone": [
    "this layout could not be found on the Desk server any more",
    "ही मांडणी आता डेस्क सर्व्हरवर सापडत नाही",
  ],
  "press.relayout": [
    "this layout no longer fits the edition: lay the edition out again",
    "ही मांडणी आता अंकाशी जुळत नाही: अंकाची पुन्हा मांडणी करा",
  ],
  // "Save page" / "पान जतन करा" is the page editor's button (pe.save)
  "press.toSave": [
    {
      one: "page {pages} still to save in the page editor (open it and press Save page)",
      other: "pages {pages} still to save in the page editor (open them and press Save page)",
    },
    {
      one: "पान {pages} अजून जतन करायचे आहे (पान संपादनात ते उघडून ‘पान जतन करा’ दाबा)",
      other: "पाने {pages} अजून जतन करायची आहेत (पान संपादनात ती उघडून ‘पान जतन करा’ दाबा)",
    },
  ],
  "press.failing": [
    { one: "page {pages} not passing the PDF/X-1a check", other: "pages {pages} not passing the PDF/X-1a check" },
    { one: "पान {pages} PDF/X-1a तपासणीत उत्तीर्ण नाही", other: "पाने {pages} PDF/X-1a तपासणीत उत्तीर्ण नाहीत" },
  ],
  "press.repeats": [
    "pages {pages} print the same article: take it off one of them in the page editor",
    "पाने {pages} वर एकच बातमी छापली जाते: पान संपादनात ती त्यांपैकी एका पानावरून काढा",
  ],
  // stories over each other, or outside the news area or over an ad (deskserver/press.py pages_with_overlaps)
  "press.overlaps": [
    {
      one: "page {pages} has stories over each other or outside the news area: move them apart in the page editor and save it",
      other:
        "pages {pages} have stories over each other or outside the news area: move them apart in the page editor and save them",
    },
    {
      one: "पान {pages} वर बातम्या एकमेकींवर येतात किंवा बातम्यांच्या जागेबाहेर जातात: पान संपादनात त्या वेगळ्या करा आणि पान जतन करा",
      other:
        "पाने {pages} वर बातम्या एकमेकींवर येतात किंवा बातम्यांच्या जागेबाहेर जातात: पान संपादनात त्या वेगळ्या करा आणि पाने जतन करा",
    },
  ],
  "press.failed": [
    { one: "page {pages} could not be laid out", other: "pages {pages} could not be laid out" },
    { one: "पान {pages} ची मांडणी होऊ शकली नाही", other: "पाने {pages} ची मांडणी होऊ शकली नाही" },
  ],
  "press.notAll": ["not every page is laid out and checked", "सगळ्या पानांची मांडणी आणि तपासणी झालेली नाही"],

  // ---- a finished layout's results
  "res.downloads": ["Downloads", "डाउनलोड"],
  "res.doNotSend": ["Do not send these press files yet.", "या छापखान्यासाठीच्या फायली अजून पाठवू नका."],
  "res.checking": ["Checking them against your last change…", "तुमच्या शेवटच्या बदलानुसार त्या पुन्हा तपासत आहे…"],
  "res.mismatch": ["They do not match the pages: {reasons}.", "त्या पानांशी जुळत नाहीत: {reasons}."],
  "res.editionPdf": ["Edition PDF", "अंकाची PDF"],
  "res.editionPdfSub": ["All pages, for reading and proofs", "सर्व पाने, वाचण्यासाठी आणि प्रूफसाठी"],
  "res.editionPdfMissing": ["Edition PDF: not made in this layout.", "अंकाची PDF: या मांडणीत तयार झाली नाही."],
  "res.press": ["Press files", "छापखान्यासाठी फायली"],
  "res.pressMissing": ["Press files: not made in this layout.", "छापखान्यासाठी फायली: या मांडणीत तयार झाल्या नाहीत."],
  "res.pressChecked": [
    "One PDF per page, each passed the PDF/X-1a check — ZIP",
    "प्रत्येक पानाची एक PDF, प्रत्येक PDF/X-1a तपासणीत उत्तीर्ण — ZIP",
  ],
  "res.pressNotCurrent": ["Not current — see the note above", "सध्याच्या पानांशी जुळत नाहीत — वरची सूचना पाहा"],
  "res.pressSeeChecks": [
    "One PDF per page, ZIP — see the page checks",
    "प्रत्येक पानाची एक PDF, ZIP — पानांच्या तपासण्या पाहा",
  ],
  "res.pagePdf": ["PDF of {page}", "{page} ची PDF"],
  "res.singlePages": ["Single page PDFs:", "एकेका पानाच्या PDF:"],
  // never "press-ready" (CONTRACT.md §5)
  "res.honesty": [
    "Every page PDF is written as PDF/X-1a and then checked by an independent PDF/X-1a checker (the result is on " +
      "each page above). The press has accepted a text-only test page from this writer; pages with photos or ads have " +
      "not been press-tested yet — print one test page before a real edition.",
    "प्रत्येक पानाची PDF, PDF/X-1a स्वरूपात लिहिली जाते आणि मग एका स्वतंत्र PDF/X-1a तपासणी-साधनाने तपासली जाते " +
      "(निकाल वर प्रत्येक पानावर आहे). हीच PDF-लेखन प्रणाली वापरून केलेले, फक्त मजकूर असलेले एक चाचणी पान " +
      "छापखान्याने स्वीकारले आहे; छायाचित्रे किंवा जाहिराती असलेली पाने अजून छापखान्यात तपासलेली नाहीत — खऱ्या " +
      "अंकापूर्वी एक चाचणी पान छापून पाहा.",
  ],
  "res.failedWhy": ["Failed: {reason}", "अयशस्वी: {reason}"],
  "res.failed": ["Failed: this page could not be laid out.", "अयशस्वी: या पानाची मांडणी होऊ शकली नाही."],
  "res.goneArticle": ["(an article that is no longer in this edition)", "(ही बातमी आता या अंकात नाही)"],
  "res.noArticles": ["No articles on this page.", "या पानावर एकही बातमी नाही."],
  "res.warnings": ["Warnings", "इशारे"],
  "res.report": ["What went where", "काय कुठे गेले"],
  "res.notPlacedN": ["Not placed ({n})", "पानावर न आलेल्या ({n})"],
  "res.notPlaced": ["Not placed", "पानावर न आलेल्या"],
  "res.allPlaced": ["Every article was placed.", "प्रत्येक बातमी पानावर आली."],
  "res.noReason": ["No reason given.", "कारण दिलेले नाही."],
  "res.otherWarnings": ["Other warnings", "इतर इशारे"],
  "res.articleWarnings": ["Warnings for this article", "या बातमीसाठी इशारे"],
  // joined with " · "; English capitalises the first
  "res.measured": ["measured in {time}", "मोजमाप {time}"],
  "res.planned": ["planned in {time}", "नियोजन {time}"],
  "res.laidOut": ["laid out in {time}", "मांडणी {time}"],
  "hist.title": ["Earlier layouts of this edition", "या अंकाच्या आधीच्या मांडण्या"],
  "hist.none": [
    "None yet. Your layouts are listed here, newest first.",
    "अजून एकही नाही. तुमच्या मांडण्या इथे दिसतील, सर्वात नवी आधी.",
  ],
  "hist.unknown": ["Unknown", "अज्ञात"],
  "hist.shown": ["Shown above", "वर दाखवली आहे"],
  "hist.openAria": ["Open the layout of {time}", "{time} ची मांडणी उघडा"],

  // ---- the page preview
  "prev.zoom": ["Zoom", "आकार"],
  "prev.fit": ["Fit", "संपूर्ण पान", GLOSSARY],
  "prev.prev": ["Previous page", "मागचे पान"],
  "prev.next": ["Next page", "पुढचे पान"],
  "prev.pdf": ["Page PDF", "पानाची PDF"],
  "prev.missing": ["The preview of this page could not be loaded.", "या पानाचे पूर्वावलोकन लोड करता आले नाही."],
  "prev.title": ["{page} — {i} of {total}", "{page} — {total} पैकी {i}"],
  "prev.alt": ["{page}: preview of the laid-out page", "{page}: मांडलेल्या पानाचे पूर्वावलोकन"],

  // ---- the new edition dialog
  "new.lede": [
    "Choose the date and the size. You can change these later in step 1.",
    "तारीख आणि आकार निवडा. हे नंतर पायरी 1 मध्ये बदलता येईल.",
  ],
  "new.folioNote": [
    "Optional. They are printed in the front-page folio where the template has a place for them; leave a box empty " +
      "to keep the template's own text.",
    "ऐच्छिक. साच्यात जागा असेल तिथे हे पहिल्या पानाच्या फोलिओ ओळीत छापले जातात; साच्याचा स्वतःचा मजकूर ठेवायचा " +
      "असेल तर चौकट रिकामी ठेवा.",
  ],
  "new.create": ["Create edition", "अंक तयार करा"],
  "new.creating": ["Creating…", "तयार होत आहे…"],
  "new.created": ["Edition for {date} created", "{date} चा अंक तयार झाला"],
  "new.lastIssue": ["Last: {issue}", "मागचा: {issue}"],
  "new.dateTaken": [
    "There is already an edition for {date}. Creating another makes a second one for the same day.",
    "{date} चा अंक आधीच आहे. आणखी एक तयार केल्यास त्याच दिवसाचा दुसरा अंक होईल.",
  ],
  // {lead}: new.needsLead, in bold; {list}: "52 stories, 4 short items, …"
  "new.needs": ["{lead} {list}. Bring about 15–20% extra.", "{lead} {list} लागतात. सुमारे 15–20% जास्त आणा."],
  "new.needsLead": ["A paper of {n} pages usually needs about", "{n} पानांच्या अंकाला साधारण"],

  // ======================================================================== the page editor (editor.html, editor.js)
  // Keys keep their names as printed on the keyboard (Ctrl+Z, Shift+L, Esc, Page Up) in both languages.
  "pe.errTimeout": ["The Desk did not answer in time.", "डेस्कने वेळेत उत्तर दिले नाही."],
  "pe.errUnreadable": ["The Desk's answer could not be read.", "डेस्कचे उत्तर वाचता आले नाही."],
  "pe.errStatus": ["The Desk answered {status}.", "डेस्कने {status} असे उत्तर दिले."],
  "pe.busyOpening": ["Opening the page…", "पान उघडत आहे…"],
  "pe.undoAfresh": ["Undo starts afresh from here.", "पूर्ववत आता इथून नव्याने सुरू होते."],
  "pe.newerRun": [
    "A newer layout of this edition was made ({newer}). This page belongs to the older layout ({older}): changes here do not reach the newer one.",
    "या अंकाची नवी मांडणी झाली आहे ({newer}). हे पान जुन्या मांडणीचे आहे ({older}): इथले बदल नव्या मांडणीत जात नाहीत.",
  ],
  "pe.changesKept": [
    "Your changes to this page are kept. Save page makes its print file.",
    "या पानातील तुमचे बदल राखून ठेवले आहेत. ‘पान जतन करा’ दाबल्यावर त्याची छपाईची फाइल तयार होते.",
  ],
  "pe.alsoOn": [
    {
      one: "A story here is still on page {pages} too: saving this page takes it off that page.",
      other: "{n} stories here are still on page {pages} too: saving this page takes them off those pages.",
    },
    {
      one: "इथली एक बातमी अजून पान {pages} वरही आहे: हे पान जतन केल्यावर ती त्या पानावरून निघते.",
      other: "इथल्या {n} बातम्या अजून पान {pages} वरही आहेत: हे पान जतन केल्यावर त्या त्या पानांवरून निघतात.",
    },
  ],
  "pe.alsoLockedOne": [
    "{Name} is also on page {pages}, locked there: this page cannot be saved until it is unlocked there or taken off this page.",
    "{Name} पान {pages} वरही आहे आणि तिथे तिला कुलूप आहे: तिथले कुलूप काढेपर्यंत किंवा ती या पानावरून काढेपर्यंत हे पान जतन करता येणार नाही.",
  ],
  "pe.alsoLocked": [
    {
      one: "{n} story here is also on page {pages}, locked there: this page cannot be saved until it is unlocked there or taken off this page.",
      other:
        "{n} stories here are also on page {pages}, locked there: this page cannot be saved until they are unlocked there or taken off this page.",
    },
    {
      one: "इथली {n} बातमी पान {pages} वरही आहे आणि तिथे तिला कुलूप आहे: तिथले कुलूप काढेपर्यंत किंवा ती या पानावरून काढेपर्यंत हे पान जतन करता येणार नाही.",
      other:
        "इथल्या {n} बातम्या पान {pages} वरही आहेत आणि तिथे त्यांना कुलूप आहे: तिथली कुलपे काढेपर्यंत किंवा त्या या पानावरून काढेपर्यंत हे पान जतन करता येणार नाही.",
    },
  ],
  "pe.held": [
    "This page cannot be saved yet: {name} is also on page {page}, locked there. Unlock it on page {page}, or take it off this page, then save.",
    "हे पान अजून जतन करता येत नाही: {name} पान {page} वरही आहे आणि तिथे तिला कुलूप आहे. पान {page} वर कुलूप काढा, किंवा ती या पानावरून काढा, मग जतन करा.",
  ],
  "pe.cropReset": [
    "The photo of {name} changed: its crop is reset.",
    "{name} चे छायाचित्र बदलले: त्याचा काप पूर्वीसारखा केला आहे.",
  ],
  "pe.busyAnother": ["Laying the page out another way…", "पानाची दुसरी मांडणी करत आहे…"],
  "pe.alt1": ["Lead on the other side.", "मुख्य बातमी दुसऱ्या बाजूला."],
  "pe.alt2": ["Lead at another width.", "मुख्य बातमी दुसऱ्या रुंदीत."],
  "pe.alt3": ["Lead on the other side, at another width.", "मुख्य बातमी दुसऱ्या बाजूला, दुसऱ्या रुंदीत."],
  "pe.altAround": [
    "The stories that are not locked are laid out another way around the locked ones, which stay where they are.",
    "कुलूप नसलेल्या बातम्यांची कुलूप असलेल्या बातम्यांभोवती दुसरी मांडणी केली आहे; कुलूप असलेल्या बातम्या जागीच राहतात.",
  ],
  "pe.altSame": [
    "Laid out around the locked stories, the page came out as it was: unlock a story to try other layouts.",
    "कुलूप असलेल्या बातम्यांभोवती मांडल्यावर पान होते तसेच आले: इतर मांडण्या पाहण्यासाठी एखाद्या बातमीचे कुलूप काढा.",
  ],
  "pe.altUndo": ["Undo brings back the last one.", "पूर्ववत केल्यास आधीची मांडणी परत येते."],
  "pe.setNewText": [
    { one: "{n} story is set with the new text.", other: "{n} stories are set with the new text." },
    { one: "{n} बातमी नव्या मजकुरासह मांडली.", other: "{n} बातम्या नव्या मजकुरासह मांडल्या." },
  ],
  "pe.folioSet": [
    "The volume, issue or price on this page is set as the edition has it now.",
    "या पानावरचे वर्ष, अंक क्रमांक किंवा किंमत अंकात आता आहे तसे मांडले.",
  ],
  "pe.adsSet": [
    {
      one: "An advertisement on this page is set as the edition has it now.",
      other: "{n} advertisements on this page are set as the edition has them now.",
    },
    {
      one: "या पानावरची एक जाहिरात अंकात आता आहे तशी मांडली.",
      other: "या पानावरच्या {n} जाहिराती अंकात आता आहेत तशा मांडल्या.",
    },
  ],
  "pe.storiesLeft": [
    {
      one: "{n} story left the page: its articles were deleted or emptied.",
      other: "{n} stories left the page: their articles were deleted or emptied.",
    },
    {
      one: "{n} बातमी पानावरून निघाली: तिच्यातील मजकूर हटवला किंवा रिकामा केला गेला.",
      other: "{n} बातम्या पानावरून निघाल्या: त्यांच्यातील मजकूर हटवला किंवा रिकामा केला गेला.",
    },
  ],
  "pe.articlesLeft": [
    {
      one: "{n} article left the page: deleted from the edition, or emptied.",
      other: "{n} articles left the page: deleted from the edition, or emptied.",
    },
    {
      one: "{n} बातमी पानावरून निघाली: अंकातून हटवली, किंवा रिकामी केली.",
      other: "{n} बातम्या पानावरून निघाल्या: अंकातून हटवल्या, किंवा रिकाम्या केल्या.",
    },
  ],
  "pe.leftLocked": [
    {
      one: "{Names} left the page although it was locked.",
      other: "{Names} left the page although they were locked.",
    },
    {
      one: "कुलूप असूनही {Names} पानावरून निघाली.",
      other: "कुलूप असूनही {Names} पानावरून निघाल्या.",
    },
  ],
  "pe.nowStory": [
    "“{head}” would now be a story of its own (its length, photo, priority or page changed); on this layout it stays with the short items until the edition is laid out again.",
    "“{head}” आता स्वतंत्र बातमी व्हायला हवी (तिची लांबी, छायाचित्र, प्राधान्य किंवा पान बदलले); अंकाची पुन्हा मांडणी होईपर्यंत या मांडणीत ती छोट्या बातम्यांतच राहते.",
  ],
  "pe.nowBrief": [
    "“{head}” would now be a short item; on this layout it stays a story of its own until the edition is laid out again.",
    "“{head}” आता छोटी बातमी व्हायला हवी; अंकाची पुन्हा मांडणी होईपर्यंत या मांडणीत ती स्वतंत्र बातमीच राहते.",
  ],
  "pe.busyRefresh": ["Setting the articles' current text…", "बातम्यांचा सध्याचा मजकूर मांडत आहे…"],
  "pe.saveToMake": ["Save page to make the print file.", "छपाईची फाइल तयार करण्यासाठी पान जतन करा."],
  "pe.noTextChanged": [
    "No text on this page has changed since it was last set.",
    "मागच्या मांडणीनंतर या पानावरचा कोणताही मजकूर बदललेला नाही.",
  ],
  "pe.busyWaiting": ["Waiting for your last change…", "तुमच्या शेवटच्या बदलाची वाट पाहत आहे…"],
  "pe.notSaved": ["The page was not saved.", "पान जतन झाले नाही."],
  "pe.notSavedText": [
    "The page was not saved: your typed text could not be saved first.",
    "पान जतन झाले नाही: तुम्ही टाइप केलेला मजकूर आधी जतन करता आला नाही.",
  ],
  "pe.checkThenSave": ["Check the page, then press Save page again.", "पान तपासा, मग पुन्हा ‘पान जतन करा’ दाबा."],
  "pe.busyCurrent": ["Setting the edition's current text first…", "आधी अंकातील सध्याचा मजकूर मांडत आहे…"],
  "pe.saveAnyway": [
    {
      one: "This page still has a problem:\n\n{list}\n\nThe print file will show the page as it is now. Save it anyway?",
      other:
        "This page still has {n} problems:\n\n{list}\n\nThe print file will show the page as it is now. Save it anyway?",
    },
    {
      one: "या पानावर अजून एक समस्या आहे:\n\n{list}\n\nछपाईच्या फाइलमध्ये पान आत्ता आहे तसेच दिसेल. तरीही जतन करायचे?",
      other:
        "या पानावर अजून {n} समस्या आहेत:\n\n{list}\n\nछपाईच्या फाइलमध्ये पान आत्ता आहे तसेच दिसेल. तरीही जतन करायचे?",
    },
  ],
  "pe.busySaving": ["Making the print file and checking it…", "छपाईची फाइल तयार करून तपासत आहे…"],
  "pe.changedWhileSaved": [
    "The page was changed again (in another window or tab) while it was saved: save it again.",
    "जतन होत असताना पान पुन्हा बदलले (दुसऱ्या विंडो किंवा टॅबमध्ये): ते पुन्हा जतन करा.",
  ],
  "pe.leftPages": [
    {
      one: "Stories moved here have left page {pages}: open it, fill the space and save.",
      other: "Stories moved here have left page {pages}: open them, fill the space and save.",
    },
    {
      one: "इथे हलवलेल्या बातम्या पान {pages} वरून निघाल्या आहेत: ते पान उघडा, जागा भरा आणि जतन करा.",
      other: "इथे हलवलेल्या बातम्या पान {pages} वरून निघाल्या आहेत: ती पाने उघडा, जागा भरा आणि जतन करा.",
    },
  ],
  "pe.pressCurrent": [
    "Every page is saved and checked: the press files on the Desk are current.",
    "प्रत्येक पान जतन करून तपासले आहे: डेस्कवरच्या छापखान्यासाठीच्या फायली सध्याच्या पानांशी जुळतात.",
  ],
  "pe.pressNot": [
    "The press files are not current yet: {reasons}.",
    "छापखान्यासाठीच्या फायली अजून सध्याच्या पानांशी जुळत नाहीत: {reasons}.",
  ],
  "pe.pressNotAll": ["not every page is done", "सगळी पाने पूर्ण झालेली नाहीत"],
  "pe.pressSave": [
    { one: "page {pages} still to save", other: "pages {pages} still to save" },
    { one: "पान {pages} अजून जतन करायचे आहे", other: "पाने {pages} अजून जतन करायची आहेत" },
  ],
  "pe.pressFail": [
    { one: "page {pages} not passing the PDF/X-1a check", other: "pages {pages} not passing the PDF/X-1a check" },
    { one: "पान {pages} PDF/X-1a तपासणीत उत्तीर्ण नाही", other: "पाने {pages} PDF/X-1a तपासणीत उत्तीर्ण नाहीत" },
  ],
  "pe.pressRepeats": [
    {
      one: "page {pages} prints the same article as another: take it off one of them",
      other: "pages {pages} print the same article: take it off one of them",
    },
    {
      one: "पान {pages} वर दुसऱ्या पानावरचीच बातमी छापली जाते: ती त्यांपैकी एका पानावरून काढा",
      other: "पाने {pages} वर एकच बातमी छापली जाते: ती त्यांपैकी एका पानावरून काढा",
    },
  ],
  "pe.pressOverlaps": [
    {
      one: "page {pages} has stories over each other or outside the news area: move them apart",
      other: "pages {pages} have stories over each other or outside the news area: move them apart",
    },
    {
      one: "पान {pages} वर बातम्या एकमेकींवर येतात किंवा बातम्यांच्या जागेबाहेर जातात: त्या वेगळ्या करा",
      other: "पाने {pages} वर बातम्या एकमेकींवर येतात किंवा बातम्यांच्या जागेबाहेर जातात: त्या वेगळ्या करा",
    },
  ],

  "pe.lockedMove": [
    "{Name} is locked: unlock it ({key}) to move it.",
    "{Name} ला कुलूप आहे: ती हलवण्यासाठी कुलूप काढा ({key}).",
  ],
  "pe.lockedSize": [
    "{Name} is locked: unlock it ({key}) to move it or change its size.",
    "{Name} ला कुलूप आहे: ती हलवण्यासाठी किंवा तिचा आकार बदलण्यासाठी कुलूप काढा ({key}).",
  ],
  "pe.lockedOff": [
    "{Name} is locked: unlock it ({key}) to take it off the page.",
    "{Name} ला कुलूप आहे: ती पानावरून काढण्यासाठी कुलूप काढा ({key}).",
  ],
  "pe.lockedPage": [
    "{Name} is locked: unlock it ({key}) to move it to another page.",
    "{Name} ला कुलूप आहे: ती दुसऱ्या पानावर हलवण्यासाठी कुलूप काढा ({key}).",
  ],
  "pe.sayUnlocked": ["{Name} is unlocked.", "{Name} चे कुलूप काढले."],
  "pe.sayLocked": [
    "{Name} is locked in place: its place, width and height stay as they are.",
    "{Name} ला कुलूप लावले: तिची जागा, रुंदी आणि उंची आहे तशीच राहते.",
  ],
  "pe.noneLocked": ["No story on this page is locked.", "या पानावरच्या कोणत्याही बातमीला कुलूप नाही."],
  "pe.sayAllUnlocked": ["Every story on this page is unlocked.", "या पानावरच्या सर्व बातम्यांची कुलपे काढली."],
  "pe.sayPhoto": [
    "Photo mode: drag the photo of {name} to move it in its frame. V or Esc to stop.",
    "छायाचित्र मोड: {name} चे छायाचित्र चौकटीत हलवण्यासाठी ओढा. थांबण्यासाठी V किंवा Esc.",
  ],
  "pe.sayFocal": [
    "Click the subject of the photo: the frame keeps it as near its centre as it can. Enter or Esc to finish.",
    "छायाचित्रातील मुख्य विषयावर क्लिक करा: चौकट तो शक्य तितका मध्यभागी ठेवते. संपवण्यासाठी Enter किंवा Esc.",
  ],
  "pe.saySelect": ["Selecting stories.", "बातम्या निवडण्याचा मोड."],
  "pe.noPhoto": ["{Name} has no photo.", "{Name} ला छायाचित्र नाही."],
  "pe.sayReset": [
    "The photo of {name} prints as laid out again.",
    "{name} चे छायाचित्र पुन्हा मूळ मांडणीप्रमाणे छापले जाईल.",
  ],
  "pe.sayEdge": ["The photo is at its edge in that direction.", "त्या दिशेला छायाचित्र कडेपर्यंत आले आहे."],
  "pe.ppiSoft": ["{n} ppi: below 150 ppi, it may print soft", "{n} ppi: 150 ppi पेक्षा कमी, छपाई धूसर होऊ शकते"],
  "pe.ppiSharp": ["{n} ppi: prints sharp", "{n} ppi: स्पष्ट छापले जाते"],
  "pe.lockedThere": [
    "{Name} is locked on page {page}: unlock it there to bring it here.",
    "{Name} ला पान {page} वर कुलूप आहे: ती इथे आणण्यासाठी तिथले कुलूप काढा.",
  ],
  "pe.noOtherPage": [
    "No other page of this layout was laid out.",
    "या मांडणीत दुसऱ्या कोणत्याही पानाची मांडणी झालेली नाही.",
  ],
  "pe.busyMoving": ["Moving {name} to page {page}…", "{name} पान {page} वर हलवत आहे…"],
  "pe.goTo": ["Go to page {page}", "पान {page} वर जा"],
  "pe.movedAlready": [
    "{Name} was already on page {page} (brought in there); it is now only there.",
    "{Name} आधीच पान {page} वर होती (तिथे आणलेली); आता ती फक्त तिथेच आहे.",
  ],
  "pe.movedTo": [
    {
      one: "{Name} moved to page {page} ({n} column × {h} mm, column {col}, {y} mm from the top).",
      other: "{Name} moved to page {page} ({n} columns × {h} mm, column {col}, {y} mm from the top).",
    },
    {
      one: "{Name} पान {page} वर हलवली ({n} स्तंभ × {h} मिमी, स्तंभ {col}, वरून {y} मिमी).",
      other: "{Name} पान {page} वर हलवली ({n} स्तंभ × {h} मिमी, स्तंभ {col}, वरून {y} मिमी).",
    },
  ],
  "pe.movedToPage": ["{Name} moved to page {page}.", "{Name} पान {page} वर हलवली."],
  "pe.movedPrints": [
    "It prints there once page {page} is saved; save this page too.",
    "पान {page} जतन केल्यावर ती तिथे छापली जाईल; हे पानही जतन करा.",
  ],
  "pe.movedPinned": [
    "It is pinned to page {page} in its article: the next layout puts it back there.",
    "तिच्या बातमीत ती पान {page} वर पिन केलेली आहे: पुढची मांडणी तिला परत तिथेच ठेवेल.",
  ],
  "pe.movedUndo": ["Undo brings it back here.", "पूर्ववत केल्यास ती परत इथे येते."],
  "pe.swapHow": [
    "Click the story to swap with, on the page or in the list “On this page” (Esc to stop).",
    "जिच्याशी अदलाबदल करायची ती बातमी पानावर किंवा “या पानावर” यादीत क्लिक करा (थांबण्यासाठी Esc).",
  ],
  "pe.beingSaved": ["The page is being saved.", "पान जतन होत आहे."],
  "pe.saveSoon": ["The page is saved as soon as it is set.", "पान मांडले जाताच जतन होईल."],
  "pe.selectFirstLock": [
    "Select a story on the page first: {key} locks it in place.",
    "आधी पानावरची एखादी बातमी निवडा: {key} तिला कुलूप लावते.",
  ],
  "pe.selectFirstZoom": [
    "Select a story on the page first: {key} zooms to it.",
    "आधी पानावरची एखादी बातमी निवडा: {key} तिच्यावर झूम करते.",
  ],
  "pe.unlockAll": ["Unlock all on page", "पानावरची सर्व कुलपे काढा"],
  "pe.fitsAlready": ["It already fits its box.", "ती आधीच तिच्या चौकटीत बसते."],
  "pe.cannotSetWidth": ["It cannot be set at this width.", "या रुंदीत ती मांडता येत नाही."],
  "pe.notCropped": [
    "The photo is not cropped: it prints as the layout crops it.",
    "छायाचित्र कापलेले नाही: मांडणी कापते तसेच ते छापले जाते.",
  ],
  "pe.editText": ["Edit text", "मजकूर संपादित करा"],
  "pe.fitHeight": ["Fit height to text", "मजकुराइतकी उंची करा"],
  "pe.swap": ["Swap with…", "अदलाबदल करा…"],
  "pe.moveTo": ["Move to page", "दुसऱ्या पानावर हलवा"],
  "pe.lock": ["Lock in place", "कुलूप लावा"],
  "pe.unlock": ["Unlock", "कुलूप काढा"],
  "pe.crop": ["Crop photo", "छायाचित्र कापा"],
  "pe.focal": ["Set focal point", "केंद्रबिंदू ठरवा"],
  "pe.reset": ["Reset crop", "काप रद्द करा"],
  "pe.remove": ["Remove from page", "पानावरून काढा"],
  "pe.back": ["Back", "मागे"],
  "pe.pageN": ["Page {n}", "पान {n}", GLOSSARY],
  "pe.notLaidOut": [
    "Page {page} was not laid out in this layout: a story cannot move there.",
    "या मांडणीत पान {page} ची मांडणी झाली नाही: तिथे बातमी हलवता येत नाही.",
  ],
  "pe.menuMove": ["Move {head} to page", "{head} दुसऱ्या पानावर हलवा"],
  "pe.menuStory": ["Story {head}", "बातमी {head}"],
  "pe.menuPage": ["The page", "पान", GLOSSARY],

  "pe.size": [
    { one: "{n} col × {h} mm", other: "{n} col × {h} mm" },
    { one: "{n} स्तंभ × {h} मिमी", other: "{n} स्तंभ × {h} मिमी" },
  ],
  "pe.shortItems": ["(short items)", "(छोट्या बातम्या)"],
  "pe.shortColumn": ["the column of short items", "छोट्या बातम्यांचा स्तंभ"],
  "pe.aShortItem": ["a short item", "एक छोटी बातमी"],
  "pe.anArticle": ["an article", "एक बातमी"],
  "pe.fitOk": ["Fits its box exactly.", "चौकटीत अचूक बसते."],
  "pe.fitOver": [
    "The text needs {mm} mm more — make the box taller or wider.",
    "मजकुराला आणखी {mm} मिमी जागा लागते — चौकट उंच किंवा रुंद करा.",
  ],
  "pe.fitShort": ["{mm} mm empty at the foot — make the box shorter.", "तळाशी {mm} मिमी रिकामे — चौकट लहान करा."],
  "pe.fitNone": ["Cannot be set at this width — make it wider.", "या रुंदीत मांडता येत नाही — रुंद करा."],
  "pe.heldTag": [
    "locked on page {page} too: unlock it there, or take it off here, to save this page",
    "पान {page} वरही कुलूप लावलेली: हे पान जतन करण्यासाठी तिथले कुलूप काढा, किंवा ती इथून काढा",
  ],
  "pe.alsoTag": ["still on page {page} until you save", "जतन करेपर्यंत पान {page} वरही"],
  "pe.lockedTag": ["locked", "कुलूप"],
  "pe.poolLocked": [
    "Locked on page {page}: unlock it there to bring it here",
    "पान {page} वर कुलूप लावलेली: ती इथे आणण्यासाठी तिथले कुलूप काढा",
  ],
  "pe.poolMove": [
    "Move this story here from page {page} (it leaves that page when you save this one)",
    "ही बातमी पान {page} वरून इथे हलवा (हे पान जतन केल्यावर ती त्या पानावरून निघते)",
  ],
  "pe.poolBring": ["Bring this story onto the page", "ही बातमी पानावर आणा"],
  "pe.kindBriefs": ["short items", "छोट्या बातम्या"],
  "pe.kindStory": ["story", "बातमी", GLOSSARY],
  "pe.poolLockedOn": ["locked on page {page}", "पान {page} वर कुलूप"],
  "pe.poolNowOn": ["now on page {page}", "सध्या पान {page} वर"],
  "pe.poolNowhere": ["not on any page", "कोणत्याही पानावर नाही"],
  "pe.pageNotLaid": ["Page {n} (not laid out)", "पान {n} (मांडणी नाही)"],
  "pe.moveTitle": [
    "The story leaves this page now and goes onto that page; it prints there once that page is saved",
    "बातमी आत्ता हे पान सोडून त्या पानावर जाते; ते पान जतन केल्यावर ती तिथे छापली जाते",
  ],
  "pe.zoomFloor": [
    "It prints at the lowest resolution allowed for it already ({ppi} ppi): it can be moved in its frame, not enlarged.",
    "ते आधीच त्याला चालणाऱ्या सर्वात कमी रेझोल्यूशनवर छापले जाते ({ppi} ppi): ते चौकटीत हलवता येते, मोठे करता येत नाही.",
  ],
  "pe.zoomSharp": ["Enlarged as far as it prints sharp ({ppi} ppi).", "स्पष्ट छापले जाईल तितके मोठे केले ({ppi} ppi)."],
  "pe.zoomMax": ["Enlarged 400 %, the most a photo is enlarged.", "400 % मोठे केले; छायाचित्र यापेक्षा मोठे होत नाही."],
  "pe.pOverlap": ["{a} and {b} overlap by {mm} mm.", "{a} आणि {b} एकमेकींवर {mm} मिमी येतात."],
  "pe.pOutside": [
    "{name} is outside the news area, or over an advertisement or picture.",
    "{name} बातम्यांच्या जागेबाहेर आहे, किंवा जाहिरातीवर किंवा चित्रावर येते.",
  ],
  "pe.pOver": ["{name}: the text needs {mm} mm more.", "{name}: मजकुराला आणखी {mm} मिमी जागा लागते."],
  "pe.pOversetLines": [
    {
      one: "{name}: {n} line of text does not fit and would not print.",
      other: "{name}: {n} lines of text do not fit and would not print.",
    },
    {
      one: "{name}: मजकुराची {n} ओळ बसत नाही आणि छापली जाणार नाही.",
      other: "{name}: मजकुराच्या {n} ओळी बसत नाहीत आणि छापल्या जाणार नाहीत.",
    },
  ],
  "pe.pOversetWords": [
    {
      one: "{name}: {n} word of a subheading does not fit and would not print.",
      other: "{name}: {n} words of a subheading do not fit and would not print.",
    },
    {
      one: "{name}: उपशीर्षकाचा {n} शब्द बसत नाही आणि छापला जाणार नाही.",
      other: "{name}: उपशीर्षकाचे {n} शब्द बसत नाहीत आणि छापले जाणार नाहीत.",
    },
  ],
  "pe.pUnset": [
    {
      one: "{name}: {n} paragraph could not be set and would not print.",
      other: "{name}: {n} paragraphs could not be set and would not print.",
    },
    {
      one: "{name}: {n} परिच्छेद मांडता आला नाही आणि छापला जाणार नाही.",
      other: "{name}: {n} परिच्छेद मांडता आले नाहीत आणि छापले जाणार नाहीत.",
    },
  ],
  "pe.pShort": ["{name}: {mm} mm empty at its foot.", "{name}: तळाशी {mm} मिमी रिकामे."],
  "pe.pCannotSet": ["{name} cannot be set at this width.", "{name} या रुंदीत मांडता येत नाही."],
  "pe.pTouchMany": [
    "{names}: lines of these stories touch in ink. Check the page before sending it.",
    "{names}: या बातम्यांच्या ओळी शाईत एकमेकींना भिडतात. पाठवण्यापूर्वी पान तपासा.",
  ],
  "pe.pTouchOne": [
    "{name}: two of its lines touch in ink. Check the page before sending it.",
    "{name}: तिच्या दोन ओळी शाईत एकमेकींना भिडतात. पाठवण्यापूर्वी पान तपासा.",
  ],
  "pe.pEmpty": ["About {n} cm² of the news area is empty.", "बातम्यांच्या जागेतील सुमारे {n} सेमी² रिकामे आहे."],
  "pe.listAnd": ["{list} and {last}", "{list} आणि {last}"],
  "pe.selectStory": ["Select the story", "बातमी निवडा"],
  "pe.noProblems": [
    "No problems: every story fits and nothing overlaps.",
    "काही समस्या नाही: प्रत्येक बातमी बसते आणि काहीही एकमेकांवर येत नाही.",
  ],
  // the save state beside "Save page": two lines at most in its slot (the whole of it in its tooltip)
  "pe.stChanged": ["Changed · not saved", "बदलले · जतन नाही"],
  "pe.stSetting": ["Setting the page…", "पान मांडत आहे…"],
  "pe.stNeeds": ["Needs saving", "जतन करायचे आहे"],
  "pe.stAuto": ["Automatic layout", "स्वयं-मांडणी"],
  "pe.savedPassed": ["Saved · PDF/X-1a check passed", "जतन झाले · PDF/X-1a तपासणीत उत्तीर्ण"],
  "pe.savedProblems": [
    {
      one: "Saved · PDF/X-1a check: {n} problem, do not send this page",
      other: "Saved · PDF/X-1a check: {n} problems, do not send this page",
    },
    {
      one: "जतन झाले · PDF/X-1a तपासणी: {n} समस्या, हे पान पाठवू नका",
      other: "जतन झाले · PDF/X-1a तपासणी: {n} समस्या, हे पान पाठवू नका",
    },
  ],
  "pe.savedNoCheck": [
    "Saved · the PDF/X-1a check could not run, do not send this page",
    "जतन झाले · PDF/X-1a तपासणी होऊ शकली नाही, हे पान पाठवू नका",
  ],
  "pe.savedUnfinished": ["Saved · its files are not finished", "जतन झाले · त्याच्या फायली पूर्ण झालेल्या नाहीत"],
  "pe.savedAgain": ["Saved · needs saving again", "जतन झाले · पुन्हा जतन करायचे आहे"],
  "pe.savedChangedSince": ["Saved · changed again since", "जतन झाले · त्यानंतर पुन्हा बदलले"],
  "pe.busyKeeping": ["Keeping your last change…", "तुमचा शेवटचा बदल राखत आहे…"],
  "pe.busyNewText": ["Setting the page with the new text…", "नव्या मजकुरासह पान मांडत आहे…"],
  "pe.typedNotSaved": [
    "Your typed text could not be saved: see the story panel.",
    "तुम्ही टाइप केलेला मजकूर जतन करता आला नाही: बातमीचा भाग पाहा.",
  ],
  "pe.earlier": ["an earlier time", "आधीच्या वेळी"],
  "pe.layoutOf": ["layout of {time}", "{time} ची मांडणी"],
  "pe.docTitle": ["Page {n} · {edition} · {app}", "पान {n} · {edition} · {app}", GLOSSARY],
  "pe.leaveTyping": [
    "Your last typing is not set on the page yet: it may be lost if you leave now.",
    "तुम्ही शेवटी टाइप केलेला मजकूर अजून पानावर मांडलेला नाही: आत्ता बाहेर पडल्यास तो हरवू शकतो.",
  ],
  "pe.leaveSetting": [
    "The page is still being set: your last change may be lost if you leave now.",
    "पान अजून मांडले जात आहे: आत्ता बाहेर पडल्यास तुमचा शेवटचा बदल हरवू शकतो.",
  ],
  "pe.leaveDirty": [
    "Your changes to page {page} are kept, but its print file is made only when you save the page.",
    "पान {page} मधील तुमचे बदल राखून ठेवले आहेत, पण पान जतन केल्यावरच त्याची छपाईची फाइल तयार होते.",
  ],
  "pe.leave": ["{why}\n\nLeave the editor?", "{why}\n\nपान संपादनातून बाहेर पडायचे?"],
  "pe.fDeck": ["Deck", "उपमथळा", GLOSSARY],
  "pe.fBody": [
    "Text — an empty line between paragraphs; a line starting with ## is a subheading",
    "मजकूर — परिच्छेदांमध्ये एक रिकामी ओळ; ## ने सुरू होणारी ओळ उपशीर्षक असते",
  ],
  "pe.reading": ["Reading the text…", "मजकूर वाचत आहे…"],
  "pe.gone": [
    {
      one: "One article of this story is no longer in the edition, so that text cannot be changed here.",
      other: "{n} articles of this story are no longer in the edition, so that text cannot be changed here.",
    },
    {
      one: "या बातमीतील एक मजकूर आता अंकात नाही, म्हणून तो इथे बदलता येत नाही.",
      other: "या बातमीतील {n} मजकूर आता अंकात नाहीत, म्हणून ते इथे बदलता येत नाहीत.",
    },
  ],
  "pe.typeToChange": [
    "Type to change the text; the page is set again when you pause.",
    "मजकूर बदलण्यासाठी टाइप करा; तुम्ही थांबल्यावर पान पुन्हा मांडले जाते.",
  ],
  "pe.noArticles": ["This story's articles are no longer in the edition.", "या बातमीचा मजकूर आता अंकात नाही."],
  "pe.notOnPage": ["This story is not on the page now.", "ही बातमी आता पानावर नाही."],
  "pe.typing": ["Typing…", "टाइप होत आहे…"],
  "pe.savingText": ["Saving the text…", "मजकूर जतन होत आहे…"],
  "pe.needParagraph": [
    "A story needs at least one paragraph of text: the page keeps the last text that had one.",
    "बातमीत किमान एक परिच्छेद हवा: पानावर तो असलेला शेवटचा मजकूर राहतो.",
  ],
  "pe.textStillHere": [
    "Your text is still here; change it to try again.",
    "तुमचा मजकूर इथे आहे; पुन्हा प्रयत्नासाठी तो बदला.",
  ],
  "pe.textSavedOther": [
    "Your text is saved, but the page was changed in another window or tab; it is shown again as it is now.",
    "तुमचा मजकूर जतन झाला, पण पान दुसऱ्या विंडो किंवा टॅबमध्ये बदलले; ते आता आहे तसे पुन्हा दाखवले आहे.",
  ],
  "pe.textSavedNotSet": [
    "The text is saved, but the page could not be set with it: press Update text.",
    "मजकूर जतन झाला, पण त्यासह पान मांडता आले नाही: ‘मजकूर अद्ययावत’ दाबा.",
  ],
  "pe.textShown": ["Saved · the page shows this text", "जतन झाले · पानावर हाच मजकूर आहे"],
  "pe.sayShows": ["The page shows your text.", "पानावर तुमचा मजकूर दिसतो."],
  "pe.textNotSaved": ["Your text could not be saved.", "तुमचा मजकूर जतन करता आला नाही."],
  "pe.closeAgain": ["Close again to let it go.", "तो सोडून देण्यासाठी पुन्हा बंद करा."],

  "pe.toDesk": ["← Desk", "← डेस्क"],
  "pe.tools": ["Page tools", "पानाची साधने"],
  "pe.prev": ["Previous page", "मागचे पान"],
  "pe.prevTitle": ["Previous page ({keys})", "मागचे पान ({keys})"],
  "pe.next": ["Next page", "पुढचे पान"],
  "pe.nextTitle": ["Next page ({keys})", "पुढचे पान ({keys})"],
  "pe.undo": ["Undo", "पूर्ववत", GLOSSARY],
  "pe.undoTitle": ["Undo ({keys})", "पूर्ववत ({keys})", GLOSSARY],
  "pe.redo": ["Redo", "पुन्हा करा", GLOSSARY],
  "pe.redoTitle": ["Redo ({keys})", "पुन्हा करा ({keys})", GLOSSARY],
  "pe.alt": ["Try another layout", "दुसरी मांडणी पाहा", GLOSSARY],
  "pe.altTitle": [
    "The same stories, laid out another way (you can undo it)",
    "त्याच बातम्या, दुसऱ्या प्रकारे मांडलेल्या (पूर्ववत करता येते)",
  ],
  "pe.refresh": ["Update text", "मजकूर अद्ययावत"],
  "pe.refreshTitle": [
    "Set the page again with the articles' current text",
    "बातम्यांच्या सध्याच्या मजकुरासह पान पुन्हा मांडा",
  ],
  "pe.zoomOut": ["Zoom out", "लहान करा", GLOSSARY],
  "pe.zoomOutTitle": ["Zoom out ({keys})", "लहान करा ({keys})", GLOSSARY],
  "pe.fit": ["Fit", "संपूर्ण पान", GLOSSARY],
  "pe.fitTitle": ["Fit the page ({keys})", "संपूर्ण पान दाखवा ({keys})"],
  "pe.zoomIn": ["Zoom in", "मोठे करा", GLOSSARY],
  "pe.zoomInTitle": ["Zoom in ({keys})", "मोठे करा ({keys})", GLOSSARY],
  "pe.width": ["Fit the page's width", "पानाची रुंदी दाखवा"],
  "pe.widthTitle": ["Fit the page's width ({keys})", "पानाची रुंदी दाखवा ({keys})"],
  "pe.zoomSel": ["Zoom to the selected story", "निवडलेल्या बातमीवर झूम करा"],
  "pe.zoomSelTitle": ["Zoom to the selected story ({keys})", "निवडलेल्या बातमीवर झूम करा ({keys})"],
  "pe.rulers": ["Rulers", "मोजपट्ट्या"],
  "pe.rulersTitle": ["Show or hide the rulers ({keys})", "मोजपट्ट्या दाखवा किंवा लपवा ({keys})"],
  "pe.save": ["Save page", "पान जतन करा"],
  "pe.saveTitle": ["Make this page's print file ({keys})", "या पानाची छपाईची फाइल तयार करा ({keys})"],
  "pe.closeNotice": ["Close this message", "हा संदेश बंद करा"],
  "pe.stories": ["Stories", "बातम्या", GLOSSARY],
  "pe.onPage": ["On this page", "या पानावर"],
  "pe.others": ["Other stories", "इतर बातम्या"],
  "pe.othersHint": ["(click to bring in)", "(पानावर आणण्यासाठी क्लिक करा)"],
  "pe.searchPlaceholder": ["Search headlines", "मथळे शोधा", GLOSSARY],
  "pe.searchLabel": ["Search other stories", "इतर बातम्यांमध्ये शोधा"],
  "pe.canvas": [
    "The page. Select a story with a click, move it by dragging, resize it with its handles; double-click it or press Enter to change its text. Shift+L locks it in place or unlocks it; a right-click or Shift+F10 opens its menu.",
    "पान. बातमी क्लिक करून निवडा, ओढून हलवा, तिच्या कडांनी आकार बदला; मजकूर बदलण्यासाठी तिच्यावर डबल-क्लिक करा किंवा Enter दाबा. Shift+L कुलूप लावते किंवा काढते; राइट-क्लिक किंवा Shift+F10 तिचा मेन्यू उघडते.",
  ],
  "pe.canvasPhoto": [
    "The page, photo mode: drag the selected story's photo to move it in its frame, or move it with the arrow keys (with Shift, further); double-click it to set its focal point. V or Esc returns to selecting stories.",
    "पान, छायाचित्र मोड: निवडलेल्या बातमीचे छायाचित्र चौकटीत हलवण्यासाठी ओढा, किंवा बाणांच्या कळांनी हलवा (Shift सोबत जास्त); केंद्रबिंदू ठरवण्यासाठी त्यावर डबल-क्लिक करा. V किंवा Esc ने बातम्या निवडण्याकडे परत.",
  ],
  "pe.canvasFocal": [
    "The page, focal point: click the subject of the photo; the frame keeps it as near its centre as it can. Enter or Esc finishes.",
    "पान, केंद्रबिंदू: छायाचित्रातील मुख्य विषयावर क्लिक करा; चौकट तो शक्य तितका मध्यभागी ठेवते. Enter किंवा Esc ने संपते.",
  ],
  "pe.textOf": ["Text of {title}", "{title} चा मजकूर"],
  "pe.closeStory": ["Close the story text (Esc)", "बातमीचा मजकूर बंद करा (Esc)"],
  "pe.selected": ["Selected story", "निवडलेली बातमी"],
  "pe.selectToChange": ["Select a story on the page to change it.", "बदलण्यासाठी पानावरची बातमी निवडा."],
  "pe.lockTitle": [
    "Keep this story's place, width and height for this layout ({keys})",
    "या मांडणीसाठी या बातमीची जागा, रुंदी आणि उंची कायम ठेवा ({keys})",
  ],
  "pe.lockNote": [
    "Locked in place for this layout: its place, width and height stay as they are, and it stays on this page. Unlock it ({key}) to change them. Its text can still change.",
    "या मांडणीसाठी कुलूप लावले आहे: तिची जागा, रुंदी आणि उंची आहे तशीच राहते, आणि ती याच पानावर राहते. ते बदलण्यासाठी कुलूप काढा ({key}). तिचा मजकूर मात्र बदलता येतो.",
  ],
  "pe.widthLabel": ["Width", "रुंदी"],
  "pe.widthCols": ["Width in columns", "स्तंभांत रुंदी"],
  "pe.height": ["Height", "उंची"],
  "pe.fromTop": ["From top", "वरून अंतर"],
  "pe.mm": ["mm", "मिमी"],
  "pe.column": ["Column", "स्तंभ", GLOSSARY],
  "pe.firstColumn": ["First column", "पहिला स्तंभ"],
  "pe.enlarge": ["Enlarge", "मोठे करा", GLOSSARY],
  "pe.cropTitle": [
    "Move the photo in its frame by dragging it, or with the arrow keys ({keys}; V or Esc to stop)",
    "छायाचित्र ओढून, किंवा बाणांच्या कळांनी, चौकटीत हलवा ({keys}; थांबण्यासाठी V किंवा Esc)",
  ],
  "pe.focalTitle": [
    "Click the photo's subject: the frame keeps it as near its centre as it can, at every size",
    "छायाचित्रातील मुख्य विषयावर क्लिक करा: प्रत्येक आकारात चौकट तो शक्य तितका मध्यभागी ठेवते",
  ],
  "pe.resetTitle": ["Print the photo as the layout crops it", "मांडणी कापते तसेच छायाचित्र छापा"],
  "pe.textTitle": [
    "Type this story's text; the page is set again as you pause ({keys})",
    "या बातमीचा मजकूर टाइप करा; तुम्ही थांबल्यावर पान पुन्हा मांडले जाते ({keys})",
  ],
  "pe.fitHeightTitle": ["The height the text needs at this width", "या रुंदीत मजकुराला लागणारी उंची"],
  "pe.swapTitle": [
    "Then click another story to exchange places",
    "मग जागा अदलाबदल करण्यासाठी दुसऱ्या बातमीवर क्लिक करा",
  ],
  "pe.removeTitle": ["Back to the other stories ({keys})", "इतर बातम्यांमध्ये परत ({keys})"],
  "pe.move": ["Move", "हलवा"],
  "pe.checks": ["Checks", "तपासण्या"],
  "pe.help1": [
    "Drag a story to move it; drag its right or bottom edge, or its corner, to resize. The left and right arrows move the selected story by a column, up and down by half a millimetre (with Shift, 5 mm); Delete takes it off the page. Double-click a story, or press Enter, to type its text: the page is set again when you pause. Every change is set by the same engine that makes the print file, and kept as you go; {save} makes the page's PDF and checks it.",
    "बातमी हलवण्यासाठी ओढा; आकार बदलण्यासाठी तिची उजवी किंवा खालची कड, किंवा कोपरा ओढा. डावा आणि उजवा बाण निवडलेली बातमी एका स्तंभाने हलवतात, वर आणि खाली अर्ध्या मिलिमीटरने (Shift सोबत 5 मिमी); Delete ती पानावरून काढते. मजकूर टाइप करण्यासाठी बातमीवर डबल-क्लिक करा, किंवा Enter दाबा: तुम्ही थांबल्यावर पान पुन्हा मांडले जाते. प्रत्येक बदल छपाईची फाइल बनवणारे तेच इंजिन मांडते, आणि तो लगेच राखला जातो; {save} पानाची PDF तयार करून तपासते.",
  ],
  "pe.help2": [
    "Shift+L locks the selected story in place for this layout, or unlocks it: a locked story keeps its place, width and height and stays on the page, and {another} lays the other stories out around it. A right-click on a story, or Shift+F10, opens its menu; on the page's empty space it unlocks every story.",
    "Shift+L या मांडणीसाठी निवडलेल्या बातमीला कुलूप लावते, किंवा काढते: कुलूप असलेल्या बातमीची जागा, रुंदी आणि उंची कायम राहते आणि ती पानावरच राहते; {another} इतर बातम्या तिच्याभोवती मांडते. बातमीवर राइट-क्लिक, किंवा Shift+F10, तिचा मेन्यू उघडते; पानाच्या रिकाम्या जागेवर तो सर्व बातम्यांची कुलपे काढतो.",
  ],
  "pe.help3": [
    "A (or {crop}) moves the selected story's photo in its frame: drag it, or use the arrow keys; {enlarge} enlarges it as far as it still prints sharp. Double-click the photo, or press {focal}, and click its subject: the frame keeps it as near its centre as it can when the story is resized or laid out again. V or Esc stops; {reset} prints the photo as the layout crops it.",
    "A (किंवा {crop}) निवडलेल्या बातमीचे छायाचित्र चौकटीत हलवते: ते ओढा, किंवा बाणांच्या कळा वापरा; {enlarge} ते स्पष्ट छापले जाईल तितके मोठे करते. छायाचित्रावर डबल-क्लिक करा, किंवा {focal} दाबा, आणि मुख्य विषयावर क्लिक करा: बातमीचा आकार बदलला किंवा पुन्हा मांडणी झाली तरी चौकट तो शक्य तितका मध्यभागी ठेवते. V किंवा Esc ने थांबते; {reset} मांडणी कापते तसेच छायाचित्र छापते.",
  ],
  "pe.help4": [
    "{move} (here or in the story's menu) takes the story off this page at once and puts it on the page you choose, at the first free place there (a page with no free place for it refuses it); it prints there once that page is saved, so save both pages. Undo brings it back here.",
    "{move} (इथे किंवा बातमीच्या मेन्यूमध्ये) बातमी लगेच या पानावरून काढून तुम्ही निवडलेल्या पानावर तिथल्या पहिल्या मोकळ्या जागी ठेवते (मोकळी जागा नसलेले पान ती नाकारते); ते पान जतन केल्यावर ती तिथे छापली जाते, म्हणून दोन्ही पाने जतन करा. पूर्ववत केल्यास ती परत इथे येते.",
  ],
  "pe.help5": [
    "Shift+2 zooms to the selected story, Shift+1 shows the whole page and Shift+3 its width; Shift+R shows or hides the rulers (millimetres from the page's top-left corner, with the columns numbered).",
    "Shift+2 निवडलेल्या बातमीवर झूम करते, Shift+1 संपूर्ण पान दाखवते आणि Shift+3 पानाची रुंदी; Shift+R मोजपट्ट्या दाखवते किंवा लपवते (पानाच्या डाव्या वरच्या कोपऱ्यापासून मिलिमीटर, स्तंभांच्या क्रमांकांसह).",
  ],

  // ======================================================================== the server's and the engine's messages
  // Generated from tools/desk/engine/messages.json (the codes the server and the engine send): the English is each
  // template as the server words it (format specs dropped); a Marathi entry may leave out a value only English needs
  // ({cols}), and may have plural forms by {n}. test_strings.mjs checks both against messages.json.
  "m.name.shortColumn": ["the column of short items", "छोट्या बातम्यांचा स्तंभ"],
  "m.name.aStory": ["a story", "एक बातमी"],
  "m.edit.stale": [
    "this page was changed in another window or tab; it is shown again as it is now",
    "हे पान दुसऱ्या विंडो किंवा टॅबमध्ये बदलले; ते आता आहे तसे पुन्हा दाखवले आहे",
  ],
  "m.edit.notNumber": ["a position or size is not a number", "एखादी जागा किंवा आकार संख्या नाही"],
  "m.edit.cropBad": [
    "a photo crop must give the photo's id, a focus point (two numbers) and a zoom (a number)",
    "छायाचित्राच्या कापासाठी छायाचित्राचा आयडी, केंद्रबिंदू (दोन संख्या) आणि झूम (एक संख्या) हवे",
  ],
  "m.edit.cropFloor": [
    "a photo crop would print below the photo's resolution floor",
    "हा काप छायाचित्राच्या किमान रेझोल्यूशनपेक्षा कमी छापला जाईल",
  ],
  "m.edit.cropLost": [
    "the photo of {name} could not be found on the page to crop it: nothing was changed",
    "{name} चे छायाचित्र कापण्यासाठी पानावर सापडले नाही: काहीही बदलले नाही",
  ],
  "m.edit.photoDamaged": [
    "the photo of {name} is damaged (its raster has the wrong size)",
    "{name} चे छायाचित्र खराब झाले आहे (त्याच्या रास्टरचा आकार चुकीचा आहे)",
  ],
  "m.edit.lockBool": ["a story's lock must be true or false", "बातमीचे कुलूप ‘हो’ किंवा ‘नाही’ असेच असावे"],
  "m.edit.lockedMove": [
    "{name} is locked: unlock it (Shift+L) to move it",
    "{name} ला कुलूप आहे: ती हलवण्यासाठी कुलूप काढा (Shift+L)",
  ],
  "m.edit.lockedTake": [
    "{name} is locked: unlock it (Shift+L) to take it off the page",
    "{name} ला कुलूप आहे: ती पानावरून काढण्यासाठी कुलूप काढा (Shift+L)",
  ],
  "m.edit.lockedThere": [
    "{name} is locked on page {page}: unlock it there to bring it here",
    "{name} ला पान {page} वर कुलूप आहे: ती इथे आणण्यासाठी तिथले कुलूप काढा",
  ],
  "m.edit.saveHeld": [
    "this page cannot be saved yet: {name} is also on page {page}, locked there. Unlock it on page {page}, or take it off this page, then save",
    "हे पान अजून जतन करता येत नाही: {name} पान {page} वरही आहे आणि तिथे तिला कुलूप आहे. पान {page} वर कुलूप काढा, किंवा ती या पानावरून काढा, मग जतन करा",
  ],
  "m.edit.allLocked": [
    "every story on this page is locked: unlock one to try another layout",
    "या पानावरच्या सर्व बातम्यांना कुलूप आहे: दुसरी मांडणी पाहण्यासाठी एखाद्या बातमीचे कुलूप काढा",
  ],
  "m.edit.noFillAround": [
    "no other layout fills the space around the locked stories exactly: unlock one, or move it",
    "कुलूप असलेल्या बातम्यांभोवतीची जागा दुसरी कोणतीही मांडणी अचूक भरत नाही: एखादे कुलूप काढा, किंवा ती बातमी हलवा",
  ],
  "m.edit.noFill": [
    "no other layout fills this page exactly with these stories",
    "या बातम्यांनी हे पान अचूक भरणारी दुसरी कोणतीही मांडणी नाही",
  ],
  "m.edit.noStories": ["this page has no stories to lay out", "या पानावर मांडण्यासाठी बातम्या नाहीत"],
  "m.edit.tooMany": [
    "this page has {n} stories; another layout needs {max} or fewer",
    "या पानावर {n} बातम्या आहेत; दुसऱ्या मांडणीसाठी {max} किंवा कमी हव्यात",
  ],
  "m.edit.tooManyFree": [
    "this page has {n} stories not locked; another layout needs {max} or fewer",
    "या पानावर कुलूप नसलेल्या {n} बातम्या आहेत; दुसऱ्या मांडणीसाठी {max} किंवा कमी हव्यात",
  ],
  "m.edit.notAllPlaced": [
    "another layout did not place every story of this page; the page is kept as it was",
    "दुसऱ्या मांडणीत या पानाच्या सर्व बातम्या आल्या नाहीत; पान होते तसेच ठेवले आहे",
  ],
  "m.edit.moveNotHere": ["{name} is not on this page", "{name} या पानावर नाही"],
  "m.edit.moveNoPage": ["this layout has no page {page}", "या मांडणीत पान {page} नाही"],
  "m.edit.moveSamePage": [
    "{name} is on this page already: choose another page",
    "{name} आधीच या पानावर आहे: दुसरे पान निवडा",
  ],
  "m.edit.moveNotLaidOut": [
    "page {page} was not laid out in this layout: a story cannot move there",
    "या मांडणीत पान {page} ची मांडणी झाली नाही: तिथे बातमी हलवता येत नाही",
  ],
  "m.edit.moveLockedThere": [
    "{name} is also on page {page}, locked there: unlock it there to move it",
    "{name} पान {page} वरही आहे आणि तिथे तिला कुलूप आहे: ती हलवण्यासाठी तिथले कुलूप काढा",
  ],
  "m.edit.moveCannotSet": [
    "{name} cannot be set {w} {cols} wide on page {page}: change its width here, then move it",
    "{name} पान {page} वर {w} स्तंभ रुंदीत मांडता येत नाही: इथे तिची रुंदी बदला, मग हलवा",
  ],
  "m.edit.moveNoRoom": [
    "there is no free place on page {page} for {name} ({w} {cols} × {h} mm): make room there, or narrow it here, then move it",
    "पान {page} वर {name} साठी मोकळी जागा नाही ({w} स्तंभ × {h} मिमी): तिथे जागा करा, किंवा इथे ती अरुंद करा, मग हलवा",
  ],
  "m.edit.notOpen": ["this page is not open: open it again", "हे पान उघडलेले नाही: ते पुन्हा उघडा"],
  "m.edit.unknownCommand": ["unknown command {cmd}", "अज्ञात आदेश {cmd}"],
  "m.edit.missing": ["missing {fields}", "{fields} नाही"],
  "m.edit.invalid": ["the request is not valid", "ही विनंती योग्य नाही"],
  "m.edit.engineFailed": ["something went wrong in the engine", "इंजिनमध्ये काहीतरी चुकले"],
  "m.move.whichStory": ["Say which story to move.", "कोणती बातमी हलवायची ते सांगा."],
  "m.move.whichPage": [
    "Say which page to move the story to, as a page number.",
    "बातमी कोणत्या पानावर हलवायची ते पान क्रमांकाने सांगा.",
  ],
  "m.move.samePage": [
    "The story is on this page already: choose another page.",
    "ही बातमी आधीच या पानावर आहे: दुसरे पान निवडा.",
  ],
  "m.move.noPage": ["This layout has no page {page}.", "या मांडणीत पान {page} नाही."],
  "m.move.notLaidOut": [
    "Page {page} was not laid out in this layout: a story cannot move there.",
    "या मांडणीत पान {page} ची मांडणी झाली नाही: तिथे बातमी हलवता येत नाही.",
  ],
  "m.save.notChanged": ["The page could not be changed: {reason}.", "पान बदलता आले नाही: {reason}."],
  "m.save.engineNotStarted": [
    "The page editor's engine did not start: {why}",
    "पान संपादनाचे इंजिन सुरू झाले नाही: {why}",
  ],
  "m.save.engineNotStartedLog": [
    "The page editor's engine did not start. See edit-service.log in the desk home.",
    "पान संपादनाचे इंजिन सुरू झाले नाही. डेस्कच्या होम फोल्डरमधील edit-service.log पाहा.",
  ],
  "m.save.engineStopped": [
    "The page editor's engine stopped. Try again.",
    "पान संपादनाचे इंजिन थांबले. पुन्हा प्रयत्न करा.",
  ],
  "m.save.engineSlow": [
    "The page editor's engine stopped or took too long. Try again.",
    "पान संपादनाचे इंजिन थांबले किंवा त्याला खूप वेळ लागला. पुन्हा प्रयत्न करा.",
  ],
  "m.save.unfinished": [
    "The last save of this page did not finish: save it again.",
    "या पानाचे मागचे जतन पूर्ण झाले नाही: ते पुन्हा जतन करा.",
  ],
  "m.save.movedHere": [
    "A story was moved here from page {page}: check its place and save the page.",
    "पान {page} वरून इथे एक बातमी हलवली आहे: तिची जागा तपासा आणि पान जतन करा.",
  ],
  "m.save.taking": [
    "Page {page} is taking a story from this page: when page {page} has been saved, open this page, fill the space and save it.",
    "पान {page} या पानावरून एक बातमी घेत आहे: पान {page} जतन झाल्यावर हे पान उघडा, जागा भरा आणि जतन करा.",
  ],
  "m.save.movedFrom": [
    "A story moved from this page to page {page}: open it, fill the space and save it.",
    "या पानावरून एक बातमी पान {page} वर हलवली: हे पान उघडा, जागा भरा आणि जतन करा.",
  ],
  "m.save.filesNotFinished": [
    "The page was saved, but its files could not be finished.",
    "पान जतन झाले, पण त्याच्या फायली पूर्ण होऊ शकल्या नाहीत.",
  ],
  "m.save.heldUnreadable": [
    "This page cannot be saved yet: the engine's list of its stories locked on other pages cannot be read.",
    "हे पान अजून जतन करता येत नाही: इतर पानांवर कुलूप असलेल्या बातम्यांची इंजिनची यादी वाचता येत नाही.",
  ],
  "m.save.held": [
    "This page cannot be saved yet: {name} is also on page {page}, locked there. Unlock it on page {page}, or take it off this page, then save.",
    "हे पान अजून जतन करता येत नाही: {name} पान {page} वरही आहे आणि तिथे तिला कुलूप आहे. पान {page} वर कुलूप काढा, किंवा ती या पानावरून काढा, मग जतन करा.",
  ],
  "m.save.heldMore1": [
    "1 more story on this page is locked on another page too.",
    "या पानावरच्या आणखी एका बातमीला दुसऱ्या पानावरही कुलूप आहे.",
  ],
  "m.save.heldMoreN": [
    "{n} more stories on this page are locked on another page too.",
    "या पानावरच्या आणखी {n} बातम्यांना दुसऱ्या पानांवरही कुलूप आहे.",
  ],
  "m.save.notPlacedEdited": [
    "Taken off the pages in the editor, or moved to a page not saved yet: bring it back onto a page, or save the page it moved to.",
    "पान संपादनात पानावरून काढली, किंवा अजून जतन न केलेल्या पानावर हलवली: ती पुन्हा पानावर आणा, किंवा ती हलवलेले पान जतन करा.",
  ],
  "m.save.deletedAfter": ["Deleted from the edition after the layout.", "मांडणीनंतर अंकातून हटवली."],
  "m.press.olderDesk": [
    "This page was made by an older version of the Desk, which did not record what its PDF prints: lay the edition out again.",
    "हे पान डेस्कच्या जुन्या व्हर्जनने तयार केले, ज्याने त्याची PDF काय छापते याची नोंद ठेवली नाही: अंकाची पुन्हा मांडणी करा.",
  ],
  "m.press.olderRecord": [
    "This page was made by an older version of the Desk, which recorded what its PDF prints in another way: open it in the page editor and save it (or lay out again).",
    "हे पान डेस्कच्या जुन्या व्हर्जनने तयार केले, ज्याने त्याची PDF काय छापते याची नोंद वेगळ्या प्रकारे ठेवली: ते पान संपादनात उघडून जतन करा (किंवा पुन्हा मांडणी करा).",
  ],
  "m.press.damaged": [
    "This page could not be checked against the edition (a file of the layout or the edition cannot be read): put the file back from a backup, or lay the edition out again.",
    "हे पान अंकाशी तपासता आले नाही (मांडणीची किंवा अंकाची एखादी फाइल वाचता येत नाही): ती फाइल बॅकअपमधून परत आणा, किंवा अंकाची पुन्हा मांडणी करा.",
  ],
  "m.press.pagesChanged": [
    "The edition now has {now} pages; this layout has {then}: lay the edition out again.",
    "अंकात आता {now} पाने आहेत; या मांडणीत {then} आहेत: अंकाची पुन्हा मांडणी करा.",
  ],
  "m.press.backAdsOn": [
    "Back-page ads were switched on after this layout: lay the edition out again.",
    "या मांडणीनंतर शेवटच्या पानावरच्या जाहिराती चालू केल्या: अंकाची पुन्हा मांडणी करा.",
  ],
  "m.press.backAdsOff": [
    "Back-page ads were switched off after this layout: lay the edition out again.",
    "या मांडणीनंतर शेवटच्या पानावरच्या जाहिराती बंद केल्या: अंकाची पुन्हा मांडणी करा.",
  ],
  "m.press.changed1": [
    "An article on this page was changed since the page's PDF was made: open the page and save it (Save page sets the current text first).",
    "पानाची PDF तयार झाल्यानंतर या पानावरची एक बातमी बदलली: पान उघडून जतन करा (‘पान जतन करा’ आधी सध्याचा मजकूर मांडते).",
  ],
  "m.press.changedN": [
    "{n} articles on this page were changed since the page's PDF was made: open the page and save it (Save page sets the current text first).",
    "पानाची PDF तयार झाल्यानंतर या पानावरच्या {n} बातम्या बदलल्या: पान उघडून जतन करा (‘पान जतन करा’ आधी सध्याचा मजकूर मांडते).",
  ],
  "m.press.gone1": [
    "An article on this page was deleted from the edition: open the page and save it (Save page takes it off first).",
    "या पानावरची एक बातमी अंकातून हटवली: पान उघडून जतन करा (‘पान जतन करा’ आधी ती काढते).",
  ],
  "m.press.goneN": [
    "{n} articles on this page were deleted from the edition: open the page and save it (Save page takes them off first).",
    "या पानावरच्या {n} बातम्या अंकातून हटवल्या: पान उघडून जतन करा (‘पान जतन करा’ आधी त्या काढते).",
  ],
  "m.press.folio": [
    "The volume, issue or price changed: open the page and save it.",
    "वर्ष, अंक क्रमांक किंवा किंमत बदलली: पान उघडून जतन करा.",
  ],
  "m.press.ad": [
    "An advertisement on this page changed: open the page and save it (Save page sets the new one first).",
    "या पानावरची एक जाहिरात बदलली: पान उघडून जतन करा (‘पान जतन करा’ आधी नवी जाहिरात मांडते).",
  ],
  "m.warn.issueNotSet": [
    "Issue number (अंक) not set in step 1: the front page keeps the old number",
    "पायरी 1 मध्ये अंक क्रमांक दिलेला नाही: पहिल्या पानावर जुनाच क्रमांक राहतो",
  ],
  "m.warn.overlap": ["stories overlap on the page", "पानावर बातम्या एकमेकींवर येतात"],
  "m.warn.outside": [
    "a story is outside the news area or over an advertisement",
    "एखादी बातमी बातम्यांच्या जागेबाहेर आहे किंवा जाहिरातीवर येते",
  ],
  "m.warn.overset": [
    "{n} lines of text did not fit",
    { one: "मजकुराची {n} ओळ बसली नाही", other: "मजकुराच्या {n} ओळी बसल्या नाहीत" },
  ],
  "m.warn.unsetN": [
    "{n} paragraphs could not be set (a character the stand-in fonts lack)",
    {
      one: "{n} परिच्छेद मांडता आला नाही (तात्पुरत्या फॉन्टमध्ये नसलेले अक्षर)",
      other: "{n} परिच्छेद मांडता आले नाहीत (तात्पुरत्या फॉन्टमध्ये नसलेले अक्षर)",
    },
  ],
  "m.warn.unset": [
    "paragraphs could not be set (a character the stand-in fonts lack)",
    "काही परिच्छेद मांडता आले नाहीत (तात्पुरत्या फॉन्टमध्ये नसलेले अक्षर)",
  ],
  "m.warn.touch": [
    "two lines of a story touch in ink somewhere: check the page",
    "एखाद्या बातमीच्या दोन ओळी कुठेतरी शाईत एकमेकींना भिडतात: पान तपासा",
  ],
  "m.warn.emptyArea": [
    "About {n} cm² of the news area is left empty: add a short item or a photo",
    "बातम्यांच्या जागेतील सुमारे {n} सेमी² रिकामे राहिले आहे: एखादी छोटी बातमी किंवा छायाचित्र जोडा",
  ],
  "m.warn.notFill": [
    "These stories do not fill the page exactly; the layout may fail",
    "या बातम्यांनी पान अचूक भरत नाही; मांडणी अयशस्वी होऊ शकते",
  ],
  "m.warn.emptyFoot": [
    "About {mm} mm of the page is left empty at the foot — add a short item or a photo",
    "पानाच्या तळाशी सुमारे {mm} मिमी रिकामे राहिले आहे — एखादी छोटी बातमी किंवा छायाचित्र जोडा",
  ],
  "m.warn.charRemoved": [
    "{what}: removed a character the fonts do not have (U+{code})",
    "{what}: फॉन्टमध्ये नसलेले एक अक्षर काढले (U+{code})",
  ],
  "m.warn.sameHeadline": [
    "Same headline as another article ({article}) — is it the same story twice?",
    "दुसऱ्या बातमीचाच मथळा ({article}) — एकच बातमी दोनदा आहे का?",
  ],
  "m.warn.photoSmall": [
    "Photo too small to print even one column wide ({px} pixels across) — the story runs without it",
    "छायाचित्र एका स्तंभाइतकेही छापण्यासाठी खूप लहान आहे ({px} पिक्सेल रुंद) — बातमी छायाचित्राशिवाय जाते",
  ],
  "m.run.reading": ["Reading the articles", "बातम्या वाचत आहे"],
  "m.run.noArticles": ["No articles with a headline and body text", "मथळा आणि मुख्य मजकूर असलेली एकही बातमी नाही"],
  "m.run.stopped": ["Stopped before it finished", "पूर्ण होण्यापूर्वी थांबले"],
  "m.run.measured": ["Measured {done} of {total} stories", "{total} पैकी {done} बातम्यांचे मोजमाप झाले"],
  "m.run.choosing": ["Choosing the stories for each page", "प्रत्येक पानासाठी बातम्या निवडत आहे"],
  "m.run.layingOut": ["Laying out the pages", "पानांची मांडणी करत आहे"],
  "m.run.noStoriesLeft": ["No stories left for this page", "या पानासाठी बातम्या उरल्या नाहीत"],
  "m.run.allLaidOut": ["All pages laid out", "सर्व पानांची मांडणी झाली"],
  "m.run.someFailed": [
    "{failed} of {total} pages could not be laid out",
    "{total} पैकी {failed} पानांची मांडणी होऊ शकली नाही",
  ],
  "m.run.pageFailed": ["layout failed", "मांडणी अयशस्वी"],
  "m.run.tooManyModules": [
    "{n} modules: more than the layout search takes ({max})",
    "{n} भाग: मांडणीचा शोध घेऊ शकतो त्यापेक्षा जास्त ({max})",
  ],
  "m.run.noStoriesPage": ["no stories for this page", "या पानासाठी बातम्या नाहीत"],
  "m.run.outOfTime": ["the layout search ran out of time", "मांडणीच्या शोधाची वेळ संपली"],
  "m.run.notFillExactly": ["these stories do not fill the page exactly", "या बातम्यांनी पान अचूक भरत नाही"],
  "m.run.restarted": [
    "The server was restarted while this run was in progress. Start it again.",
    "ही मांडणी सुरू असताना सर्व्हर पुन्हा सुरू झाला. ती पुन्हा सुरू करा.",
  ],
  "m.run.waiting": [
    "Waiting for another edition's pages to finish.",
    "दुसऱ्या अंकाची पाने पूर्ण होण्याची वाट पाहत आहे.",
  ],
  "m.run.starting": ["Starting…", "सुरू होत आहे…"],
  "m.run.cancelledBefore": ["Cancelled before it started.", "सुरू होण्यापूर्वीच रद्द केली."],
  "m.run.cancelled": ["Cancelled.", "रद्द केली."],
  "m.run.editionChanged": [
    "Set aside: the edition's date or pages changed after this layout. Lay it out again.",
    "बाजूला ठेवली: या मांडणीनंतर अंकाची तारीख किंवा पाने बदलली. पुन्हा मांडणी करा.",
  ],
  "m.run.engineStarted": ["The layout engine has started.", "मांडणी इंजिन सुरू झाले."],
  "m.run.engineNotStarted": [
    "The layout engine could not be started: {error}.",
    "मांडणी इंजिन सुरू करता आले नाही: {error}.",
  ],
  "m.run.putting": [
    "Putting the edition PDF and the press files together…",
    "अंकाची PDF आणि छापखान्यासाठीच्या फायली एकत्र करत आहे…",
  ],
  "m.run.noPages": [
    "The layout engine finished but made no pages.",
    "मांडणी इंजिनचे काम संपले, पण एकही पान तयार झाले नाही.",
  ],
  "m.run.notMerged": [
    "The pages were made, but they could not be put into one file.",
    "पाने तयार झाली, पण ती एका फाइलमध्ये एकत्र करता आली नाहीत.",
  ],
  "m.run.checking": [
    "Checking every page with the independent PDF/X-1a checker…",
    "प्रत्येक पान स्वतंत्र PDF/X-1a तपासणी-साधनाने तपासत आहे…",
  ],
  "m.run.made1": ["1 page made.", "1 पान तयार झाले."],
  "m.run.madeN": ["{n} pages made.", "{n} पाने तयार झाली."],
  "m.run.madeFailed": [
    "{n} could not be made: see the notes on those pages.",
    {
      one: "{n} पान तयार होऊ शकले नाही: त्या पानावरच्या नोंदी पाहा.",
      other: "{n} पाने तयार होऊ शकली नाहीत: त्या पानांवरच्या नोंदी पाहा.",
    },
  ],
  "m.run.checkProblems": [
    "The PDF/X-1a check found problems in {files}: do not send those to the press.",
    "PDF/X-1a तपासणीत {files} मध्ये समस्या सापडल्या: त्या छापखान्याकडे पाठवू नका.",
  ],
  "m.run.noArticlesYet": ["There are no articles in this edition yet.", "या अंकात अजून एकही बातमी नाही."],
  "m.run.alreadyRunning": [
    "Pages for this edition are already being made. Wait for them, or cancel that run first.",
    "या अंकाची पाने आधीच तयार होत आहेत. ती पूर्ण होईपर्यंत थांबा, किंवा ती मांडणी आधी रद्द करा.",
  ],
  "m.run.finished": ["This run has already finished.", "ही मांडणी आधीच पूर्ण झाली आहे."],
  "m.plan.needsText": ["It needs a headline and some body text", "तिला मथळा आणि थोडा मुख्य मजकूर हवा"],
  "m.plan.notMeasured": ["could not be measured ({why})", "मोजमाप करता आले नाही ({why})"],
  "m.plan.headlineTooLong": [
    "Its headline is too long to set (at most four lines) — shorten the headline",
    "तिचा मथळा मांडण्यासाठी खूप मोठा आहे (जास्तीत जास्त चार ओळी) — मथळा छोटा करा",
  ],
  "m.plan.tooLong": ["Too long for a whole page — shorten it", "संपूर्ण पानासाठीही खूप मोठी — ती छोटी करा"],
  "m.plan.noRoom": [
    "No room left — add pages, lower another story's priority, or pin it to a page",
    "जागा उरली नाही — पाने वाढवा, दुसऱ्या बातमीचे प्राधान्य कमी करा, किंवा ती एखाद्या पानावर पिन करा",
  ],
  "m.plan.pinnedFull": [
    "More than {max} stories are pinned to page {page} — pin it to another page",
    "पान {page} वर {max} पेक्षा जास्त बातम्या पिन केल्या आहेत — ती दुसऱ्या पानावर पिन करा",
  ],
  "m.plan.pageFailed": ["Page {n} could not be laid out: {message}", "पान {n} ची मांडणी होऊ शकली नाही: {message}"],
  "m.store.pasteText": ["Paste the articles as text.", "बातम्या मजकूर म्हणून पेस्ट करा."],
  "m.store.dateFormat": [
    "Give the edition's date as YYYY-MM-DD, for example 2026-10-21.",
    "अंकाची तारीख YYYY-MM-DD अशी द्या, उदाहरणार्थ 2026-10-21.",
  ],
  "m.store.notADate": ["{value} is not a real date.", "{value} ही खरी तारीख नाही."],
  "m.store.pages": ["An edition has 4, 8 or 16 pages.", "अंकात 4, 8 किंवा 16 पाने असतात."],
  "m.store.priority": [
    "Priority is 1 (Lead), 2 (Top), 3 (Normal) or 4 (Minor).",
    "प्राधान्य 1 (मुख्य), 2 (महत्त्वाची), 3 (सामान्य) किंवा 4 (दुय्यम) असते.",
  ],
  "m.store.pageRange": [
    "The page must be empty (the Desk chooses) or a page number from 1 to {pages}.",
    "पान रिकामे (डेस्क ठरवेल) किंवा 1 ते {pages} मधला पान क्रमांक असावा.",
  ],
  "m.store.needHeadline": ["Every article needs a headline.", "प्रत्येक बातमीला मथळा हवा."],
  "m.store.needText": ["Every article needs some text.", "प्रत्येक बातमीला थोडा मजकूर हवा."],
  "m.store.tooManyEditions": ["There are too many editions for this date.", "या तारखेचे खूप अंक आहेत."],
  "m.store.dateFixed": [
    "The date of an edition cannot be changed. Make a new edition for the other date.",
    "अंकाची तारीख बदलता येत नाही. दुसऱ्या तारखेसाठी नवा अंक तयार करा.",
  ],
  "m.store.deleteRunning": [
    "Pages for this edition are being made. Cancel that first, then delete it.",
    "या अंकाची पाने तयार होत आहेत. आधी ते रद्द करा, मग अंक हटवा.",
  ],
  "m.store.deleteSaving": [
    "A page of this edition is being changed or saved. Wait a moment, then delete it.",
    "या अंकाचे एक पान बदलले किंवा जतन केले जात आहे. थोडे थांबा, मग अंक हटवा.",
  ],
  "m.store.adBusy": [
    "Ads cannot be changed while the pages are being made. Wait until that finishes, or cancel it.",
    "पाने तयार होत असताना जाहिराती बदलता येत नाहीत. ते पूर्ण होईपर्यंत थांबा, किंवा ते रद्द करा.",
  ],
  "m.store.wordNone": [
    "No story in this Word file could be added: {reasons}",
    "या Word फाइलमधील एकही बातमी जोडता आली नाही: {reasons}",
  ],
  "m.store.wordNoneBare": ["No story in this Word file could be added.", "या Word फाइलमधील एकही बातमी जोडता आली नाही."],
  "m.store.pasteNone": [
    "No articles were found. Put each article's headline on its first line, its text below it, and a line with only --- between articles.",
    "एकही बातमी सापडली नाही. प्रत्येक बातमीचा मथळा पहिल्या ओळीत, त्याखाली तिचा मजकूर, आणि दोन बातम्यांच्या मध्ये फक्त --- असलेली ओळ ठेवा.",
  ],
  "m.store.pasteParts": [
    "{n} part(s) had a headline but no text.",
    { one: "{n} भागाला मथळा होता पण मजकूर नव्हता.", other: "{n} भागांना मथळा होता पण मजकूर नव्हता." },
  ],
  "m.img.tooManyPixels": [
    "This picture has too many pixels for the Desk. Save it smaller and try again.",
    "या चित्रात डेस्कसाठी खूप जास्त पिक्सेल आहेत. ते लहान करून जतन करा आणि पुन्हा प्रयत्न करा.",
  ],
  "m.img.notAPicture": [
    "This file is not a picture the Desk can read. Use a JPEG, PNG or WebP file.",
    "ही फाइल डेस्कला वाचता येणारे चित्र नाही. JPEG, PNG किंवा WebP फाइल वापरा.",
  ],
  "m.img.format": [
    "This picture is a {fmt} file. Use a JPEG, PNG or WebP file.",
    "हे चित्र {fmt} फाइल आहे. JPEG, PNG किंवा WebP फाइल वापरा.",
  ],
  "m.img.damaged": [
    "The picture file is damaged or incomplete. Try saving it again.",
    "चित्राची फाइल खराब किंवा अपूर्ण आहे. ती पुन्हा जतन करून पाहा.",
  ],
  "m.img.tooLarge": [
    "This picture file is larger than 40 MB. Save it smaller and try again.",
    "ही चित्राची फाइल 40 MB पेक्षा मोठी आहे. ती लहान करून जतन करा आणि पुन्हा प्रयत्न करा.",
  ],
  "m.img.none": ["No picture was sent.", "कोणतेही चित्र पाठवले नाही."],
  "m.img.noProfile": [
    "Photos cannot be converted for print: the newsprint colour profile is missing. Put it at ~/PageinatorPrivate/icc/ or set PAGEINATOR_ICC to its file.",
    "छायाचित्रे छपाईसाठी रूपांतरित करता येत नाहीत: वृत्तपत्र कागदाचे रंग-प्रोफाइल नाही. ते ~/PageinatorPrivate/icc/ मध्ये ठेवा, किंवा PAGEINATOR_ICC मध्ये त्याची फाइल द्या.",
  ],
  "m.img.badProfile": [
    "The newsprint colour profile could not be used: it must be a CMYK printer profile ({error}).",
    "वृत्तपत्र कागदाचे रंग-प्रोफाइल वापरता आले नाही: ते CMYK प्रिंटरचे प्रोफाइल असावे ({error}).",
  ],
  "m.bundle.notZip": [
    "This is not a Pageinator stories file (a .zip made by Pageinator). Download it again from Pageinator and try again.",
    "ही Pageinator बातम्यांची फाइल नाही (Pageinator ने बनवलेली .zip फाइल). ती Pageinator मधून पुन्हा डाउनलोड करून पुन्हा प्रयत्न करा.",
  ],
  "m.bundle.damaged": [
    "This Pageinator stories file is damaged. Download it again and try again.",
    "ही Pageinator बातम्यांची फाइल खराब झाली आहे. ती पुन्हा डाउनलोड करून पुन्हा प्रयत्न करा.",
  ],
  "m.bundle.tooLarge": [
    "This Pageinator stories file is larger than 200 MB.",
    "ही Pageinator बातम्यांची फाइल 200 MB पेक्षा मोठी आहे.",
  ],
  "m.bundle.unpacksTooLarge": [
    "This Pageinator stories file unpacks to more than 300 MB.",
    "ही Pageinator बातम्यांची फाइल उघडल्यावर 300 MB पेक्षा मोठी होते.",
  ],
  "m.bundle.tooManyFiles": [
    "This Pageinator stories file holds more than {max} files.",
    "या Pageinator बातम्यांच्या फाइलमध्ये {max} पेक्षा जास्त फायली आहेत.",
  ],
  "m.bundle.memberTooLarge": [
    "{name} in this Pageinator stories file is larger than the Desk takes.",
    "या Pageinator बातम्यांच्या फाइलमधील {name} Desk घेऊ शकतो त्यापेक्षा मोठी आहे.",
  ],
  "m.bundle.packed": [
    "{name} in this Pageinator stories file unpacks to far more than its packed size: the file was refused.",
    "या Pageinator बातम्यांच्या फाइलमधील {name} उघडल्यावर तिच्या आकाराच्या कितीतरी पट मोठी होते: फाइल नाकारली.",
  ],
  "m.bundle.badMember": [
    "This Pageinator stories file holds {name}, which such a file never holds: the file was refused.",
    "या Pageinator बातम्यांच्या फाइलमध्ये {name} आहे, जे अशा फाइलमध्ये कधीच नसते: फाइल नाकारली.",
  ],
  "m.bundle.noJson": [
    "This file has no bundle.json: it is not a Pageinator stories file.",
    "या फाइलमध्ये bundle.json नाही: ही Pageinator बातम्यांची फाइल नाही.",
  ],
  "m.bundle.badJson": ["The bundle.json in this file cannot be read.", "या फाइलमधील bundle.json वाचता येत नाही."],
  "m.bundle.version": [
    "This Pageinator stories file is in a format this Desk does not read ({format}): update the Desk, or make the file again.",
    "ही Pageinator बातम्यांची फाइल या Desk ला वाचता न येणाऱ्या स्वरूपात आहे ({format}): Desk अद्ययावत करा, किंवा फाइल पुन्हा बनवा.",
  ],
  "m.bundle.unknownField": [
    "This Pageinator stories file has a field this Desk does not know ({field}): update the Desk, or make the file again.",
    "या Pageinator बातम्यांच्या फाइलमध्ये या Desk ला माहीत नसलेले क्षेत्र आहे ({field}): Desk अद्ययावत करा, किंवा फाइल पुन्हा बनवा.",
  ],
  "m.bundle.badField": [
    "This Pageinator stories file has a field that is missing or not valid ({field}).",
    "या Pageinator बातम्यांच्या फाइलमधील एक क्षेत्र नाही किंवा वैध नाही ({field}).",
  ],
  "m.bundle.tooManyStories": [
    "This Pageinator stories file holds more than {max} stories.",
    "या Pageinator बातम्यांच्या फाइलमध्ये {max} पेक्षा जास्त बातम्या आहेत.",
  ],
  "m.bundle.storyTwice": [
    "This Pageinator stories file lists the story {story} twice.",
    "या Pageinator बातम्यांच्या फाइलमध्ये {story} ही बातमी दोनदा आहे.",
  ],
  "m.bundle.photoMissing": [
    "A photo the stories name is not in this Pageinator stories file ({name}).",
    "बातम्यांमध्ये नाव असलेले एक छायाचित्र या Pageinator बातम्यांच्या फाइलमध्ये नाही ({name}).",
  ],
  "m.bundle.badSha": [
    "A photo in this Pageinator stories file does not match its SHA-256 checksum ({name}): the file was changed or damaged. Download it again.",
    "या Pageinator बातम्यांच्या फाइलमधील एक छायाचित्र त्याच्या SHA-256 तपासणी-बेरजेशी जुळत नाही ({name}): फाइल बदलली गेली किंवा खराब झाली. ती पुन्हा डाउनलोड करा.",
  ],
  "m.bundle.otherDate": [
    "These stories are for the edition of {date}; this edition is of {edition}. Open that edition, or make the file again.",
    "या बातम्या {date} च्या अंकासाठी आहेत; हा अंक {edition} चा आहे. तो अंक उघडा, किंवा फाइल पुन्हा बनवा.",
  ],
  "m.bundle.otherPages": [
    "The stories were sent for an edition of {sent} pages; this one has {pages}: a story pinned to a page it does not have was refused.",
    "बातम्या {sent} पानांच्या अंकासाठी पाठवल्या होत्या; या अंकात {pages} पाने आहेत: नसलेल्या पानावर पिन केलेली बातमी नाकारली.",
  ],
  "m.bundle.keptEdited": [
    "Changed in the Desk since it was imported: kept as it is.",
    "आयात केल्यानंतर Desk मध्ये बदलली: आहे तशी ठेवली.",
  ],
  "m.bundle.keptNewer": [
    "The Desk has a newer revision of it (revision {revision}): kept as it is.",
    "Desk कडे हिची नवी आवृत्ती आहे (आवृत्ती {revision}): आहे तशी ठेवली.",
  ],
  "m.bundle.retry": [
    "It changed in the Desk while the file was being read: import the file again.",
    "फाइल वाचत असताना ती Desk मध्ये बदलली: फाइल पुन्हा आयात करा.",
  ],
  "m.bundle.zip64": [
    "This Pageinator stories file is in the ZIP64 form, which the Desk does not take: make the file again.",
    "ही Pageinator बातम्यांची फाइल ZIP64 स्वरूपात आहे, जे Desk घेत नाही: फाइल पुन्हा बनवा.",
  ],
  "m.bundle.deletedInDesk": [
    "Deleted in the Desk after it was imported: not added again.",
    "आयात केल्यानंतर Desk मधून हटवली: पुन्हा जोडली नाही.",
  ],
  // ---- a Word file's refusals and notes (deskserver/docx.py)
  "m.docx.overSize": ["This Word file is larger than 20 MB.", "ही Word फाइल 20 MB पेक्षा मोठी आहे."],
  "m.docx.protected": [
    "This Word file is protected with a password, or is an old .doc file: save it as .docx without a password and try again.",
    "ही Word फाइल पासवर्डने सुरक्षित आहे, किंवा ही जुनी .doc फाइल आहे: ती पासवर्डशिवाय .docx म्हणून जतन करा आणि पुन्हा प्रयत्न करा.",
  ],
  "m.docx.tooLarge": ["This Word file is too large to read.", "ही Word फाइल वाचण्यासाठी खूप मोठी आहे."],
  "m.docx.damaged": [
    "This Word file is damaged. Save it again and try again.",
    "ही Word फाइल खराब झाली आहे. ती पुन्हा जतन करून पुन्हा प्रयत्न करा.",
  ],
  "m.docx.notWord": [
    "This is not a Word (.docx) file. Save it as .docx and try again.",
    "ही Word (.docx) फाइल नाही. ती .docx म्हणून जतन करून पुन्हा प्रयत्न करा.",
  ],
  "m.docx.noStory": [
    "No story was found in this Word file: it needs a headline and some text.",
    "या Word फाइलमध्ये एकही बातमी सापडली नाही: बातमीला मथळा आणि थोडा मजकूर हवा.",
  ],
  "m.docx.tooManyStories": [
    "This file holds more than {max} stories; only the first {max} were imported.",
    "या फाइलमध्ये {max} पेक्षा जास्त बातम्या आहेत; फक्त पहिल्या {max} आयात केल्या.",
  ],
  "m.docx.emptyHeading1": [
    "1 heading had no text under it and was not imported.",
    "1 मथळ्याखाली मजकूर नव्हता, म्हणून तो आयात केला नाही.",
  ],
  "m.docx.emptyHeadingsN": [
    "{n} headings had no text under them and were not imported.",
    "{n} मथळ्यांखाली मजकूर नव्हता, म्हणून ते आयात केले नाहीत.",
  ],
  "m.docx.table1": [
    "1 table was not imported: copy its text into the article if it is needed.",
    "1 तक्ता आयात केला नाही: त्यातील मजकूर हवा असेल तर तो बातमीत कॉपी करा.",
  ],
  "m.docx.tablesN": [
    "{n} tables were not imported: copy their text into the article if it is needed.",
    "{n} तक्ते आयात केले नाहीत: त्यांतील मजकूर हवा असेल तर तो बातमीत कॉपी करा.",
  ],
  "m.docx.textBox1": ["1 text box was not imported.", "1 मजकूर चौकट आयात केली नाही."],
  "m.docx.textBoxesN": ["{n} text boxes were not imported.", "{n} मजकूर चौकटी आयात केल्या नाहीत."],
  "m.docx.picture1": [
    "1 picture was not imported: add photos in the Desk.",
    "1 चित्र आयात केले नाही: छायाचित्रे Desk मध्ये जोडा.",
  ],
  "m.docx.picturesN": [
    "{n} pictures were not imported: add photos in the Desk.",
    "{n} चित्रे आयात केली नाहीत: छायाचित्रे Desk मध्ये जोडा.",
  ],
  "m.docx.formatting": [
    "Formatting (bold, italic, sizes) is not kept: the Desk sets the type.",
    "स्वरूपण (ठळक, तिरके, आकार) ठेवले नाही: अक्षरांची मांडणी Desk स्वतः करतो.",
  ],

  // ---- shared words
  "common.cancel": ["Cancel", "रद्द करा"],
  "common.close": ["Close", "बंद करा"],
  "common.delete": ["Delete", "हटवा", GLOSSARY],
  "common.edit": ["Edit", "संपादित करा"],
  "common.open": ["Open", "उघडा"],
  "common.remove": ["Remove", "काढा"],
  "common.ok": ["OK", "ठीक आहे"],
  "common.saving": ["Saving…", "जतन होत आहे…"],
  "common.tooBig": ["This file is {size}. The limit is 40 MB.", "ही फाइल {size} आहे. मर्यादा 40 MB आहे."],

  // ---- the Desk's own error messages (the server's are shown as it sends them)
  "api.offline": [
    "Can't reach the Desk server. Check that it is still running on this Mac, then try again.",
    "डेस्क सर्व्हरशी संपर्क होत नाही. तो या Mac वर अजून चालू आहे का ते तपासा, मग पुन्हा प्रयत्न करा.",
  ],
  "api.http": [
    "The Desk server could not do that (HTTP {status}).",
    "डेस्क सर्व्हरला हे करता आले नाही (HTTP {status}).",
  ],
  "api.unreadable": [
    "The Desk server sent an answer this page cannot read.",
    "डेस्क सर्व्हरने पाठवलेले उत्तर हे पान वाचू शकत नाही.",
  ],
  "api.badName": ["This item has a name the Desk cannot use.", "या गोष्टीचे नाव डेस्कला वापरता येत नाही."],
  "api.noArticle": ["The Desk server did not return the new article.", "डेस्क सर्व्हरने नवी बातमी परत पाठवली नाही."],
  "api.noRun": [
    "The Desk server did not say which layout it started.",
    "डेस्क सर्व्हरने कोणती मांडणी सुरू केली ते सांगितले नाही.",
  ],
  "api.reloadFailed": ["Could not reload the edition: {error}", "अंक पुन्हा लोड करता आला नाही: {error}"],

  // ---- numbers, sizes, times and dates (Latin digits in both languages)
  "fmt.sec": ["{n} s", "{n} से."],
  "fmt.minSec": ["{m} min {s} s", "{m} मि. {s} से."],
  "fmt.hourMin": ["{h} h {m} min", "{h} ता. {m} मि."],
  "fmt.mb": ["{n} MB", "{n} MB", SAME],
  "fmt.kb": ["{n} KB", "{n} KB", SAME],
  "fmt.bytes": ["{n} bytes", "{n} बाइट"],
  "date.sun": ["Sun", "रवि"],
  "date.mon": ["Mon", "सोम"],
  "date.tue": ["Tue", "मंगळ"],
  "date.wed": ["Wed", "बुध"],
  "date.thu": ["Thu", "गुरु"],
  "date.fri": ["Fri", "शुक्र"],
  "date.sat": ["Sat", "शनि"],
  "date.jan": ["Jan", "जाने"],
  "date.feb": ["Feb", "फेब्रु"],
  "date.mar": ["Mar", "मार्च"],
  "date.apr": ["Apr", "एप्रि"],
  "date.may": ["May", "मे"],
  "date.jun": ["Jun", "जून"],
  "date.jul": ["Jul", "जुलै"],
  "date.aug": ["Aug", "ऑग"],
  "date.sep": ["Sep", "सप्टें"],
  "date.oct": ["Oct", "ऑक्टो"],
  "date.nov": ["Nov", "नोव्हें"],
  "date.dec": ["Dec", "डिसें"],
  // the order of a date's parts; the reviewer may change it for Marathi
  "date.full": ["{wd} {d} {mon} {y}", "{wd} {d} {mon} {y}", SAME],
  "date.short": ["{wd} {d} {mon}", "{wd} {d} {mon}", SAME],
  "date.time": ["{wd} {d} {mon}, {hh}:{mm}", "{wd} {d} {mon}, {hh}:{mm}", SAME],
  "date.undated": ["Undated", "तारीख नाही"],
};

export const LANGS = ["en", "mr"];
export const STRINGS = { en: {}, mr: {} };
export const GLOSSARY_KEYS = [];
export const SAME_KEYS = [];
export const REVIEW = []; // every Marathi entry a native editor still has to check (see the top of this file)
for (const [key, [en, mr, mark]] of Object.entries(TABLE)) {
  STRINGS.en[key] = en;
  STRINGS.mr[key] = mr;
  if (mark === GLOSSARY) GLOSSARY_KEYS.push(key);
  else if (mark === SAME) SAME_KEYS.push(key);
  else REVIEW.push(key);
}

// ===================================================================== the language shown

export const LANG_STORE_KEY = "pageinator-desk.lang"; // this browser's choice ("en" or "mr"), for every Desk screen
let current = "en";

export const lang = () => current;

export function setLang(value) {
  current = LANGS.includes(value) ? value : "en";
  return current;
}

/** The language this browser chose before, else English (also when storage is blocked). */
export function savedLang() {
  try {
    const value = localStorage.getItem(LANG_STORE_KEY);
    return LANGS.includes(value) ? value : "en";
  } catch {
    return "en";
  }
}

export function saveLang(value) {
  try {
    localStorage.setItem(LANG_STORE_KEY, value);
  } catch {
    // storage is blocked or full: the choice lasts until the page is reloaded
  }
}

// ===================================================================== looking up

const pluralRules = new Map();

/** "one" or "other" (the forms English and Marathi have: one is exactly 1 in both). */
function pluralForm(language, n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "other";
  try {
    if (!pluralRules.has(language)) pluralRules.set(language, new Intl.PluralRules(language));
    return pluralRules.get(language).select(n) === "one" ? "one" : "other";
  } catch {
    return n === 1 ? "one" : "other";
  }
}

function template(language, key, params) {
  const value = (STRINGS[language] && STRINGS[language][key]) ?? STRINGS.en[key];
  if (value === undefined) return key; // not in the catalogue: the key shows (the tests keep this from happening)
  return typeof value === "string" ? value : value[pluralForm(language, params.n)];
}

/** A value as the interface shows it: integers with Indian grouping and Latin digits, anything else as text. */
function shown(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value.toLocaleString("en-IN");
  return String(value);
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** The text of a key in a given language, with its {placeholders} filled from params. */
export function tIn(language, key, params = {}) {
  return template(language, key, params).replace(PLACEHOLDER, (whole, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? shown(params[name]) : whole,
  );
}

/** The text of a key in the language shown. */
export function t(key, params = {}) {
  return tIn(current, key, params);
}

/** Like t(), as a list of text and nodes: a placeholder given an element (a <code>, a <strong>) keeps it. */
export function tn(key, params = {}) {
  const text = template(current, key, params);
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    parts.push(text.slice(last, m.index));
    const value = Object.prototype.hasOwnProperty.call(params, m[1]) ? params[m[1]] : m[0];
    parts.push(value !== null && typeof value === "object" ? value : shown(value));
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts.filter((part) => part !== "");
}

// ===================================================================== the server's and the engine's messages

/* The server and the engine send each of their messages as English text, and, in the same answer's "msgs" map, that
 * text's form {code, params} (tools/desk/engine/deskmsg.py). A value in params is a number, a string, {data} (text
 * shown as it is: a headline, a file name) or a message of its own; {parts} is several sentences. The English screen
 * shows the server's own text, exactly as before; the Marathi screen says the code in Marathi, and falls back to the
 * English text for a code it does not know (at any depth). */

const UNKNOWN = Symbol("unknown");

/** A wire form in the language shown: text (or, with node(), a list of text and nodes); UNKNOWN when a code is not here. */
function said(wire, node) {
  if (wire === null || typeof wire !== "object") return wire;
  if (typeof wire.data === "string") return node ? node(wire.data) : wire.data;
  if (Array.isArray(wire.parts)) {
    const parts = wire.parts.map((w) => said(w, node));
    if (parts.includes(UNKNOWN)) return UNKNOWN;
    return node ? parts.flatMap((p, i) => (i ? [" ", ...[p].flat()] : [p].flat())) : parts.join(" ");
  }
  const code = wire.code;
  if (typeof code !== "string" || !code.startsWith("m.") || STRINGS[current][code] === undefined) return UNKNOWN;
  const params = {};
  for (const [k, v] of Object.entries(wire.params || {})) {
    const p = said(v, node);
    if (p === UNKNOWN) return UNKNOWN;
    params[k] = node && Array.isArray(p) ? spanOf(p) : p;
  }
  return node ? tn(code, params) : t(code, params);
}

/** Several parts as one value for tn() (a placeholder takes one node): a fragment. */
function spanOf(parts) {
  const f = document.createDocumentFragment();
  for (const p of parts) f.append(p);
  return f;
}

/** A message the server or the engine sent (text, and the answer's msgs map), in the language shown. */
export function tm(text, msgs) {
  const wire = current !== "en" && msgs && typeof msgs === "object" ? msgs[text] : undefined;
  if (wire === undefined) return text;
  const out = said(wire);
  return out === UNKNOWN || typeof out !== "string" ? text : out;
}

/** The same, as text and nodes: node(text) gives each {data} value (a headline) its own element (its own lang). */
export function tmn(text, msgs, node) {
  const wire = current !== "en" && msgs && typeof msgs === "object" ? msgs[text] : undefined;
  if (wire === undefined) return [text];
  const out = said(wire, node);
  return out === UNKNOWN ? [text] : [out].flat();
}
