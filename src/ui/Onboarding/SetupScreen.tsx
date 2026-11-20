import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { ConnectorStatus } from "../../connectors";
import type { ConnectorId } from "../../connectors/types";
import { useLive } from "../../connectors/live";
import { switchToFallbackHotkey } from "../../lib/native";
import { SOURCES, connectNext, next, retrySource, runFirstCheck, type OnboardingState } from "../../lib/onboarding";
import { copy, plural } from "../../copy";
import { Kbd, KeyButton } from "../Kbd";
import { KeyText } from "../KeyText";
import { CheckNowIcon, NextIcon } from "../icons";
import { stateText, useTick } from "../Palette/StatusStrip";
import { ConnectorList, ICONS, type ConnectorRow } from "./ConnectorList";

// The onboarding screens that stand in for the palette's views: welcome and
// connect. The first check after them runs in the real palette (see
// Palette.tsx). The palette owns the keys; these screens only draw, and their
// buttons call the same actions as Enter and Cmd+Enter.

export function SetupScreen({
  onboarding,
  hotkey,
  onHotkey,
  mouse = false,
  desktop = isTauri(),
}: {
  onboarding: OnboardingState;
  hotkey: string[];
  /** Mouse mode: the next row's + drops its Enter key cap. */
  mouse?: boolean;
  /** The hotkey changed (after "Use ⌘⇧Space instead"). */
  onHotkey: (keys: string[]) => void;
  /** Drawn as in the desktop app (the gallery sets this to show the welcome's ⌘⇧Space link). */
  desktop?: boolean;
}) {
  switch (onboarding.step) {
    case "welcome":
      return <Welcome hotkey={hotkey} onHotkey={onHotkey} desktop={desktop} />;
    case "connect":
      return <Connect onboarding={onboarding} mouse={mouse} />;
    default:
      return null;
  }
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 font-mono text-[10.5px] tracking-[0.06em] text-faint uppercase">{children}</p>;
}

// ---------- 1. Welcome ----------

/** What Life does, and the key that opens it from any app. */
function Welcome({ hotkey, onHotkey, desktop }: { hotkey: string[]; onHotkey: (keys: string[]) => void; desktop: boolean }) {
  const [switching, setSwitching] = useState(false);
  const keys = hotkey.length ? hotkey : ["⌥", "Space"];
  // The desktop app couldn't register any shortcut: the menu bar icon is the way in.
  const noShortcut = hotkey.length === 0 && desktop;
  const canSwitch = desktop && keys.join("") === "⌥Space";
  return (
    <section className="fade-in flex flex-1 flex-col items-center justify-center px-10 text-center">
      <Eyebrow>{copy.onboarding.step(1)}</Eyebrow>
      <h1 className="text-[20px] font-medium tracking-[-0.02em]">{copy.onboarding.welcomeTitle}</h1>
      <p className="mt-2 max-w-[54ch] text-muted">{copy.onboarding.welcomeBody}</p>
      <div className="mt-7 flex w-[400px] flex-col items-center gap-1.5 rounded-xl border border-hairline bg-raised/60 px-5 py-4">
        {noShortcut ? (
          <p className="text-[13px] text-muted">{copy.onboarding.noShortcut}</p>
        ) : (
          <>
            <p className="text-[13px] text-text">
              <KeyText text={copy.onboarding.openWith} slots={{ keys: <PlusKeys keys={keys} /> }} />
            </p>
            <p className="text-[12px] text-faint">{copy.onboarding.menuBar}</p>
          </>
        )}
      </div>
      {canSwitch && (
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
          className="mt-2 cursor-pointer rounded-md px-2 py-1 text-[12px] text-faint hover:bg-raised hover:text-text"
        >
          <KeyText text={copy.onboarding.useFallback} />
        </button>
      )}
    </section>
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

// ---------- 2. Connect the real sources ----------

const SOURCE_ROWS: Record<ConnectorId, Omit<ConnectorRow, "state" | "id"> & { unit: readonly [string, string] }> = {
  bank: { ...copy.onboarding.sources.bank, icon: ICONS.Landmark },
  email: { ...copy.onboarding.sources.email, icon: ICONS.Mail },
  documents: { ...copy.onboarding.sources.documents, icon: ICONS.FolderOpen },
  calendar: { ...copy.onboarding.sources.calendar, icon: ICONS.CalendarDays },
};

/** More things people would connect. Off in this demo: the sample data has only the four above. Fictional brands. */
const MORE_ROWS: ConnectorRow[] = [
  { id: "ferro", ...copy.onboarding.more.ferro, icon: ICONS.Wallet, state: "disabled" },
  { id: "southerly", ...copy.onboarding.more.southerly, icon: ICONS.PiggyBank, state: "disabled" },
  { id: "kinbridge", ...copy.onboarding.more.kinbridge, icon: ICONS.HeartPulse, state: "disabled" },
  { id: "cloudnest", ...copy.onboarding.more.cloudnest, icon: ICONS.Cloud, state: "disabled" },
];

function countText(id: ConnectorId, status: ConnectorStatus): string {
  const [one, many] = SOURCE_ROWS[id].unit;
  return status.count === undefined ? copy.onboarding.connected : plural(status.count, one, many);
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
      note = status ? stateText(status, now) : copy.onboarding.connecting;
    } else if (failed) {
      state = "problem";
      note = status.state === "needs_reconnect" ? copy.onboarding.signedOut : copy.onboarding.couldntRead;
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
      fix: failed ? (status.state === "needs_reconnect" ? copy.onboarding.reconnect : copy.onboarding.tryAgain) : undefined,
    };
  });
  return (
    <section className="fade-in flex min-h-0 flex-1 flex-col items-center px-10 pt-6">
      <Eyebrow>{copy.onboarding.step(2)}</Eyebrow>
      <h1 className="text-center text-[20px] font-medium tracking-[-0.02em]">{copy.onboarding.connectTitle}</h1>
      <p className="mt-1.5 max-w-[60ch] text-center text-muted">{copy.onboarding.connectBody}</p>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-3">
        <ConnectorList
          rows={[...rows, ...MORE_ROWS]}
          mouse={mouse}
          onConnect={(id) => void connectNext(id as ConnectorId)}
          onFix={(id) => void retrySource(id as ConnectorId)}
        />
        <p className="mt-3 text-center text-[12px] text-faint">{copy.onboarding.connectNote}</p>
      </div>
    </section>
  );
}

// ---------- The setup screens' main button ----------

/** The footer's main button on each screen. Disabled until the screen's own step is done. */
export function primaryAction(onboarding: OnboardingState): { label: string; icon: React.ReactNode; disabled: boolean; keys: string[] } | undefined {
  switch (onboarding.step) {
    case "welcome":
      return { label: copy.onboarding.getStarted, icon: <NextIcon />, disabled: false, keys: ["↵"] };
    case "connect":
      // Connect at least one source first (each row's +, or Enter for the next one).
      return {
        label: copy.onboarding.runFirstCheck,
        icon: <CheckNowIcon />,
        disabled: onboarding.connected.length === 0 || !!onboarding.connecting,
        keys: ["⌘", "↵"],
      };
    default:
      return undefined;
  }
}

/** A setup screen's main action (Enter on welcome, ⌘↵ on connect), as a button for the footer. */
export function PrimaryButton({ onboarding, mouse }: { onboarding: OnboardingState; mouse: boolean }) {
  const primary = primaryAction(onboarding);
  if (!primary) return null;
  return (
    <KeyButton
      keys={primary.keys}
      label={primary.label}
      icon={primary.icon}
      tone="amber"
      mouse={mouse}
      disabled={primary.disabled}
      // On the connect step the button runs the check (Enter there connects the next source).
      onClick={onboarding.step === "connect" ? runFirstCheck : next}
    />
  );
}
