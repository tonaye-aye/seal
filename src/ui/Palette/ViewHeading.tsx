// The heading at the top of the list, the timeline and an open finding. It
// sits outside the scrolling area, so it stays pinned while the rows scroll
// under it. Search lives in the top bar (SearchField.tsx); while it holds a
// search, the title says how many rows match.
// Which view you are in shows on the icon rail (Rail.tsx), so the heading has no icon of its own.

export function ViewHeading({
  title,
  eyebrow,
  children,
  action,
}: {
  title: string;
  /** A small line above the title (an open finding's business and chips). */
  eyebrow?: React.ReactNode;
  /** The line under the title (optional). */
  children?: React.ReactNode;
  /** Shown on the right (an open finding's amounts). */
  action?: React.ReactNode;
}) {
  return (
    // The hairline marks the pinned edge the rows scroll under.
    <div className="shrink-0 border-b border-hairline">
      <div className="flex items-start gap-3 px-4 pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="mb-1 flex items-center gap-2 text-meta whitespace-nowrap">{eyebrow}</div>}
          <h1 className="heading text-heading font-semibold">{title}</h1>
          {/* The line under the title is left out when there is nothing to say. */}
          {hasContent(children) && <p className="mt-0.5 text-small text-muted">{children}</p>}
        </div>
        {action && <div className="mt-1 shrink-0">{action}</div>}
      </div>
    </div>
  );
}

/** True when the line under the title has something to show (not just empty or false parts). */
function hasContent(node: React.ReactNode): boolean {
  if (node === null || node === undefined || node === false || node === "") return false;
  if (Array.isArray(node)) return node.some(hasContent);
  return true;
}
