import { useEffect, useRef } from "react";
import * as Accordion from "@radix-ui/react-accordion";
import { ChevronRight, CircleAlert } from "lucide-react";
import { useLive } from "../connectors/live";
import { useScan, type ScanState } from "../lib/scan-store";
import { copy } from "../copy";
import { Kbd } from "./Kbd";
import { TraceLines } from "./Palette/Trace";
import { ProgressBar } from "./ProgressBar";
import { scanPercent } from "./scan-percent";

// How a running check shows its progress. Onboarding's last step has the bar as
// an accordion heading over the live steps. Everywhere else the same bar sits
// in the bottom bar, and goes once the check has reached 100%.

/**
 * Onboarding's "Seal is on it...": the bar, with the agent's live steps folded
 * under it. The steps open over the empty space below, so the seal and the
 * button above never move. T or a click opens it.
 */
export function CheckProgress({ open, onOpen, mouse }: { open: boolean; onOpen: (open: boolean) => void; mouse: boolean }) {
  const scan = useScan();
  const { slowReads } = useLive();
  const failed = scan.phase === "error";
  const done = scan.phase === "done";
  const slow = !!slowReads && scan.phase === "scanning";
  const steps = useRef<HTMLDivElement>(null);
  // Follows the newest step while it is open.
  useEffect(() => {
    if (open && steps.current) steps.current.scrollTop = steps.current.scrollHeight;
  }, [open, scan.trace.length, slow]);
  const label = failed ? copy.check.stopped : done ? copy.check.done : slow ? copy.check.slow : copy.check.working;
  const end = failed ? <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" className="text-danger" /> : slow ? "" : undefined;
  return (
    <Accordion.Root type="single" collapsible value={open ? "agent" : ""} onValueChange={(v) => onOpen(v === "agent")} className="relative mt-2 w-[480px]">
      <Accordion.Item value="agent">
        <Accordion.Header>
          <Accordion.Trigger
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            className="press flex h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-small text-muted hover:bg-raised/60 hover:text-text"
          >
            {/* A fixed width, so the bar stays put as the words change. */}
            <span className="w-32 shrink-0 text-left" aria-live="polite">
              {label}
            </span>
            <ProgressBar className="flex-1" percent={slow ? undefined : scanPercent(scan)} stopped={failed} end={end} label={copy.check.progressLabel} />
            <span className={mouse ? "invisible" : undefined}>
              <Kbd keys={["T"]} />
            </span>
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" className="accordion-chevron" />
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content className="accordion-content absolute inset-x-0 top-full z-5 mt-1 rounded-lg border border-hairline bg-surface text-left shadow-(--shadow-menu)">
          <div ref={steps} className="h-[104px] overflow-y-auto px-3 py-2.5 select-text">
            <TraceLines lines={scan.trace} />
            {slow && (
              <p role="status" className="fade-in mt-2 text-meta text-muted">
                {copy.list.slowDocuments(slowReads.done)}
              </p>
            )}
          </div>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  );
}

/**
 * The bar in the bottom bar while a check runs: the fill and its percentage,
 * as the status beside it says what the agent is doing. It gives up width
 * first when an open finding leaves the bottom bar short of room.
 */
export function CheckBar({ scan, leaving }: { scan: ScanState; leaving: boolean }) {
  const { slowReads } = useLive();
  const slow = !!slowReads && scan.phase === "scanning";
  return (
    <span className={`ml-2 flex w-32 min-w-20 shrink-8 items-center ${leaving ? "progress-leave" : "fade-in"}`}>
      <ProgressBar className="w-full" percent={slow ? undefined : scanPercent(scan)} end={slow ? "" : undefined} label={copy.check.progressLabel} />
    </span>
  );
}
