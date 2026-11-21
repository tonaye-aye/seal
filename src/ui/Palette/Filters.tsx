import { ListFilter, X } from "lucide-react";
import { copy } from "../../copy";
import { Kbd } from "../Kbd";
import { Menu, MenuCheckItem, MenuItem, MenuSections, Tip } from "../layers";
import { filterLabel, type FilterId, type FilterOption } from "../filters";
import { iconButton } from "./Controls";

// Filters for the findings list: a funnel in the top bar (or F) opens a
// menu of ticks, and each filter that is on shows as a chip under the
// heading. The rules for what a filter matches are in src/ui/filters.ts.

/**
 * The Filter button and its menu. Inside the menu, the number on a row
 * ticks it (the menu stays open), Backspace clears them all, comma opens Filter
 * settings, F or Esc closes it.
 * In the timeline it is dimmed: filters are for the findings list, so using
 * it goes back there first (the palette does that in `onOpenChange`).
 */
export function FilterButton({
  options,
  active,
  onToggle,
  onClear,
  open,
  onOpenChange,
  onSettings,
  mouse,
  away = false,
  preview,
}: {
  options: FilterOption[];
  active: FilterId[];
  onToggle: (id: FilterId) => void;
  onClear: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The last row: Settings, on its Filters tab. */
  onSettings: () => void;
  mouse: boolean;
  /** In the timeline (or a finding opened from it): the list isn't showing. */
  away?: boolean;
  /** The dev gallery only: held hovered, or its tooltip held open. */
  preview?: { hover?: boolean; tip?: boolean };
}) {
  // 1 to 9 tick the rows (there are at most 9: one deadline, seven kinds, Not sure).
  const shortcuts: Record<string, () => boolean> = {
    f: () => false,
    ",": () => (onSettings(), false),
    backspace: () => (onClear(), true),
  };
  options.slice(0, 9).forEach((o, i) => (shortcuts[String(i + 1)] = () => (onToggle(o.id), true)));
  const item = (o: FilterOption) => (
    <MenuCheckItem
      key={o.id}
      label={o.label}
      checked={active.includes(o.id)}
      onToggle={() => onToggle(o.id)}
      end={
        <>
          <span className="figure text-label text-faint">{o.count}</span>
          {!mouse && <Kbd keys={[String(options.indexOf(o) + 1)]} />}
        </>
      }
    />
  );
  const look = open ? "on" : "off";
  return (
    <Menu
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      align="end"
      label={copy.filters.label}
      shortcuts={shortcuts}
      trigger={
        <Tip
          content={copy.controls.filter}
          keys={["F"]}
          side="bottom"
          open={preview?.tip || undefined}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={copy.controls.filter}
            onMouseDown={(e) => e.preventDefault()}
            className={`${iconButton(look, !!preview?.hover)} ${away && !open ? "opacity-60" : ""}`}
          >
            <ListFilter size={16} strokeWidth={1.75} aria-hidden="true" className="block" />
            {/* How many filters are on: a small neutral badge (violet is kept for the main action). */}
            {active.length > 0 && (
              <span className="absolute -top-1 -right-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-text px-0.5 figure text-label leading-none text-bg">
                {active.length}
                <span className="sr-only"> {copy.controls.filtersOn(active.length)}</span>
              </span>
            )}
          </button>
        </Tip>
      }
    >
      <MenuSections
        mouse={mouse}
        first={options.length ? item(options[0]) : <MenuItem icon={null} label={copy.filters.nothing} disabled onSelect={() => {}} />}
        rest={options.slice(1).map(item)}
        dialog={{ label: copy.settings.menu.filters, onOpen: onSettings }}
      />
    </Menu>
  );
}

/**
 * The filters that are on, as chips under the heading (Linear style). A click
 * on a chip's × takes it off; with the keyboard, Backspace takes the newest
 * off and Esc clears them all.
 */
export function FilterChips({
  active,
  mouse,
  onRemove,
  onClear,
}: {
  active: FilterId[];
  mouse: boolean;
  onRemove: (id: FilterId) => void;
  onClear: () => void;
}) {
  if (!active.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-meta">
      <span className="mr-0.5 text-faint">{copy.filters.filteredBy}</span>
      {active.map((id) => (
        <span key={id} className="inline-flex h-6 items-center gap-1 rounded-full border border-hairline bg-raised pr-1 pl-2.5 text-text">
          {filterLabel(id)}
          <button
            type="button"
            tabIndex={-1}
            aria-label={copy.filters.remove(filterLabel(id))}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onRemove(id)}
            className="press grid size-4 cursor-pointer place-items-center rounded-full text-muted hover:bg-hairline hover:text-text"
          >
            <X size={11} strokeWidth={2} aria-hidden="true" className="block" />
          </button>
        </span>
      ))}
      <span className="ml-1.5">
        {mouse ? (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
            className="press cursor-pointer rounded-md px-1.5 py-0.5 text-muted hover:bg-raised hover:text-text"
          >
            {copy.filters.clearAll}
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-faint">
            <Kbd keys={["⌫"]} />
            {copy.filters.removeLast}
          </span>
        )}
      </span>
    </div>
  );
}
