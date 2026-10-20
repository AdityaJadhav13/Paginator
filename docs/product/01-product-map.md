# Pageinator product specification — Product map

Part of the product specification ([index](README.md)). Examples are fictional.

## 2. Product map

### 2.1 The daily journey (what one newspaper night looks like)
```
Sign in → Overview ("Today: Thu 12 Nov — 4 pages — deadline 23:30")
  → Page plan (flatplan: sections, colour pages, ad dummy)
  → Content desk (stories, photos, ads arrive; readiness checklist)
  → Generate (auto-layout pages; 3 alternatives each)
  → Editor (designers adjust; editors fix text; comments; approvals)
  → Preflight (every print rule; blocking issues must be 0)
  → Export & press (PDF/X per page → send → receipt)
  → Release (approved, delivered, archived) → Archive (search, reopen, reprint)
```

### 2.2 Sitemap (routes)

**EXISTS:** routes 1–33 in `apps/web/src/app/routes.ts` (`frontend/` before M0). New routes are marked ★.

| Area | Route | Screen |
|---|---|---|
| Public | `/` `/features` `/pricing` `/security` `/contact` | Website (EXISTS, copy updated as features ship) |
| Public | ★`/how-it-works` ★`/marathi` ★`/about` ★`/legal/privacy` ★`/legal/terms` ★`/legal/grievance` ★`/status` (external link) | More website pages |
| Auth | `/login` `/signup` `/forgot-password` `/verify` ★`/reset-password` ★`/invite/:token` ★`/mfa` ★`/choose-organization` | Sign-in family |
| Onboarding | `/onboarding` (8 steps, §5.3) | New publication setup |
| Org | `/org/:orgId/settings` (tabs: General · ★Security · ★Publications · AI · Danger zone) `/billing` `/storage` ★`/audit` | Organization admin (§13) |
| Publication | `…/pub/:pubId/overview` | Overview (home after sign-in) |
| Publication | `…/editions` `…/stories` `…/media` `…/ads` `…/templates` ★`…/styles` | Production libraries |
| Publication | `…/newsroom` `…/sources` (later: G6) | Newsroom |
| Publication | `…/archive` `…/archive/:releaseId` ★`…/epaper` (later: G4) | Archive and e-paper |
| Publication | `…/brand` `…/print-profiles` ★`…/fonts` `…/team` ★`…/settings` | Publication settings |
| Edition | ★`…/editions/:editionId/plan` (the edition index now redirects here, not to `content`) `…/content` `…/generate` ★`…/pages` `…/preflight` `…/export` ★`…/history` | Edition workspace tabs |
| Editor | `…/editions/:editionId/editor` ★`…/editor/page/:pageId` (a stable page id, so links survive reordering in the Plan; replaces the `editor/*` catch-all) | Page editor |
| Template | ★`…/templates/:templateId/edit` | The editor in template mode (§8.11.11) |
| Story | ★`…/stories/:storyId` | Full-screen story editor |
| Account | ★`/account` (profile, language, theme, password, MFA, sessions, notifications) | Personal settings |
| Press | ★`/press/:deliveryToken` (no sign-in; expiring link) (later: M17) | Press portal |
| E-paper | ★`epaper.<publication domain>/…` (later: G4) | Public e-paper reader |
| Help | ★`/help` ★`/help/shortcuts` | Help centre |

### 2.3 Roles

Org roles: **Owner, Admin**. Publication roles: **Chief Editor, Editor, Sub-editor, Reporter, Page Designer, Photo Editor, Advertising, Prepress, Viewer**. External: **Press** (link only, no account).

Permissions follow `11_PLATFORM_SECURITY_OPS.md` §RBAC, which conflicts with `PHASE_12_SECURITY_TENANCY.md` in places. This plan settles the approval and grant rules once:

| Permission | Who has it | Grant that adds it to others (§13 Team → Invite / Edit member) |
|---|---|---|
| `page.approve` (approve or request changes) | Owner, Admin, Chief Editor | **"Can approve pages"**: usually given to senior Editors |
| `page.unlock` (reopen an approved page) | Owner, Admin, Chief Editor | — |
| `release.approve` (approve the edition for press) | Owner, Admin, Chief Editor | **"Can approve release"** |
| `archive.reprint` | Owner, Admin, Chief Editor, Prepress | — |
| `billing.manage` | Owner | **"Billing delegate"** (a grant, not a role) |

The per-screen visibility matrix is in §12.
