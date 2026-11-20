import { useEffect, useState } from "react";
import type { ConnectorStatus } from "../../connectors";
import { orderedStatuses, reconnectCalendar, useLive } from "../../connectors/live";
import { startScan } from "../../lib/scan-store";

// One chip per data source, showing its live state. Short labels keep the
// strip calm; the full detail is in each chip's tooltip and screen reader text.
const LABELS = { bank: "Bank", email: "Email", documents: "Documents", calendar: "Calendar" } as const;

export const DOT: Record<ConnectorStatus["state"], string> = {
  connecting: "bg-faint motion-safe:animate-pulse",
  syncing: "bg-amber motion-safe:animate-pulse",
  retrying: "bg-amber",
  ok: "bg-positive",
  needs_reconnect: "bg-danger",
  error: "bg-danger",
};

/** Re-renders every second while `active`, for countdowns. */
export function useTick(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function stateText(status: ConnectorStatus, now: number): string {
  switch (status.state) {
    case "connecting":
      return "Connecting";
    case "syncing":
      return "Syncing";
    case "retrying": {
      const seconds = Math.max(0, Math.ceil(((status.retryAt ?? now) - now) / 1000));
      return `Retrying in ${seconds}s`;
    }
    case "ok":
      return "Up to date";
    case "needs_reconnect":
      return "Needs reconnecting";
    case "error":
      return "Couldn't sync";
  }
}

export function StatusStrip() {
  const live = useLive();
  const statuses = orderedStatuses(live);
  const now = useTick(statuses.some((s) => s.state === "retrying"));

  return (
    <ul aria-label="Connections" className="flex min-w-0 gap-1">
      {(["bank", "email", "documents", "calendar"] as const).map((id) => {
        const status = live.statuses[id];
        // Documents can be "up to date" yet slow to hand over each file's text.
        const slow = id === "documents" && live.slowReads;
        const text = slow
          ? `Slow to respond, ${live.slowReads!.done} read so far`
          : status
            ? stateText(status, now)
            : "Not connected yet";
        // Only show the state in words when it needs attention or explains a wait.
        const loud = status && (status.state === "retrying" || status.state === "error");
        return (
          <li
            key={id}
            title={status?.detail ?? text}
            className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-hairline px-2.5 text-[11.5px] text-muted"
          >
            <span
              className={`size-1.5 rounded-full ${slow ? DOT.syncing : status ? DOT[status.state] : "border border-faint"}`}
              aria-hidden="true"
            />
            {LABELS[id]}
            {loud && (
              <span className={`font-mono text-[10.5px] ${status.state === "retrying" ? "text-amber" : "text-faint"}`}>{text}</span>
            )}
            {slow && (
              <>
                <span className="font-mono text-[10.5px] text-faint">Slow</span>
                <span className="shimmer h-1.5 w-8 rounded-full" aria-hidden="true" />
              </>
            )}
            <span className="sr-only">: {text}</span>
            {status?.state === "needs_reconnect" && (
              <button
                type="button"
                onClick={() => void reconnectCalendar().then(() => startScan())}
                className="-mr-1 ml-0.5 rounded-full bg-raised px-2 text-[11px] text-text hover:bg-hairline"
              >
                Reconnect
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
