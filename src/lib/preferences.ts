// The few choices in the Settings dialog that aren't about a connector or a
// model. Kept in localStorage and read by React like the other small stores.

import { useSyncExternalStore } from "react";

/** Where the palette opens: a view, or wherever it was left. */
export type StartView = "list" | "timeline" | "last";

export type Preferences = {
  startView: StartView;
  /** The timed check while the app is hidden in the menu bar. */
  backgroundChecks: boolean;
};

const KEY = "life.preferences";
const DEFAULTS: Preferences = { startView: "list", backgroundChecks: true };

function load(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Preferences> | null;
    const startView = saved?.startView;
    return {
      startView: startView === "timeline" || startView === "last" ? startView : "list",
      backgroundChecks: saved?.backgroundChecks !== false,
    };
  } catch {
    // Storage unavailable (or a Node script): the defaults apply.
    return DEFAULTS;
  }
}

let state = load();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPreferences(): Preferences {
  return state;
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, () => state);
}

export function setPreference(change: Partial<Preferences>): void {
  state = { ...state, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable; the choice then lasts until the app quits.
  }
  for (const listener of listeners) listener();
}

/** Back to the defaults (starting onboarding again from an empty account). */
export function resetPreferences(): void {
  state = DEFAULTS;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
  for (const listener of listeners) listener();
}
