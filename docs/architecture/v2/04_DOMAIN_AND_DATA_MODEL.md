# 04 — Domain and Data Model

> **Second-pass review, 2026-10-07.** The shape is accepted. Field-level detail is a hypothesis until pilot observation.
- Add `FontLicense` / `FontLicenseBinding` (`19` §1).
- Add an embargo field on story revisions (`15` §10).
- The archive tables are staged (`15` §13). Status vocabulary: ADR-021. Baseline: `20`.


Status: DECIDED (shape); field-level detail TENTATIVE until each module's P1 spec.

## 1. Principles

1. **The tenant is the Organization.** Every tenant-owned row has `org_id NOT NULL`, and row-level security (RLS) is enforced on every one of those tables (§5).
2. **Configuration that affects output is versioned and immutable once used.** This covers brand, styles, templates, print profile and fonts. An edition pins exact `profile_version_id`s, so an archived edition reproduces even after the publication changes its brand.
3. **Content revisions are append-only.** Stories, assets and documents get new revisions instead of updates. A "current" pointer is just a column.
4. **Published artifacts are immutable.** Changes create a new revision or a new edition (D05, D06).
5. **Binaries live in S3 under content addresses.** Postgres stores metadata and hashes.
6. **Module ownership.** Each table belongs to exactly one module (`03` §4). Other modules read it only through that module's service interface.

## 2. Entity map

```
User ─< AuthAccount              Organization ─< Membership >─ User
User ─< Session                  Membership ─< PublicationGrant >─ Publication
                                 Organization ─< Invitation
Organization ─< Publication ─< ProfileVersion ─┬─ BrandSpec
                                               ├─< SectionDef
                                               ├─< StyleSheet (para/char/object styles)
                                               ├─< PageTemplate (master pages, slot templates)
                                               ├── PrintProfile (+ ICC asset)
                                               └─< ProfileFont >─ FontAsset (content hash, licence)
Publication ─< Zone (city editions)
Publication ─< Edition ─┬── Flatplan ─< FlatplanPage (section, shared|variant, ad reservations)
                        ├── base_edition_id (zoned variant of)
                        ├─< EditionStory >─ StoryRevision
                        ├─< EditionAsset  >─ AssetRevision
                        ├─< AdPlacement   >─ AdBooking
                        ├── EditableDocument ─< DocumentRevision ─< CommandLogEntry
                        ├─< PageLock
                        ├─< GenerationJob
                        ├─< PreflightRun ─< PreflightIssue (+ Override)
                        ├─< ExportJob ─< ExportArtifact
                        └── Release (state machine) ── PublishedEdition ── ArchiveRecord
Organization ─< Story ─< StoryRevision (rights, provenance, body JSON)
Organization ─< Asset ─< AssetRevision ─< Rendition ; AssetRevision ── ImageMeta
Organization ─< Advertiser ─< AdBooking ─< AdArtwork(AssetRevision)
Organization ─< ContentSource ─< SourceItem >─ NewsEvent (via EventMember) ─< VerificationSignal
Publication ─< RelevanceScore >─ NewsEvent
Organization ─< AIInvocation ─< Suggestion
Organization ─< AuditEvent ; Comment ; Approval ; Notification
Organization ── Subscription ── Plan ; Entitlement ; UsageRecord
ResolvedDocument (global content-addressed index; org-scoped row) ; FontAsset ; Blob
```

## 3. Key entities (essential fields)

### Identity and organisation
- **User**: `id, email (citext unique), name, locale, mfa_enabled, created_at, disabled_at`.
- **Membership**: `org_id, user_id, org_roles text[]` (owner, admin, member), `status`.
- **PublicationGrant**: `org_id, membership_id, publication_id, roles text[]` (chief_editor, editor, sub_editor, reporter, designer, photo_editor, advertising, prepress, viewer).
  - Permissions resolve as **org role ∪ publication roles**. The permission matrix is in `11` §2.
- **Invitation**: `org_id, email, roles, publication_grants jsonb, token_hash, expires_at`.

### Publication configuration
- **Publication**: `org_id, name, slug, languages text[], primary_script, digit_style (latin|devanagari|arabic_indic), timezone, current_profile_version_id`.
- **ProfileVersion**: `org_id, publication_id, version int, status (draft|active|retired), created_by`. Immutable once `active`. Holds:
  - **BrandSpec**: logo asset, colours as CMYK plus a screen preview colour, masthead config, rule styles.
  - **SectionDef**: `key, name, color, default pages, front_page_rules jsonb`.
  - **StyleSheet**: paragraph styles, character styles and object styles (JSON validated by `packages/document` schemas).
  - **PageTemplate**: `kind (master|section_front|inside|special)`, grid (columns, gutter, margins, baseline grid), regions (`folio_bar`, `rail_left`, `news_hole`, `rail_right`, `foot`), slots for slot-based generation.
  - **PrintProfile**: `trim_mm, bleed_mm, pdf_standard (x1a_2003|x4), icc_asset_id, output_condition_identifier, tac_limit_pct, min_effective_dpi, black_policy (k_only_text, overprint), mono_pages int[] | rule, spot_colors[]`.
  - **ProfileFont** → **FontAsset**: `sha256, family, style, axes, format (ttf|otf_cff), licence (desktop|web|server|embed flags), source`. A licence check gates whether the font may be used in the browser (`11` §4).
- **Zone**: `publication_id, key, name` (for example Pune City, Pimpri-Chinchwad).

### Edition
- **Edition**: `org_id, publication_id, zone_id?, edition_date (date), page_count, profile_version_id (pinned), status (planning|in_production|preflight|released|archived), base_edition_id?` (set when this is a zoned variant).
- **Flatplan / FlatplanPage**: `page_no, section_key, colour (cmyk|mono), shared_with_base bool, template_id, reservations jsonb` (ad slots).
  - Zoned editions share pages by reference to the base edition's document pages, until a page is marked *variant*.
- **PageLock**: `edition_id, page_no, holder_user_id, kind (soft_edit|approved), expires_at`.

### Content
- **Story**: `org_id, publication_id?, slug, origin (reporter|wire|cms|import|newsroom), current_revision_id`.
- **StoryRevision**: `story_id, rev int, language, headline, deck, byline, dateline, body (ProseMirror-compatible JSON from our schema), word_count, tags, section_hint, priority_hint, location (geo ref), rights_class, rights_ref, provenance jsonb (source item IDs, URLs, licence), created_by, created_at`.
- **EditionStory**: `edition_id, story_id, pinned_revision_id, section_key, priority (1–5), must_page?, lead bool, status (candidate|selected|placed|spiked), notes`.
  - Placement itself lives in the document, not here.
- **Asset / AssetRevision**: `kind (image|logo|ad_artwork|icc|font|pdf), sha256, bytes, mime, original_key, uploaded_by, scan_status`.
- **ImageMeta**: `pixel_w, pixel_h, icc_desc, color_space, exif subset, caption, credit, photographer, focal_point (x,y), rights_class, related_story_id?`.
- **Rendition**: `asset_revision_id, purpose (thumb|preview|screen_tile|print_cmyk), params_hash, key`. Renditions are derived, never edited.

### Advertisements
- **Advertiser**: `org_id, name, billing_ref`.
- **AdBooking**: `org_id, advertiser_id, publication_id, zone_ids, run_dates daterange | dates[], size (cols × mm | named: full, half, quarter, strip, jacket, masthead_strip), colour (cmyk|mono), placement (page_no? | page_rule: 'odd'|'right-hand'|section_key, region: top|bottom|any, fixed bool), contract_ref, status`.
- **AdArtwork**: `booking_id, asset_revision_id, preflight_status, normalized_asset_revision_id?, report jsonb`.
- **AdPlacement**: `edition_id, booking_id, artwork_id, page_no, rect`. Generation creates it; locked ads are fixed.

### Document
- **EditableDocument**: `edition_id, current_revision_id`.
- **DocumentRevision**: `doc_id, rev bigint, parent_rev, author (user|system:generator|system:ai), snapshot_key? (every N revisions or on generate/release), created_at, label?`.
- **CommandLogEntry**: `doc_id, rev, op_id (uuid, idempotency), base_rev, user_id, command jsonb`. Bounded: commands are compacted into snapshots once older than N revisions, except for released revisions.
- **ResolvedDocument**: `content_address (sha256), org_id, doc_id, rev, engine_version, harfbuzz_version, icu_data_version, profile_version_id, font_manifest jsonb (sha256 list), blob_key, page_hashes text[]`. Pages are also addressable individually for incremental resolves.

### Production
- **GenerationJob**: `edition_id, scope (edition|pages[]|region), params, seed, input_hash, status, result_rev, metrics jsonb`.
- **PreflightRun**: `edition_id, rev, resolved_address, rule_set_version, status`.
- **PreflightIssue**: `rule_id, severity, page, object_ref, message, data`.
- **Override**: `issue_id, user_id, reason`. Allowed for warnings only.
- **ExportJob / ExportArtifact**: `rev, resolved_address, kind (print_pdf|proof_pdf|page_pdf|epaper|png), bytes_sha256, key, preflight_run_id`.
- **Release**: `edition_id, state` (the 8-state machine from `PHASE_11` plus `DELIVERED`). Also `approved_by, delivered_receipt jsonb`.
- **PublishedEdition**: `edition_id, release_id, manifest_key, manifest_sha256, published_at`. Immutable.
- **ArchiveRecord**: `published_edition_id, retention_class, retain_until, legal_hold bool, storage_tier`.

### Newsroom and AI
See `09`. In short:
- **ContentSource**: connector, terms, rights class.
- **SourceItem**: canonical URL, hashes, raw and extracted keys, language, published_at, rights_class.
- **NewsEvent**: centroid, first/last seen, member count.
- **EventMember**.
- **VerificationSignal**: type, evidence refs, direction, weight.
- **RelevanceScore**: per publication, with components.
- **AIInvocation**: task, prompt version, model, provider, input hash, tokens, cost, latency, status.
- **Suggestion**: target ref, payload, status (pending|accepted|rejected|expired), decided_by.

### Platform
- **AuditEvent**: append-only, `org_id, actor, action, target, before_hash, after_hash, ip, ua, trace_id, at`. Grants allow `INSERT` only.
- **Comment, Approval**: target ref (story, page, frame), thread.
- **Plan, Subscription, Entitlement, UsageRecord**: entitlements are key/limit pairs such as `publications`, `seats`, `archive_years`, `ai_credits` and `storage_gb`.

## 4. Indexes (initial)

- `(org_id, …)` leads every tenant index.
- `edition (publication_id, edition_date, zone_id) UNIQUE`.
- `edition_story (edition_id, status)`.
- `story_revision (story_id, rev DESC)`.
- `document_revision (doc_id, rev DESC)`.
- `command_log (doc_id, op_id) UNIQUE` for idempotency.
- `resolved_document (content_address) UNIQUE`.
- `asset_revision (org_id, sha256)`. Deduplication is within an org only, because RJ07 forbids cross-tenant reuse by hash.
- Newsroom:
  - `source_item (canonical_url_hash) UNIQUE per source`;
  - `source_item USING gin (simhash bands)` (or MinHash band table);
  - `news_event (last_seen_at)`.
- Search (from P2/P5):
  - `pg_trgm` GIN on headline and body text;
  - `tsvector` for English;
  - `simple` config plus trigram for Marathi and Hindi (Postgres has no Marathi stemmer);
  - `pgvector` HNSW on embeddings (P4/P5).

## 5. Tenant isolation (row-level security)

- The app connects as role `pg_app`. That role is **not** a table owner and has no `BYPASSRLS`. Every tenant table has `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- Policy: `USING (org_id = current_setting('app.org_id')::uuid)`, plus a `WITH CHECK` clause that is the same.
- Every request transaction starts with `SET LOCAL app.org_id = $org` and `SET LOCAL app.user_id = $user`. A Kysely wrapper `withTenant(orgId, fn)` is the only way to get a connection. Lint forbids the raw pool outside that wrapper.
- Publication-level authorization runs in the service layer, as a permission check against grants. It is not done in RLS, which keeps policies simple. Org isolation is the hard RLS wall.
- Workers set the same settings from the job payload's `org_id`, which the outbox writer copies from the transaction.
- Cross-tenant tables are `user`, `auth_account`, `session`, `plan`, the global content index, and `font_asset` for platform-provided OFL fonts. They have their own explicit policies.
- **Tests.** A tenancy suite creates two orgs and asserts that every repository function returns zero rows across tenants. It runs in CI against real Postgres (`12`).

## 6. Migrations

- Tooling: plain SQL migration files under `modules/<m>/migrations`, applied by `graphile-migrate` or `node-pg-migrate`. Kysely types are generated from the database with `kysely-codegen`.
- **Expand/contract only.** No destructive change ships in the same release as the code that stops using the old shape.
- Large backfills run as jobs, never inside migrations.

## 7. Backup, restore and disaster recovery

- RDS PITR, 35 days. Nightly `pg_dump` to S3 in a separate AWS account with Object Lock.
- S3 versioning on all buckets, plus cross-region replication of the archive bucket to ap-south-2 (Hyderabad).
- Targets: RPO ≤ 5 min and RTO ≤ 1 h for the production database. For the archive, the release state machine marks an edition `ARCHIVED` only after it has confirmed that the replica object exists. S3 replication is asynchronous; replication time control gives a 15-minute service level.
- **Restore drills every quarter.** One edition is restored end to end and a PDF byte-hash comparison is run. This is D11's "restore required" gate.
