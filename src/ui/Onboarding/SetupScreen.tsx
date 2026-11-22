import { useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Check } from "lucide-react";
import type { ConnectorStatus } from "../../connectors";
import type { ConnectorId } from "../../connectors/types";
import { useLive } from "../../connectors/live";
import { chooseHotkey } from "../../lib/native";
import { SOURCES, connectNext, finishOnboarding, next, retestSummon, retrySource, runFirstCheck, type OnboardingState } from "../../lib/onboarding";
import { rankedFindings, useScan } from "../../lib/scan-store";
import { copy, plural } from "../../copy";
import { Kbd, KeyButton } from "../Kbd";
import { KeyText } from "../KeyText";
import { useScrollFade } from "../motion";
import { CheckNowIcon, NextIcon, ResetIcon } from "../icons";
import { CheckProgress } from "../CheckProgress";
import { stateText, useTick } from "../Palette/StatusStrip";
import { ConnectorList, MORE_ROWS, SOURCE_ROWS, type ConnectorRow } from "./ConnectorList";
import { OnboardingCta } from "./OnboardingCta";
import { SealAnimation } from "./SealAnimation";

// The three onboarding steps: welcome (press the summon key), connect, and the
// first check. They fill the palette with no rail or bottom bar. The palette
// owns the keys; these screens only draw, and each step's big button calls the
// same action as its key.

export function SetupScreen({
  onboarding,
  hotkey,
  hotkeyReady = true,
  onHotkey,
  mouse = false,
  desktop = isTauri(),
  agentOpen = false,
  onAgentOpen = () => {},
  sealFallback = false,
}: {
  onboarding: OnboardingState;
  hotkey: string[];
  /** False until the app has said which key registered. */
  hotkeyReady?: boolean;
  /** Mouse mode: buttons show icons instead of key caps. */
  mouse?: boolean;
  /** The hotkey changed (after "Use ⌘⇧Space instead"). */
  onHotkey: (keys: string[]) => void;
  /** Drawn as in the desktop app (the gallery sets this to show the welcome's ⌘⇧Space link). */
  desktop?: boolean;
  /** Step 3: the "Agent working" fold is open (T, or a click). */
  agentOpen?: boolean;
  onAgentOpen?: (open: boolean) => void;
  /** The dev gallery only: draw the plain seal instead of the animation. */
  sealFallback?: boolean;
}) {
  switch (onboarding.step) {
    case "welcome":
      return <Welcome onboarding={onboarding} hotkey={hotkey} hotkeyReady={hotkeyReady} onHotkey={onHotkey} mouse={mouse} desktop={desktop} />;
    case "connect":
      return <Connect onboarding={onboarding} mouse={mouse} />;
    case "first-scan":
      return <FirstCheck mouse={mouse} agentOpen={agentOpen} onAgentOpen={onAgentOpen} sealFallback={sealFallback} />;
    default:
      return null;
  }
}

/**
 * Step 1's button stays locked until the summon key has been pressed. If the
 * app couldn't register any key there is nothing to press, so it never blocks.
 */
export function welcomeLocked(onboarding: OnboardingState, hotkey: string[], hotkeyReady: boolean, desktop = isTauri()): boolean {
  if (onboarding.summoned) return false;
  if (!hotkeyReady) return true;
  return !(desktop && hotkey.length === 0);
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 label text-faint">{children}</p>;
}

// ---------- 1. Welcome ----------

/** What Seal does, and the key that opens it, pressed once to prove it. */
function Welcome({
  onboarding,
  hotkey,
  hotkeyReady,
  onHotkey,
  mouse,
  desktop,
}: {
  onboarding: OnboardingState;
  hotkey: string[];
  hotkeyReady: boolean;
  onHotkey: (keys: string[]) => void;
  mouse: boolean;
  desktop: boolean;
}) {
  const [switching, setSwitching] = useState(false);
  const keys = hotkey.length ? hotkey : ["⌥", "Space"];
  // The desktop app couldn't register any shortcut: the menu bar icon is the way in.
  const noShortcut = hotkeyReady && hotkey.length === 0 && desktop;
  // Either key can be taken by another app, so the link always offers the other one.
  const onFallback = keys.join("") === "⌘⇧Space";
  const locked = welcomeLocked(onboarding, hotkey, hotkeyReady, desktop);
  return (
    <section className="fade-in flex flex-1 flex-col items-center justify-center px-10 pb-12 text-center">
      <Eyebrow>{copy.onboarding.step(1)}</Eyebrow>
      <h1 className="heading text-hero font-semibold">{copy.onboarding.welcomeTitle}</h1>
      <p className="mt-3 max-w-[54ch] text-lead text-muted">{copy.onboarding.welcomeBody}</p>
      <div className="mt-12 flex w-[480px] flex-col items-center rounded-xl border border-hairline bg-raised/60 px-5 py-6">
        {noShortcut ? (
          <p className="text-body text-muted">{copy.onboarding.noShortcut}</p>
        ) : (
          <>
            {/* The same line before and after the key is pressed, so nothing moves when it unlocks. */}
            <p role="status" className="flex min-h-8 items-center gap-2 text-lead text-text">
              {!locked && <Check size={18} strokeWidth={2} aria-hidden="true" className="tick-in shrink-0 text-positive" />}
              <span>
                <KeyText text={locked ? copy.onboarding.openWith : copy.onboarding.provedIt} slots={{ keys: <PlusKeys keys={keys} /> }} />
              </span>
            </p>
          </>
        )}
      </div>
      {desktop && (
        <button
          type="button"
          tabIndex={-1}
          disabled={switching}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setSwitching(true);
            void chooseHotkey(!onFallback)
              .then((next) => {
                onHotkey(next);
                // A new key has to be pressed for itself.
                retestSummon();
              })
              .finally(() => setSwitching(false));
          }}
          className="mt-2 cursor-pointer rounded-md px-2 py-1 text-meta text-faint hover:bg-raised hover:text-text"
        >
          <KeyText text={onFallback ? copy.onboarding.useDefault : copy.onboarding.useFallback} />
        </button>
      )}
      <div className="mt-8 w-[480px]">
        <OnboardingCta keys={["↵"]} label={copy.onboarding.getStarted} icon={<NextIcon />} disabled={locked} mouse={mouse} onClick={next} />
      </div>
      {/* Another app can hold both shortcuts, so this step must never trap anyone. The
          space stays when it goes, so nothing moves as the button unlocks. */}
      <div className="mt-1.5 flex h-7 items-center text-meta">
        {locked && <KeyButton keys={["⌘", "↵"]} label={copy.onboarding.skipShortcut} icon={<NextIcon />} tone="faint" mouse={mouse} onClick={next} />}
      </div>
    </section>
  );
}

/** A shortcut written out with plus signs, e.g. ⌥ + Space. */
function PlusKeys({ keys }: { keys: string[] }) {
  return (
    <span className="mx-0.5 inline-flex items-center gap-1.5 align-middle">
      {keys.map((k, i) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-faint">+</span>}
          <Kbd keys={[k]} large />
        </span>
      ))}
    </span>
  );
}

// ---------- 2. Connect the real sources ----------

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
  const count = onboarding.connected.length;
  const list = useRef<HTMLDivElement>(null);
  useScrollFade(list);
  return (
    <section className="fade-in flex min-h-0 flex-1 flex-col items-center px-10 pt-5">
      <Eyebrow>{copy.onboarding.step(2)}</Eyebrow>
      <h1 className="text-center heading text-hero font-semibold">{copy.onboarding.connectTitle}</h1>
      <p className="mt-3 max-w-[84ch] text-center text-lead text-muted">{copy.onboarding.connectBody}</p>
      {/* Two columns: the list scrolls on the left, the next step stays put on the right. */}
      <div className="mt-10 grid min-h-0 w-full max-w-[880px] flex-1 grid-cols-[minmax(0,1fr)_288px] gap-5">
        <div ref={list} className="scroll-fade min-h-0 overflow-y-auto pb-6">
          <ConnectorList
            rows={[...rows, ...MORE_ROWS]}
            mouse={mouse}
            onConnect={(id) => void connectNext(id as ConnectorId)}
            onFix={(id) => void retrySource(id as ConnectorId)}
          />
        </div>
        <aside className="flex h-fit flex-col gap-3 rounded-xl border border-hairline bg-raised/60 p-4">
          <p className="heading text-title font-semibold tabular">{copy.onboarding.connectedCount(count, SOURCES.length)}</p>
          <div className="grid grid-cols-4 gap-1" aria-hidden="true">
            {SOURCES.map((id, i) => (
              <span key={id} className={`h-1 rounded-full transition-colors duration-(--duration-base) ${i < count ? "bg-positive" : "bg-hairline"}`} />
            ))}
          </div>
          <p className="min-h-[38px] text-small text-muted">{count ? copy.onboarding.readyToCheck : copy.onboarding.connectFirst}</p>
          <OnboardingCta
            keys={["⌘", "↵"]}
            label={copy.onboarding.runFirstCheck}
            icon={<CheckNowIcon />}
            // Connect at least one source first (each row's +, or Enter for the next one).
            disabled={count === 0 || !!onboarding.connecting}
            mouse={mouse}
            onClick={runFirstCheck}
          />
        </aside>
      </div>
    </section>
  );
}

// ---------- 3. The first check ----------

/**
 * The first real check: the seal, the button, and the agent's live steps
 * folded away under it. View findings unlocks when the check finishes. If it
 * doesn't finish, the button tries again and a quiet link carries on, so this
 * step can never trap anyone.
 */
function FirstCheck({
  mouse,
  agentOpen,
  onAgentOpen,
  sealFallback,
}: {
  mouse: boolean;
  agentOpen: boolean;
  onAgentOpen: (open: boolean) => void;
  sealFallback: boolean;
}) {
  const scan = useScan();
  const failed = scan.phase === "error";
  const done = scan.phase === "done";
  const found = rankedFindings(scan).length;
  const title = failed ? copy.onboarding.checkFailedTitle : done ? copy.onboarding.checkDoneTitle : copy.onboarding.checkTitle;
  // The reason is in the agent's steps. scan.error's own wording points at R, which this step doesn't use.
  const body = failed ? copy.onboarding.checkFailedBody : done ? copy.onboarding.checkDoneBody(found) : copy.onboarding.checkBody;
  return (
    <section className="fade-in flex flex-1 flex-col items-center justify-center px-10 pb-20 text-center">
      <Eyebrow>{copy.onboarding.step(3)}</Eyebrow>
      {/* The app is unselectable by default, like a native one. This step's words can be highlighted. */}
      <h1 className="heading text-hero font-semibold select-text" aria-live="polite">
        {title}
      </h1>
      <p className="mt-3 max-w-[72ch] text-lead text-muted select-text">{body}</p>
      <div className="mt-8">
        <SealAnimation fallback={sealFallback} />
      </div>
      <div className="mt-8 flex w-[480px] items-center gap-3 text-small">
        {failed ? (
          <>
            <div className="min-w-0 flex-1">
              <OnboardingCta keys={["↵"]} label={copy.onboarding.tryCheckAgain} icon={<ResetIcon />} mouse={mouse} onClick={next} />
            </div>
            <KeyButton keys={["⌘", "↵"]} label={copy.onboarding.carryOn} icon={<NextIcon />} mouse={mouse} onClick={finishOnboarding} />
          </>
        ) : (
          <OnboardingCta keys={["↵"]} label={copy.onboarding.viewFindings} icon={<NextIcon />} disabled={!done} mouse={mouse} onClick={next} />
        )}
      </div>
      <CheckProgress open={agentOpen} onOpen={onAgentOpen} mouse={mouse} />
    </section>
  );
}
