import { useState } from "react";
import { CircleAlert, Plug, Settings } from "lucide-react";
import type { ConnectorStatus } from "../../connectors";
import { orderedStatuses, reconnectCalendar, useLive } from "../../connectors/live";
import type { ConnectorId } from "../../connectors/types";
import { connectLater, onboardingDone } from "../../lib/onboarding";
import { hidePalette } from "../../lib/native";
import { startScan } from "../../lib/scan-store";
import { copy } from "../../copy";
import { Kbd } from "../Kbd";
import { CloseIcon, HideIcon, KeysIcon, TraceIcon } from "../icons";
import { Menu, MenuItem } from "./Menu";
import { ModelChip, ModelRow } from "./ModelChip";
import { SimulatingChip } from "./ScenariosSheet";
import { DOT, stateText, useTick } from "./StatusStrip";

// Bottom bar: one Connectors button (with a count, and a warning when a source
// needs attention) that opens a small menu. While a demo failure is switched
// on, an amber "Simulating" chip sits next to it, and when the model endpoint
// isn't answering normally (or saved answers are in use), a model chip does. Settings lives in the top bar
// (SettingsButton below, placed by Header).
export function Footer({ onScenarios, right }: { onScenarios: () => void; right?: React.ReactNode }) {
  return (
    <footer className="relative flex h-10 shrink-0 items-center justify-between gap-3 border-t border-hairline px-3 text-[12px]">
      <div className="flex min-w-0 items-center gap-2">
        <ConnectorsButton />
        <ModelChip />
        <SimulatingChip onClick={onScenarios} />
      </div>
      {/* What the selected row's keys or clicks do, or the setup step's action. */}
      {right && <div className="flex shrink-0 items-center gap-3 pr-1">{right}</div>}
    </footer>
  );
}

const LABELS = copy.shared.source;

function footerButton(open: boolean) {
  return `inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 leading-none transition-colors duration-(--duration-fast) hover:bg-raised hover:text-text ${
    open ? "bg-raised text-text" : "text-muted"
  }`;
}

/** "Connectors 4": how many sources are connected, amber while one is busy, red with a count when any need attention. */
export function ConnectorsButton({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const live = useLive();
  const [open, setOpen] = useState(defaultOpen);
  const statuses = orderedStatuses(live);
  const now = useTick(statuses.some((s) => s.state === "retrying"));
  const ok = statuses.filter((s) => s.state === "ok").length;
  const problems = statuses.filter((s) => s.state === "needs_reconnect" || s.state === "error").length;
  const retrying = statuses.find((s) => s.state === "retrying");
  const busy = statuses.some((s) => s.state === "connecting" || s.state === "syncing") || !!live.slowReads;

  return (
    <div className="relative">
      <button
        type="button"
        tabIndex={-1}
        data-menu-button
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={footerButton(open)}
        title={copy.footer.whatsConnected}
      >
        <span className="grid size-4 place-items-center [&>svg]:block">
          <Plug size={14} strokeWidth={1.75} aria-hidden="true" />
        </span>
        {copy.footer.connectors}
        {problems > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-1.5 py-0.5 font-mono text-[10.5px] text-danger">
            <CircleAlert size={11} strokeWidth={2} aria-hidden="true" />
            {problems}
          </span>
        ) : retrying ? (
          <span className="rounded-full bg-amber-glow px-1.5 py-0.5 font-mono text-[10.5px] text-amber">{stateText(retrying, now)}</span>
        ) : (
          <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10.5px] tabular ${busy ? "bg-amber-glow text-amber" : "bg-raised text-faint"}`}>
            {busy ? <span className="motion-safe:animate-pulse">{ok}</span> : ok}
          </span>
        )}
        <span className="sr-only">
          {problems > 0 ? copy.footer.needAttention(problems) : copy.footer.connectedCount(ok)}
        </span>
      </button>
      <Menu open={open} onClose={() => setOpen(false)} label={copy.footer.connectors}>
        <p className="px-2.5 pt-1.5 pb-1 font-mono text-[10.5px] tracking-[0.06em] text-faint uppercase">{copy.footer.connectors}</p>
        <ul className="flex flex-col">
          {(["bank", "email", "documents", "calendar"] as const).map((id) => (
            <ConnectorRow key={id} id={id} label={LABELS[id]} status={live.statuses[id]} now={now} slow={id === "documents" ? live.slowReads : undefined} />
          ))}
        </ul>
        <div className="mx-2.5 my-1 h-px bg-hairline" />
        <ul className="flex flex-col">
          <ModelRow />
        </ul>
        <p className="px-2.5 pt-1 pb-1.5 text-[11px] text-faint">{copy.footer.connectorsNote}</p>
      </Menu>
    </div>
  );
}

function ConnectorRow({
  id,
  label,
  status,
  now,
  slow,
}: {
  /** Set for a source that can still be connected from here (after setup). */
  id?: ConnectorId;
  label: string;
  status?: ConnectorStatus;
  now: number;
  slow?: { done: number; total: number };
}) {
  const text = slow ? copy.connector.slow(slow.done) : status ? (status.state === "ok" && status.count !== undefined ? copy.footer.countRead(status.count) : stateText(status, now)) : copy.connector.notConnectedYet;
  return (
    <li className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px]" title={status?.detail}>
      <span className={`size-1.5 shrink-0 rounded-full ${slow ? DOT.syncing : status ? DOT[status.state] : "border border-faint"}`} aria-hidden="true" />
      <span className="flex-1 text-text">{label}</span>
      <span className={`font-mono text-[11px] ${status?.state === "error" || status?.state === "needs_reconnect" ? "text-danger" : status?.state === "retrying" ? "text-amber" : "text-faint"}`}>
        {text}
      </span>
      {!status && onboardingDone() && id && (
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void connectLater(id)}
          className="cursor-pointer rounded-full bg-raised px-2 py-0.5 text-[11px] text-text hover:bg-hairline"
        >
          {copy.footer.connect}
        </button>
      )}
      {status?.state === "needs_reconnect" && (
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void reconnectCalendar().then(() => startScan())}
          className="cursor-pointer rounded-full bg-raised px-2 py-0.5 text-[11px] text-text hover:bg-hairline"
        >
          {copy.footer.reconnect}
        </button>
      )}
    </li>
  );
}

/**
 * Settings, a cog in the top bar: Trace, Keyboard shortcuts and Hide Life,
 * each with the key that does the same.
 */
export function SettingsButton({
  hotkey,
  mouse,
  onTrace,
  onKeys,
  open: controlled,
  onOpenChange,
}: {
  hotkey: string[];
  mouse: boolean;
  onTrace: () => void;
  onKeys: () => void;
  /** Open state held by the palette, so ⌘, and the cog share it. Left out, the button keeps its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const opened = controlled ?? own;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(opened) : next;
    if (onOpenChange) onOpenChange(value);
    else setOwn(value);
  };
  const open = opened;
  const choose = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  const caps = (keys: string[]) => (mouse ? undefined : <Kbd keys={keys} />);
  return (
    <div className="relative">
      <button
        type="button"
        tabIndex={-1}
        data-menu-button
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        aria-label={copy.footer.settings}
        title={copy.footer.settings}
        className={`grid size-7 cursor-pointer place-items-center rounded-md transition-colors duration-(--duration-fast) hover:bg-raised hover:text-text ${
          open ? "bg-raised text-text" : "text-muted"
        }`}
      >
        <Settings size={15} strokeWidth={1.75} aria-hidden="true" className="block" />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} align="right" placement="below" label={copy.footer.settings}>
        <MenuItem icon={<TraceIcon />} label={copy.footer.traceItem} keys={caps(["T"])} onSelect={choose(onTrace)} />
        <MenuItem icon={<KeysIcon />} label={copy.footer.keysItem} keys={caps(["?"])} onSelect={choose(onKeys)} />
        <MenuItem
          icon={hotkey.length > 0 ? <HideIcon /> : <CloseIcon />}
          label={hotkey.length > 0 ? copy.footer.hide : copy.footer.close}
          keys={caps(hotkey.length > 0 ? hotkey : ["Esc"])}
          onSelect={choose(hidePalette)}
        />
      </Menu>
    </div>
  );
}
