import { copy } from "../../copy";
import { centerWindow, startWindowDrag } from "../../lib/native";
import { Tip } from "../layers";
import { NowVisual } from "./NowVisual";

// Top bar: the app's name and where you are (the breadcrumb: "Seal  Timeline /
// Skylink Internet"), with Search, Filter and View on the right. It is also
// the window's handle: drag it to move the palette, double-click it to put it
// back in the centre.

/** Moves the window from a bar. Anything clickable in the bar (and the search) stays clickable. */
export function dragByBar(e: React.MouseEvent) {
  if (e.button !== 0 || (e.target as HTMLElement).closest("button, [role='search']")) return;
  if (e.detail === 2) centerWindow();
  else startWindowDrag();
}

/** One step of the breadcrumb. With `onClick` it is a link back; without, it is where you are. */
export type Crumb = { label: string; onClick?: () => void };

/** The look of a breadcrumb link. The padding is pulled back by the margin, so a link takes the same room as plain text. */
const CRUMB_LINK = "press -mx-1 cursor-pointer rounded-sm px-1 hover:bg-raised/60 hover:text-text";

/**
 * `crumbs`: the view you're in, then an open finding's business. `onHome`: the
 * app name as a link home, while a finding is open. `search`: the magnifier
 * (SearchField.tsx). `controls`: Filter and View to its right, or an open
 * finding's actions in their place. `bare`: the
 * name and mark, with no breadcrumb or search, for the onboarding steps (their
 * Skip button comes in through `controls`).
 */
export function Header({
  crumbs = [],
  onHome,
  search,
  controls,
  bare = false,
}: {
  crumbs?: Crumb[];
  onHome?: { label: string; run: () => void };
  search?: React.ReactNode;
  controls?: React.ReactNode;
  bare?: boolean;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 px-4" onMouseDown={dragByBar}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* The mark is the "now" visual: it shows what the agent is doing. */}
        <NowVisual />
        {/* relative: paints the name above the glow that spills behind it. */}
        {onHome ? (
          <Tip content={copy.header.backTo(onHome.label)} keys={["Esc"]} side="bottom">
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onHome.run}
              className={`heading relative text-body font-semibold ${CRUMB_LINK}`}
            >
              {copy.appName}
            </button>
          </Tip>
        ) : (
          <span className="heading relative text-body font-semibold">{copy.appName}</span>
        )}
        {crumbs.length > 0 && (
          <nav aria-label={copy.header.breadcrumb} className="ml-1.5 flex min-w-0 items-center text-small">
            <ol className="flex min-w-0 items-center">
              {crumbs.map((crumb, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <li key={i} className="flex min-w-0 items-center">
                    {/* Only between crumbs: the app name and the view need no slash. */}
                    {i > 0 && (
                      <span className="px-2 text-faint" aria-hidden="true">
                        /
                      </span>
                    )}
                    {crumb.onClick ? (
                      <Tip content={copy.header.backTo(crumb.label)} keys={["Esc"]} side="bottom">
                        <button
                          type="button"
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={crumb.onClick}
                          className={`max-w-[220px] truncate text-muted ${CRUMB_LINK}`}
                        >
                          {crumb.label}
                        </button>
                      </Tip>
                    ) : (
                      <span
                        aria-current={last ? "page" : undefined}
                        className={`max-w-[220px] truncate ${last ? "font-medium text-text" : "text-muted"}`}
                      >
                        {crumb.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
      </div>
      {/* Never shrinks: when room runs short, the breadcrumb is what gets cut. */}
      {(!bare || controls) && (
        <div className="flex shrink-0 items-center gap-1">
          {search}
          {controls}
        </div>
      )}
    </header>
  );
}
