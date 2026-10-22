import { useI18n, type PlainKey } from "../../i18n/index.ts";
import type { StoryStatusDto, TransitionTargetDto } from "../../services/index.ts";
import "./stories.css";

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

/** A story's state as a chip: words, never colour alone (the colour only repeats them). */
export function StatusChip({ status }: { readonly status: StoryStatusDto }) {
  const { t } = useI18n();
  return <span className={`pg-chip pg-chip--${status}`}>{t(STATUS[status])}</span>;
}
