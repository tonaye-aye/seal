// The heading at the top of the list and the timeline, with the search bar
// under it. Both sit outside the scrolling area, so they stay pinned while the
// rows scroll under them. The search comes last so Down goes straight from
// typing into the rows, and Up from the first row comes straight back.
// The icon says which view you are in; the action on the right switches to the other.

export function ViewHeading({
  view,
  title,
  eyebrow,
  children,
  action,
  search,
}: {
  view: "list" | "timeline" | "finding";
  title: string;
  /** A small line above the title (an open finding's business and chips). */
  eyebrow?: React.ReactNode;
  /** The line under the title (optional). */
  children?: React.ReactNode;
  /** Shown on the right (an open finding's amounts). */
  action?: React.ReactNode;
  /** The search bar, under the heading. */
  search?: React.ReactNode;
}) {
  return (
    // The hairline marks the pinned edge the rows scroll under.
    <div className="shrink-0 border-b border-hairline">
      <div className="flex items-start gap-3 px-4 pt-3 pb-2.5">
        <span
          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-hairline bg-raised text-muted"
          aria-hidden="true"
        >
          {view === "list" ? <ListIcon /> : view === "timeline" ? <TimelineIcon /> : <FindingIcon />}
        </span>
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="mb-1 flex items-center gap-2 text-meta whitespace-nowrap">{eyebrow}</div>}
          <h1 className="heading text-heading font-semibold">{title}</h1>
          {/* The line under the title is left out when there is nothing to say. */}
          {hasContent(children) && <p className="mt-0.5 text-small text-muted">{children}</p>}
        </div>
        {action && <div className="mt-1 shrink-0">{action}</div>}
      </div>
      {search}
    </div>
  );
}

/** A page with lines and a dot: one finding, opened. */
function FindingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="2.5" y="1.5" width="11" height="13" rx="2" />
      <path d="M5.5 5.5h5M5.5 8.5h5M5.5 11.5h3" />
      <circle cx="12.5" cy="2.5" r="2" fill="currentColor" stroke="var(--color-raised)" strokeWidth="1" />
    </svg>
  );
}

/** Three rows with a dot each: the findings list. */
/** A left arrow: go back to wherever the finding was opened from. */
export function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 8H3.5M7.5 4 3.5 8l4 4" />
    </svg>
  );
}

export function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M6 4h7M6 8h7M6 12h7" />
      <circle cx="3" cy="4" r="0.6" fill="currentColor" />
      <circle cx="3" cy="8" r="0.6" fill="currentColor" />
      <circle cx="3" cy="12" r="0.6" fill="currentColor" />
    </svg>
  );
}

/** A vertical line with stops, the middle one marked: the timeline and its "now". */
export function TimelineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M4 1.5v13" />
      <circle cx="4" cy="4" r="1.3" fill="var(--color-raised)" />
      <circle cx="4" cy="8" r="1.8" fill="var(--color-accent)" stroke="var(--color-accent)" />
      <circle cx="4" cy="12" r="1.3" fill="var(--color-raised)" />
      <path d="M8 4h5.5M8 8h5.5M8 12h3.5" />
    </svg>
  );
}

/** True when the line under the title has something to show (not just empty or false parts). */
function hasContent(node: React.ReactNode): boolean {
  if (node === null || node === undefined || node === false || node === "") return false;
  if (Array.isArray(node)) return node.some(hasContent);
  return true;
}
