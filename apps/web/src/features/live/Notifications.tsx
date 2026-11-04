/**
 * The notifications button and drawer of the workspace's header (plan §10 PR 23; 06 §11): how many are unread, the
 * person's notifications newest first (all of them, or the unread only), each a sentence with a link to what it is
 * about, marked read when it is opened; "Mark all as read"; older ones a page at a time. A live `notification` (or a
 * `resync`) fetches the count again, and the open list's first page.
 *
 * A notification names what happened by ids, with the text to show it by: the story's headline and status as the
 * reader may see the story now, and the invitee's name. A story the reader no longer reaches (deleted, given away, or
 * their role changed) comes as `story: null`: its sentence then names no story, says it is no longer here, and has no
 * link, so nothing of it is shown.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Checkbox, Drawer, EmptyState, Icon, ProgressIndicator, Stack, VisuallyHidden, type IconName } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { formatDate, formatDateTime } from "../../i18n/dates.ts";
import { useI18n, type Language, type Translate } from "../../i18n/index.ts";
import type { ApiProblem, NotificationDto } from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { statusKey } from "../stories/StatusChip.tsx";
import { useLiveEvents, useNotifications } from "./live-context.tsx";
import "./live.css";

const PAGE = 20;

/** Who did what, to a story the reader can no longer see: no headline. */
function aboutAStory(kind: Exclude<NotificationDto["kind"], "invitation_accepted" | "ad_artwork_missing">, name: string | undefined, t: Translate) {
  switch (kind) {
    case "story_filed":
      return name ? t("notification.storyFiled", { name }) : t("notification.storyFiled.someone");
    case "story_sent_back":
      return name ? t("notification.storySentBack", { name }) : t("notification.storySentBack.someone");
    case "story_assigned":
      return name ? t("notification.storyAssigned", { name }) : t("notification.storyAssigned.someone");
    case "comment":
      return name ? t("notification.comment", { name }) : t("notification.comment.someone");
  }
}

/** Who did what, to the story named by its headline. */
function aboutTheStory(
  kind: Exclude<NotificationDto["kind"], "invitation_accepted" | "ad_artwork_missing">,
  name: string | undefined,
  headline: string,
  t: Translate,
) {
  switch (kind) {
    case "story_filed":
      return name ? t("notification.storyFiled.story", { name, headline }) : t("notification.storyFiled.story.someone", { headline });
    case "story_sent_back":
      return name
        ? t("notification.storySentBack.story", { name, headline })
        : t("notification.storySentBack.story.someone", { headline });
    case "story_assigned":
      return name
        ? t("notification.storyAssigned.story", { name, headline })
        : t("notification.storyAssigned.story.someone", { headline });
    case "comment":
      return name ? t("notification.comment.story", { name, headline }) : t("notification.comment.story.someone", { headline });
  }
}

/** The notification's sentences: who did what, to which story and where it stands now (or that it is gone). */
export function notificationText(item: NotificationDto, t: Translate, language: Language = "en"): string {
  const name = item.actor?.name;
  if (item.kind === "invitation_accepted") {
    const invitee = item.invitee?.name ?? name;
    return invitee ? t("notification.invitationAccepted", { name: invitee }) : t("notification.invitationAccepted.someone");
  }
  if (item.kind === "ad_artwork_missing") {
    const count = item.ads?.missing ?? 0;
    const date = item.ads ? formatDate(item.ads.date, language) : "";
    return count === 1
      ? t("notification.adArtworkMissing.one", { date })
      : t("notification.adArtworkMissing", { count, date });
  }
  if (!item.story) return `${aboutAStory(item.kind, name, t)} ${t("notification.storyGone")}`;
  const now = t("notification.storyNow", { status: t(statusKey(item.story.status)) });
  return `${aboutTheStory(item.kind, name, item.story.headline, t)} ${now}`;
}

/** Where the notification leads: the story (at its comment), or the team; null when there is nowhere to go. */
export function notificationLink(item: NotificationDto, orgId: string, mayViewTeam: boolean): string | null {
  if (item.kind === "invitation_accepted") return mayViewTeam ? paths.orgTeam(orgId) : null;
  // the Ads desk on that date, which lists the bookings still without usable artwork
  if (item.kind === "ad_artwork_missing") {
    return item.publicationId && item.ads ? `${paths.pubAds(orgId, item.publicationId)}?date=${item.ads.date}` : null;
  }
  // a story the reader no longer reaches would only open "not found"
  if (!item.story || !item.publicationId || !item.storyId) return null;
  const story = paths.pubStory(orgId, item.publicationId, item.storyId);
  return item.commentId ? `${story}#comment-${item.commentId}` : story;
}

/** Each kind's icon (02 §3.6): decorative, the sentence says what happened. */
const KIND_ICON: Record<NotificationDto["kind"], IconName> = {
  story_filed: "send",
  story_sent_back: "arrow-left",
  story_assigned: "file-text",
  comment: "message-square",
  invitation_accepted: "users",
  ad_artwork_missing: "megaphone",
};

type List =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem }
  | { readonly status: "ready"; readonly items: readonly NotificationDto[]; readonly nextCursor: string | null };

export function NotificationsButton({ orgId, mayViewTeam }: { readonly orgId: string; readonly mayViewTeam: boolean }) {
  const notifications = useNotifications();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState<number | null>(null);
  const [markFailed, setMarkFailed] = useState(false);
  const counting = useRef(0);

  /** The unread count (a one-item page carries it); a failure leaves the last count shown, quietly. */
  const count = useCallback(async () => {
    const asked = ++counting.current;
    const result = await notifications.list({ orgId, limit: 1 });
    if (asked === counting.current && result.ok) setUnread(result.value.unread);
  }, [notifications, orgId]);
  useEffect(() => {
    setUnread(null);
    void count();
  }, [count]);
  useLiveEvents((event) => {
    if (event.type === "notification" || event.type === "resync") void count();
  });

  /** A notification opened (the drawer is gone by then): marked read, then the count asked again; a failure is said. */
  const opened = useCallback(
    async (id: string) => {
      setMarkFailed(false);
      const result = await notifications.markRead({ orgId, ids: [id] });
      if (!result.ok) setMarkFailed(true);
      await count();
    },
    [count, notifications, orgId],
  );

  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        className="pg-notifications-button"
        title={t("notifications.open")}
        onClick={() => {
          setMarkFailed(false);
          setOpen(true);
        }}
        aria-haspopup="dialog"
      >
        <Icon name="bell" size={20} />
        <VisuallyHidden>{t("notifications.open")}</VisuallyHidden>
        {unread !== null && unread > 0 && (
          <>
            {" "}
            <span className="pg-badge" aria-hidden="true">
              {unread > 99 ? "99+" : unread}
            </span>
            <VisuallyHidden>{t("notifications.unreadCount", { count: unread })}</VisuallyHidden>
          </>
        )}
      </Button>
      <span role="status" className="pg-type-body-small">
        {markFailed ? t("notifications.markFailed") : ""}
      </span>
      {open && (
        <NotificationsDrawer
          orgId={orgId}
          mayViewTeam={mayViewTeam}
          onClose={() => setOpen(false)}
          onUnread={setUnread}
          onOpened={(id) => void opened(id)}
        />
      )}
    </>
  );
}

function NotificationsDrawer({
  orgId,
  mayViewTeam,
  onClose,
  onUnread,
  onOpened,
}: {
  readonly orgId: string;
  readonly mayViewTeam: boolean;
  readonly onClose: () => void;
  readonly onUnread: (unread: number) => void;
  readonly onOpened: (id: string) => void;
}) {
  const notifications = useNotifications();
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [list, setList] = useState<List>({ status: "loading" });
  const [more, setMore] = useState<{ pending: boolean; problem: ApiProblem | null }>({ pending: false, problem: null });
  const [marking, setMarking] = useState<{ pending: boolean; problem: ApiProblem | null }>({ pending: false, problem: null });
  const [said, setSaid] = useState("");
  const asking = useRef(0);
  /** The "older ones" request's own count: a live refetch of the first page does not make its answer stale. */
  const askingMore = useRef(0);
  const listRef = useRef(list);
  listRef.current = list;

  /** The first page; `quiet`: a live update, which keeps what is shown when it fails, and the pages loaded since. */
  const first = useCallback(
    async (quiet: boolean) => {
      const asked = ++asking.current;
      if (!quiet) setList({ status: "loading" });
      const result = await notifications.list({ orgId, unread: onlyUnread, limit: PAGE });
      if (asked !== asking.current) return;
      if (!result.ok) {
        if (!quiet || listRef.current.status !== "ready") setList({ status: "failed", problem: result.error });
        return;
      }
      onUnread(result.value.unread);
      const shown = listRef.current;
      const last = result.value.items.at(-1);
      if (quiet && shown.status === "ready" && result.value.nextCursor !== null && last) {
        // what was loaded beyond the new first page stays, under it (one it pushed down too), up to the same cursor
        const fresh = new Set(result.value.items.map((item) => item.id));
        const older = shown.items.filter((item) => !fresh.has(item.id) && item.createdAt <= last.createdAt);
        if (older.length > 0) {
          setList({ status: "ready", items: [...result.value.items, ...older], nextCursor: shown.nextCursor });
          return;
        }
      }
      setList({ status: "ready", items: result.value.items, nextCursor: result.value.nextCursor });
    },
    [notifications, onUnread, onlyUnread, orgId],
  );
  useEffect(() => {
    askingMore.current += 1;
    setMore({ pending: false, problem: null });
    void first(false);
  }, [first]);
  useLiveEvents((event) => {
    if (event.type === "notification" || event.type === "resync") void first(true);
  });

  const showMore = async () => {
    if (list.status !== "ready" || !list.nextCursor || more.pending) return;
    setMore({ pending: true, problem: null });
    const asked = ++askingMore.current;
    const result = await notifications.list({ orgId, unread: onlyUnread, cursor: list.nextCursor, limit: PAGE });
    if (asked !== askingMore.current) return;
    if (!result.ok) return setMore({ pending: false, problem: result.error });
    setMore({ pending: false, problem: null });
    onUnread(result.value.unread);
    setList((shown) =>
      shown.status === "ready"
        ? {
            status: "ready",
            items: [...shown.items, ...result.value.items.filter((item) => !shown.items.some((seen) => seen.id === item.id))],
            nextCursor: result.value.nextCursor,
          }
        : shown,
    );
  };

  /** Marks these read here at once; the API is told, and the count asked again. */
  const markRead = async (which: { ids: readonly string[] } | { all: true }) => {
    setMarking({ pending: true, problem: null });
    const result = await notifications.markRead({ orgId, ...which });
    if (!result.ok) {
      setMarking({ pending: false, problem: result.error });
      return false;
    }
    setMarking({ pending: false, problem: null });
    const ids = "ids" in which ? new Set(which.ids) : null;
    setList((shown) =>
      shown.status === "ready"
        ? {
            ...shown,
            items: shown.items
              .map((item) => (item.readAt === null && (!ids || ids.has(item.id)) ? { ...item, readAt: "now" } : item))
              .filter((item) => !onlyUnread || item.readAt === null),
          }
        : shown,
    );
    void first(true);
    return true;
  };

  const open = (item: NotificationDto, to: string) => {
    if (item.readAt === null) onOpened(item.id);
    onClose();
    navigate(to);
  };

  const unreadShown = list.status === "ready" && list.items.some((item) => item.readAt === null);
  return (
    <Drawer open onClose={onClose} title={t("notifications.title")} closeLabel={t("shell.closeDialog")}>
      <Stack gap="4">
        <OfflineNotice />
        <div className="pg-notifications__bar">
          <Checkbox label={t("notifications.onlyUnread")} checked={onlyUnread} onChange={(event) => setOnlyUnread(event.target.checked)} />
          <Button
            variant="quiet"
            size="sm"
            disabled={!unreadShown || marking.pending}
            aria-busy={marking.pending}
            onClick={async () => {
              if (await markRead({ all: true })) setSaid(t("notifications.allRead"));
            }}
          >
            <Icon name="circle-check" size={16} />
            {t("notifications.markAll")}
          </Button>
        </div>
        <div aria-live="polite" className="pg-type-body-small">
          {said}
        </div>
        {marking.problem && <ProblemMessage problem={marking.problem} />}
        {list.status === "loading" && <ProgressIndicator role="status" label={t("notifications.loading")} />}
        {list.status === "failed" && (
          <Stack gap="3">
            <ProblemMessage problem={list.problem} live={false} />
            <div>
              <Button variant="secondary" onClick={() => void first(false)}>
                {t("form.retry")}
              </Button>
            </div>
          </Stack>
        )}
        {list.status === "ready" && list.items.length === 0 && (
          <EmptyState icon="bell" heading={onlyUnread ? t("notifications.noneUnread") : t("notifications.none")} headingLevel={3} />
        )}
        {list.status === "ready" && list.items.length > 0 && (
          <ul className="pg-notifications" aria-label={t("notifications.title")}>
            {list.items.map((item) => {
              const to = notificationLink(item, orgId, mayViewTeam);
              const text = notificationText(item, t, language);
              const fresh = item.readAt === null;
              return (
                <li key={item.id} className={fresh ? "pg-notification pg-notification--unread" : "pg-notification"}>
                  <span className="pg-notification__icon">
                    <Icon name={KIND_ICON[item.kind]} size={16} />
                  </span>
                  <div className="pg-notification__main">
                    <p className="pg-notification__text">
                      {fresh && <VisuallyHidden>{`${t("notifications.new")} `}</VisuallyHidden>}
                      {to ? (
                        <Link
                          to={to}
                          onClick={(event) => {
                            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                            event.preventDefault();
                            open(item, to);
                          }}
                        >
                          {text}
                        </Link>
                      ) : (
                        text
                      )}
                    </p>
                    <div className="pg-notification__foot">
                      <span className="pg-type-body-small pg-notification__when">
                        <time dateTime={item.createdAt}>{formatDateTime(item.createdAt, language)}</time>
                      </span>
                      {fresh && (
                        <Button
                          variant="quiet"
                          size="sm"
                          disabled={marking.pending}
                          aria-label={t("notifications.markOneNamed", { notification: text })}
                          onClick={async () => {
                            if (await markRead({ ids: [item.id] })) setSaid(t("notifications.oneRead"));
                          }}
                        >
                          {t("notifications.markOne")}
                        </Button>
                      )}
                    </div>
                  </div>
                  {fresh && <span className="pg-notification__dot" aria-hidden="true" />}
                </li>
              );
            })}
          </ul>
        )}
        {list.status === "ready" && list.nextCursor && (
          <Stack gap="3">
            {more.problem && <ProblemMessage problem={more.problem} />}
            <div>
              <Button variant="secondary" disabled={more.pending} aria-busy={more.pending} onClick={() => void showMore()}>
                {more.pending ? t("notifications.loadingMore") : t("notifications.more")}
              </Button>
            </div>
          </Stack>
        )}
      </Stack>
    </Drawer>
  );
}
