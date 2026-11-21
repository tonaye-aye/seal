import type { Cleared, Finding } from "../../agent/pipeline";
import { isEarlierStop, type TimelineStop } from "../timeline";
import { KeyButton, KeyHint } from "../Kbd";
import { CheckNowIcon, OpenIcon, PaneIcon } from "../icons";
import { MouseIcon, type Pane, type SideStop } from "./FindingDetail";
import { copy } from "../../copy";

// What the selected row's keys or clicks do, shown at the right of the
// footer in the list, the timeline and an open finding (whose bar above holds
// only its actions).
// With the keyboard: Enter opens, J/K move. With the mouse: what a click does.

type Item = Finding | Cleared | { undecided: string } | { group: boolean } | undefined;

export function ListHint({ item, mouse, onOpen, onRescan }: { item: Item; mouse: boolean; onOpen: () => void; onRescan: () => void }) {
  if (!item) return null;
  if ("undecided" in item) {
    return <KeyButton keys={["R"]} label={copy.actions.checkAgain} icon={<CheckNowIcon />} tone="muted" mouse={mouse} onClick={onRescan} />;
  }
  // The "Checked and left alone" header: Enter (or Space, or a click) opens and closes it.
  if ("group" in item) return <GroupHint open={item.group} mouse={mouse} onToggle={onOpen} />;
  if (mouse) return <ClickHint text={"evidence" in item ? copy.actions.clickForDetail : copy.actions.clickWhyFine} />;
  return (
    <>
      <KeyButton keys={["↵"]} label={copy.actions.open} icon={<OpenIcon />} tone="faint" onClick={onOpen} />
      <KeyHint keys={["J", "K"]} label={copy.actions.move} />
    </>
  );
}

export function TimelineHint({ stop, mouse, onOpen }: { stop?: TimelineStop; mouse: boolean; onOpen: () => void }) {
  if (!stop) return null;
  // Earlier's header works like "Checked and left alone".
  if (isEarlierStop(stop)) return <GroupHint open={stop.open} mouse={mouse} onToggle={onOpen} />;
  const entry = stop;
  const opens = !!(entry.findingId || entry.clearedId);
  if (mouse) return opens ? <ClickHint text={entry.clearedId ? copy.actions.clickWhyFine : copy.actions.clickForDetail} /> : null;
  return (
    <>
      {opens && <KeyButton keys={["↵"]} label={copy.actions.open} icon={<OpenIcon />} tone="faint" onClick={onOpen} />}
      <KeyHint keys={["J", "K"]} label={copy.actions.move} />
    </>
  );
}

/**
 * In an open finding. On the sidebar: J/K move, Enter opens or closes a
 * panel or previews a piece of evidence, Tab goes to the draft. On the
 * draft: J/K scroll, Enter opens or folds its Details. With the mouse: click any evidence.
 */
export function DetailHint({
  pane,
  stop,
  panelOpen,
  twoPanes,
  detailsOpen,
  canSayWhy = false,
  mouse,
  onToggle,
  onPane,
}: {
  pane: Pane;
  /** The selected sidebar stop. */
  stop?: SideStop;
  /** That stop is a panel, and it is open (so Enter closes it). */
  panelOpen: boolean;
  /** A finding (with a draft side), not a case left alone. */
  twoPanes: boolean;
  /** The draft's Details are open (undefined: there are none). On the draft side, Enter opens or folds them. */
  detailsOpen?: boolean;
  /** Marked "Not a leak": keys 1 to 3 say why. */
  canSayWhy?: boolean;
  mouse: boolean;
  onToggle: () => void;
  onPane: () => void;
}) {
  if (mouse) return <ClickHint text={copy.actions.clickEvidence} />;
  const enter = stop && "evidence" in stop ? copy.actions.preview : panelOpen ? copy.actions.close : copy.actions.open;
  return (
    <>
      {canSayWhy && <KeyHint keys={["1", "3"]} label={copy.rules.hint} />}
      <KeyHint keys={["J", "K"]} label={pane === "draft" ? copy.actions.scroll : copy.actions.evidence} />
      {pane !== "draft" && stop && <KeyButton keys={["↵"]} label={enter} icon={<OpenIcon />} tone="faint" onClick={onToggle} />}
      {pane === "draft" && detailsOpen !== undefined && (
        <KeyButton keys={["↵"]} label={detailsOpen ? copy.actions.hideDetails : copy.actions.showDetails} icon={<OpenIcon />} tone="faint" onClick={onToggle} />
      )}
      {twoPanes && <KeyButton keys={["Tab"]} label={pane === "draft" ? copy.actions.toEvidence : copy.actions.toDraft} icon={<PaneIcon />} tone="faint" onClick={onPane} />}
    </>
  );
}

/** A folding group's header: Enter (or Space, or a click) opens and closes it. */
function GroupHint({ open, mouse, onToggle }: { open: boolean; mouse: boolean; onToggle: () => void }) {
  if (mouse) return <ClickHint text={open ? copy.actions.clickToHide : copy.actions.clickToShow} />;
  return (
    <>
      <KeyButton keys={["↵"]} label={open ? copy.actions.hide : copy.actions.show} tone="faint" onClick={onToggle} />
      <KeyHint keys={["J", "K"]} label={copy.actions.move} />
    </>
  );
}

function ClickHint({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <MouseIcon />
      {text}
    </span>
  );
}
