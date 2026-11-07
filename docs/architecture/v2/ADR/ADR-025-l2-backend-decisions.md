# ADR-025: The L2 backend: one writer, a Python engine worker, an identity zone, publication RLS, one origin

**Status:**
- **PROPOSED** (2026-10-20; revised 2026-10-21 after review), for the owner to accept (decision D-7 in
  `docs/product/10-l2-newsroom-plan.md` §9.3).
- Certainty class: ARCHITECTURE DECISION (ADR-021).

Date: 2026-10-20. Once accepted, it amends `11_PLATFORM_SECURITY_OPS.md` §1 (its double-submit CSRF token, line 28) and
ADR-007 (the job queue and the transactional outbox; publication-level checks). It records the backend choices of the
L2 plan (`docs/product/10-l2-newsroom-plan.md` §0, §2, §3.1–3.2, §4.5), built on the stack of
`docs/product/09-launch-plan.md` §3.1.

## Context
- L2 puts the newsroom online: accounts, the story desk, and later hosted layout, the page editor and release.
- The press-proven engines are Python (ADR-023: they stay the engine service until the TypeScript port proves parity),
  while the API is TypeScript (Fastify and Kysely, ADR-007).
- Two languages must not both write the application's tables. Otherwise validation, the tenancy context and the audit
  log would have to be built twice, and could disagree.
- Doc 11 §1 asks for a double-submit token on every mutating request. The L2 app serves the web app, the API and its
  sign-in pages from a single origin, with JSON bodies only.

## Decision
1. **One writer.** The Fastify API (`apps/api`) is the only code that writes application tables.
   - The Python engine worker only computes. It takes jobs, reads and writes S3, and reports results through one
     narrow inbox table.
   - Validation, the tenancy context and the audit log therefore live in one language.
2. **The engine worker runs Procrastinate jobs and reports through an event inbox.**
   - Jobs live in schema `queue`. The API defers them by SQL inside the same transaction as the domain change, so no
     separate outbox is needed.
   - Job arguments carry ids only, including `org_id` and `pub_id`. Every S3 key a task touches must start with
     `orgs/<org>/pubs/<pub>/`.
   - The worker inserts into `app.engine_event` and sends `pg_notify`; that insert is all it may do in `app`.
   - The API consumes the events (LISTEN plus a poll). It validates each payload, applies it under the event's
     organisation, and refuses and audits an event whose target belongs to another organisation.
   - The worker reaches the object store through its S3 API only. In development, every port of the SeaweedFS
     container except S3's 8333 answers without authentication inside the compose network: the filer (8888), master
     (9333) and volume server (8080), their gRPC ports (18888, 19333, 18080), and the S3 gateway's own gRPC port
     (18333), whose PutIdentity and PutPolicy calls could mint an S3 key pair. (PR 2's compose turns off its Iceberg
     and Lance servers.) The engine container (L2.2) must therefore use S3 only, or those ports must be bound to
     127.0.0.1 inside the s3 container.
3. **An identity zone.** Better Auth's tables live in schema `identity`, reached only through its own role (`pgn_auth`).
   - The application role (`pgn_app`) has no rights on `identity`.
   - An organisation keeps its own `person` directory, so lists never join across the two.
   - An `IdentityPort` isolates Better Auth, so Keycloak can replace it. Better Auth itself stays PROPOSED, with the
     hardening of ADR-008 and `15` §8.
4. **Publication RLS: four tenancy layers.**
   - FORCE row-level security with an organisation wall on every `app` table.
   - A restrictive publication wall on content tables, using the publications granted to the user, set per transaction
     by `withTenant`.
   - Foreign keys that include `org_id`, so no row can point at another organisation's row.
   - The identity zone (decision 3).
   - Roles (none superuser, none BYPASSRLS, none CREATEROLE):
     - `pgn_owner` owns everything and cannot sign in;
     - the login roles are `pgn_migrator` (migrations only, acting as `pgn_owner` through `SET ROLE`), `pgn_app`,
       `pgn_auth`, `pgn_engine`, and `pgn_listen` (the API's LISTEN connection, with no table rights).
     - Doc 04's `pg_app` is renamed, because Postgres reserves names that start with `pg_`.
5. **One origin.** The web app, `/api/v1/*`, `/api/auth/*` and the server-sent events share one origin behind the TLS
   proxy. The API sends no CORS headers to any origin. In production the allowed list holds exactly the app's origin;
   development adds the local web server's.
6. **CSRF by Origin and a custom header, not a double-submit token.** The API refuses every request except GET, HEAD
   and OPTIONS unless:
   - its `Origin` equals one of the configured origins. A missing `Origin` or `Origin: null` is refused, so a browser
     that omits `Origin` on a same-origin POST is refused too: the check fails closed;
   - it carries `X-Pageinator: 1`;
   - its `Sec-Fetch-Site`, if sent, is `same-origin`, `same-site` or `none`, read without regard to case. `cross-site`,
     any other value, and a repeated header are refused.

   The check runs before the body is read, and bodies are JSON only on every route: any other body type answers 415
   (an unrouted path answers 404).
   - **GET, HEAD and OPTIONS change nothing, with named exceptions only.** Today these are the two token-bearing links
     in emails, both Better Auth's: `GET /api/auth/verify-email?token=…`, which marks the address verified and signs
     its person in, and `GET /api/auth/reset-password/:token`, which only checks the token and sends the browser on to
     the web app's reset page (the new password itself is a POST). They act only with the token from the email, which
     a page on another site cannot know.
   - **Every exemption is listed and justified one by one** in this ADR or its successor. That covers both GETs that
     change something and routes the guard does not cover (Better Auth's `/api/auth/*`, later webhooks).
   - **What stays outside the API's own answers.** Three answers are written raw, without the envelope: Fastify's 503
     while the server is closing, and Node's own 400 for an HTTP/1.1 request without a Host header and 417 for an
     `Expect` other than 100-continue. Browsers never send either of the last two. They refuse a request; none
     changes anything. And Better Auth's own answers under `/api/auth/*` are its JSON, which its client reads; the
     guard's refusals there, and Fastify's, are envelopes as everywhere else.
   - **Where it comes from.** This is the Desk's `X-Desk` pattern; the API's security-baseline PR implements it in
     `apps/api/src/http/origin-guard.ts`. Two things differ:
     - the Desk (`tools/desk/deskserver/api.py`) also checks Host, against DNS rebinding of its 127.0.0.1 server, and
       accepts a request that has no `Origin`;
     - the API refuses a missing `Origin`, and leaves Host to the TLS proxy, which must route only the app's domain
       (deploy PR 25).

### Why the CSRF protection equals the double-submit token here
- **What both must stop.** An attack makes the victim's browser send a state-changing request with the victim's cookies
  from another site.
  - A double-submit token stops it because only pages that can read the token can send it.
  - The custom header stops it because a page on another site cannot add a custom header or send
    `Content-Type: application/json` without a CORS preflight¹. The API answers no preflight with permission, so the
    browser never sends the request. OWASP lists custom request headers as a defence for API endpoints for exactly
    this reason².
  - A page on another site can still send a "simple" POST without a preflight¹: a form-encoded, multipart or
    `text/plain` body, with no custom header. Such a request lacks the header and carries a foreign `Origin`, so the
    guard refuses it (403); its body type would be refused with 415 even past the guard.
- **The Origin check backs it up.** Browsers add `Origin` to cross-origin requests and to same-origin requests other
  than GET and HEAD³, and page scripts cannot set it, nor any `Sec-` header⁴.
  - An exact match against the configured origins refuses a request from any other origin, a sibling subdomain
    included.
  - A request without `Origin` is refused rather than allowed. That is stricter than OWASP's fallback to `Referer`².
    Browsers send `Origin: null` in some cases, such as sandboxed frames and some form posts³; that is refused too.
- **Fetch metadata adds a third signal**². `Sec-Fetch-Site: cross-site` is refused outright. Browsers that do not send
  it still face the two checks above.
- **What defeats one defeats the other.** A script running on our own origin (an XSS) can read a double-submit token
  just as it can set the header. Neither replaces output encoding and the strict CSP of the web app.
- **Where the naive token is weaker.** This applies to the naive double-submit cookie only: anyone able to write a
  cookie for our domain, for example from a subdomain, can bypass it². The header check uses no cookie an attacker
  could plant. A signed double-submit cookie, bound to the session², resists that as well. The claim here is equal
  protection, not more.
- **What would break the equality.** It no longer holds if:
  - the API answered CORS preflights for other origins;
  - it accepted form-encoded, multipart or plain-text bodies;
  - it changed state on a GET that is not listed above.
  Each of these needs a new ADR. SameSite=Lax session cookies remain a further layer, not the defence². The API's tests
  must pin the first two conditions: no `access-control-*` header on a foreign preflight, and 415 for the three body
  types.

## Consequences
- **Once accepted, doc 11 §1 is amended:** the double-submit token is replaced for this app. Doc 11 keeps a note at
  line 28.
- **ADR-007's queue and outbox details change:**
  - Procrastinate, already named there for a Python backend, serves the Python worker;
  - deferring the job inside the domain transaction meets the outbox's purpose;
  - publication-level access is enforced by RLS as well as in the service layer.
- **The web client sends `X-Pageinator: 1` and JSON on every change** (plan §10, PR 12).
- **Better Auth's `/api/auth/*` routes stay behind the same guard.** Its client sends `X-Pageinator: 1` with every
  request, as the rest of the web client does (plan PR 12), so they need no exemption. Better Auth's own Origin and
  Fetch Metadata checks stay on as a second layer.
- **The tenancy proof tests (a)–(h) of plan §4.8** start in PR 6. A planted table without FORCE RLS must fail CI.
- **Route hooks must never throw on an error answer.** If a route's preSerialization or onSend hook fails on the error
  envelope itself, Fastify's fallback handler answers instead: outside the envelope, with the hook's own message in the
  body.

## Sources
1. MDN, "Cross-Origin Resource Sharing (CORS)", section "Simple requests": the CORS-safelisted headers and the three
   allowed `Content-Type` values; custom headers and `application/json` are preflighted.
   https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS (checked 2026-10-21).
2. OWASP Cross-Site Request Forgery Prevention Cheat Sheet, sections:
   - "Employing Custom Request Headers for AJAX/API";
   - "Verifying Origin with Standard Headers";
   - "Fetch Metadata headers";
   - "Signed Double-Submit Cookie" and "Naive Double-Submit Cookie Pattern (DISCOURAGED)";
   - "SameSite (Cookie Attribute)".
   https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html (checked
   2026-10-20).
3. MDN, "Origin" request header: when user agents add it, and when its value is `null`.
   https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin (checked 2026-10-21).
4. MDN, "Forbidden request header": a header that cannot be set or modified programmatically; the list includes
   `Origin` and every `Sec-` header. https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header (checked
   2026-10-21).
5. `docs/product/10-l2-newsroom-plan.md` §0, §2, §3.1–3.2, §4.5, §4.8 and §9.2 (question Q5).
