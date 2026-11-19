import { APP_NAME } from "../../lib/app";
import { formatDay, now } from "../../lib/clock";
import { Mark } from "./Mark";

// Top bar: who we are, what day it is, and when the agent last checked.
export function Header() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <span className="text-amber">
          <Mark />
        </span>
        <span className="font-medium tracking-[-0.01em]">{APP_NAME}</span>
        <span className="text-faint">Household check</span>
      </div>
      <div className="flex items-center gap-3 font-mono text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-faint" aria-hidden="true" />
          Not checked yet
        </span>
        <span className="text-muted">{formatDay(now())}</span>
      </div>
    </header>
  );
}
