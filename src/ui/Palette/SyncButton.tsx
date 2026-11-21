import { RefreshCw } from "lucide-react";
import { useScan } from "../../lib/scan-store";
import { copy } from "../../copy";
import { Tip } from "../layers";

// The bottom bar's sync: one press reads every connected source again and runs
// the whole check (the same as R). It spins and rests while a check runs.
export function SyncButton({ onSync, tip }: { onSync: () => void; /** The dev gallery only: tooltip held open. */ tip?: boolean }) {
  const scan = useScan();
  const busy = scan.phase === "scanning" || scan.refreshing;
  const label = busy ? copy.header.syncing : copy.header.sync;
  return (
    <Tip content={label} keys={busy ? undefined : ["R"]} side="top" open={tip || undefined}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        // Not the real disabled attribute, so its tooltip still shows while it spins.
        aria-disabled={busy || undefined}
        // Keep keyboard focus on the palette, so the keys keep working after a click.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!busy) onSync();
        }}
        className={`grid size-7 shrink-0 place-items-center rounded-md ${
          busy ? "cursor-default text-faint" : "press cursor-pointer text-muted hover:bg-raised/60 hover:text-text"
        }`}
      >
        <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" className={`block ${busy ? "motion-safe:animate-spin" : ""}`} />
      </button>
    </Tip>
  );
}
