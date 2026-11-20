import type { FindingKind } from "../agent/judge";
import { copy } from "../copy";
import { isUnsure, urgency } from "./format";
import type { ListItem } from "./Palette/FindingsList";

// The findings list's filters (F, or the funnel on the rail). Plain code, no
// model: each filter is a test on one row.
//
// How they combine (the way Linear does it): several kinds show rows of any
// of those kinds; "Due within 7 days" and "Not sure" each narrow that down
// further. The search narrows it again.

export type FilterId = "soon" | "unsure" | `kind:${FindingKind}`;

export type FilterOption = {
  id: FilterId;
  label: string;
  /** How many rows in this check the filter matches on its own (ignoring the search and other filters). */
  count: number;
};

export function filterLabel(id: FilterId): string {
  if (id === "soon") return copy.filters.soon;
  if (id === "unsure") return copy.filters.unsure;
  return copy.shared.kind[id.slice(5) as FindingKind];
}

/** Does this one row pass this one filter? */
function passesOne(item: ListItem, id: FilterId): boolean {
  if (id === "unsure") {
    // Rows the agent couldn't settle, and findings it isn't sure of (still waiting on Maya).
    if (item.type === "undecided") return true;
    return item.type === "finding" && item.finding.status === "new" && isUnsure(item.finding);
  }
  if (item.type !== "finding") return false;
  // A deadline only counts while the finding still needs her (decided rows don't show it).
  if (id === "soon") return item.finding.status === "new" && urgency(item.finding.deadline?.date) === "soon";
  return `kind:${item.finding.kind}` === id;
}

/** Does a row pass every active filter? Kinds count as one filter between them (any of them will do). */
export function passes(item: ListItem, active: FilterId[]): boolean {
  if (!active.length) return true;
  const kinds = active.filter((id) => id.startsWith("kind:"));
  if (kinds.length && !kinds.some((id) => passesOne(item, id))) return false;
  return active.filter((id) => !id.startsWith("kind:")).every((id) => passesOne(item, id));
}

export function applyFilters(items: ListItem[], active: FilterId[]): ListItem[] {
  return active.length ? items.filter((item) => passes(item, active)) : items;
}

/**
 * The menu's rows, from every row in this check (`all`, before search and
 * filters): "Due within 7 days", each kind in the order the list shows them,
 * then "Not sure". Only filters that match something are offered, plus any
 * that are already on (so they can be turned off again).
 */
export function filterOptions(all: ListItem[], active: FilterId[]): FilterOption[] {
  const kinds: FilterId[] = [];
  for (const item of all) {
    if (item.type !== "finding") continue;
    const id: FilterId = `kind:${item.finding.kind}`;
    if (!kinds.includes(id)) kinds.push(id);
  }
  for (const id of active) if (id.startsWith("kind:") && !kinds.includes(id)) kinds.push(id);
  const ids: FilterId[] = ["soon", ...kinds, "unsure"];
  return ids
    .map((id) => ({ id, label: filterLabel(id), count: all.filter((item) => passesOne(item, id)).length }))
    .filter((o) => o.count > 0 || active.includes(o.id));
}

/** Turns a filter on (at the end, so Backspace takes the newest off first) or off. */
export function toggleFilter(active: FilterId[], id: FilterId): FilterId[] {
  return active.includes(id) ? active.filter((x) => x !== id) : [...active, id];
}
