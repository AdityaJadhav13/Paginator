# 10 — Archive, Storage and Revisions

> **Second-pass review, 2026-10-07.** The design is accepted but **staged**:
- G2–G4: versioned storage plus a hash manifest only.
- G5: full package.
- G7: tiers and search.

E-paper comes after G4.

The DPDP byline/archive question is a legal unknown (`15` §9). Status vocabulary: ADR-021. Baseline: `20`.


Status:
- **DECIDED:** the package format and the immutability model.
- **RESEARCH:** retention promises and the legal terms behind them (OP05, RD04).

## 1. Storage layout (S3, ap-south-1)

| Bucket / prefix | Contents | Mutability | Lifecycle |
|---|---|---|---|
| `pg-quarantine` | Raw uploads waiting for a scan | Short-lived | Deleted after 24 h |
| `pg-originals/<org>/<sha256>` | Original images, ad artwork, logos, ICC profiles, fonts (licence permitting) | Write-once (versioning on) | Kept while referenced; reference-counted garbage collection after 90 days unreferenced, never while referenced by a published package |
| `pg-derived/<org>/<rendition-hash>` | Thumbnails, previews, screen ladders, print CMYK renditions | Regenerable | Intelligent-Tiering; can be deleted and rebuilt |
| `pg-resolved/<org>/<address>/` | Resolved documents (per page) | Write-once (content-addressed) | Unpinned entries expire after 30 days |
| `pg-exports/<org>/<edition>/<artifact-sha>` | Print/proof PDFs, PNGs | Write-once | Copied into the archive package at release |
| `pg-archive/<org>/<edition-id>/` | **Published edition packages** | **Object Lock (governance mode)** + versioning + cross-region replication to ap-south-2 | Tiered by retention class (§4) |
| `pg-ingest/<org>/<source>/` | News raw payloads | Per the rights policy | 30 days by default for discovery-only items |

Common rules for every bucket:
- **Encryption:** SSE-KMS with one key per environment. Per-org data keys are an Enterprise option.
- **Access:** only through short-lived CloudFront or S3 signed URLs (5 min for downloads, 15 min for uploads). There is no public bucket.
- **Integrity:** SHA-256 is stored in Postgres and also as S3 object metadata. Archive packages also carry an S3 `ChecksumSHA256`.
- **Dedup:** content hashes deduplicate *within* an organization only. RJ07 forbids reuse across tenants.

## 2. Revisions model

- **StoryRevision, AssetRevision, DocumentRevision and ProfileVersion are append-only.** "Current" is only a pointer.
- **Every export is tied to an exact source.** It references `(document rev, resolved address, profile version)`. RJ02 forbids building an export from "latest".
- **The release locks the revision.** Once a release reaches `APPROVED`, that revision is frozen. Any later change creates a new revision, which needs a new release candidate (D05).
- **Command logs of released revisions are never compacted away.** This keeps an audit trail of who changed what before print.

## 3. Edition package (what is archived)

When an edition reaches `RELEASED`, a worker builds an immutable package:

```
pg-archive/<org>/<edition-id>/<release-id>/
  manifest.json            ← list of every file with sha256, sizes, versions; signed (§3.1)
  print/edition.pdf, print/pages/P01.pdf …   ← exact bytes delivered to press
  proof/edition-proof.pdf
  epaper/pages/P01.webp (+ tiles), epaper/articles.json (article regions, clipped text for e-paper)
  thumbs/P01.webp …
  document/editable.json.zst      ← EditableDocument at released rev
  document/resolved/*.bin.zst     ← ResolvedDocument pages (address-verified)
  content/stories/*.json          ← StoryRevisions pinned (text, rights, provenance)
  content/assets.json             ← list of originals by sha256 (+ copies for those not otherwise retained)
  ads/bookings.json, ads/artwork/* (normalized PDFs)
  profile/profile-version.json, profile/icc/*.icc, fonts/manifest.json (+ font binaries where licence permits archival)
  preflight/report.json, release/approvals.json, release/delivery-receipts.json
  audit/summary.json              ← key audit events (no personal data beyond actor IDs)
```

### 3.1 Manifest
- The manifest's SHA-256 is recorded in Postgres (`PublishedEdition.manifest_sha256`).
- It is also signed with a KMS asymmetric key, so we can prove later that an archived edition was not altered (legal disputes).

### 3.2 Personal data and Object Lock (India's DPDP Act)
- Locked objects contain **only** editorial artifacts and pseudonymous actor IDs.
- Names and emails of users stay in Postgres, which can be erased.
- Bylines are published content, not personal data held for processing in the DPDP sense. They remain, which is standard practice for news archives. **TENTATIVE:** confirm with Indian counsel.
- Governance mode (not compliance mode) lets an authorised operator remove a package under a court order.

## 4. Retention tiers (archive is a paid feature)

| Plan | Archive retention | Storage tier progression |
|---|---|---|
| Trial | 30 days | Standard |
| Starter | 6 months | Standard → Intelligent-Tiering |
| Professional | 2 years | Standard for 90 d → Standard-IA → Glacier Instant Retrieval after 1 y |
| Business | 5 years | Same as Professional, then Glacier Flexible after 2 y (retrieval in minutes to hours, shown in the UI) |
| Enterprise | Custom or permanent, legal hold, customer-managed key | Custom |

- `ArchiveRecord.retain_until` is set at publish time.
- A daily job applies expiry to packages that are past retention and not under legal hold:
  - it notifies the organization 30 days in advance;
  - then it deletes the package once the governance retention has lapsed.
- **Legal hold** is a per-edition flag that admins can set. It maps to S3 Legal Hold and blocks expiry.
- **Cost model:**
  - A 16-page edition package is about 150–400 MB, depending on photos. That is roughly 100 GB per year per daily paper.
  - At Glacier Instant Retrieval prices this costs a few dollars per month per paper per year retained, which makes the archive a high-margin add-on.
  - Usage is metered in `UsageRecord(storage_gb)`.

## 5. Archive experience

**Browse**
- Year → month → day calendar for each publication, with zone filters.
- Each edition opens to its thumbnails.

**Actions**

| Action | Behaviour |
|---|---|
| Preview | e-paper viewer (page images and article hotspots) |
| Download print PDF / proof | Signed URL to the exact archived bytes (D06: an exact reprint returns the archived bytes) |
| Open (read-only) | Editor in read-only mode, built from the archived resolved and editable data |
| Duplicate / open editable copy | Creates a **new edition** (or a new draft revision) from the archived EditableDocument plus pinned content. It re-resolves with the current engine and shows a diff report if anything reflows. The original is never modified |
| Reprint | Re-delivers the archived print PDFs to the press, with a new receipt. No regeneration |
| Correct and republish | A new edition revision is released as `corrected` and linked to the original, which stays immutable and is marked "superseded by" |

## 6. Archive search (P2 metadata, P5 full)

- **P2 indexing:**
  - Index fields: edition date, publication, zone, page, section, headline, byline, keywords.
  - The source is the **editable text**, never text extracted from the PDF (Devanagari ToUnicode fidelity is not good enough).
- **P5:**
  - full-text search across stories;
  - entities (people, places, orgs) from the AI enrichment;
  - semantic search through pgvector embeddings;
  - "show every story about Pune Metro in the last 6 months" (query + filters, results grouped by edition and page, with page-thumbnail hit highlighting from resolved `source` mappings).
- **Engine:**
  - English uses Postgres `tsvector`.
  - Marathi and Hindi use the `simple` config plus `pg_trgm`, because Postgres has no Marathi stemmer.
  - Embeddings handle cross-script and semantic recall.
  - An external search cluster (OpenSearch) is considered only if p95 query time exceeds 1 s at the measured scale (DF04).
