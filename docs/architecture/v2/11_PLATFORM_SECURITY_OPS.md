# 11 — Platform: Auth, RBAC, Security, Compliance, Jobs, Operations, Billing

> **Second-pass review, 2026-10-07.** Updated:
- Better Auth is PROPOSED with mandatory hardening (verified CVEs in `15` §8).
- AWS and ECS are hypotheses or details.
- The RBAC matrix is a hypothesis until P0-02.
- The threat model is re-ranked in `15` §10.
- Deadline degraded modes are in ADR-020.
- The DPDP legal unknowns are in `15` §9. Status vocabulary: ADR-021. Baseline: `20`.


**Status:** DECIDED, except vendor contracts, which are still RESEARCH.

## 1. Authentication

- **Library:** Better Auth.
  - *Revised 2026-10-07: PROPOSED, not decided. Version claims were unverified.*
  - Verified advisories: CVE-2026-53515 (SSO provider registration by any org member) and CVE-2026-53514 (org invitation accepted by an *unverified* email under the default config). Both were published July 2026.
  - If adopted: pin a patched version, and set `requireEmailVerification` and `requireEmailVerificationOnInvitation` to true. See `15` §8.
  - Run it self-hosted inside the `identity` module, on our own Postgres tables.
- **Sign-in methods:**
  - email and password (argon2id), with email verification required before anyone can join an organization;
  - Google OAuth;
  - Microsoft Entra ID OAuth (multi-tenant).
  - Magic link is optional.
- **Sessions:**
  - stored in the database, using HttpOnly, Secure, SameSite=Lax cookies;
  - CSRF protection with a double-submit token on every mutating request;
  - 12 h idle timeout and 30 day absolute timeout;
  - revoked on password change.
  - Users can see and revoke their devices.
- **Multi-factor authentication:** TOTP plus recovery codes in P2. Organisations can make it mandatory for their admin and prepress roles.
- **Enterprise single sign-on (P5):** SAML and OIDC through WorkOS, or Better Auth SSO if it is mature by then. Also SCIM provisioning and domain capture (for example `@abcmedia.com`).
- **Onboarding flow:**
  1. Sign up and verify email.
  2. Create the organization (or accept an invitation).
  3. Create a publication through a wizard that builds the first ProfileVersion: identity → languages and sections → page and grid → fonts (licence check) → brand → print profile → zones.
  4. Create the first edition.
- **Re-use from C:** the session UX and the stale-session and stale-workspace race guards (`SessionProvider.tsx`) are kept.

## 2. Authorization (RBAC)

- **How permissions are computed:** effective permissions = the union of the org role's permissions and the roles granted on that publication. Every API handler declares one `requires(permission, scope)`. A central `authorize()` checks it, the check is audited when it is denied, and handlers cannot run without it (an architecture test enforces this).

| Permission | Owner | Admin | Chief Ed | Editor | Sub Ed | Reporter | Designer | Photo | Advertising | Prepress | Viewer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| org.billing / delete org / transfer | ✔ | | | | | | | | | | |
| org.members.manage | ✔ | ✔ | | | | | | | | | |
| publication.profile.edit (brand, templates, print profile) | ✔ | ✔ | ✔ | | | | ✔ (templates/styles) | | | ✔ (print profile) | |
| edition.create / flatplan.edit | ✔ | ✔ | ✔ | ✔ | | | | | ✔ (ad reservations) | | |
| story.create / edit own | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | | | | | |
| story.edit any / assign priority / select for edition | ✔ | ✔ | ✔ | ✔ | ✔ | | | | | | |
| asset.upload / edit metadata | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (ads) | | |
| ads.book / artwork.upload | ✔ | ✔ | | | | | | | ✔ | | |
| document.edit (layout) | ✔ | ✔ | ✔ | ✔ | ✔ (text only) | | ✔ | ✔ (images) | | ✔ | |
| generate / regenerate | ✔ | ✔ | ✔ | ✔ | | | ✔ | | | | |
| preflight.run / override warning | ✔ | ✔ | ✔ | | | | | | | ✔ | |
| release.approve | ✔ | ✔ | ✔ | | | | | | | | |
| export.print / deliver to press | ✔ | ✔ | ✔ | | | | | | | ✔ | |
| archive.view / download | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| archive.legal_hold / delete | ✔ | ✔ | | | | | | | | | |
| newsroom.view / add_to_edition | ✔ | ✔ | ✔ | ✔ | ✔ | view | | | | | |
| audit.view | ✔ | ✔ | ✔ | | | | | | | | |

- **Customisation:** roles are bundles of permissions. Organisations may define custom roles later (P5). The permission list itself is defined in code.
- **Support staff:** Pageinator support never gets standing access to customer data. They use **break-glass impersonation**, which requires the org owner's consent, is time-boxed (1 h) and is fully audited.

## 3. Security threat model (STRIDE, summarized)

| Threat | Vector | Controls |
|---|---|---|
| **Cross-tenant data leak** | Missing org filter, ID guessing, cache key collision, job payload mix-up, search index bleed, hash dedup across tenants | Postgres RLS with FORCE and a non-owner role; `withTenant` is the only DB entry point; UUIDv7 IDs (unguessable, but never relied on for access); org ID in every cache, S3 and vector key; workers re-set the tenant from the job; a tenancy test suite in CI; dedup within an org only (RJ07) |
| Account takeover | Credential stuffing, phishing, session theft | argon2id, rate limits and lockout, breached-password check (k-anonymity HIBP), MFA, HttpOnly cookies, device list, alerts on new login |
| Privilege escalation | Self-granting roles, IDOR on publication | Central `authorize()`, only owners and admins can grant, grant changes are audited, tests per permission |
| Malicious uploads | Image decompression bombs, polyglots, malformed PDF/EPS/fonts (parser exploits) | Quarantine bucket; magic-byte sniffing; ClamAV; decoding in **sandboxed worker containers** (no network, read-only FS, seccomp, memory and CPU limits, timeouts); pixel limits; EPS and PDF processed by Ghostscript under `-dSAFER` in a separate sandbox; fonts parsed by HarfBuzz/fontTools in the sandbox; uploaded SVG is rejected, or rasterised in the sandbox |
| XSS / injection | Brand strings, story HTML, comment text, ProseMirror paste | No HTML strings rendered; ProseMirror schema rejects unknown nodes; strict CSP (`script-src 'self' 'wasm-unsafe-eval'`); colour and font fields validated by schema (fixes B's `_stylesheet` injection) |
| SSRF | Feed URLs, "import from URL" | Egress proxy with allowlist, private-IP and metadata-IP denial, DNS-rebinding protection, per-domain rate limits |
| Prompt injection | Ingested articles steering AI | Data is passed as delimited fields; output is suggestions only; no write tools exposed to the model; output schema validated (`09` B3) |
| Archive tampering / repudiation | Insider modifies a published edition | Object Lock, a KMS-signed manifest, append-only audit (INSERT-only grants), cross-account backups |
| Supply chain | npm and WASM packages, Docker base images | Lockfile with integrity hashes, `pnpm audit` plus OSV scanning, Renovate with review, pinned WASM artefacts (hash-checked at build), SBOM per release (RD10), minimal distroless images, signed images |
| Denial of service / cost abuse | Large generation jobs, AI credit burn, huge uploads | Request size limits, per-org job concurrency quotas, AI budgets, WAF rate limits, separate worker pools (deadline exports protected) |
| Secrets | Leaked keys | AWS Secrets Manager, no secrets in env files committed, gitleaks in CI, short-lived IAM roles for tasks |
| Font licence breach | Shipping customer fonts to browsers | `FontAsset.licence` gate; server-resolve-only mode with streamed outlines (`05` §7); contract clause |

**Process controls:**
- an external penetration test before the first paid customer;
- annual pen tests after that;
- a responsible-disclosure page.

## 4. Compliance and legal

- **India DPDP Act 2023, with the rules notified in November 2025** (most obligations apply from May 2027). Pageinator is a **Data Processor** for customer content and a **Data Fiduciary** for user accounts. We need:
  - a privacy notice and consent records for accounts;
  - a grievance officer and contact;
  - breach notification runbooks;
  - an erasure workflow (accounts and personal data in Postgres; archives keep pseudonymous actor IDs, see `10` §3.2);
  - Data Processing Agreements with customers;
  - a sub-processor list (AWS, AI providers, email).
- **Copyright and content rights:**
  - rights classes are enforced (`09` A1);
  - wire licence terms (attribution, embargo, territory) are stored per source and enforced in preflight.
- **Font licensing:** a licence questionnaire at font upload; OFL defaults are bundled. This feeds `FNT002`.
- **Third-party licences:**
  - Ghostscript and MuPDF are AGPL. They run unmodified as separate processes, subject to legal review, with pdfium (BSD) preferred.
  - An SBOM and notices are produced per release.
- **Data residency:** primary data stays in AWS Mumbai and the DR replica in Hyderabad. AI-provider regional routing is used where available, and the contract states the processing location.

## 5. Async jobs

- **Queue: Graphile Worker on Postgres.** It is stable, already widely used, and is the reason Redis is not needed.
  - API transactions write an **outbox row in the same transaction** as the state change. A relay enqueues the job, which gives exactly-once enqueue semantics.
- **Every job carries:**
  - `job_key` for idempotency and deduplication (for example `export:<edition>:<rev>:<kind>`);
  - `org_id`;
  - `trace_context`;
  - `attempt`;
  - `deadline`.
- **Job types and pools:**

  | Pool | Jobs | Concurrency |
  |---|---|---|
  | interactive | resolve-pages, small AI tasks, thumbnail render | High, short timeouts (30 s) |
  | batch | generate, export-pdf, preflight, image print renditions, archive-package, press-delivery | Per-org caps; deadline-aware priority (editions with `edition_date` = tomorrow and status `preflight` go first) |
  | ingest | connector fetches, enrichment, clustering | Rate-limited per source |

- **Failure handling:**
  - progress is written to the job row and streamed over SSE;
  - cancellation uses a cooperative check of a cancel flag;
  - retries use exponential backoff and are capped per type;
  - failed jobs go to a **dead-letter** table after the final attempt, with an alert;
  - duplicate submissions are collapsed by `job_key`.
- **Scaling:** ECS services autoscale on queue depth per pool. CPU-heavy jobs use Node `worker_threads` inside each task.

## 6. Operations and SRE

- **Environments:** `dev` (ephemeral preview stacks per PR for web plus API, using a shared dev DB with an isolated schema), `staging` (prod-like), and `prod`.
- **Delivery:**
  - GitHub Actions runs lint, typecheck, unit, tenancy, golden, parity, perf-smoke, build and image build (`12`).
  - Deploys are blue/green through ECS.
  - Database migrations run as a separate pre-deploy step and follow expand/contract.
- **Observability:**
  - OpenTelemetry traces (web → API → DB → job → worker, linked by trace context);
  - metrics (RED per endpoint, queue depth and age, job durations, parity mismatches, AI cost);
  - structured logs (pino, JSON, no story content at info level);
  - Sentry;
  - Grafana dashboards per pilot org.
- **SLOs:**
  - API availability 99.9% monthly.
  - **Deadline window SLO:** from 18:00 to 02:00 IST, export and preflight jobs start within 30 s at p95 and complete within budget at 99%.
  - Error-budget policy freezes features when the SLOs are breached.
- **Deadline-night resilience:**
  - The last good export per page is always downloadable.
  - A "manual export" runbook covers a worker outage, using an on-call CLI that runs the same packages.
  - On-call rota during pilot nights.
  - Load test at 3× expected deadline concurrency before each pilot onboarding.
- **Incident management:** runbooks, a status page, postmortems. The pilot customer gets a WhatsApp/phone escalation path, which is how Indian newsrooms actually work.

## 7. Billing and entitlements

- **Plans:** Trial, Starter, Professional, Business, Enterprise. Pricing is not decided (OP09).
- **Entitlements are enforced in code from P1:** `publications`, `seats`, `editions_per_month`, `pages_per_edition`, `ai_credits`, `storage_gb`, `archive_years`, `premium_preflight`, `api_access`.
- **Usage metering:** `UsageRecord` daily rollups for storage, AI cost, pages exported and seats.
- **Payments (P5):**
  - **Razorpay** for Indian customers (INR, GST invoices, UPI/NetBanking, e-mandates for subscriptions);
  - Stripe for international customers.
  - Webhook handlers are idempotent and reconciled daily (RD11).
- **Pilot:** billing runs manually by invoice. The pilot does not wait for payment integration.
