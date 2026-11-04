// The news finder's engine events, applied in the engine inbox's one transaction (src/modules/media/engine-inbox.ts;
// docs/product/13-news-finder.md). The inbox's asset_id is the run's id (news.collect) or the draft's (news.draft).
//   - news.collected → the collection stored (src/db/news.ts storeCollection: new items, Claude's topics, the sources'
//     last fetch, the AI state) and its Claude calls' cost; a repeat stores nothing new. A news.collect job that
//     failed changes nothing but the record. Audited as the system (news.collect).
//   - news.drafted → the story made by the editor who picked the topic, given to them, a Draft (origin news, "Made with
//     Claude" until a person edits its text, the draft's sources kept with it), in the language picked (the
//     publication's primary one if it no longer has it); the draft settled done with the photos offered and the
//     sentences the copy check still flags. A picker who may no longer make stories gets none (news.not_allowed), and
//     a text the stories' rules refuse fails the draft (news.bad_draft). Audited as the system (news.draft_done), and
//     the story as story.create by the picker.
//   - news.draft_failed, and a news.draft job that failed → the draft failed with the code and plain message
//     (news.draft_fail).
//   Every draft event is applied once: a draft no longer queued ignores it. Claude's calls are logged (app.ai_usage)
//   with the event that reports them.
import { type EngineEvent, reach } from "@pageinator/contracts";
import { recordAudit } from "../../db/audit.ts";
import { addUsage, findDraft, findSettings, settleDraft, storeCollection } from "../../db/news.ts";
import type { Database } from "../../db/pools.ts";
import { createStory, publicationOf } from "../../db/stories.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { orgView } from "../access/access.ts";
import type { Applied } from "../media/imports.ts";
import { cleaned } from "../stories/store.ts";

/** A news event, or a news job's job.failed. */
export type NewsEvent =
  | Extract<EngineEvent, { kind: "news.collected" | "news.drafted" | "news.draft_failed" }>
  | (Extract<EngineEvent, { kind: "job.failed" }> & { job_kind: "news.collect" | "news.draft" });

const NOT_ALLOWED = {
  problem: "news.not_allowed",
  message: "the person who picked the topic may no longer make stories in this publication",
};
const BAD_DRAFT = {
  problem: "news.bad_draft",
  message: "the draft breaks the stories' rules (too long, or no headline)",
};

/** Whether the event is the news finder's. */
export function isNewsEvent(event: EngineEvent): event is NewsEvent {
  return event.kind.startsWith("news.") || (event.kind === "job.failed" && event.job_kind.startsWith("news."));
}

export async function applyNewsEvent(
  database: Database,
  tx: Tx,
  tenant: Tenant,
  event: NewsEvent,
  job: string,
): Promise<Applied> {
  const pub = event.pub_id;
  if (event.kind === "news.collected" || (event.kind === "job.failed" && event.job_kind === "news.collect")) {
    if (!(await findSettings(tx, pub))) return { refuse: "not_found" }; // a run is asked for with its settings row
    const runId = event.kind === "job.failed" ? event.target_id : event.run_id;
    const data =
      event.kind === "news.collected"
        ? { ...(await storeCollection(tx, tenant.orgId, event)), ai: event.ai }
        : { code: event.code };
    if (event.kind === "news.collected") await addUsage(tx, tenant.orgId, pub, event.usage);
    await recordAudit(tx, tenant, {
      action: "news.collect",
      actorKind: "system",
      targetType: "news_run",
      targetId: runId,
      publicationId: pub,
      data: { job, ...data },
    });
    return "applied";
  }
  const draftId = event.kind === "job.failed" ? event.target_id : event.draft_id;
  const row = await findDraft(tx, pub, draftId, true);
  if (!row) return { refuse: "not_found" };
  if (row.state !== "queued") return "ignored"; // settled already: a repeat
  if (event.kind !== "job.failed") await addUsage(tx, tenant.orgId, pub, event.usage);
  const audit = (action: "news.draft_done" | "news.draft_fail", data: Record<string, unknown>) =>
    recordAudit(tx, tenant, {
      action,
      actorKind: "system",
      targetType: "news_draft",
      targetId: draftId,
      publicationId: pub,
      data: { job, ...data },
    });
  const fail = async (outcome: { problem: string; message: string }) => {
    await settleDraft(tx, pub, draftId, { state: "failed", ...outcome });
    await audit("news.draft_fail", { code: outcome.problem });
    return "applied" as const;
  };
  if (event.kind !== "news.drafted") return fail({ problem: event.code, message: event.message });
  // the picker may have lost story.create (or left) since: their story is made only while they may make one
  const view = await orgView(database, { userId: row.user_id }, tenant.orgId, `news-draft:${draftId}`);
  const here = view?.publications.get(pub);
  if (!view || !here || !reach("story.create", view.orgRole, here)) return fail(NOT_ALLOWED);
  let text;
  try {
    text = {
      headline: cleaned(event.headline, "headline"),
      byline: cleaned(event.byline, "byline"),
      body: cleaned(event.body, "body"),
    };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return fail(BAD_DRAFT);
  }
  if (text.headline === "") return fail(BAD_DRAFT);
  const publication = await publicationOf(tx, pub);
  const storyId = await createStory(tx, { ...tenant, userId: row.user_id }, pub, {
    ...text,
    kicker: "",
    deck: "",
    language: publication.languages.includes(row.language) ? row.language : publication.primary_language,
    sectionId: null,
    priority: 3,
    pagePin: null,
    editionId: null,
    deskNote: "",
    origin: "news",
    assigneeId: row.user_id,
    newsSources: event.sources,
  });
  await settleDraft(tx, pub, draftId, { state: "done", storyId, flagged: event.flagged, photos: event.photos });
  await audit("news.draft_done", { story: storyId, flagged: event.flagged.length, photos: event.photos.length });
  return "applied";
}
