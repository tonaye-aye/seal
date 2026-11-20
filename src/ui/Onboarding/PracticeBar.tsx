import { Check } from "lucide-react";
import { CHAPTERS, chapterPlace, next, runFirstCheck, skip, type OnboardingState } from "../../lib/onboarding";
import { KeyButton } from "../Kbd";
import { SkipIcon } from "../icons";
import { primaryAction } from "./SetupScreen";

// The one bar at the bottom of the palette during the practice round, in
// place of the footer. On the setup screens: Skip practice on the left, the
// screen's action on the right. During the tour: Skip practice on the left
// and the four chapters on the right (Next lives in each tip's tooltip). It
// sits above the spotlight's dimming (data-coach-strip), so it stays readable
// and clickable.

export function PracticeBar({ onboarding, mouse }: { onboarding: OnboardingState; mouse: boolean }) {
  if (onboarding.step !== "practice") {
    return (
      <div className="flex h-10 shrink-0 items-center justify-between border-t border-hairline px-4 text-[12px]">
        <KeyButton keys={["Esc"]} label="Skip practice" icon={<SkipIcon />} tone="faint" mouse={mouse} onClick={skip} />
        <PrimaryButton onboarding={onboarding} mouse={mouse} />
      </div>
    );
  }

  const place = chapterPlace(onboarding.tip);
  const current = CHAPTERS.indexOf(place.chapter);
  return (
    <div
      data-coach-strip
      className="relative z-40 flex h-10 shrink-0 items-center justify-between border-t border-hairline bg-bg/80 px-4 text-[12px]"
    >
      {/* Esc is locked during the tour, so this one is a plain button. */}
      <KeyButton keys={["Esc"]} label="Skip practice" icon={<SkipIcon />} tone="faint" mouse onClick={skip} />
      <ol className="flex items-center gap-3.5" aria-label="Practice chapters">
        {CHAPTERS.map((chapter, i) => {
          const done = i < current;
          const now = i === current;
          return (
            <li
              key={chapter}
              className={`flex items-center gap-1.5 ${now ? "text-text" : done ? "text-positive" : "text-faint"}`}
              aria-current={now ? "step" : undefined}
            >
              {done ? (
                <span className="tick-in grid size-3.5 place-items-center rounded-full bg-positive/20" aria-hidden="true">
                  <Check size={10} strokeWidth={3} />
                </span>
              ) : (
                <span className={`size-2 rounded-full ${now ? "bg-amber" : "border border-faint"}`} aria-hidden="true" />
              )}
              {chapter}
              {now && (
                <span className="font-mono text-[10.5px] text-muted tabular">
                  {place.index}/{place.of}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * A setup screen's main action (Enter, or ⌘↵ for Run my first check), as a
 * button for the bottom bar. A busy one (the practice check) shows a spinner
 * and its words, and can't be pressed.
 */
export function PrimaryButton({ onboarding, mouse }: { onboarding: OnboardingState; mouse: boolean }) {
  const primary = primaryAction(onboarding);
  if (!primary) return null;
  if (primary.busy) {
    return (
      <span className="inline-flex items-center gap-1.5 leading-none text-faint" role="status">
        <span className="grid size-4 place-items-center [&>svg]:block">{primary.icon}</span>
        {primary.label}
      </span>
    );
  }
  return (
    <KeyButton
      keys={primary.keys}
      label={primary.label}
      icon={primary.icon}
      tone="amber"
      mouse={mouse}
      disabled={primary.disabled}
      // On the real connect step the button runs the check (Enter there connects the next source).
      onClick={onboarding.step === "connect" ? runFirstCheck : next}
    />
  );
}
