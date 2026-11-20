import { forwardRef } from "react";
import { copy } from "../../copy";
import { Kbd } from "../Kbd";

// The search bar, shared by the list and the timeline. It is not focused on
// open, so single-letter shortcuts (J, K, A) drive the view. Press / to type here.
type Props = { value: string; onChange: (value: string) => void; label?: string; placeholder?: string };

export const CommandBar = forwardRef<HTMLInputElement, Props>(
  function CommandBar({ value, onChange, label = copy.search.findingsLabel, placeholder = copy.search.findingsPlaceholder }, ref) {
    return (
      <div className="px-3 pb-2.5">
        {/* Light on purpose: a hairline box with no fill until it is focused (press /). */}
        <label className="flex h-8 items-center gap-2 rounded-md border border-hairline px-2.5 transition-colors duration-(--duration-fast) focus-within:border-muted/50 focus-within:bg-bg/50">
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-faint">
            <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={ref}
            type="text"
            aria-label={label}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-small text-text outline-none placeholder:text-faint"
          />
          <Kbd keys={["/"]} />
        </label>
      </div>
    );
  },
);
