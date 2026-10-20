/**
 * Pageinator canonical route table (UI002 §6).
 *
 * This module is the one durable source of path structure. Later
 * units replace what renders at a leaf; they do not renegotiate the
 * path. `PATTERNS` are React Router path strings (used to declare
 * `<Route>` elements); `paths` are typed builder functions (used by
 * links, tests, and deep-link construction) so a param can never be
 * forgotten or misplaced by hand-writing a template string at the call
 * site.
 *
 * Route identifiers are illustrative in the same sense Phase 15 marks
 * them illustrative — one consistent family, not a locked production
 * URL contract.
 */

/**
 * Every route leaf's `<h1>` carries this id. `RouteAnnouncer` (§7.6)
 * looks it up after each navigation to move focus and announce the
 * new page's title — one shared convention instead of every leaf
 * wiring its own focus-management effect.
 */
export const ROUTE_HEADING_ID = "pg-route-heading";

/** Id of each shell's `<main>` landmark — the skip link's target. */
export const MAIN_LANDMARK_ID = "pg-main";

export const PATTERNS = {
  // Public
  home: "/",
  features: "/features",
  pricing: "/pricing",
  security: "/security",
  contact: "/contact",
  login: "/login",
  signup: "/signup",
  forgotPassword: "/forgot-password",
  verify: "/verify",
  onboarding: "/onboarding",

  // Workspace root (layout route)
  workspaceRoot: "/org/:orgId",

  // Workspace — org admin (relative to workspaceRoot)
  orgSettings: "settings",
  orgBilling: "billing",
  orgStorage: "storage",

  // Workspace — publication scoped (relative to workspaceRoot)
  pubOverview: "pub/:pubId/overview",
  pubEditions: "pub/:pubId/editions",
  pubStories: "pub/:pubId/stories",
  pubMedia: "pub/:pubId/media",
  pubAds: "pub/:pubId/ads",
  pubTemplates: "pub/:pubId/templates",
  pubNewsroom: "pub/:pubId/newsroom",
  pubSources: "pub/:pubId/sources",
  pubArchive: "pub/:pubId/archive",
  pubArchiveRelease: "pub/:pubId/archive/:releaseId",
  pubBrand: "pub/:pubId/brand",
  pubPrintProfiles: "pub/:pubId/print-profiles",
  pubTeam: "pub/:pubId/team",

  // Edition workspace (relative to workspaceRoot; layout route + children)
  editionLayout: "pub/:pubId/editions/:editionId",
  editionContent: "content",
  editionGenerate: "generate",
  editionPreflight: "preflight",
  editionExport: "export",

  // Editor — its own top-level route, not nested under workspaceRoot,
  // because EditorShell replaces WorkspaceShell's chrome entirely
  // rather than extending it (UI002 §7.3).
  editionEditor: "/org/:orgId/pub/:pubId/editions/:editionId/editor",
} as const;

/** Typed absolute-path builders. Every function returns a real URL. */
export const paths = {
  home: () => "/",
  features: () => "/features",
  pricing: () => "/pricing",
  security: () => "/security",
  contact: () => "/contact",
  login: () => "/login",
  signup: () => "/signup",
  forgotPassword: () => "/forgot-password",
  verify: () => "/verify",
  onboarding: () => "/onboarding",

  orgSettings: (orgId: string) => `/org/${orgId}/settings`,
  orgBilling: (orgId: string) => `/org/${orgId}/billing`,
  orgStorage: (orgId: string) => `/org/${orgId}/storage`,

  pubOverview: (orgId: string, pubId: string) => `/org/${orgId}/pub/${pubId}/overview`,
  pubEditions: (orgId: string, pubId: string) => `/org/${orgId}/pub/${pubId}/editions`,
  pubStories: (orgId: string, pubId: string) => `/org/${orgId}/pub/${pubId}/stories`,
  pubMedia: (orgId: string, pubId: string) => `/org/${orgId}/pub/${pubId}/media`,
  pubAds: (orgId: string, pubId: string) => `/org/${orgId}/pub/${pubId}/ads`,
  pubTemplates: (orgId: string, pubId: string) => `/org/${orgId}/pub/${pubId}/templates`,
  pubNewsroom: (orgId: string, pubId: string) => `/org/${orgId}/pub/${pubId}/newsroom`,
  pubSources: (orgId: string, pubId: string) => `/org/${orgId}/pub/${pubId}/sources`,
  pubArchive: (orgId: string, pubId: string) => `/org/${orgId}/pub/${pubId}/archive`,
  pubArchiveRelease: (orgId: string, pubId: string, releaseId: string) =>
    `/org/${orgId}/pub/${pubId}/archive/${releaseId}`,
  pubBrand: (orgId: string, pubId: string) => `/org/${orgId}/pub/${pubId}/brand`,
  pubPrintProfiles: (orgId: string, pubId: string) =>
    `/org/${orgId}/pub/${pubId}/print-profiles`,
  pubTeam: (orgId: string, pubId: string) => `/org/${orgId}/pub/${pubId}/team`,

  edition: (orgId: string, pubId: string, editionId: string) =>
    `/org/${orgId}/pub/${pubId}/editions/${editionId}`,
  editionContent: (orgId: string, pubId: string, editionId: string) =>
    `/org/${orgId}/pub/${pubId}/editions/${editionId}/content`,
  editionGenerate: (orgId: string, pubId: string, editionId: string) =>
    `/org/${orgId}/pub/${pubId}/editions/${editionId}/generate`,
  editionPreflight: (orgId: string, pubId: string, editionId: string) =>
    `/org/${orgId}/pub/${pubId}/editions/${editionId}/preflight`,
  editionExport: (orgId: string, pubId: string, editionId: string) =>
    `/org/${orgId}/pub/${pubId}/editions/${editionId}/export`,
  editionEditor: (orgId: string, pubId: string, editionId: string) =>
    `/org/${orgId}/pub/${pubId}/editions/${editionId}/editor`,
} as const;

/**
 * Human-readable labels for breadcrumb and placeholder-title use.
 * Consumed by durable `Breadcrumbs` (via each route's `handle`, set in
 * the disposable route assembly) and by the disposable `PlaceholderScreen`
 * call sites directly. Living here keeps the label text itself in
 * durable code without requiring `Breadcrumbs.tsx` to import any demo
 * module — it only ever reads whatever `handle.label` the currently
 * matched routes carry, wherever they were registered.
 */
export const ROUTE_LABELS = {
  home: "Home",
  features: "Features",
  pricing: "Pricing",
  security: "Security",
  contact: "Contact",
  login: "Sign in",
  signup: "Sign up",
  forgotPassword: "Forgot password",
  verify: "Verify",
  onboarding: "Onboarding",
  orgSettings: "Organization settings",
  orgBilling: "Billing",
  orgStorage: "Storage",
  pubOverview: "Overview",
  pubEditions: "Editions",
  pubStories: "Stories",
  pubMedia: "Media",
  pubAds: "Ads",
  pubTemplates: "Templates",
  pubNewsroom: "Newsroom",
  pubSources: "Sources",
  pubArchive: "Archive",
  pubArchiveRelease: "Release",
  pubBrand: "Brand",
  pubPrintProfiles: "Print profiles",
  pubTeam: "Team",
  editionContent: "Content",
  editionGenerate: "Generate",
  editionPreflight: "Preflight",
  editionExport: "Export",
  editionPlan: "Plan",
  editionEditor: "Editor",
} as const;

/** The future unit that owns each route's real content (§6 table). */
export const OWNING_UNIT = {
  home: "UI005",
  features: "UI005",
  pricing: "UI005",
  security: "UI005",
  contact: "UI005",
  login: "UI004",
  signup: "UI004",
  forgotPassword: "UI004",
  verify: "UI004",
  onboarding: "UI006",
  orgSettings: "UI022–024",
  orgBilling: "UI024",
  orgStorage: "UI023",
  pubOverview: "UI007",
  pubEditions: "UI008",
  pubStories: "UI010–011",
  pubMedia: "UI011",
  pubAds: "UI012",
  pubTemplates: "UI013",
  pubNewsroom: "UI009",
  pubSources: "UI009–010",
  pubArchive: "UI021",
  pubArchiveRelease: "UI021",
  pubBrand: "UI013/022",
  pubPrintProfiles: "UI013",
  pubTeam: "UI022",
  editionContent: "UI010–012",
  editionGenerate: "UI014",
  editionPreflight: "UI019",
  editionExport: "UI020",
  editionPlan: "UI027 (proposed)",
  editionEditor: "UI015–018",
} as const;
