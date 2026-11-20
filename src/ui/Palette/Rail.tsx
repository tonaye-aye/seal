import { useState } from "react";
import { Activity, Check, Settings } from "lucide-react";
import { hidePalette } from "../../lib/native";
import { copy } from "../../copy";
import { Kbd } from "../Kbd";
import { CloseIcon, HideIcon, KeysIcon, ListIcon, TimelineIcon } from "../icons";
import { Menu, MenuItem, Tip } from "../layers";

// The icon rail down the left of the palette (Linear and Slack have one like
// it): View at the top, Trace and Settings at the foot. Icons only, to leave
// the rows their width; each one names itself and its key in a tooltip.
//
// View is one button with a menu (V, or a click): Findings or Timeline, the
// current one ticked. Its icon is the view you're in, and the top bar's
// breadcrumb ("Life / Timeline") says it in words. While a finding is open,
// the view it was opened from counts as current, and choosing it goes back.

export type RailView = "list" | "timeline" | "detail";
export type RailItem = "view" | "trace" | "settings";

export function Rail({
  view,
  from = "list",
  traceOpen,
  onList,
  onTimeline,
  onTrace,
  viewOpen,
  onViewOpenChange,
  mouse,
  settings,
  preview,
}: {
  view: RailView;
  /** Where an open finding was opened from (that view counts as current). */
  from?: "list" | "timeline";
  traceOpen: boolean;
  onList: () => void;
  onTimeline: () => void;
  onTrace: () => void;
  /** The View menu's open state, held by the palette so V and a click share it. */
  viewOpen: boolean;
  onViewOpenChange: (open: boolean) => void;
  /** Mouse mode: the menu rows leave out their key caps. */
  mouse: boolean;
  /** The Settings button and its menu (SettingsButton below). */
  settings: React.ReactNode;
  /** The dev gallery only: hold one item hovered, or its tooltip open. */
  preview?: { hover?: RailItem; tip?: RailItem };
}) {
  const current = view === "detail" ? from : view;
  const choose = (run: () => void) => () => {
    onViewOpenChange(false);
    run();
  };
  // The current view gets a tick. The other one shows ↵ (keyboard mode only):
  // the menu opens with it highlighted, so V then Enter switches views.
  const end = (target: "list" | "timeline") =>
    current === target ? (
      <Check size={14} strokeWidth={2} aria-hidden="true" className="text-text" />
    ) : mouse ? undefined : (
      <Kbd keys={["↵"]} />
    );

  return (
    <nav aria-label={copy.rail.label} className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-hairline py-2">
      <Menu
        open={viewOpen}
        onOpenChange={onViewOpenChange}
        side="right"
        align="start"
        label={copy.rail.view}
        // V closes it again; ⌘↵ still toggles the timeline with it open.
        shortcuts={{ v: () => {}, "⌘enter": current === "timeline" ? onList : onTimeline }}
        trigger={
          <Tip content={copy.rail.viewTip(current === "timeline" ? copy.rail.timeline : copy.rail.list)} keys={["V"]} side="right" open={preview?.tip === "view" || undefined}>
            <button
              type="button"
              tabIndex={-1}
              aria-label={copy.rail.view}
              onMouseDown={(e) => e.preventDefault()}
              className={railButton(viewOpen ? "on" : "off", preview?.hover === "view")}
            >
              {current === "timeline" ? <TimelineIcon /> : <ListIcon />}
            </button>
          </Tip>
        }
      >
        <MenuItem icon={<ListIcon />} label={copy.rail.list} current={current === "list"} focusOnOpen={!mouse && current !== "list"} keys={end("list")} onSelect={choose(onList)} />
        <MenuItem icon={<TimelineIcon />} label={copy.rail.timeline} current={current === "timeline"} focusOnOpen={!mouse && current !== "timeline"} keys={end("timeline")} onSelect={choose(onTimeline)} />
      </Menu>
      <div className="flex flex-col gap-1">
        <RailButton
          label={copy.rail.trace}
          keys={["T"]}
          icon={<Activity size={16} strokeWidth={1.75} aria-hidden="true" className="block" />}
          pressed={traceOpen}
          onClick={onTrace}
          hover={preview?.hover === "trace"}
          tip={preview?.tip === "trace"}
        />
        {settings}
      </div>
    </nav>
  );
}

/**
 * The look every rail button shares: a 32 px square, muted until hovered.
 * "on": the View or Settings menu is open, or Trace's drawer is.
 */
function railButton(state: "on" | "off", hover: boolean) {
  const look =
    state === "on"
      ? "bg-raised text-text"
      : hover
          ? "bg-raised/60 text-text"
          : "text-muted hover:bg-raised/60 hover:text-text";
  return `press relative grid size-8 cursor-pointer place-items-center rounded-md ${look}`;
}

function RailButton({
  label,
  keys,
  icon,
  pressed,
  onClick,
  hover = false,
  tip,
}: {
  label: string;
  keys?: string[];
  icon: React.ReactNode;
  /** A toggle (Trace): on while its drawer is open. */
  pressed: boolean;
  onClick: () => void;
  hover?: boolean;
  tip?: boolean;
}) {
  return (
    <Tip content={label} keys={keys} side="right" open={tip || undefined}>
      <button
        type="button"
        tabIndex={-1}
        aria-pressed={pressed}
        aria-label={label}
        // Keep keyboard focus on the palette, so the keys keep working after a click.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={railButton(pressed ? "on" : "off", hover)}
      >
        {icon}
      </button>
    </Tip>
  );
}

/**
 * Settings, the cog at the foot of the rail: Keyboard shortcuts and Hide Life,
 * each with the key that does the same. The menu opens to the right.
 */
export function SettingsButton({
  hotkey,
  mouse,
  onKeys,
  open: controlled,
  onOpenChange,
  hover = false,
  tip,
}: {
  hotkey: string[];
  mouse: boolean;
  onKeys: () => void;
  /** Open state held by the palette, so ⌘, and the cog share it. Left out, the button keeps its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The dev gallery only: held hovered, or its tooltip held open. */
  hover?: boolean;
  tip?: boolean;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (value: boolean) => {
    if (onOpenChange) onOpenChange(value);
    else setOwn(value);
  };
  const choose = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  const caps = (keys: string[]) => (mouse ? undefined : <Kbd keys={keys} />);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      side="right"
      align="end"
      label={copy.footer.settings}
      // The keys on the rows work while it is open; ⌘, closes it again.
      shortcuts={{ "?": onKeys, "⌘,": () => {} }}
      trigger={
        <Tip content={copy.footer.settings} keys={["⌘", ","]} side="right" open={tip || undefined}>
          <button
            type="button"
            tabIndex={-1}
            aria-label={copy.footer.settings}
            className={railButton(open ? "on" : "off", hover)}
          >
            <Settings size={16} strokeWidth={1.75} aria-hidden="true" className="block" />
          </button>
        </Tip>
      }
    >
      <MenuItem icon={<KeysIcon />} label={copy.footer.keysItem} keys={caps(["?"])} onSelect={choose(onKeys)} />
      <MenuItem
        icon={hotkey.length > 0 ? <HideIcon /> : <CloseIcon />}
        label={hotkey.length > 0 ? copy.footer.hide : copy.footer.close}
        keys={caps(hotkey.length > 0 ? hotkey : ["Esc"])}
        onSelect={choose(hidePalette)}
      />
    </Menu>
  );
}
