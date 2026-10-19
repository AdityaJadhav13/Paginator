# Phase 11 — Data, revisions and archive

Inputs: Phases 2–3 and PDF/preflight/asset/rights research, read from disk. Ownership and immutable release requirements are CONFIRMED; storage schema shape, command mechanics and release protocol below are RECOMMENDED. No database schema is implemented.

## Ownership and relationships

| Aggregate / records | Ownership, references and lifecycle |
|---|---|
| User | Global account identity with external identity-provider mapping; no implicit customer-content access |
| Organization / Membership | Tenant root and user association; membership/grants revoked independently of user deletion |
| Publication / PublicationProfile | Organization-owned; versions reference Brand, editorial rules, sections and approved source/print defaults |
| Edition / Section | Publication-owned; local publication date and region distinguish editions; timezone/time instants stored separately; sections ordered within edition |
| Story / StoryRevision | Tenant-owned editorial identity and immutable body/metadata versions; publication grants constrain sharing; edition selects exact revision |
| Asset / Advertisement | Tenant-owned originals, derivatives, rights and metadata; ad reservation belongs to edition and pins creative plus contractual constraints |
| Brand / Template / PrintProfile | Versioned tenant/publication configuration; new versions never silently alter existing editions/releases |
| EditableDocument / Page / DocumentRevision | Edition-owned canonical revision, stable page/frame IDs; large snapshots may be objects with transactional metadata |
| ResolvedDocument | Derived immutable scene keyed by document revision and full engine/input manifest; multiple resolutions possible under different manifests |
| ExportJob / PreflightResult | Tenant/publication/revision/profile scope, immutable candidate digest and tool identities; attempts/status separate from authoritative result |
| ContentSource / NewsSource / SourceItem | Connector configuration vs publisher identity vs timestamped observation; public publisher identity may be shared but customer credentials/content cannot |
| NewsEvent | Reversible event grouping within authorized corpus; no copying private wire items into a global index |
| RightsGrant / ProvenanceLink | Evidence, allowed purposes/scope/time, source relations and revisions; grants can expire without rewriting publication history |
| AuditEvent | Append-only action record with actor, scope, object/revision and correlation; not full sensitive payload logging |
| Subscription / Usage / StorageUsage | Organization commercial records and idempotent usage events; storage count reconciles object inventory and retention |
| ArchiveRecord / EditionPackage | Released revision, manifest and exact files; immutable identity with separate access, hold and retention status |

Use organization-qualified foreign keys/constraints for important cross-record references. Publication sharing is explicit. IDs alone grant no access. Version references are immutable IDs plus content hashes where bytes matter. Search indexes are rebuildable projections, never the sole archive catalogue.

Phase 24 clarification (AR14): a public publisher identity may be global reference metadata, but customer source observations, entitlements, event clusters, embeddings and search results are tenant-scoped by default. A shared URL or content hash is not authority to share licensed content, counts or snippets across organizations.

## Revision and edit contract

Command envelope: organization/publication/document, base revision, operation ID, actor and typed payload. Server derives actual authority from the session, validates all referenced objects and applies command atomically. A duplicate operation ID returns the existing result. A stale base revision returns a conflict and current revision reference; it never overwrites another edit silently. A document edit lease is a proposed initial coordination aid, but revision checks remain necessary when leases expire or clients disconnect.

Autosave acknowledges a durable commit. Before acknowledgment, show pending/unsaved state. One completed drag creates a semantic operation, not a revision for every pointer pixel. Text transactions honor IME composition boundaries. Session undo/redo and persistent revision history are different: undo emits a new operation; restoring an old revision creates a new revision with lineage. A story changed after placement offers an explicit edition update/diff rather than live mutation of placed content.

Phase 24 clarification (AR06): edition-specific text changes create an immutable edition-local StoryRevision with parent/source lineage and update the placement's revision reference. Formatting/geometry overrides must not hide a second unversioned story body. Source-library text is not silently mutated by copyfit or an accepted suggestion.

Recommend snapshots plus bounded command/audit history. Avoid full-system event sourcing. Snapshot compaction may remove disposable intermediates under policy but cannot remove revisions referenced by exports, approvals, published packages or legal holds. Migration of an editable copy preserves the original historical snapshot and records a transformation manifest.

## Release and archive state machine

Edition work remains editable independently of a candidate release. Recommended candidate states: REQUESTED → SNAPSHOT_PINNED → RESOLVED → PDF_CREATED → VALIDATED → APPROVED → ARCHIVE_COMMITTED → RELEASED. Failure/cancellation is explicit at every processing stage. Press delivery/acceptance/physical-print confirmation are later observations, not inferred from RELEASED. A new edit creates or requires a new candidate; it does not retroactively change a release.

At validation and approval bind document revision, resolved digest, print-profile version, PDF digest, checks/tool versions, rights decision and approval actor/time. The final release transaction verifies current permission, required rights and unchanged candidate identity. Revoke stale approvals on any candidate mutation; no “latest PDF” pointer as the source of truth.

Phase 24 clarification (AR07): final commit must check approval/grant/policy versions and time validity under transaction protection that serializes against revocation, or an equivalent compare-and-retry protocol. A check before object staging is insufficient. Rights revocation after release restricts subsequent access/reprint and is audited; it does not mutate the historical PDF and cannot recall already delivered bytes. Press receipts and physical-print observations are append-only linked records outside the immutable package manifest (AR17).

Object storage and database are not one atomic transaction. Stage all immutable package objects, verify hashes and required replication policy, then commit manifest metadata and release pointer in a database transaction. Expose a released download only after archive commitment. An outbox records downstream handoff/indexing work. A reconciler retries incomplete manifests, recognizes an already committed release and safely accounts for orphaned staged objects. Never delete staged objects referenced by active jobs/holds. Worker retries use stable release IDs and attempt-specific temporary keys.

## Edition Package

Required package: editable snapshot/schema; ResolvedDocument; exact print PDF; labeled proof PDF and thumbnails; pinned story revisions, images and advertisement assets; brand/template/publication/print profile versions; font files or licensed recoverable font references; engine and dependency manifests; preflight reports; rights/attribution evidence; approval/release audit and file hash inventory. Keep required dependencies available according to the promised recovery tier. Logical package membership need not duplicate every binary physically, but reference counting/retention must prevent deleting shared dependencies.

Three retrieval promises must remain distinct:

1. **Exact re-download/reprint:** retrieve archived print bytes, verify digest, reauthorize current permitted use. No engine rerun required.
2. **View/proof:** render archived PDF or retained proof; rebuilding thumbnails must not rewrite the master.
3. **Editable restoration:** copy the historical editable snapshot into a new working revision and recover licensed dependencies. Recomposition under a newer engine is a new result and may differ.

Byte-identical regeneration years later is not promised by a saved JSON file. Font licenses, licensed software availability, profiles and engine compatibility may limit restoration. Before selling exact editable recovery, prove dependency retention and migration; otherwise state limitations in the product contract.

## Retention, deletion and disaster recovery

Immutable means no silent overwrite during retention, not an unconditional promise never to delete. Separate archive retention schedules, legal holds, rights-driven access restrictions, customer deletion, account closure and backup expiry. A paid plan change does not retroactively discard releases without agreed notice/policy. WORM/object-lock mode is RESEARCH REQUIRED until retention/legal decisions are made. S3 documentation distinguishes protection modes; equivalent behavior cannot be assumed from S3 API compatibility ([Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)).

Protect archive objects and the key-management/manifest database together. Use checksums, backups in an independent failure boundary, periodic inventory reconciliation and restoration drills. Reconstruct metadata and authorized search projections from manifests. Agree recovery point/time objectives with the first customer; no invented SLA. Test lost DB, lost index, deleted working asset, expired signed link, unavailable old engine, corrupted archive member, interrupted release and account-access revocation. Archive acceptance includes restoring a complete edition and retrieving the exact release bytes after simulated infrastructure loss.
