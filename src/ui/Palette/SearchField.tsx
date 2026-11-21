import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { copy } from "../../copy";
import { Kbd } from "../Kbd";
import { CloseIcon } from "../icons";
import { Tip } from "../layers";

// Search, in the top bar (Raycast feel). Closed, it is a magnifier: / or a
// click opens it into a field. It stays open while it has focus or holds a
// search, so a search that is filtering the rows is always in view, and it
// closes again once it is empty and focus has moved on (Esc empties it first,
// then hands focus back to the palette: Palette.tsx).
//
// The field is always there, only narrowed to the icon while closed, so
// anything that focuses it (the / key) also opens it. It is not focused when
// the palette opens, so single-letter shortcuts (J, K, A) drive the view.

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** What it searches, for screen readers and the tooltip ("Search findings"). */
  label: string;
  placeholder: string;
  /** Mouse mode: a clear button instead of the key caps. */
  mouse?: boolean;
  /** The dev gallery only: drawn as if focused, or with the closed tooltip held open. */
  preview?: { focused?: boolean; tip?: boolean };
};

export const SearchField = forwardRef<HTMLInputElement | null, Props>(function SearchField(
  { value, onChange, label, placeholder, mouse = false, preview },
  ref,
) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current as HTMLInputElement, []);
  const [hasFocus, setHasFocus] = useState(false);
  const focused = hasFocus || !!preview?.focused;
  const open = focused || value !== "";

  // Closed: no border. Open: a hairline box; filled while you type in it,
  // quieter (no fill) once you have moved down to the results.
  const box = !open
    ? "w-8 border-transparent"
    : focused
      ? "w-(--search-width) border-muted/50 bg-inset"
      : "w-(--search-width) border-hairline";

  const icon = (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="block">
      <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );

  return (
    <div
      role="search"
      className={`search-field flex h-7 shrink-0 items-center overflow-hidden rounded-md border ${box}`}
    >
      {/* Closed, the icon is the button (with its key in a tooltip); open, it just marks the field. */}
      <Tip content={open ? undefined : label} keys={["/"]} side="bottom" open={(!open && preview?.tip) || undefined}>
        <button
          type="button"
          tabIndex={-1}
          aria-label={label}
          aria-hidden={open || undefined}
          // Keep focus where it is until the click lands, then move it into the field.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => input.current?.focus()}
          className={`grid h-full w-[30px] shrink-0 cursor-pointer place-items-center rounded-md transition-colors duration-(--duration-fast) ${
            open ? "text-faint" : "press text-muted hover:bg-raised/60 hover:text-text"
          }`}
        >
          {icon}
        </button>
      </Tip>
      <input
        ref={input}
        type="text"
        aria-label={label}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        // Out of the Tab order while closed; / still focuses it.
        tabIndex={open ? 0 : -1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setHasFocus(true)}
        onBlur={() => setHasFocus(false)}
        className={`min-w-0 flex-1 bg-transparent text-small text-text outline-none placeholder:text-faint transition-opacity duration-(--duration-fast) ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {open && (
        <span className="mr-1.5 flex shrink-0 items-center">
          {mouse ? (
            value !== "" && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={copy.search.clear}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange("");
                  input.current?.focus();
                }}
                className="press grid size-5 cursor-pointer place-items-center rounded-sm text-faint hover:bg-raised hover:text-text"
              >
                <CloseIcon />
              </button>
            )
          ) : (
            // While typing, Esc is the way out; from the results, / comes back.
            <Kbd keys={[focused ? "Esc" : "/"]} />
          )}
        </span>
      )}
    </div>
  );
});
