import { useState } from "react";
import { Activity, Cpu, Plug, Settings } from "lucide-react";
import { orderedStatuses, useLive } from "../../connectors/live";
import { useEndpoint } from "../../lib/endpoint";
import { hidePalette } from "../../lib/native";
import { copy } from "../../copy";
import { Kbd } from "../Kbd";
import { CloseIcon, HideIcon, KeysIcon, ListIcon, TimelineIcon } from "../icons";
import { Menu, MenuItem, MenuSections, Tip } from "../layers";
import { endpointTone, modelAttention, modelNote } from "./model-status";
import { DOT } from "./StatusStrip";

// The small icon buttons around the views: Filter and View at the right of the
// top bar, and the Settings cog and Trace at the left of the bottom bar. Each
// names itself and its key in a tooltip.

export type ControlItem = "view" | "filter" | "trace" | "settings";

/** The look every icon button shares: a 28 px square, muted until hovered. "on": its menu or drawer is open. */
export function iconButton(state: "on" | "off", hover: boolean) {
  const look =
    state === "on"
      ? "bg-raised text-text"
      : hover
        ? "bg-raised/60 text-text"
        : "text-muted hover:bg-raised/60 hover:text-text";
  return `press relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-md ${look}`;
}

/**
 * View: one click (or V) switches between the findings list and the timeline.
 * Its icon is the view you're on.
 */
export function ViewButton({
  current,
  onToggle,
  preview,
}: {
  /** The view you're on (for an open finding, the one it was opened from). */
  current: "list" | "timeline";
  onToggle: () => void;
  /** The dev gallery only: held hovered, or its tooltip held open. */
  preview?: { hover?: boolean; tip?: boolean };
}) {
  return (
    <Tip content={copy.controls.view} keys={["V"]} side="bottom" open={preview?.tip || undefined}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${copy.controls.view}: ${current === "timeline" ? copy.controls.timeline : copy.controls.list}`}
        // Keep keyboard focus on the palette, so the keys keep working after a click.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
        className={iconButton("off", !!preview?.hover)}
      >
        {current === "timeline" ? <TimelineIcon /> : <ListIcon />}
      </button>
    </Tip>
  );
}

/** Trace, in the bottom bar: what the agent did in the whole check. On while its drawer is open. */
export function TraceButton({
  pressed,
  onClick,
  hover = false,
  tip,
}: {
  pressed: boolean;
  onClick: () => void;
  /** The dev gallery only: held hovered, or its tooltip held open. */
  hover?: boolean;
  tip?: boolean;
}) {
  return (
    <Tip content={copy.controls.trace} keys={["T"]} side="top" open={tip || undefined}>
      <button
        type="button"
        tabIndex={-1}
        aria-pressed={pressed}
        aria-label={copy.controls.trace}
        // Keep keyboard focus on the palette, so the keys keep working after a click.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={iconButton(pressed ? "on" : "off", hover)}
      >
        <Activity size={14} strokeWidth={1.75} aria-hidden="true" className="block" />
      </button>
    </Tip>
  );
}

/**
 * Settings, the cog in the bottom left corner. Its menu holds
 * Keyboard shortcuts, then Connectors, Models and Hide, then All settings.
 * Connectors and Models have no buttons of their own any more, so a small dot
 * on the cog says when one of them needs a look.
 */
export function SettingsButton({
  hotkey,
  mouse,
  onKeys,
  onConnectors,
  onModels,
  onAllSettings,
  open: controlled,
  onOpenChange,
  hover = false,
  tip,
}: {
  hotkey: string[];
  mouse: boolean;
  onKeys: () => void;
  /** Open the Settings dialog on its Connectors tab. */
  onConnectors: () => void;
  /** Open the Settings dialog on its Models tab. */
  onModels: () => void;
  /** The last row: the Settings dialog, on its General tab. */
  onAllSettings: () => void;
  /** Open state held by the palette, so ⌘, and the cog share it. Left out, the button keeps its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The dev gallery only: held hovered, or its tooltip held open. */
  hover?: boolean;
  tip?: boolean;
}) {
  const live = useLive();
  const endpoint = useEndpoint();
  const [own, setOwn] = useState(false);
  const isOpen = controlled ?? own;
  const setOpen = (value: boolean) => {
    if (onOpenChange) onOpenChange(value);
    else setOwn(value);
  };
  const choose = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  const caps = (keys: string[]) => (mouse ? undefined : <Kbd keys={keys} />);

  const statuses = orderedStatuses(live);
  const problems = statuses.filter((s) => s.state === "needs_reconnect" || s.state === "error").length;
  const waiting = statuses.some((s) => s.state === "retrying") || !!live.slowReads;
  const model = modelAttention(endpoint.state);
  const attention = problems > 0 || model === "danger" ? "danger" : waiting || model === "info" ? "info" : undefined;

  const end = (note: string, tone: string, keys: string[]) => (
    <>
      <span className={`shrink-0 font-mono text-label ${tone}`}>{note}</span>
      {caps(keys)}
    </>
  );
  return (
    <Menu
      open={isOpen}
      onOpenChange={setOpen}
      side="top"
      align="start"
      label={copy.footer.settings}
      // The keys on the rows work while it is open; ⌘, closes it again.
      shortcuts={{ "?": onKeys, n: onConnectors, m: onModels, ",": onAllSettings, "⌘,": () => {} }}
      trigger={
        <Tip content={copy.footer.settings} keys={["⌘", ","]} side="top" open={tip || undefined}>
          <button
            type="button"
            tabIndex={-1}
            aria-label={attention ? copy.footer.settingsAttention : copy.footer.settings}
            className={iconButton(isOpen ? "on" : "off", hover)}
          >
            <Settings size={16} strokeWidth={1.75} aria-hidden="true" className="block" />
            {attention && (
              <span
                aria-hidden="true"
                className={`absolute top-0.5 right-0.5 size-2 rounded-full border border-panel ${attention === "danger" ? DOT.error : DOT.retrying}`}
              />
            )}
          </button>
        </Tip>
      }
    >
      <MenuSections
        mouse={mouse}
        first={<MenuItem icon={<KeysIcon />} label={copy.footer.keysItem} keys={caps(["?"])} onSelect={choose(onKeys)} />}
        rest={
          <>
            <MenuItem
              icon={<Plug size={14} strokeWidth={1.75} aria-hidden="true" />}
              label={copy.footer.connectors}
              keys={end(
                problems > 0 ? copy.footer.problems(problems) : String(statuses.filter((s) => s.state === "ok").length),
                problems > 0 ? "text-danger" : waiting ? "text-info" : "text-faint",
                ["N"],
              )}
              onSelect={choose(onConnectors)}
            />
            <MenuItem
              icon={<Cpu size={14} strokeWidth={1.75} aria-hidden="true" />}
              label={copy.footer.models}
              keys={end(modelNote(endpoint.state), endpointTone(endpoint.state), ["M"])}
              onSelect={choose(onModels)}
            />
            <MenuItem
              icon={hotkey.length > 0 ? <HideIcon /> : <CloseIcon />}
              label={hotkey.length > 0 ? copy.footer.hide : copy.footer.close}
              keys={caps(hotkey.length > 0 ? hotkey : ["Esc"])}
              onSelect={choose(hidePalette)}
            />
          </>
        }
        dialog={{ label: copy.settings.menu.general, onOpen: choose(onAllSettings) }}
      />
    </Menu>
  );
}
