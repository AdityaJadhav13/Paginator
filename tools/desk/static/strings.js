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
  // "Save page" is the page editor's button; the editor is still in English (its Marathi is the next part)
  "press.toSave": [
    {
      one: "page {pages} still to save in the page editor (open it and press Save page)",
      other: "pages {pages} still to save in the page editor (open them and press Save page)",
    },
    {
      one: "पान {pages} अजून जतन करायचे आहे (पान संपादनात ते उघडून Save page दाबा)",
      other: "पाने {pages} अजून जतन करायची आहेत (पान संपादनात ती उघडून Save page दाबा)",
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
