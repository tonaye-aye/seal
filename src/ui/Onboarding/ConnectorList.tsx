import { CalendarDays, Check, Cloud, FolderOpen, HeartPulse, Landmark, Loader2, Mail, PiggyBank, Plus, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { copy } from "../../copy";
import { Kbd } from "../Kbd";
import { Tip } from "../layers";

// The list of things you can connect, on the onboarding's connect screen.
// One row per connector: an icon tile, its name, one line on what it reads,
// who provides it, and a + to connect.

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
  return (
    <ul className="flex w-[560px] flex-col gap-1.5">
      {rows.map((row) => {
        const Icon = row.icon;
        const off = row.state === "disabled";
        return (
          <li
            key={row.id}
            className={`flex items-center gap-3.5 rounded-xl border px-3.5 py-2.5 transition-colors duration-(--duration-fast) ${
              row.next ? "border-accent/35 bg-accent-glow/10" : "border-hairline bg-surface/60"
            } ${off ? "opacity-45" : ""}`}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-hairline bg-raised text-muted" aria-hidden="true">
              <Icon size={18} strokeWidth={1.6} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-body text-text">{row.name}</span>
              <span className="block truncate text-meta text-muted">{row.what}</span>
              <span className="block truncate text-meta text-faint">{copy.onboarding.by(row.by)}</span>
            </span>
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
                    className="cursor-pointer rounded-full bg-raised px-2.5 py-1 text-meta text-text hover:bg-hairline"
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
              <Tip content={copy.onboarding.connectSource(row.name)}>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={copy.onboarding.connectSource(row.name)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onConnect(row.id)}
                  className={`grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border transition-colors duration-(--duration-fast) ${
                    row.next ? "border-accent/40 text-accent hover:bg-accent-glow" : "border-hairline text-muted hover:bg-raised hover:text-text"
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
