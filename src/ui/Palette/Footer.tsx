import { useState } from "react";
import { CircleAlert, Plug } from "lucide-react";
import type { ConnectorStatus } from "../../connectors";
import { orderedStatuses, reconnectCalendar, useLive } from "../../connectors/live";
import type { ConnectorId } from "../../connectors/types";
import { connectLater, onboardingDone } from "../../lib/onboarding";
import { startScan } from "../../lib/scan-store";
import { copy } from "../../copy";
import { Menu, Tip } from "../layers";
import { ModelChip, ModelRow } from "./ModelChip";
import { SimulatingChip } from "./ScenariosSheet";
import { DOT, pillButton, stateText, StatusRow, useTick } from "./StatusStrip";

// Bottom bar: one Connectors button (with a count, and a warning when a source
// needs attention) that opens a small menu. While a demo failure is switched
// on, a "Simulating" chip (info colour) sits next to it, and when the model endpoint
// isn't answering normally (or saved answers are in use), a model chip does. Settings lives at the foot of
// the icon rail (SettingsButton in Rail.tsx).
export function Footer({ onScenarios, right }: { onScenarios: () => void; right?: React.ReactNode }) {
  return (
    <footer className="relative flex h-10 shrink-0 items-center justify-between gap-3 border-t border-hairline px-3 text-meta">
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
  return `press inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 leading-none hover:bg-raised hover:text-text ${
    open ? "bg-raised text-text" : "text-muted"
  }`;
}

/** "Connectors 4": how many sources are connected, info colour while one is busy, red with a count when any need attention. */
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
    <Menu
      open={open}
      onOpenChange={setOpen}
      label={copy.footer.connectors}
      trigger={
        <Tip content={copy.footer.whatsConnected}>
          <button
            type="button"
            tabIndex={-1}
            className={footerButton(open)}
          >
            <span className="grid size-4 place-items-center [&>svg]:block">
              <Plug size={14} strokeWidth={1.75} aria-hidden="true" />
            </span>
            {copy.footer.connectors}
            {problems > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-1.5 py-0.5 font-mono text-label text-danger">
                <CircleAlert size={11} strokeWidth={2} aria-hidden="true" />
                {problems}
              </span>
            ) : retrying ? (
              <span className="rounded-full bg-info/15 px-1.5 py-0.5 font-mono text-label text-info">{stateText(retrying, now)}</span>
            ) : (
              <span className={`rounded-full px-1.5 py-0.5 figure text-label ${busy ? "bg-info/15 text-info" : "bg-raised text-faint"}`}>
                {busy ? <span className="motion-safe:animate-pulse">{ok}</span> : ok}
              </span>
            )}
            <span className="sr-only">
              {problems > 0 ? copy.footer.needAttention(problems) : copy.footer.connectedCount(ok)}
            </span>
          </button>
        </Tip>
      }
    >
      <p className="px-2.5 pt-1.5 pb-1 label text-faint">{copy.footer.connectors}</p>
      <ul className="flex flex-col">
        {(["bank", "email", "documents", "calendar"] as const).map((id) => (
          <ConnectorRow key={id} id={id} label={LABELS[id]} status={live.statuses[id]} now={now} slow={id === "documents" ? live.slowReads : undefined} />
        ))}
      </ul>
      <div className="mx-2.5 my-1 h-px bg-hairline" />
      <ul className="flex flex-col">
        <ModelRow />
      </ul>
      <p className="px-2.5 pt-1 pb-1.5 text-meta text-faint">{copy.footer.connectorsNote}</p>
    </Menu>
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
  const bad = status?.state === "error" || status?.state === "needs_reconnect";
  const action =
    !status && onboardingDone() && id ? (
      <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => void connectLater(id)} className={pillButton()}>
        {copy.footer.connect}
      </button>
    ) : status?.state === "needs_reconnect" ? (
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void reconnectCalendar().then(() => startScan())}
        className={pillButton()}
      >
        {copy.footer.reconnect}
      </button>
    ) : undefined;
  return (
    <StatusRow
      dot={slow ? DOT.syncing : status ? DOT[status.state] : "border border-faint"}
      label={label}
      state={text}
      tone={bad ? "danger" : status?.state === "retrying" || slow ? "info" : "faint"}
      tip={status?.detail}
      action={action}
    />
  );
}
