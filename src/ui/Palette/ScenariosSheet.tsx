import type { ScenarioId } from "../../connectors";
import { toggleScenario, useLive, useScenarios } from "../../connectors/live";
import * as Switch from "@radix-ui/react-switch";
import { DROP_AFTER, toggleDrop, toggleSavedOnly, useModelDemo } from "../../lib/endpoint";
import { useScan } from "../../lib/scan-store";
import { CheckNowIcon, CloseIcon, ResetIcon } from "../icons";
import { copy } from "../../copy";
import { Kbd, KeyButton } from "../Kbd";
import { Sheet, SheetDescription, SheetTitle, SwitchLook, Tip } from "../layers";

// The hidden demo panel (Cmd+Shift+D): switches that make the fake connectors
// fail the way real ones do, so the demo can show how the app copes. Nothing
// here is real: the connectors are demo connectors over seed data. Two more
// switches are about the model endpoint: use saved answers only (so bad wifi
// can't break a demo), and make the endpoint drop out partway through a check.

const DEMO = copy.demo;

export const SCENARIOS: { id: ScenarioId; key: string; name: string; short: string; simulates: string; expect: string }[] = [
  { id: "calendar_reauth", key: "1", ...DEMO.scenarios.calendar_reauth },
  { id: "bank_rate_limit", key: "2", ...DEMO.scenarios.bank_rate_limit },
  { id: "slow_documents", key: "3", ...DEMO.scenarios.slow_documents },
];

/** The model endpoint's switches, keyed like the scenarios above. */
export const MODEL_SWITCHES = [
  { id: "saved", key: "M", name: DEMO.saved.name, simulates: DEMO.saved.simulates, expect: DEMO.saved.expect },
  { id: "drop", key: "4", name: DEMO.drop.name, simulates: DEMO.drop.simulates(DROP_AFTER), expect: DEMO.drop.expect },
] as const;

export function ScenariosSheet({
  open,
  mouse,
  onClose,
  onCheck,
  onReset,
}: {
  open: boolean;
  mouse: boolean;
  onClose: () => void;
  onCheck: () => void;
  /** Starts the first-run onboarding again from an empty account. */
  onReset: () => void;
}) {
  const on = useScenarios();
  const model = useModelDemo();
  const { pending } = useLive();
  const scan = useScan();
  const checking = scan.phase === "scanning" || scan.refreshing;

  // The panel's own keys, while it is open (it holds focus, so the palette's keys rest).
  function onKey(e: React.KeyboardEvent) {
    const lower = e.key.toLowerCase();
    // Cmd+Shift+D opens it (in the palette) and closes it again (here).
    if (e.metaKey && e.shiftKey && lower === "d") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const scenario = SCENARIOS.find((s) => s.key === e.key);
    if (scenario) {
      e.preventDefault();
      toggleScenario(scenario.id);
    } else if (e.key === "4") {
      // The model endpoint drops out partway through the next check.
      e.preventDefault();
      toggleDrop();
    } else if (lower === "m") {
      // Saved model answers only (not while LIFE_REPLAY=1 holds it on).
      e.preventDefault();
      if (!model.byFlag) toggleSavedOnly();
    } else if (lower === "o") {
      // Start onboarding again from an empty account (to rehearse the demo).
      e.preventDefault();
      if (!checking) onReset();
    } else if (lower === "r") {
      // While a check is running, R does nothing here (the button says so).
      e.preventDefault();
      if (!checking) onCheck();
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      onKeyDown={onKey}
      className="max-h-[calc(100%-32px)] w-[640px] overflow-y-auto rounded-xl border border-hairline bg-surface p-5 shadow-(--shadow-sheet)"
    >
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <SheetTitle className="heading text-title font-semibold">{DEMO.title}</SheetTitle>
          <SheetDescription className="mt-0.5 text-meta text-muted">{DEMO.intro}</SheetDescription>
        </div>
        <span className="shrink-0 rounded-full border border-info/30 px-2 py-0.5 label text-info">
          {DEMO.badge}
        </span>
      </header>

      <ul className="flex flex-col gap-1.5">
        {SCENARIOS.map((s) => {
          const enabled = on.includes(s.id);
          return (
            <li key={s.id}>
              <Switch.Root
                checked={enabled}
                onCheckedChange={() => toggleScenario(s.id)}
                className={`group flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-(--duration-fast) ${
                  enabled ? "border-info/30 bg-info/8" : "border-hairline hover:bg-raised"
                }`}
              >
                {!mouse && (
                  <span className="mt-px">
                    <Kbd keys={[s.key]} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-text">{s.name}</span>
                  <span className="mt-0.5 block text-meta text-muted">{s.simulates}</span>
                  {/* Where to look, once it's on (keeps the panel inside the window). */}
                  {enabled && <span className="mt-0.5 block text-meta text-faint">{DEMO.youllSee(s.expect)}</span>}
                </span>
                <SwitchLook tone="info" className="mt-0.5" />
              </Switch.Root>
            </li>
          );
        })}
      </ul>

      <h3 className="mt-3 mb-1.5 label text-faint">{DEMO.modelTitle}</h3>
      <ul className="flex flex-col gap-1.5">
        {MODEL_SWITCHES.map((s) => {
          const enabled = s.id === "saved" ? model.saved || model.byFlag : model.drop;
          const locked = s.id === "saved" && model.byFlag;
          return (
            <li key={s.id}>
              <Switch.Root
                checked={enabled}
                disabled={locked}
                onCheckedChange={() => (s.id === "saved" ? toggleSavedOnly() : toggleDrop())}
                className={`group flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-(--duration-fast) ${
                  locked ? "cursor-default" : "cursor-pointer"
                } ${enabled ? "border-info/30 bg-info/8" : "border-hairline hover:bg-raised"}`}
              >
                {!mouse && (
                  <span className="mt-px">
                    <Kbd keys={[s.key]} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-text">{s.name}</span>
                  <span className="mt-0.5 block text-meta text-muted">
                    {locked ? DEMO.saved.locked : s.simulates}
                  </span>
                  {/* Where to look, once it's on (keeps the panel inside the window). */}
                  {enabled && <span className="mt-0.5 block text-meta text-faint">{DEMO.youllSee(s.expect)}</span>}
                </span>
                <SwitchLook tone="info" className="mt-0.5" />
              </Switch.Root>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2.5">
        <span className="min-w-0">
          <span className="block text-body text-text">{DEMO.resetTitle}</span>
          <span className="mt-0.5 block text-meta text-muted">
            {checking ? DEMO.resetWait : DEMO.resetBody}
          </span>
        </span>
        <KeyButton keys={["O"]} label={DEMO.resetButton} icon={<ResetIcon />} disabled={checking} mouse={mouse} onClick={onReset} />
      </div>

      <footer className="mt-4 flex min-h-7 items-center justify-between gap-3 text-meta">
        <p role="status" className="text-muted">
          {checking ? DEMO.statusRunning : pending.length > 0 ? DEMO.statusPending : DEMO.statusIdle}
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <KeyButton
            keys={["R"]}
            label={checking ? DEMO.checkInProgress : DEMO.checkNow}
            icon={<CheckNowIcon />}
            tone={pending.length > 0 ? "primary" : "muted"}
            disabled={checking}
            mouse={mouse}
            onClick={onCheck}
          />
          <KeyButton keys={["Esc"]} label={DEMO.close} icon={<CloseIcon />} tone="faint" mouse={mouse} onClick={onClose} />
        </div>
      </footer>
    </Sheet>
  );
}

/** Footer reminder while any failure is simulated, so one is never left on by accident. */
export function SimulatingChip({ onClick }: { onClick: () => void }) {
  const on = useScenarios();
  const model = useModelDemo();
  const names = SCENARIOS.filter((s) => on.includes(s.id)).map((s) => s.short as string);
  if (model.drop) names.push(DEMO.drop.short);
  if (names.length === 0) return null;
  return (
    <Tip content={DEMO.simulatingTitle(names)} keys={["⌘", "⇧", "D"]}>
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className="press fade-in flex h-6 min-w-0 cursor-pointer items-center gap-1.5 truncate rounded-full border border-info/30 px-2.5 text-meta text-info hover:bg-info/10"
      >
        <span className="size-1.5 shrink-0 rounded-full bg-info" aria-hidden="true" />
        <span className="truncate">{DEMO.simulating(names[0], names.length - 1)}</span>
      </button>
    </Tip>
  );
}
