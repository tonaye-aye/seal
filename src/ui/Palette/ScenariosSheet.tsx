import type { ScenarioId } from "../../connectors";
import { toggleScenario, useLive, useScenarios } from "../../connectors/live";
import { DROP_AFTER, toggleDrop, toggleSavedOnly, useModelDemo } from "../../lib/endpoint";
import { useScan } from "../../lib/scan-store";
import { CheckNowIcon, CloseIcon, ResetIcon } from "../icons";
import { copy } from "../../copy";
import { Kbd, KeyButton } from "../Kbd";

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
  mouse,
  onClose,
  onCheck,
  onReset,
}: {
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

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-bg/70 backdrop-blur-sm" onClick={onClose}>
      <section
        role="dialog"
        aria-label={DEMO.label}
        className="sheet-in max-h-[calc(100%-32px)] w-[640px] overflow-y-auto rounded-xl border border-hairline bg-surface p-5 shadow-[0_16px_48px_rgb(0_0_0/0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-medium tracking-[-0.01em]">{DEMO.title}</h2>
            <p className="mt-0.5 text-[12px] text-muted">{DEMO.intro}</p>
          </div>
          <span className="shrink-0 rounded-full border border-amber/30 px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] text-amber uppercase">
            {DEMO.badge}
          </span>
        </header>

        <ul className="flex flex-col gap-1.5">
          {SCENARIOS.map((s) => {
            const enabled = on.includes(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  tabIndex={-1}
                  // Keep keyboard focus on the palette, so the keys keep working after a click.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggleScenario(s.id)}
                  className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-(--duration-fast) ${
                    enabled ? "border-amber/30 bg-amber-glow/20" : "border-hairline hover:bg-raised"
                  }`}
                >
                  {!mouse && (
                    <span className="mt-px">
                      <Kbd keys={[s.key]} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-text">{s.name}</span>
                    <span className="mt-0.5 block text-[12px] text-muted">{s.simulates}</span>
                    {/* Where to look, once it's on (keeps the panel inside the window). */}
                    {enabled && <span className="mt-0.5 block text-[12px] text-faint">{DEMO.youllSee(s.expect)}</span>}
                  </span>
                  <Switch on={enabled} />
                </button>
              </li>
            );
          })}
        </ul>

        <h3 className="mt-3 mb-1.5 font-mono text-[10.5px] tracking-[0.06em] text-faint uppercase">{DEMO.modelTitle}</h3>
        <ul className="flex flex-col gap-1.5">
          {MODEL_SWITCHES.map((s) => {
            const enabled = s.id === "saved" ? model.saved || model.byFlag : model.drop;
            const locked = s.id === "saved" && model.byFlag;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-disabled={locked}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (locked ? undefined : s.id === "saved" ? toggleSavedOnly() : toggleDrop())}
                  className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-(--duration-fast) ${
                    locked ? "cursor-default" : "cursor-pointer"
                  } ${enabled ? "border-amber/30 bg-amber-glow/20" : "border-hairline hover:bg-raised"}`}
                >
                  {!mouse && (
                    <span className="mt-px">
                      <Kbd keys={[s.key]} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-text">{s.name}</span>
                    <span className="mt-0.5 block text-[12px] text-muted">
                      {locked ? DEMO.saved.locked : s.simulates}
                    </span>
                    {/* Where to look, once it's on (keeps the panel inside the window). */}
                    {enabled && <span className="mt-0.5 block text-[12px] text-faint">{DEMO.youllSee(s.expect)}</span>}
                  </span>
                  <Switch on={enabled} />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-[13px] text-text">{DEMO.resetTitle}</span>
            <span className="mt-0.5 block text-[12px] text-muted">
              {checking ? DEMO.resetWait : DEMO.resetBody}
            </span>
          </span>
          <KeyButton keys={["O"]} label={DEMO.resetButton} icon={<ResetIcon />} disabled={checking} mouse={mouse} onClick={onReset} />
        </div>

        <footer className="mt-4 flex min-h-7 items-center justify-between gap-3 text-[12px]">
          <p role="status" className="text-muted">
            {checking ? DEMO.statusRunning : pending.length > 0 ? DEMO.statusPending : DEMO.statusIdle}
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <KeyButton
              keys={["R"]}
              label={checking ? DEMO.checkInProgress : DEMO.checkNow}
              icon={<CheckNowIcon />}
              tone={pending.length > 0 ? "amber" : "muted"}
              disabled={checking}
              mouse={mouse}
              onClick={onCheck}
            />
            <KeyButton keys={["Esc"]} label={DEMO.close} icon={<CloseIcon />} tone="faint" mouse={mouse} onClick={onClose} />
          </div>
        </footer>
      </section>
    </div>
  );
}

/** A small on/off switch drawn from the tokens. The row around it is the real control. */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative mt-0.5 h-[18px] w-[30px] shrink-0 rounded-full border transition-colors duration-(--duration-fast) ${
        on ? "border-amber/60 bg-amber/80" : "border-hairline bg-raised"
      }`}
    >
      <span
        className={`absolute top-[2px] left-[2px] size-3 rounded-full transition-transform duration-(--duration-fast) ease-out ${
          on ? "translate-x-3 bg-bg" : "bg-muted"
        }`}
      />
    </span>
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
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={DEMO.simulatingTitle(names)}
      className="fade-in flex h-6 min-w-0 cursor-pointer items-center gap-1.5 truncate rounded-full border border-amber/30 px-2.5 text-[11.5px] text-amber hover:bg-amber-glow/20"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-amber" aria-hidden="true" />
      <span className="truncate">{DEMO.simulating(names[0], names.length - 1)}</span>
    </button>
  );
}
