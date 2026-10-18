# ADR-008: AWS ap-south-1, Better Auth, S3 Object Lock (governance mode)

**Post-review status (2026-10-07):** **ACCEPTED:** hosting region in India (baseline B12). **EXPERIMENTAL:** AWS as the provider (O9). **DETAIL, deferred to G3:** ECS, OpenTofu, multi-environment setup. **Better Auth: PROPOSED.** CVE-2026-53514 (default-config invitation acceptance by an unverified email) and CVE-2026-53515 (SSO registration by any member) were published July 2026. If adopted, hardening is mandatory; it is decided by a 2-day spike after O3 (`15` §8). **Object Lock: ACCEPTED in design, staged** (`15` §13).

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:** DECIDED. Vendor contracts remain RESEARCH (OP07).

## Decision
**Hosting**
- AWS Mumbai (ap-south-1): RDS Postgres (Multi-AZ, point-in-time recovery), S3 with versioning, CloudFront signed URLs, ECS Fargate (separate API and worker services), Secrets Manager, SES, OpenTofu.
- Disaster recovery and archive replication go to Hyderabad (ap-south-2).

**Archive storage**
- The archive bucket uses Object Lock in **governance** mode. Compliance mode is not used: it conflicts with DPDP erasure duties and with deletion under a court order.

**Authentication**
- Better Auth, version-pinned and with security advisories monitored: email, Google, Microsoft Entra and organizations.
- MFA from Phase 2.
- Enterprise SSO (WorkOS or similar) from Phase 5.

## Rejected
- **Supabase as the whole platform.** Its storage has no Object Lock, and we would be coupled to its auth and RLS conventions. Plain Postgres could still be hosted there if needed.
- **Building our own identity system** (RJ06).
