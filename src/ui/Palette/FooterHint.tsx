import type { Cleared, Finding } from "../../agent/pipeline";
import type { TimelineEntry } from "../timeline";
import { KeyButton, KeyHint } from "../Kbd";
import { CheckNowIcon, OpenIcon } from "../icons";
import { MouseIcon } from "./FindingDetail";
import { copy } from "../../copy";

// What the selected row's keys or clicks do, shown at the right of the
// footer in the list and the timeline (there is no separate bar for it).
// With the keyboard: Enter opens, J/K move. With the mouse: what a click does.

type Item = Finding | Cleared | { undecided: string } | { group: boolean } | undefined;

export function ListHint({ item, mouse, onOpen, onRescan }: { item: Item; mouse: boolean; onOpen: () => void; onRescan: () => void }) {
  if (!item) return null;
  if ("undecided" in item) {
    return <KeyButton keys={["R"]} label={copy.actions.checkAgain} icon={<CheckNowIcon />} tone="muted" mouse={mouse} onClick={onRescan} />;
  }
  // The "Checked and left alone" header: Enter (or Space, or a click) opens and closes it.
  if ("group" in item) {
    if (mouse) return <ClickHint text={item.group ? copy.actions.clickToHide : copy.actions.clickToShow} />;
    return (
      <>
        <KeyButton keys={["↵"]} label={item.group ? copy.actions.hide : copy.actions.show} tone="faint" onClick={onOpen} />
        <KeyHint keys={["J", "K"]} label={copy.actions.move} />
      </>
    );
  }
  if (mouse) return <ClickHint text={"evidence" in item ? copy.actions.clickForDetail : copy.actions.clickWhyFine} />;
  return (
    <>
      <KeyButton keys={["↵"]} label={copy.actions.open} icon={<OpenIcon />} tone="faint" onClick={onOpen} />
      <KeyHint keys={["J", "K"]} label={copy.actions.move} />
    </>
  );
}

export function TimelineHint({ entry, mouse, onOpen }: { entry?: TimelineEntry; mouse: boolean; onOpen: () => void }) {
  if (!entry) return null;
  const opens = !!(entry.findingId || entry.clearedId);
  if (mouse) return opens ? <ClickHint text={entry.clearedId ? copy.actions.clickWhyFine : copy.actions.clickForDetail} /> : null;
  return (
    <>
      {opens && <KeyButton keys={["↵"]} label={copy.actions.open} icon={<OpenIcon />} tone="faint" onClick={onOpen} />}
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
