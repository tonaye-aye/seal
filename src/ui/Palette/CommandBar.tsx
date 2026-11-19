import { forwardRef } from "react";
import { Kbd } from "../Kbd";

// The command bar. Today it only takes focus; commands arrive with the agent.
// It is not focused on open, so single-letter shortcuts (J, K, A) can drive the
// findings list. Press / to type here.
export const CommandBar = forwardRef<HTMLInputElement>(function CommandBar(_, ref) {
  return (
    <div className="px-3 pb-3">
      <label className="flex h-10 items-center gap-2.5 rounded-lg border border-hairline bg-bg/60 px-3 transition-colors duration-(--duration-fast) focus-within:border-amber/50 focus-within:bg-bg/80">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-faint">
          <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={ref}
          type="text"
          aria-label="Command"
          placeholder="Search findings or run a command"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
        />
        <Kbd keys={["/"]} />
      </label>
    </div>
  );
});
