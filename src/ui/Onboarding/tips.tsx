import type { TipId } from "../../lib/onboarding";
import { Kbd } from "../Kbd";

// What each tip of the practice tour says: one short line each. The order,
// chapters, what each one spotlights and what it waits for live in
// src/lib/onboarding.ts (TIPS). Key caps here light up when the key is used.

export function tipText(id: TipId, { moves, approved }: { moves: number; approved: boolean }): React.ReactNode {
  switch (id) {
    case "list-intro":
      return <>Everything that needs you lives here. Just one made-up problem for now.</>;
    case "search":
      return (
        <>
          Looking for something? Press <Kbd keys={["/"]} /> to search by business or problem.
        </>
      );
    case "quick-menu":
      return <>Here's a quick menu: approve, snooze or mark not a leak without opening it. Best to look inside first, though.</>;
    case "timeline":
      return (
        <>
          Not into lists? See it on a timeline: <Kbd keys={["⌘", "↵"]} /> or click.
        </>
      );
    case "timeline-intro":
      return <>One problem, three moments: what happened, today (the amber line), and what's coming.</>;
    case "to-item":
      // Move a couple of times first; then the line is ready to open.
      return moves >= 2 ? (
        <>
          That's the item. Press <Kbd keys={["↵"]} /> or click it to go in.
        </>
      ) : (
        <>
          Move with <Kbd keys={["J"]} /> <Kbd keys={["K"]} /> or your mouse.
        </>
      );
    case "detail-evidence":
      return <>The evidence I found. The amounts I checked are highlighted.</>;
    case "detail-draft":
      return <>The fix I drafted. Every figure in it was checked in code.</>;
    case "detail-back":
      return (
        <>
          All done here. <Kbd keys={["Esc"]} /> takes you back.
        </>
      );
    case "approve":
      return (
        <>
          Looks right? <Kbd keys={["A"]} /> approves: it saves the draft, nothing is sent. <Kbd keys={["E"]} /> edits the draft,{" "}
          <Kbd keys={["S"]} /> snoozes it for later, <Kbd keys={["D"]} /> marks it not a leak. Approve it now.
        </>
      );
    case "approved":
      return approved ? (
        <>
          <span className="font-medium text-positive">All approved!</span> Made a mistake? Just undo with <Kbd keys={["⌘", "Z"]} />.
        </>
      ) : (
        <>
          Undone. Approve it again with <Kbd keys={["A"]} />.
        </>
      );
    case "settings":
      return (
        <>
          Find your settings here: click the cog or press <Kbd keys={["⌘", ","]} />.
        </>
      );
    case "done":
      return <span className="font-medium text-positive">You're done!</span>;
  }
}
