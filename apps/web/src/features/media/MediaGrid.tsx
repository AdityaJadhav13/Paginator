/**
 * The publication's pictures as a grid (plan §L2.2, §5.3): newest first, 60 a page ("Load more"), each a thumbnail
 * (the engine's preview once ready), its state (Preparing, Ready, Refused or Failed, with the reason) and small flags
 * "No caption" / "No credit". Filters: a search of caption, credit and photographer, "Missing caption", "Missing
 * credit", and "Too small for N columns" once the publication's grid is known (some picture has a sharpUpToCols). Used by the Media screen and by the story editor's "Choose from library".
 *
 * Fresh pictures: a live change to a story of this publication (a story's photo became ready, the API's trigger) or a
 * `resync` fetches the pages shown again, in place; while a picture is still being prepared the grid also asks again
 * every 3 s, because a picture no story uses yet has no live update of its own (L2-385). "Load more" and a refresh do
 * not cancel each other: a refresh asked while a page was coming runs again once it is shown.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, Button, EmptyState, Field, Icon, Panel, ProgressIndicator, Select, Stack, TextInput } from "../../ui/index.ts";
import { useI18n, type Translate } from "../../i18n/index.ts";
import type { ApiProblem, MediaItemDto, MediaQueryDto } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { useMedia } from "../stories/media-context.tsx";
import { deskWords } from "./upload.tsx";
import "../stories/stories.css";
import "./media.css";

const COLUMNS = [1, 2, 3, 4, 5, 6] as const;
const POLL_MS = 3_000;

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem; readonly live: boolean }
  | { readonly status: "ready"; readonly items: readonly MediaItemDto[]; readonly next: string | null; readonly pages: number };

/** The picture's state as a badge: never colour alone, the word says it. */
export function MediaStatus({ item, t }: { readonly item: MediaItemDto; readonly t: Translate }) {
  if (item.status === "received") return <Badge tone="info" icon="clock">{t("library.status.received")}</Badge>;
  if (item.status === "ready") return <Badge tone="success" icon="circle-check">{t("library.status.ready")}</Badge>;
  if (item.status === "rejected") return <Badge tone="danger" icon="circle-x">{t("library.status.rejected")}</Badge>;
  return <Badge tone="danger" icon="triangle-alert">{t("library.status.failed")}</Badge>;
}

/** Why a picture was refused (the Desk's words) or failed, or null. */
export function mediaReason(item: MediaItemDto, t: Translate): string | null {
  if (item.status === "failed") return t("photo.failed.body");
  if (item.status !== "rejected") return null;
  const words = deskWords(item.problem);
  return words ? t(words) : null;
}

/** The name a picture goes by: its caption, or its size. */
export const mediaName = (item: MediaItemDto, t: Translate) =>
  item.caption || t("library.untitled", { width: item.widthPx, height: item.heightPx });

export function MediaGrid({
  orgId,
  pubId,
  onChoose,
  picker = false,
  compact = false,
  version = 0,
  photoFilters = true,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly onChoose: (item: MediaItemDto) => void;
  /** Choosing attaches the picture (the picker): a refused or failed one cannot be chosen, and says why. */
  readonly picker?: boolean;
  /** In a side sheet: smaller cards. */
  readonly compact?: boolean;
  /** Bumped by the screen to fetch again (after an upload, a change, a delete). */
  readonly version?: number;
  /** The news photo filters (caption or credit missing, too small for columns): off when choosing ad artwork. */
  readonly photoFilters?: boolean;
}) {
  const media = useMedia();
  const { t } = useI18n();
  const [query, setQuery] = useState<MediaQueryDto>({});
  const [search, setSearch] = useState("");
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [more, setMore] = useState<{ readonly busy: boolean; readonly problem: ApiProblem | null }>({ busy: false, problem: null });
  const pagesShown = useRef(1);
  const ask = useRef(0); // the newest refresh (a newer one wins over an older answer)
  const asking = useRef(false); // a refresh is on its way
  const shown = useRef(0); // bumped when the filters change: a page asked for before then is dropped

  /** The first `pages` pages again (a newer ask wins over an older answer). */
  const fetchPages = useCallback(
    async (pages: number, live: boolean) => {
      const mine = ++ask.current;
      asking.current = true;
      const items: MediaItemDto[] = [];
      let cursor: string | undefined;
      let next: string | null = null;
      for (let page = 0; page < pages; page += 1) {
        const result = await media.list({ orgId, pubId, query: { ...query, ...(cursor ? { cursor } : {}) } });
        if (mine !== ask.current) return;
        if (!result.ok) {
          asking.current = false;
          return setLoad({ status: "failed", problem: result.error, live });
        }
        items.push(...result.value.items);
        next = result.value.next;
        if (!next) break;
        cursor = next;
      }
      asking.current = false;
      setLoad({ status: "ready", items, next, pages });
    },
    [media, orgId, pubId, query],
  );
  useEffect(() => {
    pagesShown.current = 1;
    shown.current += 1;
    setLoad({ status: "loading" });
    void fetchPages(1, false);
  }, [fetchPages]);
  const refresh = useRef(() => {});
  refresh.current = () => void fetchPages(pagesShown.current, true);
  useEffect(() => {
    if (version > 0) refresh.current();
  }, [version]);
  useLiveEvents((event) => {
    if ((event.type === "story" && event.publicationId === pubId) || event.type === "resync") refresh.current();
  });
  const preparing = load.status === "ready" && load.items.some((item) => item.status === "received");
  useEffect(() => {
    if (!preparing) return;
    const timer = setTimeout(() => refresh.current(), POLL_MS);
    return () => clearTimeout(timer);
  }, [preparing, load]);

  const loadMore = async () => {
    if (load.status !== "ready" || !load.next) return;
    setMore({ busy: true, problem: null });
    const filters = shown.current;
    const result = await media.list({ orgId, pubId, query: { ...query, cursor: load.next } });
    if (filters !== shown.current) return setMore({ busy: false, problem: null });
    if (!result.ok) return setMore({ busy: false, problem: result.error });
    pagesShown.current += 1;
    const pages = pagesShown.current;
    setLoad((now) => {
      if (now.status !== "ready") return now;
      const have = new Set(now.items.map((item) => item.id));
      const added = result.value.items.filter((item) => !have.has(item.id));
      return { status: "ready", items: [...now.items, ...added], next: result.value.next, pages };
    });
    setMore({ busy: false, problem: null });
    // a refresh asked while this page was coming counts one page fewer: ask again, for every page shown
    if (asking.current) refresh.current();
  };

  const set = (change: Partial<MediaQueryDto>) => {
    const next: Record<string, unknown> = { ...query, ...change };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    setQuery(next as MediaQueryDto);
  };
  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    set({ q: search.trim() || undefined });
  };
  const filtered = Object.keys(query).length > 0;
  // the publication's grid is not known to the API yet (every sharpUpToCols null): no size filter is offered
  const gridKnown = query.tooSmallForCols !== undefined || (load.status === "ready" && load.items.some((item) => item.sharpUpToCols !== null));

  return (
    <Stack gap="4">
      <section aria-label={t("library.filters")} className="pg-stories__filter-bar pg-media__filter-bar">
        <form className="pg-stories__filters" onSubmit={applySearch} role="search">
          <div className="pg-media__search-group">
            <div className="pg-stories__search">
              <Field label={t("library.search")}>
                <TextInput type="search" name="q" value={search} onChange={(event) => setSearch(event.target.value)} />
              </Field>
              <Icon name="search" size={16} className="pg-stories__search-icon" />
            </div>
            <Button type="submit" variant="secondary">
              {t("stories.filter.apply")}
            </Button>
          </div>
          {photoFilters && (
          <Field label={t("library.filter.missing")}>
            {/* one choice: the API takes one `missing` */}
            <Select
              value={query.missing ?? ""}
              onChange={(event) => set({ missing: (event.target.value || undefined) as MediaQueryDto["missing"] })}
            >
              <option value="">{t("library.filter.missing.any")}</option>
              <option value="caption">{t("glossary.caption")}</option>
              <option value="credit">{t("glossary.photoCredit")}</option>
            </Select>
          </Field>
          )}
          {photoFilters && gridKnown && (
          <Field label={t("library.filter.tooSmall")}>
            <Select
              value={query.tooSmallForCols ? String(query.tooSmallForCols) : ""}
              onChange={(event) => set({ tooSmallForCols: event.target.value ? Number(event.target.value) : undefined })}
            >
              <option value="">{t("library.filter.anySize")}</option>
              {COLUMNS.map((columns) => (
                <option key={columns} value={columns}>
                  {t("library.filter.columns", { count: columns })}
                </option>
              ))}
            </Select>
          </Field>
          )}
          {filtered && (
            <Button
              variant="quiet"
              onClick={() => {
                setSearch("");
                setQuery({});
              }}
            >
              <Icon name="x" size={16} />
              {t("stories.filter.clear")}
            </Button>
          )}
        </form>
      </section>

      {load.status === "loading" && <ProgressIndicator role="status" label={t("library.loading")} />}
      {load.status === "failed" && (
        <Stack gap="3">
          <ProblemMessage problem={load.problem} live={load.live} />
          {!(load.problem.kind === "answer" && load.problem.status === 403) && (
            <div>
              <Button variant="secondary" onClick={() => void fetchPages(pagesShown.current, true)}>
                {t("form.retry")}
              </Button>
            </div>
          )}
        </Stack>
      )}
      {load.status === "ready" && load.items.length === 0 && (
        <Panel>
          <EmptyState icon="images" heading={filtered ? t("library.none.filtered") : t("library.none")}>
            {filtered ? t("library.none.filteredBody") : t("library.none.body")}
          </EmptyState>
        </Panel>
      )}
      {load.status === "ready" && load.items.length > 0 && (
        <ul className={`pg-media__grid${compact ? " pg-media__grid--compact" : ""}`} aria-label={t("library.pictures")}>
          {load.items.map((item) => {
            const unusable = picker && (item.status === "rejected" || item.status === "failed");
            const reason = mediaReason(item, t);
            return (
              <li key={item.id} className="pg-media__card">
                <button type="button" className="pg-media__pick" disabled={unusable} onClick={() => onChoose(item)}>
                  <span className="pg-media__thumb">
                    {item.previewUrl ? (
                      <img src={item.previewUrl} alt="" loading="lazy" width={item.widthPx} height={item.heightPx} />
                    ) : (
                      <Icon name="image" size={24} />
                    )}
                  </span>
                  <span className="pg-media__name">{mediaName(item, t)}</span>
                </button>
                <div className="pg-media__flags">
                  <MediaStatus item={item} t={t} />
                  {!item.caption && <Badge tone="warning">{t("library.flag.noCaption")}</Badge>}
                  {!item.credit && <Badge tone="warning">{t("library.flag.noCredit")}</Badge>}
                </div>
                {reason && <p className="pg-media__reason">{reason}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {load.status === "ready" && load.next && (
        <div>
          <Button variant="secondary" disabled={more.busy} aria-busy={more.busy} onClick={() => void loadMore()}>
            {t("library.more")}
          </Button>
        </div>
      )}
      {more.problem && <ProblemMessage problem={more.problem} />}
    </Stack>
  );
}
