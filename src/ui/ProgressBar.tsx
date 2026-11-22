import type { CSSProperties, ReactNode } from "react";
import { copy } from "../copy";

// The app's one loading bar: a violet fill with a grainy texture. With a
// percentage it shows real progress, and the number sits beside the fill. With
// no percentage it moves without one, for waits that can't honestly be measured.

export function ProgressBar({
  percent,
  label,
  stopped = false,
  end,
  still = false,
  className = "",
}: {
  /** How far along, 0 to 100. Left out when there is no honest number. */
  percent?: number;
  /** What it is measuring, for screen readers. */
  label: string;
  /** The work ended early: the fill stays where it got to and turns grey. */
  stopped?: boolean;
  /** Shown in the number's place (an icon when the check failed). */
  end?: ReactNode;
  /** Dev gallery only: draw it as "reduce motion" does. */
  still?: boolean;
  className?: string;
}) {
  const value = percent === undefined ? undefined : Math.max(0, Math.min(100, Math.round(percent)));
  const beside = end ?? (value !== undefined && !stopped ? copy.check.percent(value) : undefined);
  const mode = value === undefined ? "indeterminate" : stopped ? "stopped" : "determinate";
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      <span
        role="progressbar"
        aria-label={label}
        aria-valuemin={value === undefined ? undefined : 0}
        aria-valuemax={value === undefined ? undefined : 100}
        aria-valuenow={value}
        data-mode={mode}
        data-still={still ? "" : undefined}
        className="progress-track"
        style={value === undefined ? undefined : ({ "--progress": `${value}%` } as CSSProperties)}
      >
        <span className="progress-fill" />
      </span>
      {/* A fixed width, so the bar doesn't change size as the number grows. */}
      {beside !== undefined && <span className="flex min-w-9 shrink-0 figure text-meta text-muted">{beside}</span>}
    </span>
  );
}
