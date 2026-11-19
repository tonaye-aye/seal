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
