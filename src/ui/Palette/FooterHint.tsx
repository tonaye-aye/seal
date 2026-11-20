import type { Cleared, Finding } from "../../agent/pipeline";
import type { TimelineEntry } from "../timeline";
import { KeyButton, KeyHint } from "../Kbd";
import { CheckNowIcon, OpenIcon } from "../icons";
import { MouseIcon } from "./FindingDetail";

// What the selected row's keys or clicks do, shown at the right of the
// footer in the list and the timeline (there is no separate bar for it).
// With the keyboard: Enter opens, J/K move. With the mouse: what a click does.

type Item = Finding | Cleared | { undecided: string } | undefined;

export function ListHint({ item, mouse, onOpen, onRescan }: { item: Item; mouse: boolean; onOpen: () => void; onRescan: () => void }) {
  if (!item) return null;
  if ("undecided" in item) {
    return <KeyButton keys={["R"]} label="Check again" icon={<CheckNowIcon />} tone="muted" mouse={mouse} onClick={onRescan} />;
  }
  if (mouse) return <ClickHint text={"evidence" in item ? "Click for more detail" : "Click to see why it looks fine"} />;
  return (
    <>
      <KeyButton keys={["↵"]} label="Open" icon={<OpenIcon />} tone="faint" onClick={onOpen} />
      <KeyHint keys={["J", "K"]} label="Move" />
    </>
  );
}

export function TimelineHint({ entry, mouse, onOpen }: { entry?: TimelineEntry; mouse: boolean; onOpen: () => void }) {
  if (!entry) return null;
  const opens = !!(entry.findingId || entry.clearedId);
  if (mouse) return opens ? <ClickHint text={entry.clearedId ? "Click to see why it looks fine" : "Click for more detail"} /> : null;
  return (
    <>
      {opens && <KeyButton keys={["↵"]} label="Open" icon={<OpenIcon />} tone="faint" onClick={onOpen} />}
      <KeyHint keys={["J", "K"]} label="Move" />
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
