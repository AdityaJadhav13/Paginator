/**
 * The evidence the public website's facts and plans rest on (content.ts): for each key, a file in this repository and
 * words it contains, exactly. `tests/ui005/claims.test.ts` reads every file and fails when the words are not there,
 * so a claim cannot outlive its evidence. Only tests import the values; the pages ship the keys alone.
 *
 * Private files (~/PageinatorPrivate) are never evidence here: the repository is public.
 */

/** Where a fact or a plan is recorded: a file in this repository and words it contains, exactly. */
export interface Evidence {
  readonly path: string;
  readonly quote: string;
}

const LAUNCH = "docs/product/09-launch-plan.md";
const WEBSITE = "docs/product/03-website-and-accounts.md";
const DESK = "tools/desk/README.md";
const GEN1 = "docs/phase0/EXP_GEN_1_REPORT.md";
const PDF1 = "docs/phase0/EXP_PDF_1_REPORT.md";
const L2 = "docs/product/10-l2-newsroom-plan.md";

export const EVIDENCE = {
  edition: { path: LAUNCH, quote: "It already lays out a whole 4-, 8- or 16-page paper" },
  editionCode: { path: "tools/desk/engine/desk_engine.py", quote: "if pages not in (4, 8, 16) and pages not in sizes:" },
  houseStyle: { path: DESK, quote: "it chooses the paper's page designs and measures" },
  medians: { path: DESK, quote: "medians measured on the paper's own printed pages." },
  standInFonts: { path: DESK, quote: "The type uses the free stand-in fonts the experiments use; the paper's own fonts come later." },
  exactType: { path: LAUNCH, quote: "The page is set only by our engine" },
  deskApp: { path: DESK, quote: "The Desk is a small local app for the owner's own newspaper." },
  gen1: { path: GEN1, quote: "On the held-out editions Pageinator lays out **all 28 Marathi pages** by itself (gen1/2.10.0, 2026-10-19)." },
  gen1Checks: { path: GEN1, quote: "**All 28 pass every automatic check.**" },
  gen1NoEditor: { path: GEN1, quote: "**No editor has judged the layouts yet. G1: NOT MET.**" },
  gen1Rebuilt: {
    path: GEN1,
    quote: "**Until now Pageinator copied the printed page plan. Now it makes the plan itself.** It is given:",
  },
  styleDiffers: { path: GEN1, quote: "**Pageinator's style differs from the paper's:**" },
  press: { path: PDF1, quote: "The owner reports that the printing unit accepted and printed the test page" },
  pressDate: { path: PDF1, quote: "**Press test done (2026-10-13).**" },
  pressG2: { path: PDF1, quote: "**G2: PASSED on the owner's report.**" },
  pressTextOnly: { path: LAUNCH, quote: "Press-tested with a text-only page (pages with photos or ads not yet)." },
  checker: { path: LAUNCH, quote: "Every page PDF is checked by the independent PDF/X-1a checker; a page that fails is never offered as a press file." },
  preflight: { path: LAUNCH, quote: "plus a commercial preflight or a press proof before any PDF/X claim (ADR-022)" },
  planner: { path: DESK, quote: "the planner gives each page a set of stories that fills it exactly" },
  articles: { path: DESK, quote: "an optional photo with caption and credit" },
  wordImport: { path: LAUNCH, quote: "Word (.docx) import;" },
  measure: { path: DESK, quote: "every story is measured at every width with the real typesetter." },
  fitsNowhere: { path: DESK, quote: "If an article fits nowhere, it is listed with the reason." },
  editor: { path: LAUNCH, quote: "select, move, resize, swap, remove and add stories on the grid; undo and redo; every change" },
  editorMore: { path: LAUNCH, quote: "lock a story in place; photo crop and focal point; move a story to another page;" },
  checks: { path: DESK, quote: "**Checks** list overlaps, text that does not fit, stories outside the news area or over an ad, and empty space." },
  notCurrent: { path: DESK, quote: "The Desk does not offer the press files as current while any page is changed and not saved," },
  files: { path: DESK, quote: "It gives you one PDF/X-1a file per page plus one PDF of the" },
  archivePlan: { path: LAUNCH, quote: "**Archive:** every printed edition, searchable and reprintable." },
  conjuncts: { path: "docs/phase0/EXP_COMPOSE_1_REPORT.md", quote: "Devanagari conjuncts, matras and hyphens draw correctly at the composed positions." },
  digits: { path: "tools/desk/engine/deskfolio.py", quote: 'DEVA_DIGITS = "०१२३४५६७८९"' },
  headlines: { path: "docs/phase0/EXP_HEAD_1_REPORT.md", quote: "**Pageinator never breaks a keep-together rule**" },
  noAi: { path: LAUNCH, quote: "No AI decides any line break, size, position or fit. AI may suggest text, and a person" },
  marathiFirst: { path: LAUNCH, quote: "**Marathi first.** Correct Devanagari, Marathi input methods, Marathi labels." },
  sourced: { path: WEBSITE, quote: "Each claim below is added **only when it is true and sourced** in `content.ts`." },
  pressHandoff: { path: LAUNCH, quote: "**Release:** preflight, approvals, export, and sending to the press with a receipt." },
  tenancy: { path: L2, quote: "a hard organisation wall (FORCE RLS);" },
  tenancyTests: { path: "apps/api/test/tenancy/cross-tenant.test.ts", quote: "each organisation reads and writes only its own rows" },
  auditAppendOnly: { path: "apps/api/src/db/migrations/2026_11_01_0002_directory.ts", quote: "create trigger append_only before update or delete on app.audit_event" },
  auditMembers: { path: "apps/api/src/modules/people/members.ts", quote: 'action: "member.update",' },
  auditInvitations: { path: "apps/api/src/modules/people/invitations.ts", quote: 'action: "invitation.create",' },
  auditStories: { path: "apps/api/src/db/stories.ts", quote: "Soft-deletes the story and records it in the audit log" },
  twoStep: { path: "docs/DEVELOPMENT.md", quote: "Two-step sign-in is required of Owners and Admins before any organisation route answers" },
  invitation: { path: L2, quote: "sign-up only by invitation" },
  passwords: { path: "apps/api/src/modules/identity/password.ts", quote: "Passwords are kept as argon2id hashes" },
  phone: { path: "apps/web/src/features/stories/StoryEditor.tsx", quote: "(plan §10 PR 22), phone first." },
  photos: { path: "apps/web/src/features/stories/PhotoPanel.tsx", quote: "give it a caption and a credit" },
  comments: { path: "apps/api/src/modules/stories/comments.ts", quote: "POST …/stories/:s/comments (comment.write" },
  live: {
    path: "apps/api/src/modules/notifications/routes.ts",
    quote: "GET …/events → text/event-stream (src/modules/notifications/events.ts): story, comment, notification, resync;",
  },
  bundle: { path: DESK, quote: "imports the `.zip` the hosted newsroom's \"Send to the Desk\" makes" },
  pilotNotRun: { path: L2, quote: "**Release check:** real staff data goes in only after items 2–4 are true." },
  deskLanguages: { path: LAUNCH, quote: "The Marathi is a first draft: a native editor checks it (D-5" },
  india: { path: "docs/architecture/v2/ADR/ADR-008-platform-hosting-auth.md", quote: "**ACCEPTED:** hosting region in India (baseline B12)." },
  indiaDr: { path: "docs/architecture/v2/ADR/ADR-008-platform-hosting-auth.md", quote: "Disaster recovery and archive replication go to Hyderabad (ap-south-2)." },
  hostingLater: { path: WEBSITE, quote: '"Made in India · Data stored in India" (once hosting is decided)' },
  backups: { path: LAUNCH, quote: "**Hosting:** in India, with backups and monitoring." },
  objectLock: { path: LAUNCH, quote: "Object Lock for the printed archive" },
  legal: { path: WEBSITE, quote: "Legal (Privacy, Terms, Grievance officer, as required by DPDP)" },
  cookies: { path: L2, quote: "the cookie is `__Secure-pgn.session_token` (HttpOnly, Secure, SameSite=Lax);" },
  cookiesCode: {
    path: "apps/api/src/modules/identity/auth.ts",
    quote: 'defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax" }',
  },
  cookiesTest: {
    path: "apps/api/test/db/identity.test.ts",
    quote: "verifying signs in with a __Secure- cookie: HttpOnly, Secure, SameSite=Lax",
  },
  auditRefusals: {
    path: "apps/api/src/modules/access/access.ts",
    quote: "the permission missing: 403 not_allowed, recorded in the audit log",
  },
  deskSavePage: {
    path: DESK,
    quote: "**Save page** writes the page's PDF/X-1a file, checks it with the independent checker",
  },
  headlineRules: {
    path: "docs/phase0/EXP_HEAD_1_REPORT.md",
    quote: "(a title from its name, a number from its unit, a date, punctuation or a dash at a line start)",
  },
  webLanguages: { path: "apps/web/src/i18n/catalogue.ts", quote: "/** The interface languages: English and Marathi. */" },
  webReview: { path: "apps/web/src/i18n/review.ts", quote: "a native Marathi editor," },
  contactConnected: {
    path: "apps/api/src/modules/contact/routes.ts",
    quote: "GET /api/v1/contact answers {connected}: true only when PGN_CONTACT_TO is set",
  },
  contactUnset: {
    path: "apps/api/src/modules/contact/routes.ts",
    quote: "Without that address the form answers 503 contact_unavailable",
  },
  requestLogAddress: { path: "apps/api/src/http/log.ts", quote: "remoteAddress: request.ip," },
  sameAnswer: { path: L2, quote: "tests: generic wrong-password answer" },
  originGuard: { path: "apps/api/src/http/origin-guard.ts", quote: "must come from an allowed origin and carry `X-Pageinator: 1`" },
  notFound: { path: "apps/api/src/http/errors.ts", quote: "There is nothing here, or you do not have access to it." },
  contact: { path: "apps/api/src/modules/contact/routes.ts", quote: "text, to the one address the owner set at deploy (PGN_CONTACT_TO)" },
  contactKeepsNothing: { path: "apps/api/src/modules/contact/routes.ts", quote: "and kept nowhere by the API: it lives on in that" },
  pilotPricing: { path: WEBSITE, quote: 'Until then: "Pilot pricing by conversation"' },
  plansLater: { path: WEBSITE, quote: "Plans once decided (OP09)." },
  pricingOpen: { path: "docs/architecture/v2/11_PLATFORM_SECURITY_OPS.md", quote: "Pricing is not decided (OP09)." },
  testPrint: { path: LAUNCH, quote: "Before a real edition, the press confirms a test print of the same kind of page." },
  houseFonts: { path: LAUNCH, quote: "the house fonts (the owner provides the files and the licence)" },
  noPaymentCapability: {
    path: "docs/architecture/DECISION_REGISTER.md",
    quote: "No live publishing/backend/AI/payment capability in initial backlog",
  },
} as const satisfies Record<string, Evidence>;

export type EvidenceKey = keyof typeof EVIDENCE;
