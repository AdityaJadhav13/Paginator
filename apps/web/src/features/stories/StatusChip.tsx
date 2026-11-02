import { useI18n, type PlainKey } from "../../i18n/index.ts";
import type { StoryStatusDto, TransitionTargetDto } from "../../services/index.ts";
import { Badge, type BadgeTone, type IconName } from "../../ui/index.ts";

const STATUS: Readonly<Record<StoryStatusDto, PlainKey>> = {
  draft: "status.draft",
  filed: "status.filed",
  editing: "status.editing",
  ready: "status.ready",
  held: "status.held",
  spiked: "status.spiked",
  placed: "status.placed",
};

const MOVE: Readonly<Record<TransitionTargetDto, PlainKey>> = {
  filed: "move.filed",
  editing: "move.editing",
  ready: "move.ready",
  draft: "move.draft",
  held: "move.held",
  spiked: "move.spiked",
  restore: "move.restore",
};

export const statusKey = (status: StoryStatusDto): PlainKey => STATUS[status];
export const moveKey = (to: TransitionTargetDto): PlainKey => MOVE[to];

const LOOK: Readonly<Record<StoryStatusDto, readonly [BadgeTone, IconName]>> = {
  draft: ["neutral", "file-text"],
  filed: ["info", "send"],
  editing: ["info", "pencil"],
  ready: ["success", "circle-check"],
  held: ["warning", "clock"],
  spiked: ["danger", "circle-x"],
  placed: ["accent", "layout-template"],
};

/** A story's state as a badge: icon and words, never colour alone (the colour only repeats them). */
export function StatusChip({ status }: { readonly status: StoryStatusDto }) {
  const { t } = useI18n();
  const [tone, icon] = LOOK[status];
  return (
    <Badge tone={tone} icon={icon} className={`pg-chip pg-chip--${status}`}>
      {t(STATUS[status])}
    </Badge>
  );
}
