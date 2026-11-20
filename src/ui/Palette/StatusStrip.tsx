import { useEffect, useState } from "react";
import type { ConnectorStatus } from "../../connectors";
import { orderedStatuses, reconnectCalendar, useLive } from "../../connectors/live";
import { startScan } from "../../lib/scan-store";
import { copy } from "../../copy";
import { Tip } from "../layers";

// One chip per data source, showing its live state. Short labels keep the
// strip calm; the full detail is in each chip's tooltip and screen reader text.
const LABELS = copy.shared.source;

export const DOT: Record<ConnectorStatus["state"], string> = {
  connecting: "bg-faint motion-safe:animate-pulse",
  syncing: "bg-info motion-safe:animate-pulse",
  retrying: "bg-info",
  ok: "bg-positive",
  needs_reconnect: "bg-danger",
  error: "bg-danger",
};

/** The small Connect / Reconnect button on a source's row. `small` fits inside a status chip. */
export function pillButton(small = false): string {
  return `press inline-flex shrink-0 cursor-pointer items-center rounded-full bg-raised text-meta leading-none text-text hover:bg-hairline ${
    small ? "-mr-1.5 ml-0.5 h-[18px] px-2" : "h-6 px-2.5"
  }`;
}

/**
 * One row in the Connectors menu (a data source or the model endpoint): a
 * status dot, the name, and either the state in a few words or a button that
 * fixes it. Every row is the same height, with or without a button.
 */
export function StatusRow({
  dot,
  label,
  state,
  tone = "faint",
  tip,
  action,
}: {
  /** The dot's classes (from DOT). */
  dot: string;
  label: string;
  /** The state in a few words. With an action, the dot and button say it, so it goes to screen readers only. */
  state: string;
  tone?: "faint" | "info" | "danger";
  tip?: string;
  action?: React.ReactNode;
}) {
  const colour = tone === "danger" ? "text-danger" : tone === "info" ? "text-info" : "text-faint";
  return (
    <Tip content={tip} side="right">
      <li className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-small">
        <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-text">{label}</span>
        <span className={`shrink-0 font-mono text-label ${colour} ${action ? "sr-only" : ""}`}>{state}</span>
        {action}
      </li>
    </Tip>
  );
}

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
      return copy.connector.connecting;
    case "syncing":
      return copy.connector.syncing;
    case "retrying": {
      const seconds = Math.max(0, Math.ceil(((status.retryAt ?? now) - now) / 1000));
      return copy.connector.retrying(seconds);
    }
    case "ok":
      return copy.connector.ok;
    case "needs_reconnect":
      return copy.connector.needsReconnect;
    case "error":
      return copy.connector.error;
  }
}

export function StatusStrip() {
  const live = useLive();
  const statuses = orderedStatuses(live);
  const now = useTick(statuses.some((s) => s.state === "retrying"));

  return (
    <ul aria-label={copy.footer.connectionsLabel} className="flex min-w-0 gap-1">
      {(["bank", "email", "documents", "calendar"] as const).map((id) => {
        const status = live.statuses[id];
        // Documents can be "up to date" yet slow to hand over each file's text.
        const slow = id === "documents" && live.slowReads;
        const text = slow
          ? copy.connector.slow(live.slowReads!.done)
          : status
            ? stateText(status, now)
            : copy.connector.notConnectedYet;
        // Only show the state in words when it needs attention or explains a wait.
        const loud = status && (status.state === "retrying" || status.state === "error");
        return (
          <Tip key={id} content={status?.detail ?? text}>
            <li
              className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-hairline px-2.5 text-meta text-muted"
            >
              <span
                className={`size-1.5 rounded-full ${slow ? DOT.syncing : status ? DOT[status.state] : "border border-faint"}`}
                aria-hidden="true"
              />
              {LABELS[id]}
              {loud && (
                <span className={`font-mono text-label ${status.state === "retrying" ? "text-info" : "text-faint"}`}>{text}</span>
              )}
              {slow && (
                <>
                  <span className="font-mono text-label text-faint">{copy.footer.slowShort}</span>
                  <span className="shimmer h-1.5 w-8 rounded-full" aria-hidden="true" />
                </>
              )}
              <span className="sr-only">: {text}</span>
              {status?.state === "needs_reconnect" && (
                <button
                  type="button"
                  onClick={() => void reconnectCalendar().then(() => startScan())}
                  className={pillButton(true)}
                >
                  {copy.footer.reconnect}
                </button>
              )}
            </li>
          </Tip>
        );
      })}
    </ul>
  );
}
