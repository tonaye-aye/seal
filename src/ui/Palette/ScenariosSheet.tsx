import type { ScenarioId } from "../../connectors";
import { toggleScenario, useLive, useScenarios } from "../../connectors/live";
import { useScan } from "../../lib/scan-store";
import { CheckNowIcon, CloseIcon, ResetIcon } from "../icons";
import { Kbd, KeyButton } from "../Kbd";

// The hidden demo panel (Cmd+Shift+D): switches that make the fake connectors
// fail the way real ones do, so the demo can show how the app copes. Nothing
// here is real: the connectors are demo connectors over seed data.

export const SCENARIOS: { id: ScenarioId; key: string; name: string; short: string; simulates: string; expect: string }[] = [
  {
    id: "calendar_reauth",
    key: "1",
    name: "Calendar sign-in expires",
    short: "Calendar signed out",
    simulates: "Every calendar call fails with 401, like an expired token.",
    expect: "Connectors at the bottom turns red with a 1 (open it for Reconnect), and the findings list says the calendar couldn't be read. Press R again to reconnect.",
  },
  {
    id: "bank_rate_limit",
    key: "2",
    name: "Bank rate limit",
    short: "Bank rate limit",
    simulates: "Every 4th transactions call is refused with 429, asking to wait 3 seconds.",
    expect: 'once per check, Connectors at the bottom counts down "Retrying in 3s" and the checking screen says the bank asked us to slow down. It carries on by itself.',
  },
  {
    id: "slow_documents",
    key: "3",
    name: "Slow documents",
    short: "Slow documents",
    simulates: "Each document read takes 4 to 6 seconds.",
    expect: "for about 15 s while documents are read, a loading card under the steps on the checking screen; Connectors at the bottom stays amber, and its menu says Documents are slow to respond.",
  },
];

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
  const { pending } = useLive();
  const scan = useScan();
  const checking = scan.phase === "scanning" || scan.refreshing;

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-bg/70 backdrop-blur-sm" onClick={onClose}>
      <section
        role="dialog"
        aria-label="Simulate connector failures"
        className="sheet-in w-[560px] rounded-xl border border-hairline bg-surface p-5 shadow-[0_16px_48px_rgb(0_0_0/0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-medium tracking-[-0.01em]">Simulate connector failures</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              For demos. These are demo connectors over seed data, so nothing real breaks. Switches stay on until you turn them off.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-amber/30 px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] text-amber uppercase">
            Demo
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
                    <span className="mt-0.5 block text-[12px] text-faint">You'll see: {s.expect}</span>
                  </span>
                  <Switch on={enabled} />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-[13px] text-text">Start onboarding again</span>
            <span className="mt-0.5 block text-[12px] text-muted">
              {checking
                ? "Wait for the check to finish first."
                : "Forgets decisions, results and connections, then shows the welcome. Simulated failures stay as they are."}
            </span>
          </span>
          <KeyButton keys={["O"]} label="Reset onboarding" icon={<ResetIcon />} disabled={checking} mouse={mouse} onClick={onReset} />
        </div>

        <footer className="mt-4 flex min-h-7 items-center justify-between gap-3 text-[12px]">
          <p role="status" className="text-muted">
            {checking
              ? "A check is running. Changes may not show until the next one."
              : pending.length > 0
                ? "Shows up on the next check. Check now closes this so you can watch."
                : "The next check uses these settings."}
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <KeyButton
              keys={["R"]}
              label={checking ? "Check in progress" : "Check now"}
              icon={<CheckNowIcon />}
              tone={pending.length > 0 ? "amber" : "muted"}
              disabled={checking}
              mouse={mouse}
              onClick={onCheck}
            />
            <KeyButton keys={["Esc"]} label="Close" icon={<CloseIcon />} tone="faint" mouse={mouse} onClick={onClose} />
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
  if (on.length === 0) return null;
  const names = SCENARIOS.filter((s) => on.includes(s.id)).map((s) => s.short);
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={`Simulating: ${names.join(", ")}. Click to change.`}
      className="fade-in flex h-6 min-w-0 cursor-pointer items-center gap-1.5 truncate rounded-full border border-amber/30 px-2.5 text-[11.5px] text-amber hover:bg-amber-glow/20"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-amber" aria-hidden="true" />
      <span className="truncate">
        Simulating: {names[0]}
        {names.length > 1 && ` +${names.length - 1}`}
      </span>
    </button>
  );
}
