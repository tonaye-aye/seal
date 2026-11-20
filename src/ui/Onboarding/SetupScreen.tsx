import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { ConnectorStatus } from "../../connectors";
import type { ConnectorId } from "../../connectors/types";
import { useLive } from "../../connectors/live";
import { switchToFallbackHotkey } from "../../lib/native";
import { SOURCES, connectNext, next, retrySource, runFirstCheck, type OnboardingState } from "../../lib/onboarding";
import { Kbd, KeyButton } from "../Kbd";
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
      <Eyebrow>Step 1 of 3</Eyebrow>
      <h1 className="text-[20px] font-medium tracking-[-0.02em]">Hi, I'm Life</h1>
      <p className="mt-2 max-w-[54ch] text-muted">
        Once a month I look through your bank, email, documents and calendar for charges that are wrong or unwanted. I gather the
        proof and draft the fix, and you approve it. I never send, cancel or pay for anything.
      </p>
      <div className="mt-7 flex w-[400px] flex-col items-center gap-1.5 rounded-xl border border-hairline bg-raised/60 px-5 py-4">
        {noShortcut ? (
          <p className="text-[13px] text-muted">
            The keyboard shortcut couldn't be set up on this Mac, so open me from the ring icon in the menu bar.
          </p>
        ) : (
          <>
            <p className="text-[13px] text-text">
              Open and hide me from any app with <PlusKeys keys={keys} />
            </p>
            <p className="text-[12px] text-faint">I also live in the menu bar.</p>
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
          Taken by another app? Use <Kbd keys={["⌘", "⇧", "Space"]} /> instead
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
      <Eyebrow>Step 2 of 3</Eyebrow>
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

// ---------- The setup screens' main button ----------

/** The footer's main button on each screen. Disabled until the screen's own step is done. */
export function primaryAction(onboarding: OnboardingState): { label: string; icon: React.ReactNode; disabled: boolean; keys: string[] } | undefined {
  switch (onboarding.step) {
    case "welcome":
      return { label: "Get started", icon: <NextIcon />, disabled: false, keys: ["↵"] };
    case "connect":
      // Connect at least one source first (each row's +, or Enter for the next one).
      return {
        label: "Run my first check",
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
