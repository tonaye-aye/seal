// The heading at the top of the list, the timeline and an open finding. It
// sits outside the scrolling area, so it stays pinned while the rows scroll
// under it. Search lives in the top bar (SearchField.tsx); while it holds a
// search, the title says how many rows match.

export function ViewHeading({
  title,
  eyebrow,
  children,
  action,
  below,
  divider = false,
}: {
  title: string;
  /** A small line above the title (an open finding's business and chips). */
  eyebrow?: React.ReactNode;
  /** The line under the title (optional). */
  children?: React.ReactNode;
  /** Shown on the right (an open finding's amounts). */
  action?: React.ReactNode;
  /** Under the title and its line (the findings list's filter chips). */
  below?: React.ReactNode;
  /** A dotted zig-zag line under it, inset to match the content (an open finding: it separates the actions from the draft). */
  divider?: boolean;
}) {
  return (
    <div className="shrink-0">
      <div className="flex items-start gap-3 px-4 py-6.5">
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="mb-1 flex items-center gap-2 text-meta whitespace-nowrap">{eyebrow}</div>}
          <h1 className="heading text-heading font-semibold">{title}</h1>
          {/* The line under the title is left out when there is nothing to say. */}
          {hasContent(children) && <p className="mt-0.5 text-small text-muted">{children}</p>}
          {below}
        </div>
        {action && <div className="mt-1 shrink-0">{action}</div>}
      </div>
      {divider && <div className="stitch-x mx-4" aria-hidden="true" />}
    </div>
  );
}

/** True when the line under the title has something to show (not just empty or false parts). */
function hasContent(node: React.ReactNode): boolean {
  if (node === null || node === undefined || node === false || node === "") return false;
  if (Array.isArray(node)) return node.some(hasContent);
  return true;
}
