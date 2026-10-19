# Phase 12 — Security and tenancy

Prepared 2026-09-16. Inputs read from disk: Phases 2 and 11; the original requirements remain authoritative. Tenant isolation and protected releases are CONFIRMED requirements. Mechanisms below are RECOMMENDED, with customer-specific residency/retention and identity-provider selection open.

## Trust and tenant model

Organization is the tenant boundary; publication is a nested authorization boundary. A user can hold different memberships and permissions in different organizations. Organization/publication IDs supplied by a client select a context but never establish authority. Authenticate through a mature provider, then resolve current membership and resource-level permissions in Pageinator. Unpublished content, wire credentials, font binaries, archive packages, payments and support access have distinct sensitivities.

Trust boundaries are browser/API, API/database, API/object storage, queue/worker, external fetch/parser, AI provider, billing provider and operator/customer. Requests, jobs, caches and search projections must preserve verified scope. This applies to result counts, snippets, thumbnails and error messages as well as full documents. OWASP highlights scope propagation and isolation beyond database rows ([multi-tenant guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)).

## Proposed permission matrix

These are capabilities to agree with the newsroom, not irrevocable role definitions. Roles are reusable bundles of scoped grants; deny unspecified actions.

| Capability | Proposed default grantees | Constraints |
|---|---|---|
| Manage organization/membership | Owner, organization administrator | Cannot implicitly bypass editorial approval or retention holds |
| Billing/subscription | Owner, billing delegate | No automatic story/export access |
| Submit story/media | Reporter, editor, photo editor | Publication assignment and editorial state checked |
| Edit/approve editorial content | Editor, chief editor | Approval scope and revision recorded |
| Edit document/layout | Designer, editor | Document lease/version and content permissions checked |
| Manage ad creative/reservations | Advertising | No blanket authority to change editorial story text |
| Manage print profiles/preflight | Prepress | Profile version/approval; cannot mark failed check passed |
| Release print master | Explicit release grant | Required approvals, current rights and mandatory preflight pass |
| Read/download/reprint archive | Explicit archive grants | Rights and retention/access state; reprint is distinct from viewing |
| Delete organization / alter retention | Owner plus protected workflow | Step-up authentication, holds, notice and audit policy |

Publication-wide editorial access may be adequate initially; confidential stories may later need narrower grants. Decide this before using real embargoed material. UI visibility is a convenience, not enforcement.

## Data and storage enforcement

Recommend tenant-qualified keys/foreign keys, application authorization and PostgreSQL row-level security as independent defenses. Use non-owner, non-superuser, non-BYPASSRLS application roles; migration/backup roles are separated. Set tenant context transaction-locally and test pooled connection reuse. Cross-tenant references, joins, bulk endpoints, exports and background maintenance need explicit tests. Owners and privileged roles can bypass RLS, so policy definitions alone are insufficient ([PostgreSQL](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)).

Private object storage maps opaque asset IDs to tenant-scoped objects. Issue short-lived, method/object-specific signed access after authorization. A signed URL is a bearer capability until expiry; revocation is not guaranteed instantaneously. For content requiring immediate revocation, use an authenticated download gateway or equivalent enforceable policy. Prevent public CDN caching of customer objects, URL leakage in analytics and cross-tenant cache keys. Upload completion rechecks scope/type/digest before attaching an object to a record.

Export and archive authorization cover the package and every referenced asset. A manifest cannot smuggle another tenant's object into a ZIP/download job. Font delivery additionally checks browser-distribution rights. Search permissions must be checked at query time and refreshed on membership/rights changes; an index rebuild cannot widen access.

## Jobs, integrations and hostile inputs

Job payloads identify tenant, publication, actor/service authority, immutable inputs and operation ID. Workers accept jobs only from trusted queues, load scoped records and verify permission/policy at execution and before externally visible completion. Revocation can cancel user-triggered pending work; scheduled ingestion uses an explicit organization integration principal. Results cannot attach themselves to a newer revision after a race.

External URLs are hostile. Restrict schemes and destinations, revalidate redirects/resolved addresses, block private/link-local/metadata endpoints, isolate egress and bound response/decompression sizes. Reject arbitrary credentials and internal paths. Crawler browser instances and PDF/font/image/XML parsers run without customer-wide secrets or general network access. OWASP documents SSRF controls and DNS/redirect pitfalls ([SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)).

Use encrypted secret storage and scoped service identities; integration credentials never enter browser bundles or prompts. Rotate/revoke secrets and log access metadata. Validate webhook signatures, timestamps and event identities, and handle duplicates/out-of-order delivery. Disable unsafe serializers and active content from imported HTML/SVG/PDF. Bound CPU, memory, temporary disk, upload size and concurrency per tenant so one edition cannot exhaust the service.

## Sessions and operator separation

Prefer secure server-managed sessions or a reviewed OIDC integration; protect cookie sessions against CSRF and XSS, set appropriate cookie flags and enforce TLS. Account recovery/MFA come from the identity provider. Invitations are single-purpose, expiring and bound to approved organization/role assignments. An email domain alone must not grant membership.

Platform operators use separate identities/control plane, least privilege and audited, time-limited support access. Never impersonate a customer silently. High-impact support actions need a recorded justification and policy-approved authorization. Billing events update entitlements only; they cannot grant publication release rights. Logs/telemetry redact stories, prompts, secrets and signed URLs by default.

## Immutable records, deletion and recovery

Released bytes cannot be overwritten. Restriction/takedown/hold/deletion status is separate metadata. Before selecting WORM mode, resolve retention, customer termination, legal obligations and font/wire restrictions. Do not promise legal compliance for an unspecified jurisdiction. Residency and retention requirements need contractual/legal review, not an invented default.

Back up database, manifests, object inventory and key material with separated access. Test restoration and deletion propagation into indexes/caches; document backup expiry and legal-hold exceptions. Audit authorization changes, profile changes, AI acceptance, export/release, archive access and destruction. Protect audit integrity and avoid retaining unnecessary personal data indefinitely.

## Day-one gates

Before real customer persistence: verified identity, scoped authorization, migration-role separation, private storage, safe sessions/secrets, tenant-negative tests and restore rehearsal. Before integrations: egress/SSRF controls and rights policy. Before publishing: exact-hash release authorization, preflight failure closed, audit and complete archive commitment. Before paid operations: signed billing events, reconciled usage, approved retention/offboarding terms. The UI-first phase only simulates these states and cannot establish security readiness.
