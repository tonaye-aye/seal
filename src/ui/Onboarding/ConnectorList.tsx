import { CalendarDays, Check, Cloud, FolderOpen, HeartPulse, Landmark, Loader2, Mail, PiggyBank, Plus, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ConnectorId } from "../../connectors/types";
import { copy } from "../../copy";
import { Kbd } from "../Kbd";
import { Tip } from "../layers";
import { pillButton } from "../Palette/StatusStrip";

// The list of things you can connect, on the onboarding's connect screen.
// One row per connector: an icon tile, its name, one line on what it reads,
// who provides it, and a + to connect. The Settings dialog draws its rows
// from the same parts (ConnectorBody, SOURCE_ROWS, MORE_ROWS).

export type ConnectorRow = {
  id: string;
  name: string;
  what: string;
  by: string;
  icon: LucideIcon;
  state: "idle" | "connecting" | "connected" | "problem" | "disabled";
  /** Short text on the right once connected (e.g. "134 transactions") or when there is a problem. */
  note?: string;
  /** This is the one Enter connects. */
  next?: boolean;
  /** Label for the problem button (e.g. "Reconnect"). */
  fix?: string;
};

export const ICONS = { Landmark, Mail, FolderOpen, CalendarDays, PiggyBank, HeartPulse, Cloud, Wallet };

/** The four sources in this demo. */
export const SOURCE_ROWS: Record<ConnectorId, Omit<ConnectorRow, "state" | "id"> & { unit: readonly [string, string] }> = {
  bank: { ...copy.onboarding.sources.bank, icon: ICONS.Landmark },
  email: { ...copy.onboarding.sources.email, icon: ICONS.Mail },
  documents: { ...copy.onboarding.sources.documents, icon: ICONS.FolderOpen },
  calendar: { ...copy.onboarding.sources.calendar, icon: ICONS.CalendarDays },
};

/** More things people would connect. Off in this demo: the sample data has only the four above. Fictional brands. */
export const MORE_ROWS: ConnectorRow[] = [
  { id: "ferro", ...copy.onboarding.more.ferro, icon: ICONS.Wallet, state: "disabled" },
  { id: "southerly", ...copy.onboarding.more.southerly, icon: ICONS.PiggyBank, state: "disabled" },
  { id: "kinbridge", ...copy.onboarding.more.kinbridge, icon: ICONS.HeartPulse, state: "disabled" },
  { id: "cloudnest", ...copy.onboarding.more.cloudnest, icon: ICONS.Cloud, state: "disabled" },
];

/** A connector's icon tile and its three lines. `meta` replaces the "by ..." line. */
export function ConnectorBody({ row, meta }: { row: Pick<ConnectorRow, "icon" | "name" | "what" | "by">; meta?: string }) {
  const Icon = row.icon;
  return (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-hairline bg-raised text-muted" aria-hidden="true">
        <Icon size={18} strokeWidth={1.6} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-body text-text">{row.name}</span>
        <span className="block truncate text-meta text-muted">{row.what}</span>
        <span className="block truncate text-meta text-faint">{meta ?? copy.onboarding.by(row.by)}</span>
      </span>
    </>
  );
}

export function ConnectorList({
  rows,
  onConnect,
  onFix,
  mouse = false,
}: {
  rows: ConnectorRow[];
  /** Keyboard mode shows ↵ by the + that Enter presses. */
  mouse?: boolean;
  onConnect: (id: string) => void;
  onFix?: (id: string) => void;
}) {
  // One source connects at a time: the others' + wait until it's done.
  const waiting = rows.some((row) => row.state === "connecting");
  return (
    <ul className="flex w-full flex-col gap-1.5">
      {rows.map((row) => {
        const off = row.state === "disabled";
        // A source still to connect: the whole row connects it, not just the +.
        const idle = row.state === "idle" && !waiting;
        return (
          <li
            key={row.id}
            onMouseDown={idle ? (e) => e.preventDefault() : undefined}
            onClick={idle ? () => onConnect(row.id) : undefined}
            className={`flex items-center gap-3.5 rounded-xl border px-3.5 py-2.5 transition-colors duration-(--duration-fast) ${
              row.next ? "border-accent/35 bg-accent-glow/10" : "border-hairline bg-surface/60"
            } ${idle ? `row-press cursor-pointer ${row.next ? "hover:border-accent/60" : "hover:border-muted/40 hover:bg-surface"}` : ""} ${off ? "opacity-45" : ""}`}
          >
            <ConnectorBody row={row} />
            {row.state === "connected" && (
              <span className="tick-in flex shrink-0 items-center gap-1.5 text-meta text-positive" role="status">
                <Check size={14} strokeWidth={2} aria-hidden="true" />
                {row.note ?? copy.onboarding.connected}
              </span>
            )}
            {row.state === "connecting" && (
              <span className="flex shrink-0 items-center gap-1.5 text-meta text-muted" role="status">
                <Loader2 size={14} strokeWidth={1.75} className="motion-safe:animate-spin" aria-hidden="true" />
                {row.note ?? copy.onboarding.connecting}
              </span>
            )}
            {row.state === "problem" && (
              <span className="flex shrink-0 items-center gap-2 text-meta text-danger" role="status">
                {row.note}
                {onFix && row.fix && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onFix(row.id)}
                    className={pillButton()}
                  >
                    {row.fix}
                  </button>
                )}
              </span>
            )}
            {off && <span className="shrink-0 text-meta text-faint">{copy.onboarding.notInDemo}</span>}
            {row.state === "idle" && row.next && !mouse && (
              <span className="shrink-0" aria-hidden="true">
                <Kbd keys={["↵"]} />
              </span>
            )}
            {row.state === "idle" && (
              <Tip content={waiting ? undefined : copy.onboarding.connectSource(row.name)}>
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={waiting}
                  aria-label={copy.onboarding.connectSource(row.name)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    // The row would connect it too.
                    e.stopPropagation();
                    onConnect(row.id);
                  }}
                  className={`grid size-8 shrink-0 place-items-center rounded-lg border ${
                    waiting
                      ? "cursor-default border-hairline text-faint opacity-50"
                      : row.next
                        ? "press cursor-pointer border-accent/40 text-accent hover:bg-accent-glow"
                        : "press cursor-pointer border-hairline text-muted hover:bg-raised hover:text-text"
                  }`}
                >
                  <Plus size={16} strokeWidth={1.75} />
                </button>
              </Tip>
            )}
          </li>
        );
      })}
    </ul>
  );
}
