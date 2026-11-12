# 15 — Launch checklist: what is left (2026-11-06)

> Status: the software for the owner's own internal use is built (L1, L2.1–L2.7, the five sidebar screens, L4
> onboarding, and bucket A below). What remains is the owner's input, the deployment, and what must happen before other
> papers are offered the product. Sources: docs 09–14, `docs/runbooks/`, and the open minor findings in
> `11-fix-before-launch.md`. Gates decide what may be released, not what may be built (09 §6).

## A. Built before internal use — done

| Item | What it is | Commit |
|---|---|---|
| A1 | Everything integrated on `feat/l2-foundation`, pushed, PR #6 into `main` (merging needs the owner's `evidence-change` label: Phase-0 evidence changed in #4) | 72f06e2 |
| A2–A5 | Platform parity (12/12 pages byte-identical, Mac vs the linux/amd64 worker), colour parity (253/253), G1-2 L3 measured (0.04 %), a real press test page | 17555c6 (doc 14) |
| A6–A10, ED-15 | Hosted editor parity (crop, focal point, rulers, zoom), ads through Update text/Save, not-placed recount, board marks, Download all, idempotent Mark as sent; a page whose story changed after layout needs saving before approval or release | a35d97b, b9d1490 |
| A11–A17 | Section picker, edition date/pages correction, column grid, Marathi on the daily path, engine memory cap and raster cache prune, no story text in logs | f9f9c31, 8829b2e |
| A18–A22 | Point-in-time restore check, runbook gaps, legal pages (owner's text), Desk fallback carries ads and settings, load test at 3×, stable database tests | 4048414 |

## B. The owner's decisions and inputs (no software work)

1. **Merge PR #6:** add the `evidence-change` label, then merge.
2. **D-1** hosting and monthly budget (the runbooks assume AWS Mumbai, option A); PITR days; standby database now or later.
3. **D-2** the domain (`app.<domain>`), the sending address (SPF/DKIM/DMARC), the contact-form address.
4. **D-3** staff list, roles, two-step policy, who exports, approves pages and approves the release; the first Owner.
5. **D-5** a native Marathi reviewer for every first-draft Marathi string (web, Desk, emails, public site).
6. **D-6** privacy notice, terms and grievance officer text (with a lawyer); the legal name for the copyright line.
7. **D-7** accept ADR-025 and the Q4–Q5 deviations. **D-8** licence review (pikepdf MPL-2.0, Pillow, LGPL libraries in wheels, pypdfium2).
8. **D-9** upload the WAN-IFRA newsprint profile; **D-11** upload the private engine dataset; **D-13** which Desk data to import.
9. **D-10** photo retention, GPS/EXIF stripping, Word-original retention. **D-12** engine host size (as built: one t3.large).
10. **D-14** accept the parity result in writing (doc 14). **G1-1** the owner–editor's signed sheet.
11. **D-15, D-17** confirm as built (straight editor port; lock 75 s, take-over after 30 s). **D-16** house fonts and licences (optional).
12. **D-18** delivery and file naming; **D-19** approval before export; **D-20** archive retention and lock mode.
13. **D-21 / G2** print the press test page at the press and accept it in writing by SHA-256. Until then no page with photos or ads goes to press.
14. **D-22** light penetration test now or before other papers. **D-23–D-25** inside-page ads, artwork formats, booking cut-off.
15. **D-26–D-29** Claude key and budget, the starting source list, the house style text, paid agency pictures (all optional).
16. **G0** the pilot agreement and the press questionnaire. Alert recipients and an on-call rota for production nights.
17. The real deadline concurrency (how many people work at once), for the load test's baseline; DEP-2 (one rejected ad refuses the whole Desk file, the default).
18. Back up `~/PageinatorPrivate` (encrypted disk plus one cloud copy) before private data goes to the cloud.

## C. Deploy (follow `docs/runbooks/aws-setup.md`, then `deploy.md`)

1. AWS account, root MFA, IAM admin, budget alarm. 2. VPC, subnets, security groups (no SSH). 3. SSM parameters (every
`PGN_*` secret). 4. IAM roles and users from `infra/aws/*.json`. 5. RDS Postgres 18 (TLS, PITR, roles). 6. EC2 t3.large
app host, CloudWatch agent. 7. S3 work, archive (Object Lock) and backups buckets, then the real-S3 checks. 8. SES out of
the sandbox, real delivery to Gmail and Indian providers. 9. ECR repositories (api, web, backup, engine-worker); build and
push linux/amd64 images. 10. CloudWatch logs, SNS alarms. 11. Uptime Kuma plus one outside check. 12. DNS A record;
`deploy.sh deploy <tag>`. 13. Private inputs: dataset, ICC and its SHA-256, contact and sender addresses, optional Claude
key. 14. `bootstrap-org`, the one-time Desk import (dry run, then for real, one page re-laid and compared). 15. First-day
checks: security headers on the real domain, a restore drill into a new database (`verify-restore.ts`, point-in-time
mode), the nightly dump under Object Lock. 16. Timings on the real host (8 and 16 pages, editor p95, the load test).
17. Branch protection with CI and the Desk tests as required checks. 18. Operations: key rotation every 90 days, monthly
restore drills, the Better Auth advisory watch.

## D. Before other papers are offered the product (the internal months)

- **Gates G3–G6** and their evidence: a physically printed 4-page edition with an ad (G3, with upload sandboxing and
  the penetration test), shadow and live nights, the productivity study, four consecutive weeks (13 G3–G6).
- **A second real paper's PDFs** through onboarding before the first sale; a press test per paper and press; per-paper
  house fonts with licence confirmation; ICC and masthead upload at set-up.
- **Billing** (Razorpay, GST invoices, plans; invoiced by hand until then); customer DPA and terms.
- **Public website** pages still marked ★ in doc 03, claims updated as facts become true, "Data stored in India" once hosted.
- **Screens in the spec not built:** account preferences, help, organisation security/AI/danger-zone tabs, audit CSV;
  the template editor (or the owner accepts learned templates only).
- **Many-paper scale:** an engine role and queue per organisation, per-organisation caps.
- **The doc-11 sweep:** every open minor finding is fixed before launch (doc 11's rule); about 400 remain.
- A commercial preflight or a press proof before any PDF/X claim.

## E. Later roadmap (not needed for internal use or the first public launch)

TypeScript engine M1–M8 (the Python engine serves production meanwhile); the full browser editor of doc 05; e-paper
(after G4); press portal and WhatsApp/email delivery; inside-page and vector ads; the G6 newsroom feed; editing styles,
swatches and house rules; live co-editing; self-serve onboarding and social sign-in; a separate engine host; the
Desk-only screen findings; G7 commercial validation.
