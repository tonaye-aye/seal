import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Check, Loader2 } from "lucide-react";
import type { ConnectorStatus } from "../../connectors";
import type { ConnectorId } from "../../connectors/types";
import { useLive } from "../../connectors/live";
import { switchToFallbackHotkey } from "../../lib/native";
import { SOURCES, connectNext, next, retrySource, setName, type OnboardingState } from "../../lib/onboarding";
import { useScan } from "../../lib/scan-store";
import { PRACTICE_PROVIDER } from "../../onboarding/practice";
import { Kbd } from "../Kbd";
import { CheckNowIcon, NextIcon } from "../icons";
import { TraceLines } from "../Palette/Trace";
import { stateText, useTick } from "../Palette/StatusStrip";
import { ConnectorList, ICONS, type ConnectorRow } from "./ConnectorList";
import { TrainingShader } from "./TrainingShader";

// The onboarding screens that stand in for the palette's views: welcome,
// summon, the practice connect and check, training complete and the real
// connect. The practice tour itself runs in the real palette views (see
// Palette.tsx). The palette owns the keys; these screens only draw, and their
// buttons call the same actions as Enter and Esc.

export function SetupScreen({
  onboarding,
  hotkey,
  onHotkey,
  mouse = false,
}: {
  onboarding: OnboardingState;
  hotkey: string[];
  /** Mouse mode: the next row's + drops its Enter key cap. */
  mouse?: boolean;
  /** The hotkey changed (after "Use ⌘⇧Space instead"). */
  onHotkey: (keys: string[]) => void;
}) {
  switch (onboarding.step) {
    case "welcome":
      return <Welcome name={onboarding.name} />;
    case "summon":
      return <Summon onboarding={onboarding} hotkey={hotkey} onHotkey={onHotkey} />;
    case "practice-connect":
      return <PracticeConnect onboarding={onboarding} mouse={mouse} />;
    case "practice-check":
      return <PracticeCheck found={onboarding.practiceFound} />;
    case "training-complete":
      return <TrainingComplete name={onboarding.name} />;
    case "connect":
      return <Connect onboarding={onboarding} mouse={mouse} />;
    default:
      return null;
  }
}

function Frame({ eyebrow, title, children }: { eyebrow?: string; title: string; children: React.ReactNode }) {
  return (
    <section className="fade-in flex flex-1 flex-col items-center justify-center px-10 text-center">
      {eyebrow && <p className="mb-2 font-mono text-[10.5px] tracking-[0.06em] text-faint uppercase">{eyebrow}</p>}
      <h1 className="text-[20px] font-medium tracking-[-0.02em]">{title}</h1>
      <div className="mt-2 flex max-w-[56ch] flex-col items-center text-muted">{children}</div>
    </section>
  );
}

/** A green tick and a short message: the step worked. Used by summon, connect and the practice check. */
export function Success({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div role="status" className="mt-6 flex flex-col items-center">
      <span className="tick-in grid size-11 place-items-center rounded-full border border-positive/40 bg-positive/10 text-positive">
        <Check size={22} strokeWidth={2.2} aria-hidden="true" />
      </span>
      <p className="mt-3 text-[15px] font-medium text-text">{title}</p>
      {children && <p className="mt-1 text-[13px] text-muted">{children}</p>}
    </div>
  );
}

// ---------- 1. Welcome ----------

function Welcome({ name }: { name: string }) {
  const input = useRef<HTMLInputElement>(null);
  // After the palette has taken focus on open, move it into the name field.
  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Frame eyebrow="Practice round" title="Hi, I'm Life">
      <p>I scan your data for mistakes or unwanted charges. I gather proof, draft a fix and you approve it!</p>
      <label className="mt-6 flex w-[320px] flex-col items-center gap-1.5 text-center text-[12px] text-faint">
        What should I call you?
        <input
          ref={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          spellCheck={false}
          className="h-9 w-full rounded-lg border border-hairline bg-raised px-3 text-center text-[14px] text-text outline-none focus:border-amber/50"
        />
      </label>
    </Frame>
  );
}

// ---------- 2. Summon ----------

function Summon({ onboarding, hotkey, onHotkey }: { onboarding: OnboardingState; hotkey: string[]; onHotkey: (keys: string[]) => void }) {
  const [switching, setSwitching] = useState(false);
  const keys = hotkey.length ? hotkey : ["⌥", "Space"];
  const optionSpace = keys.join("") === "⌥Space";

  if (hotkey.length === 0 && isTauri()) {
    return (
      <Frame eyebrow="Practice round" title="Open me from the menu bar">
        <p>The keyboard shortcut couldn't be set up on this Mac, so open me from the ring icon in the menu bar instead.</p>
      </Frame>
    );
  }
  if (onboarding.summon === "success") {
    return (
      <Frame eyebrow="Practice round" title="I live in your menu bar">
        <Success title="Success!">
          Nice. <Kbd keys={keys} /> is your shortcut from anywhere.
        </Success>
      </Frame>
    );
  }
  return (
    <Frame eyebrow="Practice round" title="I live in your menu bar">
      <p>
        Press <PlusKeys keys={keys} />. It's how you'll open and hide me from any app.
      </p>
      {!isTauri() && <p className="mt-2 text-[12px] text-faint">In this browser preview, pressing it here counts.</p>}
      {onboarding.summon === "trouble" && (
        <div role="status" className="fade-in mt-6 w-[420px] rounded-lg border border-amber/25 bg-amber-glow/30 px-4 py-3 text-left text-[12.5px]">
          <p className="text-text">Nothing happened?</p>
          <p className="mt-0.5 text-muted">
            Another app may already be using <Kbd keys={keys} /> (Raycast and Alfred often do). You can always open me from the ring
            icon in the menu bar too.
          </p>
          {optionSpace && isTauri() && (
            <button
              type="button"
              tabIndex={-1}
              disabled={switching}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSwitching(true);
                void switchToFallbackHotkey()
                  .then(onHotkey)
                  .finally(() => setSwitching(false));
              }}
              className="mt-2 cursor-pointer rounded-md px-2 py-1 text-amber hover:bg-amber-glow"
            >
              Use <Kbd keys={["⌘", "⇧", "Space"]} /> instead
            </button>
          )}
        </div>
      )}
    </Frame>
  );
}

/** A shortcut written out with plus signs, e.g. ⌥ + Space. */
function PlusKeys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {keys.map((k, i) => (
        <span key={k} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-faint">+</span>}
          <Kbd keys={[k]} />
        </span>
      ))}
    </span>
  );
}

// ---------- 3. Practice connect ----------

function PracticeConnect({ onboarding, mouse }: { onboarding: OnboardingState; mouse: boolean }) {
  const row: ConnectorRow = {
    id: "postbox",
    name: PRACTICE_PROVIDER,
    what: "Finds receipts and bills in your inbox",
    by: `${PRACTICE_PROVIDER} · practice, a made-up service`,
    icon: ICONS.Mail,
    state: onboarding.practiceConnect === "ok" ? "connected" : onboarding.practiceConnect === "connecting" ? "connecting" : "idle",
    next: onboarding.practiceConnect === "idle",
  };
  return (
    <Frame eyebrow="Practice round" title="Connect your data">
      <p>Connect to email, let's pretend.</p>
      <div className="mt-6">
        <ConnectorList rows={[row]} mouse={mouse} onConnect={() => next()} />
      </div>
      {onboarding.practiceConnect === "ok" && <Success title="Success!">{PRACTICE_PROVIDER} is connected. Continue to check it.</Success>}
    </Frame>
  );
}

// ---------- 4. Practice check ----------

function PracticeCheck({ found }: { found: boolean }) {
  const scan = useScan();
  return (
    <section className="flex min-h-0 flex-1 flex-col px-4 pt-6">
      <div className="mb-4 flex items-center gap-3">
        {found ? (
          <span className="grid size-8 place-items-center rounded-full border border-positive/40 text-positive" aria-hidden="true">
            <Check size={16} strokeWidth={2} />
          </span>
        ) : (
          <span className="scan-ring size-8 rounded-full border border-amber/40" aria-hidden="true" />
        )}
        <div>
          <h1 className="text-[17px] font-medium tracking-[-0.015em]">{found ? "Checked your practice inbox" : "Checking your practice inbox"}</h1>
          <p className="text-[12.5px] text-muted">A made-up example: no model calls, nothing real is read.</p>
        </div>
      </div>
      <div className="min-h-0 pl-1">
        <TraceLines lines={scan.trace} limit={9} />
      </div>
      {found && (
        <div className="flex flex-1 flex-col items-center justify-center pb-10">
          <Success title="Found one!">It's waiting for you in the list.</Success>
        </div>
      )}
    </section>
  );
}

// ---------- 5. Training complete ----------

function TrainingComplete({ name }: { name: string }) {
  return (
    <section className="fade-in flex flex-1 flex-col items-center justify-center px-10 text-center">
      <TrainingShader />
      <p className="-mt-3 font-mono text-[10.5px] tracking-[0.06em] text-positive uppercase">Training complete</p>
      <h1 className="mt-1 text-[20px] font-medium tracking-[-0.02em]">You're all set{name.trim() ? `, ${name.trim()}` : ""}</h1>
      <p className="mt-1.5 max-w-[52ch] text-muted">That was practice, now for the real thing.</p>
    </section>
  );
}

// ---------- 6. Connect the real sources ----------

const SOURCE_ROWS: Record<ConnectorId, Omit<ConnectorRow, "state" | "id"> & { unit: [string, string] }> = {
  bank: { name: "Harbour Bank", what: "Your joint everyday account and Visa card", by: "Harbour Bank", icon: ICONS.Landmark, unit: ["transaction", "transactions"] },
  email: { name: "Mailbox", what: "Your inbox and the shared home address", by: "your email provider", icon: ICONS.Mail, unit: ["email", "emails"] },
  documents: { name: "Household Admin folder", what: "Bills, agreements and receipts you've saved", by: "your files", icon: ICONS.FolderOpen, unit: ["document", "documents"] },
  calendar: { name: "Family calendar", what: "Renewals, reminders and appointments", by: "your calendar", icon: ICONS.CalendarDays, unit: ["event", "events"] },
};

/** More things people would connect. Off in this demo: the sample data has only the four above. Fictional brands. */
const MORE_ROWS: ConnectorRow[] = [
  { id: "ferro", name: "Ferro Credit Union", what: "A second bank account", by: "Ferro Credit Union", icon: ICONS.Wallet, state: "disabled" },
  { id: "southerly", name: "Southerly Super", what: "Statements and fees from your super fund", by: "Southerly Super", icon: ICONS.PiggyBank, state: "disabled" },
  { id: "kinbridge", name: "Kinbridge Health", what: "Health cover renewals and claims", by: "Kinbridge Health", icon: ICONS.HeartPulse, state: "disabled" },
  { id: "cloudnest", name: "Cloudnest Drive", what: "Documents stored in the cloud", by: "Cloudnest", icon: ICONS.Cloud, state: "disabled" },
];

function countText(id: ConnectorId, status: ConnectorStatus): string {
  const [one, many] = SOURCE_ROWS[id].unit;
  return status.count === undefined ? "Connected" : `${status.count} ${status.count === 1 ? one : many}`;
}

function Connect({ onboarding, mouse }: { onboarding: OnboardingState; mouse: boolean }) {
  const live = useLive();
  const now = useTick(Object.values(live.statuses).some((s) => s?.state === "retrying"));
  const nextId = SOURCES.find((s) => !onboarding.connected.includes(s));
  const rows: ConnectorRow[] = SOURCES.map((id) => {
    const status = live.statuses[id];
    const busy = onboarding.connecting === id;
    const done = onboarding.connected.includes(id);
    const failed = status && (status.state === "needs_reconnect" || status.state === "error");
    const { unit: _unit, ...text } = SOURCE_ROWS[id];
    let state: ConnectorRow["state"] = "idle";
    let note: string | undefined;
    if (busy) {
      state = "connecting";
      note = status ? stateText(status, now) : "Connecting";
    } else if (failed) {
      state = "problem";
      note = status.state === "needs_reconnect" ? "Signed out" : "Couldn't read";
    } else if (done && status) {
      state = "connected";
      note = countText(id, status);
    }
    return {
      id,
      ...text,
      state,
      note,
      next: id === nextId && !onboarding.connecting,
      fix: failed ? (status.state === "needs_reconnect" ? "Reconnect" : "Try again") : undefined,
    };
  });
  return (
    <section className="fade-in flex min-h-0 flex-1 flex-col items-center px-10 pt-6">
      <h1 className="text-center text-[20px] font-medium tracking-[-0.02em]">Connect your data</h1>
      <p className="mt-1.5 max-w-[60ch] text-center text-muted">
        I can only read, and save drafts in your email. I can't send, cancel or pay for anything.
      </p>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-3">
        <ConnectorList
          rows={[...rows, ...MORE_ROWS]}
          mouse={mouse}
          onConnect={(id) => void connectNext(id as ConnectorId)}
          onFix={(id) => void retrySource(id as ConnectorId)}
        />
        <p className="mt-3 text-center text-[12px] text-faint">Demo connectors over sample data. No sign-in needed.</p>
      </div>
    </section>
  );
}

// ---------- The bar under the setup screens ----------

/** The bottom bar's main button on each screen (Enter does the same). Disabled until the screen's own step is done. */
export function primaryAction(
  onboarding: OnboardingState,
): { label: string; icon: React.ReactNode; disabled?: boolean; keys: string[]; busy?: boolean } | undefined {
  const go = (label: string, icon: React.ReactNode = <NextIcon />, disabled = false, keys = ["↵"]) => ({ label, icon, disabled, keys });
  switch (onboarding.step) {
    case "welcome":
      // A name is needed first.
      return go("Get started", <NextIcon />, !onboarding.name.trim());
    case "summon":
      return onboarding.summon === "success" ? go("Continue") : onboarding.summon === "trouble" ? go("Continue anyway") : undefined;
    case "practice-connect":
      // Connect with the row's + first (Enter presses it too).
      return go("Continue", <NextIcon />, onboarding.practiceConnect !== "ok");
    case "practice-check":
      return onboarding.practiceFound
        ? go("See items")
        : { ...go("Scanning", <Loader2 size={14} strokeWidth={1.75} className="motion-safe:animate-spin" aria-hidden="true" />, true), busy: true };
    case "training-complete":
      return go("Connect your data");
    case "connect":
      // Connect at least one source first (each row's +, or Enter for the next one).
      return go("Run my first check", <CheckNowIcon />, onboarding.connected.length === 0 || !!onboarding.connecting, ["⌘", "↵"]);
    default:
      return undefined;
  }
}
