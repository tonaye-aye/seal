import { useRef } from "react";
import * as Switch from "@radix-ui/react-switch";
import { Cpu, ListFilter, Plug, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import type { ConnectorStatus } from "../../connectors";
import { useLive } from "../../connectors/live";
import type { ConnectorId } from "../../connectors/types";
import { checkEndpoint, toggleSavedOnly, useEndpoint, useModelDemo } from "../../lib/endpoint";
import { MODELS } from "../../lib/llm";
import { chooseHotkey } from "../../lib/native";
import { SOURCES, setSourceEnabled } from "../../lib/onboarding";
import { setPreference, usePreferences, type StartView } from "../../lib/preferences";
import { sourcesChanged, syncEverything, useScan } from "../../lib/scan-store";
import { copy, plural } from "../../copy";
import type { FilterId, FilterOption } from "../filters";
import { clockTime } from "../format";
import { CloseIcon, ListIcon } from "../icons";
import { Kbd, KeyButton } from "../Kbd";
import { useScrollFade } from "../motion";
import { Sheet, SheetDescription, SheetTitle, SwitchLook } from "../layers";
import { ConnectorBody, MORE_ROWS, SOURCE_ROWS } from "../Onboarding/ConnectorList";
import { endpointDot, endpointText, MODEL_ROLES } from "./model-status";
import { pillButton, stateText, useTick } from "./StatusStrip";
import { ago } from "./Timeline";

// The one Settings dialog. The last row of every menu opens it on that menu's
// tab, so "I want more than this menu offers" always lands in the same place.
// J/K move between tabs, the numbers on the rows work them, Esc closes.

export type SettingsTab = "connectors" | "models" | "view" | "filters" | "general";

const S = copy.settings;
const TABS: { id: SettingsTab; icon: React.ReactNode }[] = [
  { id: "connectors", icon: <Plug size={14} strokeWidth={1.75} aria-hidden="true" /> },
  { id: "models", icon: <Cpu size={14} strokeWidth={1.75} aria-hidden="true" /> },
  { id: "view", icon: <ListIcon /> },
  { id: "filters", icon: <ListFilter size={14} strokeWidth={1.75} aria-hidden="true" /> },
  { id: "general", icon: <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden="true" /> },
];
const INTROS: Record<SettingsTab, string> = {
  connectors: S.connectors.intro,
  models: S.models.intro,
  view: S.view.intro,
  filters: S.filters.intro,
  general: S.general.intro,
};
const START_VIEWS: StartView[] = ["list", "timeline", "last"];

const ROW = "flex w-full items-center gap-3 rounded-lg border border-hairline px-3 py-2.5 text-left transition-colors duration-(--duration-fast)";
const CLICKABLE = "cursor-pointer hover:bg-raised";

export function SettingsDialog({
  tab,
  onTab,
  onClose,
  mouse,
  hotkey,
  onHotkey,
  filterOptions,
  activeFilters,
  onToggleFilter,
  onClearFilters,
}: {
  /** The tab showing; undefined keeps the dialog closed. */
  tab: SettingsTab | undefined;
  onTab: (tab: SettingsTab) => void;
  onClose: () => void;
  mouse: boolean;
  hotkey: string[];
  onHotkey: (keys: string[]) => void;
  filterOptions: FilterOption[];
  activeFilters: FilterId[];
  onToggleFilter: (id: FilterId) => void;
  onClearFilters: () => void;
}) {
  // Keeps the last tab on screen while the dialog fades out.
  const lastTab = useRef<SettingsTab>("connectors");
  const body = useRef<HTMLDivElement>(null);
  useScrollFade(body);
  if (tab) lastTab.current = tab;
  const shown = tab ?? lastTab.current;

  const live = useLive();
  const scan = useScan();
  const endpoint = useEndpoint();
  const demo = useModelDemo();
  const prefs = usePreferences();
  const now = useTick(Object.values(live.statuses).some((s) => s?.state === "retrying"));

  const checking = scan.phase === "scanning" || scan.refreshing;
  const busy = Object.values(live.statuses).some((s) => s?.state === "connecting" || s?.state === "syncing");
  const on = SOURCES.filter((id) => live.statuses[id]);
  const changed = !checking && sourcesChanged(on, scan);
  const locked = (id: ConnectorId) => checking || busy || (on.length === 1 && on[0] === id);
  const testing = endpoint.state === "checking";
  const savedLocked = demo.byFlag || endpoint.state === "browser";
  const savedOn = demo.saved || savedLocked;
  const fallback = hotkey.join("") === "⌘⇧Space";

  function pressSource(id: ConnectorId) {
    if (live.statuses[id]?.state === "needs_reconnect") void syncEverything();
    else if (!locked(id)) void setSourceEnabled(id, !live.statuses[id]);
  }
  const flipSaved = () => {
    if (!savedLocked) toggleSavedOnly();
  };
  function chooseKey(wantFallback: boolean) {
    if (hotkey.length > 0 && wantFallback === fallback) return;
    void chooseHotkey(wantFallback).then(onHotkey);
  }
  const flipBackground = () => setPreference({ backgroundChecks: !prefs.backgroundChecks });
  function applySources() {
    onClose();
    void syncEverything();
  }

  // What each number key does on the tab showing.
  const numbered: Record<SettingsTab, (() => void)[]> = {
    connectors: SOURCES.map((id) => () => pressSource(id)),
    models: [flipSaved],
    view: START_VIEWS.map((startView) => () => setPreference({ startView })),
    filters: filterOptions.slice(0, 9).map((o) => () => onToggleFilter(o.id)),
    general: [() => chooseKey(false), () => chooseKey(true), flipBackground],
  };

  function onKey(e: React.KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const lower = e.key.toLowerCase();
    if (lower === "j" || e.key === "ArrowDown" || lower === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      const by = lower === "j" || e.key === "ArrowDown" ? 1 : -1;
      const at = TABS.findIndex((t) => t.id === shown);
      onTab(TABS[Math.min(TABS.length - 1, Math.max(0, at + by))].id);
      return;
    }
    const action = numbered[shown][Number(e.key) - 1];
    if (action) {
      e.preventDefault();
      action();
    } else if (lower === "r" && shown === "connectors" && !checking) {
      e.preventDefault();
      applySources();
    } else if (lower === "t" && shown === "models") {
      e.preventDefault();
      void checkEndpoint();
    } else if (e.key === "Backspace" && shown === "filters") {
      e.preventDefault();
      onClearFilters();
    }
  }

  const footerNote =
    shown === "connectors"
      ? checking
        ? S.connectors.checking
        : changed
          ? S.connectors.pending
          : S.connectors.upToDate
      : shown === "models"
        ? copy.model.savedNote
        : undefined;

  return (
    <Sheet
      open={tab !== undefined}
      onClose={onClose}
      onKeyDown={onKey}
      className="flex h-[540px] max-h-[calc(100%-32px)] w-[780px] overflow-hidden rounded-xl border border-hairline bg-surface shadow-(--shadow-sheet)"
    >
      <nav className="flex w-[172px] shrink-0 flex-col gap-0.5 border-r border-hairline p-2">
        <SheetTitle className="px-2.5 pt-2 pb-3 heading text-title font-semibold">{S.title}</SheetTitle>
        <div role="tablist" aria-orientation="vertical" aria-label={S.title} className="flex flex-col gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === shown}
              tabIndex={-1}
              // Focus stays on the dialog, so its keys keep working after a click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onTab(t.id)}
              className={`press flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-small ${
                t.id === shown ? "bg-raised text-text" : "text-muted hover:bg-raised/60 hover:text-text"
              }`}
            >
              <span className="grid size-4 shrink-0 place-items-center [&>svg]:block">{t.icon}</span>
              {S.tabs[t.id]}
            </button>
          ))}
        </div>
      </nav>

      <section role="tabpanel" aria-label={S.tabs[shown]} className="flex min-w-0 flex-1 flex-col">
        <header className="px-5 pt-4 pb-3">
          <h2 className="heading text-heading font-semibold">{S.tabs[shown]}</h2>
          <SheetDescription className="mt-0.5 text-meta text-muted">{INTROS[shown]}</SheetDescription>
        </header>

        <div ref={body} className="scroll-fade flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-5 pb-4">
          {shown === "connectors" && (
            <>
              {SOURCES.map((id, i) => (
                <ConnectorSetting
                  key={id}
                  id={id}
                  index={i}
                  status={live.statuses[id]}
                  now={now}
                  lastOn={on.length === 1 && on[0] === id}
                  locked={locked(id)}
                  mouse={mouse}
                  onPress={() => pressSource(id)}
                />
              ))}
              {MORE_ROWS.map((row) => (
                <div key={row.id} className={`${ROW} opacity-45`}>
                  <ConnectorBody row={row} />
                  <span className="shrink-0 text-meta text-faint">{copy.onboarding.notInDemo}</span>
                </div>
              ))}
            </>
          )}

          {shown === "models" && (
            <>
              <h3 className="mb-0.5 label text-faint">{S.models.endpoint}</h3>
              <div className="rounded-lg border border-hairline px-3 py-2.5">
                <div className="flex min-h-7 items-center gap-2">
                  <span className={`size-1.5 shrink-0 rounded-full ${endpointDot(endpoint.state)}`} aria-hidden="true" />
                  <span className="text-body text-text" role="status">
                    {endpointText(endpoint)}
                  </span>
                  {endpoint.checkedAt && <span className="font-mono text-label text-faint">{copy.model.checkedAgo(ago(endpoint.checkedAt))}</span>}
                  <span className="ml-auto text-meta">
                    <KeyButton
                      keys={["T"]}
                      label={copy.model.testConnection}
                      icon={<RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" className={testing ? "motion-safe:animate-spin" : ""} />}
                      disabled={testing}
                      mouse={mouse}
                      onClick={() => void checkEndpoint()}
                    />
                  </span>
                </div>
                {endpoint.detail && <p className="mt-1 text-meta text-muted">{endpoint.detail}</p>}
              </div>
              <SwitchRow
                index={0}
                name={copy.model.useSaved}
                note={demo.byFlag ? copy.model.byFlag : endpoint.state === "browser" ? S.models.browserHelp : S.models.savedHelp}
                checked={savedOn}
                disabled={savedLocked}
                mouse={mouse}
                onChange={flipSaved}
              />
              <h3 className="mt-2 mb-0.5 label text-faint">{S.models.used}</h3>
              {MODEL_ROLES.map((role) => {
                const model = copy.model.roles[role];
                return (
                  <div key={role} className="rounded-lg border border-hairline px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-body text-text">{model.name}</span>
                      <span className="font-mono text-label text-muted">{model.job}</span>
                    </div>
                    <p className="mt-0.5 text-meta text-muted">{model.detail}</p>
                    <p className="mt-1 font-mono text-label text-faint">
                      {MODELS[role]} · {model.thinking}
                    </p>
                  </div>
                );
              })}
            </>
          )}

          {shown === "view" && (
            <div role="radiogroup" aria-label={S.view.openOn} className="flex flex-col gap-1.5">
              <h3 className="mb-0.5 label text-faint">{S.view.openOn}</h3>
              {START_VIEWS.map((id, i) => (
                <RadioRow
                  key={id}
                  index={i}
                  name={S.view[id].name}
                  note={S.view[id].note}
                  checked={prefs.startView === id}
                  mouse={mouse}
                  onChoose={() => setPreference({ startView: id })}
                />
              ))}
            </div>
          )}

          {shown === "filters" &&
            (filterOptions.length === 0 ? (
              <p className="text-small text-muted">{S.filters.none}</p>
            ) : (
              filterOptions.map((o, i) => (
                <SwitchRow
                  key={o.id}
                  index={i}
                  name={o.label}
                  note={S.filters.meaning[(o.id.startsWith("kind:") ? o.id.slice(5) : o.id) as keyof typeof S.filters.meaning]}
                  end={<span className="figure text-label text-faint">{o.count}</span>}
                  checked={activeFilters.includes(o.id)}
                  mouse={mouse}
                  onChange={() => onToggleFilter(o.id)}
                />
              ))
            ))}

          {shown === "general" && (
            <>
              <div role="radiogroup" aria-label={S.general.summon} className="flex flex-col gap-1.5">
                <h3 className="mb-0.5 label text-faint">{S.general.summon}</h3>
                {hotkey.length === 0 && <p className="text-small text-muted">{S.general.noShortcut}</p>}
                <RadioRow
                  index={0}
                  name="⌥ Space"
                  note={S.general.summonNote}
                  checked={hotkey.length > 0 && !fallback}
                  mouse={mouse}
                  onChoose={() => chooseKey(false)}
                />
                <RadioRow
                  index={1}
                  name="⌘ ⇧ Space"
                  note={S.general.fallbackNote}
                  checked={fallback}
                  mouse={mouse}
                  onChoose={() => chooseKey(true)}
                />
              </div>
              <h3 className="mt-2 mb-0.5 label text-faint">{S.general.background}</h3>
              <SwitchRow
                index={2}
                name={S.general.backgroundName}
                note={S.general.backgroundNote}
                checked={prefs.backgroundChecks}
                mouse={mouse}
                onChange={flipBackground}
              />
            </>
          )}
        </div>

        <footer className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-t border-hairline px-5 py-2 text-meta">
          <p role="status" className="min-w-0 text-faint">
            {footerNote}
          </p>
          <div className="flex shrink-0 items-center gap-3">
            {shown === "connectors" && changed && (
              <KeyButton
                keys={["R"]}
                label={S.connectors.syncToApply}
                icon={<RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />}
                tone="primary"
                mouse={mouse}
                onClick={applySources}
              />
            )}
            {shown === "filters" && filterOptions.length > 0 && (
              <KeyButton
                keys={["⌫"]}
                label={S.filters.clearAll}
                icon={<X size={14} strokeWidth={1.75} aria-hidden="true" />}
                disabled={activeFilters.length === 0}
                mouse={mouse}
                onClick={onClearFilters}
              />
            )}
            <KeyButton keys={["Esc"]} label={S.close} icon={<CloseIcon />} tone="faint" mouse={mouse} onClick={onClose} />
          </div>
        </footer>
      </section>
    </Sheet>
  );
}

/** A whole row that is one switch, with its number key in keyboard mode. */
function SwitchRow({
  index,
  name,
  note,
  body,
  end,
  checked,
  disabled = false,
  mouse,
  onChange,
}: {
  index: number;
  name?: string;
  note?: string;
  /** Replaces the name and note (a connector's icon and lines). */
  body?: React.ReactNode;
  end?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  mouse: boolean;
  onChange: () => void;
}) {
  return (
    <Switch.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      className={`group ${ROW} shrink-0 ${disabled ? "cursor-default" : CLICKABLE}`}
    >
      {!mouse && <Kbd keys={[String(index + 1)]} />}
      {body ?? (
        <span className="min-w-0 flex-1">
          <span className="block text-body text-text">{name}</span>
          {note && <span className="mt-0.5 block text-meta text-muted">{note}</span>}
        </span>
      )}
      {end}
      <SwitchLook />
    </Switch.Root>
  );
}

/** A row in a pick-one list. */
function RadioRow({
  index,
  name,
  note,
  checked,
  mouse,
  onChoose,
}: {
  index: number;
  name: string;
  note: string;
  checked: boolean;
  mouse: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onChoose}
      className={`${ROW} ${CLICKABLE}`}
    >
      {!mouse && <Kbd keys={[String(index + 1)]} />}
      <span className="min-w-0 flex-1">
        <span className="block text-body text-text">{name}</span>
        <span className="mt-0.5 block text-meta text-muted">{note}</span>
      </span>
      <span aria-hidden="true" className={`grid size-4 shrink-0 place-items-center rounded-full border ${checked ? "border-text" : "border-faint"}`}>
        {checked && <span className="size-2 rounded-full bg-text" />}
      </span>
    </button>
  );
}

/** One source: what it reads, what it may do, how its last sync went, and its switch. */
function ConnectorSetting({
  id,
  index,
  status,
  now,
  lastOn,
  locked,
  mouse,
  onPress,
}: {
  id: ConnectorId;
  index: number;
  status?: ConnectorStatus;
  now: number;
  lastOn: boolean;
  locked: boolean;
  mouse: boolean;
  onPress: () => void;
}) {
  const source = SOURCE_ROWS[id];
  const body = <ConnectorBody row={source} meta={`${copy.onboarding.by(source.by)} · ${S.connectors.access[id]}`} />;
  if (status?.state === "needs_reconnect") {
    return (
      <div className={`${ROW} shrink-0`}>
        {!mouse && <Kbd keys={[String(index + 1)]} />}
        {body}
        <span className="shrink-0 text-meta text-danger">{copy.onboarding.signedOut}</span>
        <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onPress} className={pillButton()}>
          {copy.footer.reconnect}
        </button>
      </div>
    );
  }
  const [one, many] = source.unit;
  const first = !status
    ? copy.footer.off
    : lastOn && status.state === "ok"
      ? copy.footer.keepOne
      : status.state === "ok" && status.count !== undefined
        ? plural(status.count, one, many)
        : stateText(status, now);
  const synced = status?.state === "ok" && status.lastSyncedAt ? S.connectors.synced(clockTime(status.lastSyncedAt)) : undefined;
  return (
    <SwitchRow
      index={index}
      body={body}
      end={
        <span className="shrink-0 text-right">
          <span className={`block font-mono text-label ${status?.state === "error" ? "text-danger" : "text-muted"}`}>{first}</span>
          {synced && <span className="block font-mono text-label text-faint">{synced}</span>}
        </span>
      }
      checked={!!status}
      disabled={locked}
      mouse={mouse}
      onChange={onPress}
    />
  );
}
