/**
 * The public website's words, in English and Marathi (docs/product/03-website-and-accounts.md §4).
 *
 * Every user-visible sentence on the public pages is a record here, and components read records by id. So what
 * Pageinator says in public is reviewed in one file, and `tests/ui005/claims.test.ts` scans every record.
 *
 * A record says what kind of statement it is:
 *   - "fact": something true today. It names its evidence (./evidence.ts): a file in this repository and the exact
 *     words there, which the claims test reads back. A number in a fact must appear in its evidence.
 *   - "plan": something intended, said as intended ("planned", "being prepared", "will"). It names the plan it comes
 *     from the same way.
 *   - "denial": a sentence that exists to say something is NOT true ("No certification…"). Only denials may contain
 *     the claim vocabulary the test otherwise forbids.
 *   - "copy": a heading, a label or an action, which claims nothing about what the product does.
 *   - "specimen": the fictional Marathi example text of the typography section, shown in Marathi on both pages.
 *
 * The Marathi is a first draft, written for the native editor's review (D-5): every record is on the review list
 * (src/i18n/review.ts). Product names (Pageinator, Pageinator Desk, Word, WhatsApp) and record names (EXP-GEN-1,
 * ADR-022) stay as they are in both languages.
 *
 * Fictional examples only: no pilot newspaper, person, place, headline or advertiser is named anywhere here.
 */

import type { EvidenceKey } from "./evidence.ts";

export type PublicLanguage = "en" | "mr";

/** The document a record's wording traces to. */
export type ContentSource =
  /** docs/product/03-website-and-accounts.md: the website's own specification. */
  | "WEBSITE_SPEC"
  /** docs/product/09-launch-plan.md. */
  | "LAUNCH_PLAN"
  /** docs/product/10-l2-newsroom-plan.md. */
  | "L2_PLAN"
  /** tools/desk/README.md: Pageinator Desk. */
  | "DESK"
  /** docs/phase0/EXP_GEN_1_REPORT.md. */
  | "EXP_GEN_1"
  /** docs/phase0/EXP_PDF_1_REPORT.md: the press test (gate G2). */
  | "EXP_PDF_1"
  /** docs/phase0 typesetting reports (EXP-HEAD-1, EXP-COMPOSE-1). */
  | "TYPESETTING"
  /** docs/architecture/v2 ADRs. */
  | "ADR"
  /** The code itself (apps/api, apps/web): what the newsroom app and this website do. */
  | "CODE"
  /** docs/product/01-product-map.md and the master specification's non-goals. */
  | "PRODUCT_MAP";

export type ContentKind = "fact" | "plan" | "denial" | "copy" | "specimen";


export interface ContentRecord {
  /** Stable, kebab-case. Referenced literally by at least one component. */
  readonly id: string;
  readonly kind: ContentKind;
  /** The English text. */
  readonly en: string;
  /** The Marathi text (a first draft for the native editor). For a specimen, the same Marathi as `en`. */
  readonly mr: string;
  readonly source: ContentSource;
  /** Where in `source`: a section, a row, a line. */
  readonly sourceRef: string;
  /**
   * Required for facts and plans: where each is recorded, as keys of `EVIDENCE` (./evidence.ts, a file in this
   * repository and the exact words there). Only the keys ship to the browser; the claims test reads the words.
   */
  readonly evidence?: readonly EvidenceKey[];
}



function copy(id: string, en: string, mr: string, sourceRef: string, source: ContentSource = "WEBSITE_SPEC"): ContentRecord {
  return { id, kind: "copy", en, mr, source, sourceRef };
}

function fact(
  id: string,
  en: string,
  mr: string,
  source: ContentSource,
  sourceRef: string,
  evidence: readonly EvidenceKey[],
): ContentRecord {
  return { id, kind: "fact", en, mr, source, sourceRef, evidence };
}

function plan(
  id: string,
  en: string,
  mr: string,
  source: ContentSource,
  sourceRef: string,
  evidence: readonly EvidenceKey[],
): ContentRecord {
  return { id, kind: "plan", en, mr, source, sourceRef, evidence };
}

function denial(id: string, en: string, mr: string, source: ContentSource, sourceRef: string): ContentRecord {
  return { id, kind: "denial", en, mr, source, sourceRef };
}

function specimen(id: string, text: string): ContentRecord {
  return { id, kind: "specimen", en: text, mr: text, source: "WEBSITE_SPEC", sourceRef: "§4.2 Marathi typography showcase; fictional text" };
}

const RECORDS: readonly ContentRecord[] = [
  // ── Calls to action ──────────────────────────────────────────────────
  copy("cta-book-demo", "Book a demo", "डेमो ठरवा", "§4.1 primary CTA"),
  copy("cta-open-workspace", "Open your workspace", "तुमचे कार्यक्षेत्र उघडा", "§4.1 primary CTA when signed in"),
  copy("cta-pilot", "Talk to us about a pilot", "प्रायोगिक वापराबद्दल बोला", "§4.2 /pricing primary action"),
  copy("cta-stages", "See every stage", "प्रत्येक टप्पा पाहा", "§4.2 /features"),
  copy("cta-security", "Read the security notes", "सुरक्षेविषयी वाचा", "§4.2 /security"),
  copy("cta-pricing", "How pricing works", "किंमत कशी ठरते", "§4.2 /pricing"),
  copy("cta-report", "Open the contact form", "संपर्क अर्ज उघडा", "§4.2 /contact"),

  // ── Closing band (every page but /contact) ───────────────────────────
  copy("closing-standing", "Next step", "पुढचे पाऊल", "§4.2 closing CTA"),
  copy("closing-title", "See it lay out an edition", "अंकाची मांडणी प्रत्यक्ष पाहा", "§4.2 closing CTA"),
  fact(
    "closing-body",
    "A demo shows Pageinator Desk laying out a whole edition and a page being edited. Then we can talk about a pilot for your paper.",
    "डेमोमध्ये Pageinator Desk संपूर्ण अंकाची मांडणी करताना आणि एखादे पान संपादित होताना दिसते. त्यानंतर तुमच्या वृत्तपत्रासाठी प्रायोगिक वापराबद्दल बोलता येईल.",
    "LAUNCH_PLAN",
    "L1 EXISTS: lay out 4/8/16 pages, the page editor",
    ["edition", "editor"],
  ),
  fact(
    "closing-note",
    "Pilot pricing is by conversation. Nothing is sold on this website.",
    "प्रायोगिक वापराची किंमत चर्चेने ठरते. या संकेतस्थळावर काहीही विकले जात नाही.",
    "WEBSITE_SPEC",
    "§4.2 /pricing: pilot pricing by conversation",
    ["pilotPricing", "noPaymentCapability"],
  ),

  // ── Home: hero ───────────────────────────────────────────────────────
  copy("home-hero-standing", "Layout engine · page editor · newsroom", "मांडणी इंजिन · पान संपादक · वृत्तकक्ष", "§4.2 Home hero"),
  copy(
    "home-hero-title",
    "Newspaper production, built first for Marathi papers",
    "अंकनिर्मिती, सर्वप्रथम मराठी वृत्तपत्रांसाठी घडवलेली",
    "§4.2 Home hero",
  ),
  fact(
    "home-hero-lead",
    "Pageinator lays out a whole edition, with page designs and measures taken from the paper's own printed pages. It checks every page's print file, and lets the desk adjust any page while its engine keeps the type exact.",
    "वृत्तपत्राच्या स्वतःच्या छापील पानांवरून घेतलेल्या पानरचना आणि मोजमापांनुसार Pageinator संपूर्ण अंकाची मांडणी करते. ते प्रत्येक पानाची छपाई फाइल तपासते, आणि डेस्कला कोणतेही पान बदलू देते; अक्षरमांडणी मात्र त्याचे इंजिनच अचूक ठेवते.",
    "DESK",
    "Start it; what it does; save page; launch plan principles 1–2",
    ["houseStyle", "medians", "deskSavePage", "checker", "exactType"],
  ),
  fact(
    "home-hero-aside",
    "Today the engine runs in Pageinator Desk, a layout app built for a Marathi daily's own pages. The newsroom app is being prepared for a pilot.",
    "आज हे इंजिन Pageinator Desk या मांडणी ॲपमध्ये चालते; ते एका मराठी दैनिकाच्या स्वतःच्या पानांसाठी घडवले आहे. वृत्तकक्ष ॲप प्रायोगिक वापरासाठी तयार केले जात आहे.",
    "DESK",
    "Owner decision 2026-10-20; L2 plan release check",
    ["deskApp", "pilotNotRun"],
  ),

  // ── Home: proof facts ────────────────────────────────────────────────
  copy("proof-standing", "Evidence so far", "आतापर्यंतचे पुरावे", "§4 claims rule: the source is shown with each claim"),
  copy(
    "proof-title",
    "What has been shown, and where it is recorded",
    "काय सिद्ध झाले आहे, आणि त्याची नोंद कुठे आहे",
    "§4 claims rule",
  ),
  copy(
    "proof-lead",
    "Each fact below names the record it comes from. Nothing here is a forecast.",
    "खालील प्रत्येक मुद्द्यासोबत त्याची नोंद दिली आहे. यात कोणताही अंदाज नाही.",
    "§4 claims rule",
  ),
  copy("proof-source-label", "Source", "स्रोत", "§4 claims rule"),
  fact("proof-edition-figure", "4 · 8 · 16", "४ · ८ · १६", "LAUNCH_PLAN", "L1: lay out 4/8/16 pages", ["edition"]),
  fact("proof-gen1-figure", "28 / 28", "२८ / २८", "EXP_GEN_1", "Status block", ["gen1", "gen1Checks"]),
  fact("proof-press-figure", "Printed", "छापले", "EXP_PDF_1", "Status block", ["press"]),
  fact("proof-check-figure", "Every page", "प्रत्येक पान", "LAUNCH_PLAN", "Principle 1, print safety", ["checker"]),
  fact(
    "proof-edition",
    "A whole 4-, 8- or 16-page edition, laid out automatically.",
    "४, ८ किंवा १६ पानांचा संपूर्ण अंक, आपोआप मांडलेला.",
    "LAUNCH_PLAN",
    "Opening: the Desk lays out a whole 4-, 8- or 16-page paper; L1 EXISTS",
    ["edition", "editionCode"],
  ),
  fact(
    "proof-edition-note",
    "With free stand-in fonts until the paper's own fonts are added.",
    "वृत्तपत्राचे स्वतःचे फॉन्ट येईपर्यंत मोफत पर्यायी फॉन्ट वापरले जातात.",
    "DESK",
    "Limits: fonts",
    ["standInFonts"],
  ),
  fact(
    "proof-edition-cite",
    "Launch plan; Pageinator Desk",
    "प्रारंभ आराखडा; Pageinator Desk",
    "LAUNCH_PLAN",
    "L1: The Desk complete for our own paper",
    ["edition"],
  ),
  fact(
    "proof-gen1",
    "28 of 28 held-out test pages laid out automatically, and all 28 passed every automatic check.",
    "चाचणीसाठी राखून ठेवलेली २८ पैकी २८ पाने आपोआप मांडली गेली, आणि सर्व २८ पानांनी प्रत्येक स्वयंचलित तपासणी पार केली.",
    "EXP_GEN_1",
    "Status block",
    ["gen1", "gen1Checks"],
  ),
  fact(
    "proof-gen1-note",
    "The pages were laid out from the stories of printed pages, and their style still differs from the paper's. No editor has judged the layouts yet.",
    "ही पाने छापील पानांवरील बातम्यांवरून मांडली गेली, आणि त्यांची शैली अजून वृत्तपत्राच्या शैलीपेक्षा वेगळी आहे. या मांडण्यांचे परीक्षण अद्याप कोणत्याही संपादकाने केलेले नाही.",
    "EXP_GEN_1",
    "Status block; what the generator is given",
    ["gen1NoEditor", "gen1Rebuilt", "styleDiffers"],
  ),
  fact(
    "proof-gen1-cite",
    "EXP-GEN-1 report, 2026-10-19",
    "EXP-GEN-1 अहवाल, २०२६-१०-१९",
    "EXP_GEN_1",
    "Status block (gen1/2.10.0)",
    ["gen1"],
  ),
  fact(
    "proof-press",
    "A real newspaper press accepted and printed a test page made by Pageinator.",
    "Pageinator ने तयार केलेले चाचणी पान एका प्रत्यक्ष वृत्तपत्र छापखान्याने स्वीकारले आणि छापले.",
    "EXP_PDF_1",
    "Status block: press test done; G2 passed on the owner's report",
    ["press", "pressG2"],
  ),
  fact(
    "proof-press-note",
    "It was a text-only page. A page with photos and an advertisement has not been press-tested yet.",
    "ते फक्त मजकुराचे पान होते. छायाचित्रे आणि जाहिरात असलेल्या पानाची छपाई चाचणी अजून झालेली नाही.",
    "LAUNCH_PLAN",
    "§3 engine service row: press-tested with a text-only page",
    ["pressTextOnly"],
  ),
  fact(
    "proof-press-cite",
    "EXP-PDF-1 report, gate G2, on the owner's report of 2026-10-13",
    "EXP-PDF-1 अहवाल, टप्पा G2, मालकांच्या २०२६-१०-१३ च्या अहवालानुसार",
    "EXP_PDF_1",
    "Status block",
    ["pressDate", "pressG2"],
  ),
  fact(
    "proof-check",
    "Every page's print file is checked by Pageinator's own independent checker before it is offered.",
    "प्रत्येक पानाची छपाई फाइल देण्यापूर्वी Pageinator चा स्वतःचा स्वतंत्र तपासक ती तपासतो.",
    "LAUNCH_PLAN",
    "Principle 1, print safety; Desk: save page",
    ["checker", "deskSavePage"],
  ),
  fact(
    "proof-check-note",
    "A page that fails is never offered. The checker is our own, not a commercial preflight.",
    "तपासणीत नापास झालेले पान कधीच दिले जात नाही. हा तपासक आमचा स्वतःचा आहे; ती व्यावसायिक छपाईपूर्व तपासणी नाही.",
    "LAUNCH_PLAN",
    "Principle 1; §3.1 print check row (ADR-022)",
    ["checker", "preflight"],
  ),
  fact(
    "proof-check-cite",
    "Launch plan, print safety; ADR-022",
    "प्रारंभ आराखडा, छपाई सुरक्षा; ADR-022",
    "LAUNCH_PLAN",
    "Principle 1; §3.1",
    ["checker", "preflight"],
  ),

  // ── The workflow ─────────────────────────────────────────────────────
  copy("home-workflow-standing", "The workflow", "कामाचा क्रम", "§4.2 the 7-stage workflow strip"),
  copy("home-workflow-title", "Seven stages, one edition", "सात टप्पे, एक अंक", "§4.2 the 7-stage workflow strip"),
  copy(
    "home-workflow-lead",
    "Each stage carries its state today: working in the Desk, built for the pilot, or planned.",
    "प्रत्येक टप्प्यासोबत त्याची आजची स्थिती दिली आहे: Desk मध्ये चालू, प्रायोगिक वापरासाठी घडवलेले, किंवा नियोजित.",
    "§4.2 /features: what's live today",
  ),
  copy("availability-desk", "Working in the Desk", "Desk मध्ये चालू", "§4.2 what's live today", "LAUNCH_PLAN"),
  copy("availability-pilot", "Built for the pilot", "प्रायोगिक वापरासाठी घडवलेले", "§4.2 what's live today", "L2_PLAN"),
  copy("availability-planned", "Planned", "नियोजित", "§4.2 what's live today", "LAUNCH_PLAN"),
  copy("workflow-today-label", "Today", "आज", "§4.2 /features: what's live today"),

  copy("workflow-plan-name", "Plan", "नियोजन", "§4.2 /features stages"),
  fact(
    "workflow-plan-description",
    "Set the date and the number of pages; the planner gives each page the stories that fill it.",
    "तारीख आणि पानांची संख्या ठरवा; नियोजक प्रत्येक पानाला ते भरतील अशा बातम्या देतो.",
    "DESK",
    "What it does 1 and 5: edition; plan",
    ["planner"],
  ),
  fact(
    "workflow-plan-today",
    "In the Desk. How many stories, photos and words a page needs comes from what the paper's own printed pages hold.",
    "Desk मध्ये. एका पानाला किती बातम्या, छायाचित्रे आणि शब्द लागतात, हे वृत्तपत्राच्या स्वतःच्या छापील पानांवरील मोजणीवरून ठरते.",
    "DESK",
    "What it does 3: needs",
    ["medians"],
  ),
  copy("workflow-content-name", "Content", "मजकूर", "§4.2 /features stages"),
  fact(
    "workflow-content-description",
    "Stories with headline, deck, byline, photo, caption and credit.",
    "मथळा, उपमथळा, वार्ताहर नाव, छायाचित्र, छायाचित्र ओळ आणि सौजन्यासह बातम्या.",
    "DESK",
    "What it does 2: articles",
    ["articles"],
  ),
  fact(
    "workflow-content-today",
    "In the Desk: typed, pasted or imported from Word. Built for the pilot: reporters file from a phone in the newsroom app, with a photo.",
    "Desk मध्ये: टाइप करून, चिकटवून किंवा Word मधून आणून. प्रायोगिक वापरासाठी घडवलेले: वार्ताहर वृत्तकक्ष ॲपमध्ये फोनवरून छायाचित्रासह बातमी पाठवतात.",
    "CODE",
    "Desk Word import; the newsroom app's story editor and photo panel",
    ["wordImport", "phone", "photos"],
  ),
  copy("workflow-generate-name", "Generate", "स्वयं-मांडणी", "§4.2 /features stages"),
  fact(
    "workflow-generate-description",
    "The engine lays out every page, measuring each story at every width with the real typesetter.",
    "इंजिन प्रत्येक पानाची मांडणी करते; प्रत्येक बातमी प्रत्यक्ष अक्षरजुळणी यंत्रणेने प्रत्येक रुंदीवर मोजली जाते.",
    "DESK",
    "What it does 5: measure, lay out",
    ["measure"],
  ),
  fact(
    "workflow-generate-today",
    "In the Desk, for 4, 8 or 16 pages. An article that fits nowhere is listed with the reason.",
    "Desk मध्ये, ४, ८ किंवा १६ पानांसाठी. कुठेच न बसणारी बातमी कारणासह दाखवली जाते.",
    "DESK",
    "Opening; limits: articles that do not fit",
    ["editionCode", "fitsNowhere"],
  ),
  copy("workflow-edit-name", "Edit", "संपादन", "§4.2 /features stages"),
  fact(
    "workflow-edit-description",
    "Move, resize, swap and lock stories, crop photos and move a story to another page, with undo and redo.",
    "बातम्या हलवा, लहान-मोठ्या करा, अदलाबदल करा आणि जागी कुलूपबंद करा; छायाचित्रे कापा आणि बातमी दुसऱ्या पानावर न्या; पूर्ववत आणि पुन्हा करा.",
    "LAUNCH_PLAN",
    "L1 EXISTS: the page editor",
    ["editor", "editorMore"],
  ),
  fact(
    "workflow-edit-today",
    "In the Desk's page editor. The same engine sets every change again; the browser never sets the page's type.",
    "Desk च्या पान संपादकात. प्रत्येक बदल तेच इंजिन पुन्हा मांडते; पानावरील अक्षरे ब्राउझर कधीच मांडत नाही.",
    "LAUNCH_PLAN",
    "L1 EXISTS: every change set by the engine; principle 2, exact type",
    ["editor", "exactType"],
  ),
  copy("workflow-check-name", "Check", "तपासणी", "§4.2 /features stages"),
  fact(
    "workflow-check-description",
    "Overlaps, text that does not fit and empty space are listed, and every print file goes through the independent checker.",
    "एकमेकांवर आलेला मजकूर, न बसणारा मजकूर आणि रिकामी जागा दाखवली जाते, आणि प्रत्येक छपाई फाइल स्वतंत्र तपासकातून जाते.",
    "DESK",
    "Edit a page: checks; save page",
    ["checks", "checker"],
  ),
  fact(
    "workflow-check-today",
    "In the Desk. Press files are not offered as current while any page fails or is unsaved.",
    "Desk मध्ये. एखादे पान नापास असेल किंवा जतन केलेले नसेल, तर छपाई फाइल्स चालू म्हणून दिल्या जात नाहीत.",
    "DESK",
    "Edit a page: save page",
    ["notCurrent"],
  ),
  copy("workflow-print-name", "Print", "छपाई", "§4.2 /features stages"),
  fact(
    "workflow-print-description",
    "One print file for each page and one for the whole edition, handed to the press by a person.",
    "प्रत्येक पानाची एक छपाई फाइल आणि संपूर्ण अंकाची एक फाइल; छापखान्याकडे ती माणूसच देतो.",
    "DESK",
    "Opening: one PDF/X-1a file per page plus one PDF of the whole edition",
    ["files"],
  ),
  fact(
    "workflow-print-today",
    "In the Desk. So far only a text-only test page has been through a press.",
    "Desk मध्ये. आतापर्यंत फक्त मजकुराचे एक चाचणी पान छापखान्यातून गेले आहे.",
    "LAUNCH_PLAN",
    "§3 engine service row",
    ["pressTextOnly"],
  ),
  copy("workflow-archive-name", "Archive", "संग्रह", "§4.2 /features stages"),
  plan(
    "workflow-archive-description",
    "Every printed edition kept as printed, searchable and reprintable.",
    "प्रत्येक छापलेला अंक जसा छापला तसा जपलेला, शोधता येणारा आणि पुन्हा छापता येणारा.",
    "LAUNCH_PLAN",
    "L3 archive",
    ["archivePlan"],
  ),
  plan(
    "workflow-archive-today",
    "Planned for a later stage. Nothing is archived yet.",
    "पुढच्या टप्प्यासाठी नियोजित. अद्याप काहीही संग्रहित केलेले नाही.",
    "LAUNCH_PLAN",
    "L3 archive",
    ["archivePlan"],
  ),

  // ── Home: built for Marathi newspapers ───────────────────────────────
  copy("marathi-standing", "Built for Marathi newspapers", "मराठी वृत्तपत्रांसाठी घडवलेले", "§4.2 Marathi typography showcase"),
  copy(
    "marathi-title",
    "Devanagari set the way a Marathi desk sets it",
    "मराठी डेस्क जशी देवनागरी मांडतो, तशीच",
    "§4.2 Marathi typography showcase",
  ),
  fact(
    "marathi-body-1",
    "Pageinator was built on Marathi pages first. Its typesetter draws conjuncts and vowel signs correctly and prints Devanagari digits in folios and dates. It never breaks a headline's keep-together rules: a title from its name, a number from its unit, a date.",
    "Pageinator ची सुरुवातच मराठी पानांवरून झाली. त्याची अक्षरजुळणी जोडाक्षरे आणि मात्रा अचूक काढते, आणि पानक्रमांक व तारखांत देवनागरी अंक छापते. ती मथळ्यातील एकत्र ठेवायचे नियम कधीच मोडत नाही: नावापासून उपाधी, संख्येपासून तिचे एकक, किंवा तारीख वेगळी होत नाही.",
    "TYPESETTING",
    "EXP-COMPOSE-1 rendering check; Desk folio digits; EXP-HEAD-1 headline rules",
    ["marathiFirst", "conjuncts", "digits", "headlines", "headlineRules"],
  ),
  fact(
    "marathi-body-2",
    "No AI decides a line break, a size, a position or a fit. The engine's own rules do.",
    "ओळ कुठे तुटेल, अक्षरांचा आकार, जागा किंवा मजकूर बसणे यांपैकी काहीही कृत्रिम बुद्धिमत्ता (AI) ठरवत नाही. ते इंजिनचे स्वतःचे नियम ठरवतात.",
    "LAUNCH_PLAN",
    "Principle 4, no AI for layout",
    ["noAi"],
  ),
  copy("marathi-label-story", "A news story", "एक बातमी", "§4.2 Marathi typography showcase"),
  copy("marathi-label-conjuncts", "Conjuncts", "जोडाक्षरे", "§4.2 Marathi typography showcase"),
  copy("marathi-label-digits", "Devanagari digits", "देवनागरी अंक", "§4.2 Marathi typography showcase"),
  copy(
    "marathi-caption",
    "A fictional example, set by your browser in your computer's own Devanagari font. It shows the script, not Pageinator's output.",
    "हे काल्पनिक उदाहरण तुमच्या ब्राउझरने तुमच्या संगणकातील देवनागरी फॉन्टमध्ये मांडले आहे. ते लिपी दाखवते; ही Pageinator ची निर्मिती नाही.",
    "§4.2 Marathi typography showcase; ui005 figure rule: a diagram is never presented as output",
  ),
  specimen("specimen-kicker", "कल्पितपूर"),
  specimen("specimen-headline", "नदीकाठच्या गावात नव्या पुलाचे काम सुरू"),
  specimen("specimen-deck", "विद्यार्थ्यांचा रोजचा लांबचा वळसा पावसाळ्यापूर्वी संपणार"),
  specimen(
    "specimen-body",
    "कल्पितपूर, ता. १२ : गावातील विद्यार्थ्यांना शाळेत पोहोचण्यासाठी आता नदी ओलांडून लांबचा वळसा घालावा लागणार नाही. पुलाचे काम पावसाळ्यापूर्वी पूर्ण होईल, असे ग्रामपंचायतीने स्पष्ट केले.",
  ),
  specimen("specimen-folio", "पान ४ · कल्पित वार्ता"),
  specimen("specimen-conjuncts", "क्ष त्र ज्ञ श्र द्य ष्ट्र स्त्र"),
  specimen("specimen-digits", "० १ २ ३ ४ ५ ६ ७ ८ ९"),

  // ── Deliberate limits ────────────────────────────────────────────────
  copy("limits-standing", "Deliberate limits", "जाणीवपूर्वक मर्यादा", "Master specification §5 non-goals", "PRODUCT_MAP"),
  copy("limits-title", "What Pageinator will not be", "Pageinator काय असणार नाही", "Master specification §5 non-goals", "PRODUCT_MAP"),
  copy("limit-ai-name", "Not AI layout", "कृत्रिम बुद्धिमत्तेची मांडणी नाही", "Launch plan principle 4", "LAUNCH_PLAN"),
  fact(
    "limit-ai-body",
    "Layout, line breaks and fit come from the engine's rules. If an AI ever suggests text, a person accepts it first.",
    "मांडणी, ओळी तुटणे आणि मजकूर बसणे हे इंजिनच्या नियमांतून येते. कधी AI ने मजकूर सुचवला, तरी तो आधी माणूसच स्वीकारतो.",
    "LAUNCH_PLAN",
    "Principle 4",
    ["noAi"],
  ),
  copy("limit-design-name", "Not a general design tool", "सर्वसाधारण डिझाइन साधन नाही", "Master specification §5: not a full InDesign clone", "PRODUCT_MAP"),
  copy(
    "limit-design-body",
    "It sets newspaper pages on the paper's own grid, not posters or magazines.",
    "ते वृत्तपत्राची पाने त्या वृत्तपत्राच्याच स्तंभरचनेत मांडते; पोस्टर किंवा मासिके नाही.",
    "Master specification §5: not a full InDesign clone",
    "PRODUCT_MAP",
  ),
  copy("limit-press-name", "Not automatic press control", "छापखान्याचे स्वयंचलित नियंत्रण नाही", "Master specification §5: manual press handoff", "PRODUCT_MAP"),
  copy(
    "limit-press-body",
    "A person hands the files to the press. Pageinator never drives a printing press.",
    "फाइल्स छापखान्याकडे माणूसच देतो. Pageinator कधीच छपाई यंत्र चालवत नाही.",
    "Master specification §5: manual press handoff",
    "PRODUCT_MAP",
  ),
  copy("limit-claims-name", "Not a claim before the proof", "पुराव्याआधी दावा नाही", "§4 claims rule"),
  fact(
    "limit-claims-body",
    "A capability appears on this site only once it works, with its record named.",
    "एखादी क्षमता प्रत्यक्ष चालू झाल्यावरच, तिच्या नोंदीसह, या संकेतस्थळावर येते.",
    "WEBSITE_SPEC",
    "§4: each claim is added only when it is true and sourced",
    ["sourced"],
  ),

  // ── Security and privacy (Home summary and /security) ────────────────
  copy("home-security-standing", "Security and privacy", "सुरक्षा आणि गोपनीयता", "§4.2 Home security summary"),
  copy("home-security-title", "How a paper's data is kept", "वृत्तपत्राची माहिती कशी जपली जाते", "§4.2 Home security summary"),
  fact(
    "security-separate",
    "In the newsroom app, each paper's data is walled off by the database itself, and tests check that one paper cannot reach another's.",
    "वृत्तकक्ष ॲपमध्ये प्रत्येक वृत्तपत्राची माहिती डेटाबेसच्या पातळीवरच वेगळी ठेवली जाते, आणि एका वृत्तपत्राला दुसऱ्याची माहिती मिळू शकत नाही हे चाचण्या तपासतात.",
    "L2_PLAN",
    "Tenancy has four layers; the cross-tenant tests",
    ["tenancy", "tenancyTests"],
  ),
  fact(
    "security-audit",
    "An audit log records refused actions, invitations, member changes and deleted stories. Its entries cannot be changed or removed.",
    "बदलांच्या नोंदवहीत (ऑडिट लॉग) नाकारलेल्या कृती, निमंत्रणे, सदस्यांतील बदल आणि हटवलेल्या बातम्या नोंदवल्या जातात. त्यातील नोंदी बदलता किंवा काढता येत नाहीत.",
    "CODE",
    "app.audit_event, append-only; written by access, people and stories",
    ["auditAppendOnly", "auditRefusals", "auditMembers", "auditInvitations", "auditStories"],
  ),
  fact(
    "security-two-step",
    "Owners and admins must turn on two-step sign-in with an authenticator app before they can open their organisation.",
    "मालक आणि प्रशासकांना त्यांची संस्था उघडण्यापूर्वी ऑथेंटिकेटर ॲपद्वारे दोन टप्प्यांचा प्रवेश सुरू करावा लागतो.",
    "CODE",
    "docs/DEVELOPMENT.md bootstrap-org; app.org_settings.mfa_required_roles",
    ["twoStep"],
  ),
  plan(
    "security-india",
    "Hosting in India is planned, with a second Indian region for recovery copies.",
    "भारतातच होस्टिंग नियोजित आहे; पुनर्प्राप्तीसाठीच्या प्रती भारतातील दुसऱ्या प्रदेशात असतील.",
    "ADR",
    "ADR-008: hosting region in India accepted; recovery to a second Indian region",
    ["india", "indiaDr", "hostingLater"],
  ),

  // ── Features page ────────────────────────────────────────────────────
  copy(
    "features-title",
    "What Pageinator does today, stage by stage",
    "Pageinator आज काय करते, टप्प्याटप्प्याने",
    "§4.2 /features",
  ),
  fact(
    "features-lead",
    "Each stage says what it does and what works today. Most of it runs in Pageinator Desk; the newsroom app is being prepared for a pilot.",
    "प्रत्येक टप्पा काय करतो आणि आज काय चालते, हे सांगितले आहे. बहुतेक काम Pageinator Desk मध्ये चालते; वृत्तकक्ष ॲप प्रायोगिक वापरासाठी तयार केले जात आहे.",
    "LAUNCH_PLAN",
    "L1 EXISTS; L2 release check",
    ["edition", "pilotNotRun"],
  ),
  copy("features-stages-standing", "Stage by stage", "टप्प्याटप्प्याने", "§4.2 /features"),
  copy("newsroom-standing", "The newsroom app", "वृत्तकक्ष ॲप", "L2 plan", "L2_PLAN"),
  copy("newsroom-title", "Being prepared for a pilot", "प्रायोगिक वापरासाठी तयारी सुरू", "L2 plan", "L2_PLAN"),
  fact(
    "newsroom-lead",
    "Built so a paper's reporters and desk work in one place. It is not available to buy, and no paper's staff use it yet.",
    "वृत्तपत्राचे वार्ताहर आणि डेस्क एकाच ठिकाणी काम करावेत म्हणून हे घडवले आहे. ते विकत मिळत नाही, आणि अद्याप कोणत्याही वृत्तपत्राचे कर्मचारी ते वापरत नाहीत.",
    "L2_PLAN",
    "L2.1 release check: real staff data only after the pilot's checks",
    ["pilotNotRun"],
  ),
  fact(
    "newsroom-accounts",
    "Accounts open only from an emailed invitation, and owners and admins must use two-step sign-in.",
    "खाते फक्त ईमेलने आलेल्या निमंत्रणातूनच उघडते, आणि मालक व प्रशासकांसाठी दोन टप्प्यांचा प्रवेश आवश्यक आहे.",
    "L2_PLAN",
    "Better Auth with sign-up only by invitation; two-step required of owners and admins",
    ["invitation", "twoStep"],
  ),
  fact(
    "newsroom-filing",
    "Reporters file stories from a phone, with a photo, its caption and its credit.",
    "वार्ताहर फोनवरून बातमी पाठवतात, छायाचित्र, छायाचित्र ओळ आणि सौजन्यासह.",
    "CODE",
    "apps/web story editor (phone first) and photo panel",
    ["phone", "photos"],
  ),
  fact(
    "newsroom-server",
    "Comments on a story, live updates and the audit log are built in the server; their screens are still being built.",
    "बातमीवरील टिप्पण्या, थेट अद्ययावत माहिती आणि बदलांची नोंदवही सर्व्हरमध्ये घडवलेले आहेत; त्यांचे स्क्रीन अजून घडवले जात आहेत.",
    "CODE",
    "apps/api comments, live events and audit log",
    ["comments", "live", "auditAppendOnly"],
  ),
  fact(
    "newsroom-desk",
    "Sending stories to the Desk: the Desk can import them already, and the newsroom's sending side is still being built.",
    "बातम्या Desk कडे पाठवणे: Desk त्या आधीच आयात करू शकतो, आणि वृत्तकक्षाकडून पाठवण्याची बाजू अजून घडवली जात आहे.",
    "DESK",
    "Pageinator stories import (PR 24, the Desk side)",
    ["bundle"],
  ),
  fact(
    "newsroom-languages",
    "The Desk, the newsroom app and this website are in English and Marathi. The Marathi is a first draft that a native editor will review.",
    "Desk, वृत्तकक्ष ॲप आणि हे संकेतस्थळ इंग्रजी आणि मराठीत आहेत. मराठी मजकूर हा पहिला मसुदा आहे; मराठी भाषक संपादक तो तपासतील.",
    "LAUNCH_PLAN",
    "L1 EXISTS: English and Marathi labels; the web app's catalogue and review list; D-5",
    ["deskLanguages", "webLanguages", "webReview"],
  ),

  // ── Pricing page ─────────────────────────────────────────────────────
  copy("pricing-title", "Pricing", "किंमत", "§4.2 /pricing"),
  fact(
    "pricing-lead",
    "Pageinator is not for sale yet. Pricing for a pilot is agreed in conversation with each paper.",
    "Pageinator अद्याप विक्रीसाठी नाही. प्रायोगिक वापराची किंमत प्रत्येक वृत्तपत्राशी चर्चा करून ठरते.",
    "WEBSITE_SPEC",
    "§4.2 /pricing: pilot pricing by conversation",
    ["pilotPricing"],
  ),
  plan(
    "pricing-later",
    "Plans and prices will be set after the pilot, once it is clear what papers need.",
    "वृत्तपत्रांना काय हवे हे स्पष्ट झाल्यावर, प्रायोगिक वापरानंतर योजना आणि किंमती ठरतील.",
    "WEBSITE_SPEC",
    "§4.2 /pricing: plans once decided (OP09)",
    ["plansLater", "pricingOpen"],
  ),
  copy("pricing-pilot-standing", "A pilot", "प्रायोगिक वापर", "§4.2 /pricing: what each plan will include"),
  copy("pricing-pilot-title", "What a pilot would include", "प्रायोगिक वापरात काय असेल", "§4.2 /pricing: what each plan will include"),
  plan(
    "pricing-pilot-measure",
    "Your paper's page designs and needs, measured from its own printed pages.",
    "तुमच्या वृत्तपत्राच्या स्वतःच्या छापील पानांवरून मोजलेली पानरचना आणि गरजा.",
    "DESK",
    "Start it: the Desk measures the paper's pages",
    ["houseStyle"],
  ),
  plan(
    "pricing-pilot-desk",
    "Editions laid out with the Desk, and a test print at your press before any real edition.",
    "Desk ने केलेली अंकांची मांडणी, आणि कोणताही खरा अंक छापण्यापूर्वी तुमच्या छापखान्यात चाचणी छपाई.",
    "LAUNCH_PLAN",
    "Principle 1: the press confirms a test print before a real edition",
    ["edition", "testPrint"],
  ),
  plan(
    "pricing-pilot-fonts",
    "Your paper's own fonts, once you provide the files and their licence.",
    "तुमच्या वृत्तपत्राचे स्वतःचे फॉन्ट, तुम्ही फाइल्स आणि त्यांचा परवाना दिल्यानंतर.",
    "LAUNCH_PLAN",
    "L1 inputs: the house fonts",
    ["houseFonts"],
  ),
  plan(
    "pricing-pilot-newsroom",
    "The newsroom app for your staff, once its pilot begins.",
    "तुमच्या कर्मचाऱ्यांसाठी वृत्तकक्ष ॲप, त्याचा प्रायोगिक वापर सुरू झाल्यावर.",
    "L2_PLAN",
    "L2.1 release check",
    ["pilotNotRun"],
  ),
  copy("pricing-excluded-standing", "Not offered", "उपलब्ध नाही", "§4.2 /pricing"),
  copy("pricing-excluded-title", "What is not on offer yet", "अद्याप काय उपलब्ध नाही", "§4.2 /pricing"),
  fact(
    "pricing-excluded-body",
    "There is no published price, no online checkout, no self-serve sign-up and no contract on this website.",
    "या संकेतस्थळावर प्रसिद्ध केलेली किंमत, ऑनलाइन खरेदी, स्वतःहून नोंदणी किंवा करार नाही.",
    "L2_PLAN",
    "Sign-up only by invitation; no payments",
    ["invitation", "noPaymentCapability"],
  ),

  // ── Security page ────────────────────────────────────────────────────
  copy("security-title", "Security, privacy and current limits", "सुरक्षा, गोपनीयता आणि सध्याच्या मर्यादा", "§4.2 /security"),
  copy(
    "security-lead",
    "What is true today, what is planned and what is not true yet, kept apart on purpose.",
    "आज काय खरे आहे, काय नियोजित आहे आणि काय अजून खरे नाही, हे मुद्दाम वेगळे ठेवले आहे.",
    "§4.2 /security; claims rules",
  ),
  copy("security-true-standing", "Current reality", "सद्यस्थिती", "§4.2 /security"),
  copy("security-true-title", "What is true today", "आज काय खरे आहे", "§4.2 /security"),
  fact(
    "security-passwords",
    "Passwords are kept only as one-way hashes, never as text.",
    "पासवर्ड कधीच मूळ स्वरूपात ठेवले जात नाहीत; फक्त एकमार्गी हॅश स्वरूपात.",
    "CODE",
    "apps/api identity: argon2id",
    ["passwords"],
  ),
  fact(
    "security-cookies",
    "A signed-in browser keeps its session in cookies that page scripts cannot read. Sign-in gives the same answer for a wrong email address and a wrong password.",
    "प्रवेश केलेला ब्राउझर सत्र अशा कुकीजमध्ये ठेवतो ज्या पानावरील स्क्रिप्ट वाचू शकत नाहीत. चुकीचा ईमेल पत्ता आणि चुकीचा पासवर्ड, दोन्हींना प्रवेश एकच उत्तर देतो.",
    "L2_PLAN",
    "§4.5 HttpOnly session cookie; §4.6 generic answers",
    ["cookies", "cookiesCode", "cookiesTest", "sameAnswer"],
  ),
  fact(
    "security-origin",
    "A change can only come from Pageinator's own pages: a request sent from another website is refused.",
    "बदल फक्त Pageinator च्या स्वतःच्या पानांवरूनच होऊ शकतो: दुसऱ्या संकेतस्थळावरून आलेली विनंती नाकारली जाते.",
    "CODE",
    "apps/api origin guard (ADR-025)",
    ["originGuard"],
  ),
  fact(
    "security-contact",
    "This website's contact form emails your message to the Pageinator team and keeps no copy.",
    "या संकेतस्थळावरील संपर्क अर्ज तुमचा संदेश Pageinator टीमला ईमेलने पाठवतो आणि त्याची प्रत ठेवत नाही.",
    "CODE",
    "apps/api POST /api/v1/contact; shown only when connected",
    ["contact", "contactKeepsNothing", "contactConnected"],
  ),
  fact(
    "security-contact-off",
    "This website's contact form is not connected yet: it sends nothing.",
    "या संकेतस्थळावरील संपर्क अर्ज अजून जोडलेला नाही: तो काहीही पाठवत नाही.",
    "CODE",
    "apps/api GET /api/v1/contact answers connected: false without PGN_CONTACT_TO",
    ["contactConnected", "contactUnset"],
  ),
  copy("security-plan-standing", "Planned", "नियोजित", "§4.2 /security"),
  copy("security-plan-title", "What is planned, and not yet true", "काय नियोजित आहे, पण अजून खरे नाही", "§4.2 /security"),
  plan(
    "security-backups",
    "Backups and monitoring of the hosted service, and an archive of printed editions that cannot be altered.",
    "होस्ट केलेल्या सेवेचे बॅकअप आणि देखरेख, आणि छापलेल्या अंकांचा बदलता न येणारा संग्रह.",
    "LAUNCH_PLAN",
    "L2 hosting; §3.1 files row",
    ["backups", "objectLock"],
  ),
  plan(
    "security-legal",
    "A privacy notice, terms of use and a grievance officer, as India's data protection law requires.",
    "भारतीय माहिती संरक्षण कायद्यानुसार गोपनीयता सूचना, वापराच्या अटी आणि तक्रार निवारण अधिकारी.",
    "WEBSITE_SPEC",
    "§4.1 footer: Legal (DPDP)",
    ["legal"],
  ),
  copy("security-limits-standing", "Current limits", "सध्याच्या मर्यादा", "§4.2 /security: current limits"),
  copy("security-limits-title", "What is not true today", "आज काय खरे नाही", "§4.2 /security: current limits"),
  denial(
    "security-limit-hosting",
    "No paper's data is hosted yet: the newsroom app is not deployed.",
    "अद्याप कोणत्याही वृत्तपत्राची माहिती होस्ट केलेली नाही: वृत्तकक्ष ॲप अजून सुरू केलेले नाही.",
    "L2_PLAN",
    "PR 25 deploy not built",
  ),
  denial(
    "security-limit-assessment",
    "No certification, audit, attestation or third-party assessment of any kind.",
    "कोणतेही प्रमाणपत्र, लेखापरीक्षण, साक्षांकन किंवा त्रयस्थ मूल्यमापन नाही.",
    "PRODUCT_MAP",
    "Route map: no invented certifications",
  ),
  denial(
    "security-limit-testing",
    "No penetration test and no compliance programme.",
    "घुसखोरीची चाचणी (पेनिट्रेशन टेस्ट) झालेली नाही, आणि अनुपालन कार्यक्रमही नाही.",
    "PRODUCT_MAP",
    "Hardening not started",
  ),
  denial(
    "security-limit-encryption",
    "No encryption-at-rest claim.",
    "साठवलेल्या माहितीच्या कूटबद्धतेचा कोणताही दावा नाही.",
    "L2_PLAN",
    "§8 hosting not yet deployed",
  ),
  denial(
    "security-limit-availability",
    "No availability commitment, no service-level agreement and no incident-response programme.",
    "उपलब्धतेची कोणतीही बांधिलकी, सेवा-स्तर करार किंवा घटना-प्रतिसाद कार्यक्रम नाही.",
    "PRODUCT_MAP",
    "Hardening not started",
  ),
  denial(
    "security-limit-processing",
    "No data-processing agreement and no sub-processor list.",
    "माहिती-प्रक्रिया करार नाही, आणि उप-प्रक्रियाकर्त्यांची यादीही नाही.",
    "L2_PLAN",
    "§8 hosting not yet decided",
  ),
  copy("security-nonleak-standing", "By design", "रचनेनुसार", "§4.2 /security: tenancy"),
  copy("security-nonleak-title", "Another paper's records stay invisible", "दुसऱ्या वृत्तपत्राच्या नोंदी दिसत नाहीत", "§4.2 /security: tenancy"),
  fact(
    "security-nonleak-body",
    "The server answers an organisation you do not belong to exactly as it answers one that does not exist, and the screens show the same page for both.",
    "तुम्ही सदस्य नसलेल्या संस्थेबद्दल सर्व्हर अगदी तसेच उत्तर देतो जसे अस्तित्वात नसलेल्या संस्थेबद्दल, आणि दोन्हींसाठी स्क्रीनवर एकच पान दिसते.",
    "CODE",
    "apps/api not_found for a non-member (plan §5.1)",
    ["notFound"],
  ),
  copy("security-report-standing", "Reporting", "कळवणे", "§4.2 /security"),
  copy("security-report-title", "How to report a security problem", "सुरक्षेतील त्रुटी कशी कळवावी", "§4.2 /security"),
  copy(
    "security-report-body",
    "Use the contact form and choose “Something else”. Please do not send passwords or other people's personal details.",
    "संपर्क अर्ज वापरा आणि “इतर काही” निवडा. कृपया पासवर्ड किंवा इतरांची वैयक्तिक माहिती पाठवू नका.",
    "§4.2 /contact intents",
  ),

  // ── Contact page ─────────────────────────────────────────────────────
  copy("contact-title", "Contact", "संपर्क", "§4.2 /contact"),
  copy(
    "contact-lead",
    "Book a demo, ask about a pilot for your paper, or write to us as a press.",
    "डेमो ठरवा, तुमच्या वृत्तपत्रासाठी प्रायोगिक वापराबद्दल विचारा, किंवा छापखाना म्हणून आम्हाला लिहा.",
    "§4.2 /contact: intents",
  ),
  fact(
    "contact-connected",
    "Messages sent here go by email to the people who build Pageinator.",
    "येथून पाठवलेले संदेश Pageinator घडवणाऱ्या लोकांकडे ईमेलने जातात.",
    "CODE",
    "apps/api GET and POST /api/v1/contact; shown only when connected",
    ["contact", "contactConnected"],
  ),
  fact(
    "contact-off-body",
    "It cannot send messages yet, so no form is shown here. Please come back later.",
    "तो अजून संदेश पाठवू शकत नाही, म्हणून येथे अर्ज दाखवलेला नाही. कृपया नंतर पुन्हा भेट द्या.",
    "CODE",
    "apps/api GET /api/v1/contact answers connected: false without PGN_CONTACT_TO",
    ["contactConnected", "contactUnset"],
  ),
  copy(
    "contact-checking",
    "Checking whether the form is connected…",
    "अर्ज जोडलेला आहे का ते पाहत आहे…",
    "Contact API: GET /api/v1/contact",
    "CODE",
  ),
  copy("contact-unknown-heading", "The contact form could not be reached", "संपर्क अर्ज उपलब्ध होऊ शकला नाही", "Contact API: no answer", "CODE"),
  copy(
    "contact-unknown-body",
    "Check your connection and reload this page.",
    "तुमची इंटरनेट जोडणी तपासा आणि हे पान पुन्हा उघडा.",
    "Contact API: no answer",
    "CODE",
  ),
  fact(
    "contact-privacy",
    "Your message is emailed to the Pageinator team and stays in their mailbox. This website keeps no copy of it. Like every request, sending it leaves your connection's address in the server's log.",
    "तुमचा संदेश Pageinator टीमला ईमेलने पाठवला जातो आणि त्यांच्या मेलबॉक्समध्ये राहतो. हे संकेतस्थळ त्याची प्रत ठेवत नाही. प्रत्येक विनंतीप्रमाणे, तो पाठवताना सर्व्हरच्या नोंदीत तुमच्या जोडणीचा पत्ता नोंदवला जातो.",
    "CODE",
    "apps/api POST /api/v1/contact keeps nothing; the request log's remoteAddress",
    ["contact", "contactKeepsNothing", "requestLogAddress"],
  ),
  copy("contact-form-standing", "Your message", "तुमचा संदेश", "§4.2 /contact"),
  copy("contact-form-title", "Tell us about your paper", "तुमच्या वृत्तपत्राबद्दल सांगा", "§4.2 /contact"),
  copy("contact-intent-legend", "What would you like?", "तुम्हाला काय हवे आहे?", "§4.2 /contact: intent"),
  copy("contact-intent-demo", "A demo", "डेमो", "§4.2 /contact: intent"),
  copy("contact-intent-pilot", "A pilot for my paper", "माझ्या वृत्तपत्रासाठी प्रायोगिक वापर", "§4.2 /contact: intent"),
  copy("contact-intent-press", "We are a press (printing partner)", "आम्ही छापखाना आहोत (छपाई भागीदार)", "§4.2 /contact: intent"),
  copy("contact-intent-other", "Something else", "इतर काही", "§4.2 /contact: intent"),
  copy("contact-label-name", "Your name", "तुमचे नाव", "§4.2 /contact: fields"),
  copy("contact-label-newspaper", "Newspaper or organisation", "वृत्तपत्र किंवा संस्था", "§4.2 /contact: fields"),
  copy("contact-label-city", "City", "शहर", "§4.2 /contact: fields"),
  copy("contact-label-phone", "Phone or WhatsApp", "फोन किंवा WhatsApp", "§4.2 /contact: fields"),
  copy("contact-label-email", "Email", "ईमेल", "§4.2 /contact: fields"),
  copy("contact-label-message", "Message", "संदेश", "§4.2 /contact: fields"),
  copy("contact-label-trap", "Leave this empty", "हे रिकामे ठेवा", "Contact API: the trap field", "CODE"),
  copy(
    "contact-hint-reach",
    "Give a phone number or an email address, or both.",
    "फोन नंबर किंवा ईमेल पत्ता द्या, किंवा दोन्ही.",
    "Contact API: phone or email",
    "CODE",
  ),
  copy(
    "contact-hint-message",
    "Optional. For example, how many pages you print, and when.",
    "ऐच्छिक. उदा. तुम्ही किती पाने छापता, आणि केव्हा.",
    "§4.2 /contact: fields",
  ),
  copy("contact-submit", "Send", "पाठवा", "§4.2 /contact: primary action Send"),
  copy("contact-sending", "Sending…", "पाठवत आहे…", "§4.2 /contact"),
  copy("contact-error-name", "Enter your name.", "तुमचे नाव लिहा.", "Contact API: name is required", "CODE"),
  copy(
    "contact-error-reach",
    "Give a phone number or an email address.",
    "फोन नंबर किंवा ईमेल पत्ता द्या.",
    "Contact API: phone or email",
    "CODE",
  ),
  copy(
    "contact-error-phone",
    "Write the phone number with digits, spaces and + ( ) - only.",
    "फोन नंबर फक्त अंक, जागा आणि + ( ) - वापरून लिहा.",
    "Contact API: phone shape",
    "CODE",
  ),
  copy("contact-error-email", "Check the email address.", "ईमेल पत्ता तपासा.", "Contact API: one plain address", "CODE"),
  copy("contact-required", "(required)", "(आवश्यक)", "§4.2 /contact: fields"),
  copy(
    "contact-error-text",
    "Remove the special characters from this text.",
    "या मजकुरातील विशेष चिन्हे काढा.",
    "Contact API: text only",
    "CODE",
  ),
  copy("contact-error-too-long", "This is too long.", "हे खूप लांब आहे.", "Contact API: length limits", "CODE"),
  copy("contact-error-line", "Write this on one line.", "हे एकाच ओळीत लिहा.", "Contact API: one line", "CODE"),
  copy("contact-sent-heading", "Thank you. Your message was sent.", "धन्यवाद. तुमचा संदेश पाठवला गेला.", "§4.2 /contact: confirmation copy"),
  fact(
    "contact-sent-body",
    "It has gone by email to the Pageinator team.",
    "तो Pageinator टीमला ईमेलने पाठवला आहे.",
    "CODE",
    "apps/api POST /api/v1/contact answers once the mail server took it",
    ["contact"],
  ),
  copy("contact-send-another", "Write another message", "आणखी एक संदेश लिहा", "§4.2 /contact"),
  copy(
    "contact-unavailable-heading",
    "The contact form is not connected yet",
    "संपर्क अर्ज अजून जोडलेला नाही",
    "Contact API: 503 contact_unavailable",
    "CODE",
  ),
  copy(
    "contact-unavailable-body",
    "Your message was not sent. Please try again later; what you wrote is still here.",
    "तुमचा संदेश पाठवला गेला नाही. कृपया नंतर पुन्हा प्रयत्न करा; तुम्ही लिहिलेले येथेच आहे.",
    "Contact API: 503 contact_unavailable",
    "CODE",
  ),
  copy(
    "contact-down-heading",
    "Your message could not be sent just now",
    "तुमचा संदेश आत्ता पाठवता आला नाही",
    "Contact API: 503 contact_send_failed",
    "CODE",
  ),
  copy(
    "contact-down-body",
    "Please try again later. What you wrote is still here.",
    "कृपया नंतर पुन्हा प्रयत्न करा. तुम्ही लिहिलेले येथेच आहे.",
    "Contact API: 503 contact_send_failed",
    "CODE",
  ),
  copy(
    "contact-refused-heading",
    "This page could not send your message",
    "हे पान तुमचा संदेश पाठवू शकले नाही",
    "Contact API: 403 bad_origin, or a refused hidden field",
    "CODE",
  ),
  copy(
    "contact-refused-body",
    "Copy what you wrote, reload the page and try again.",
    "तुम्ही लिहिलेले कॉपी करून ठेवा, पान पुन्हा उघडा आणि पुन्हा प्रयत्न करा.",
    "Contact API: 403 bad_origin, or a refused hidden field",
    "CODE",
  ),
  copy("contact-busy-heading", "Too many messages", "खूप संदेश", "Contact API: 429 slow_down", "CODE"),
  copy(
    "contact-busy-body",
    "Too many messages have been sent. Please try again later.",
    "खूप संदेश पाठवले गेले आहेत. कृपया नंतर पुन्हा प्रयत्न करा.",
    "Contact API: 429 slow_down",
    "CODE",
  ),
  copy("contact-failed-heading", "Your message was not sent", "तुमचा संदेश पाठवला गेला नाही", "Contact API: network failure", "CODE"),
  copy(
    "contact-failed-body",
    "Check your connection and try again. What you wrote is still here.",
    "तुमची इंटरनेट जोडणी तपासा आणि पुन्हा प्रयत्न करा. तुम्ही लिहिलेले येथेच आहे.",
    "Contact API: network failure",
    "CODE",
  ),
  copy("contact-invalid-heading", "Some fields need attention", "काही रकाने तपासा", "Contact API: 400 invalid_request", "CODE"),

  // ── Page geometry figure ─────────────────────────────────────────────
  copy(
    "figure-caption",
    "Illustration of newspaper page structure. This is a diagram, not output produced by Pageinator.",
    "वृत्तपत्राच्या पानरचनेचे रेखाचित्र. ही केवळ आकृती आहे; Pageinator ने तयार केलेले पान नाही.",
    "ui005 §14.2 required caption",
  ),
  copy(
    "figure-alt",
    "A schematic newspaper page: outer margins, a six-column grid with gutters, a reserved advertisement rectangle in one corner, and an arrow marking text flowing from one column region to another.",
    "वृत्तपत्राच्या पानाची आकृती: बाहेरचे समास, अंतरांसह सहा स्तंभांची रचना, एका कोपऱ्यात जाहिरातीसाठी राखलेला आयत, आणि एका स्तंभातून दुसऱ्या स्तंभात जाणारा मजकूर दाखवणारा बाण.",
    "ui005 §14.2 accessible description",
  ),
  copy("figure-label-grid", "Column grid", "स्तंभरचना", "ui005 §14.2 region labels"),
  copy("figure-label-ad", "Reserved ad", "राखीव जाहिरात", "ui005 §14.2 region labels"),
  copy("figure-label-flow", "Linked flow", "जोडलेला प्रवाह", "ui005 §14.2 region labels"),
];

const BY_ID = new Map(RECORDS.map((record) => [record.id, record]));

/** Every content record, for the claims scan and the Marathi review list. */
export const CONTENT_RECORDS: readonly ContentRecord[] = RECORDS;

/** One record, or an error for an unknown id (a typo is a test failure, not an empty region). */
export function contentRecord(id: string): ContentRecord {
  const record = BY_ID.get(id);
  if (!record) throw new Error(`Unknown public content id: ${id}`);
  return record;
}

/** A record's text in a language. */
export function text(id: string, language: PublicLanguage): string {
  return contentRecord(id)[language];
}

/** The language a record's text is written in on a page: a specimen is Marathi on both. */
export function languageOf(id: string, page: PublicLanguage): PublicLanguage {
  return contentRecord(id).kind === "specimen" ? "mr" : page;
}

/** Every rendered string the public pages can show, in both languages. */
export function contentTexts(): readonly string[] {
  return RECORDS.flatMap((record) => [record.en, record.mr]);
}
