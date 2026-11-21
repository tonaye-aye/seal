// Small wrappers around the Rust commands and events, so the UI also renders
// in a plain browser (`pnpm dev`) where there is no native shell.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function hidePalette(): void {
  if (isTauri()) void invoke("hide_palette");
}

/** Key labels of the hotkey that registered, e.g. ["⌥", "Space"]. */
export async function activeHotkey(): Promise<string[]> {
  if (!isTauri()) return ["⌥", "Space"];
  return invoke<string[]>("active_hotkey");
}

/** Runs `handler` every time the palette is summoned. Returns an unsubscribe. */
export function onPaletteShown(handler: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen("palette:shown", handler);
  return () => void unlisten.then((stop) => stop());
}

/** Runs `handler` every time the palette is hidden. Returns an unsubscribe. */
export function onPaletteHidden(handler: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen("palette:hidden", handler);
  return () => void unlisten.then((stop) => stop());
}

/** Lets the user move the window by dragging (called on mouse down in the top bar). */
export function startWindowDrag(): void {
  if (isTauri()) void getCurrentWindow().startDragging();
}

/** Puts the window back in the middle of the screen (double-click on the top bar). */
export function centerWindow(): void {
  if (isTauri()) void getCurrentWindow().center();
}

// Whether the palette is on screen. The window starts hidden in the app (it
// waits for the hotkey); in a plain browser there is no hiding, so it is shown.
// The dev-only gallery window is never the palette, so it always counts as shown.
const inPaletteWindow = isTauri() && getCurrentWindow().label === "palette";
let paletteHidden = inPaletteWindow;
const visibilityListeners = new Set<() => void>();
if (inPaletteWindow) {
  onPaletteShown(() => setHidden(false));
  onPaletteHidden(() => setHidden(true));
  // After a page reload the shown/hidden events have been missed: ask.
  void invoke<boolean>("palette_visible")
    .then((visible) => setHidden(!visible))
    .catch(() => undefined);
}

function setHidden(next: boolean): void {
  paletteHidden = next;
  visibilityListeners.forEach((run) => run());
}

export function isPaletteHidden(): boolean {
  return paletteHidden;
}

/** Runs `handler` whenever the palette is shown or hidden. Returns an unsubscribe. */
export function onPaletteVisibility(handler: () => void): () => void {
  visibilityListeners.add(handler);
  return () => visibilityListeners.delete(handler);
}

/**
 * Switches the summon hotkey to Cmd+Shift+Space (when another app already
 * has Option+Space) and remembers the choice. Returns the new key labels.
 */
export async function switchToFallbackHotkey(): Promise<string[]> {
  if (!isTauri()) return ["⌘", "⇧", "Space"];
  return invoke<string[]>("use_fallback_hotkey");
}

/** Shows the palette without the hotkey (first run, so the welcome is waiting). */
export function showPalette(): void {
  if (isTauri()) void invoke("show_palette");
}

export type LaunchFlags = { onboarding: boolean; replay: boolean };

/**
 * Launch options from the native side: LIFE_ONBOARDING=1 starts onboarding
 * again, LIFE_REPLAY=1 uses saved model answers only for this launch. In a
 * browser: ?onboarding and ?replay.
 */
export async function launchFlags(): Promise<LaunchFlags> {
  if (!isTauri()) {
    const url = new URL(location.href);
    const onboarding = url.searchParams.has("onboarding");
    const replay = url.searchParams.has("replay");
    // Used once: take it off the address, so a reload resumes instead of starting over.
    if (onboarding) {
      url.searchParams.delete("onboarding");
      history.replaceState(null, "", url);
    }
    return { onboarding, replay };
  }
  return invoke<LaunchFlags>("launch_flags");
}

/** Whether clicking into another app hides the palette (off during onboarding, so it dims instead). */
export function setHideOnBlur(enabled: boolean): void {
  if (isTauri()) void invoke("set_hide_on_blur", { enabled });
}

/** Runs `handler(focused)` when the window gains or loses focus. Returns an unsubscribe. */
export function onWindowFocus(handler: (focused: boolean) => void): () => void {
  if (!isTauri()) {
    const on = () => handler(true);
    const off = () => handler(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }
  const unlisten = getCurrentWindow().onFocusChanged(({ payload }) => handler(payload));
  return () => void unlisten.then((stop) => stop());
}


/**
 * Opens Mail ("mailto:..."), a call ("tel:...") or the Calendar app
 * ("calendar") for Seal the leak. False when it couldn't: in a plain browser
 * there is no native shell, so nothing opens (the preview says so).
 */
export async function openExternal(target: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invoke("open_external", { target });
    return true;
  } catch {
    return false;
  }
}
