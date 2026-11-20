// Showing and hiding the palette window.
//
// The palette is the app's only window. It starts hidden and is summoned by the
// global hotkey or the menu bar icon, like Raycast or Spotlight.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The window's label, set in tauri.conf.json.
pub const LABEL: &str = "palette";

/// The dev-only gallery window (opened from the webview console with `__life.gallery()`).
pub const GALLERY_LABEL: &str = "gallery";

/// Hide the palette when the user clicks into another app.
/// Set this to false while using the webview devtools, otherwise opening
/// them steals focus and the palette disappears.
pub const HIDE_ON_BLUR: bool = true;

/// Switched off by the UI during first-run onboarding, so clicking elsewhere
/// doesn't take the window away mid-way. An atomic bool is a true/false that
/// is safe to read and write from any thread.
static HIDE_ON_BLUR_NOW: AtomicBool = AtomicBool::new(true);

pub fn set_hide_on_blur(enabled: bool) {
    HIDE_ON_BLUR_NOW.store(enabled, Ordering::SeqCst);
}

/// Switched on by the UI on the onboarding's summon step: the hotkey then
/// tells the UI it was pressed instead of hiding the palette (the one time it
/// doesn't hide), so the step can say "Success" straight away.
static HOTKEY_PRACTICE: AtomicBool = AtomicBool::new(false);

pub fn set_hotkey_practice(on: bool) {
    HOTKEY_PRACTICE.store(on, Ordering::SeqCst);
}

/// True when clicking into another app should hide the palette.
pub fn hides_on_blur() -> bool {
    HIDE_ON_BLUR && HIDE_ON_BLUR_NOW.load(Ordering::SeqCst)
}

/// Show the palette, focus it and tell the UI it opened (the UI uses that
/// event to reset itself and replay its entrance animation). It opens where
/// the user last left it: it starts centred (tauri.conf.json) and can be
/// dragged by its top bar; a double-click there centres it again.
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("palette:shown", ());
}

/// Hide the palette and hand focus back to whatever app the user was in.
pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let _ = window.hide();
    // The UI uses this to know it is in the background (for the timed re-check).
    let _ = window.emit("palette:hidden", ());
    // On macOS, hiding the app (not just the window) is what returns focus to
    // the previous app, so the user can keep typing where they were.
    // Skipped while the dev-only gallery window is open, which hiding the app
    // would take away too (it only exists in development).
    #[cfg(target_os = "macos")]
    if app.get_webview_window(GALLERY_LABEL).is_none() {
        let _ = app.hide();
    }
}

/// The hotkey toggles: close if open and in front, otherwise open. While
/// onboarding the palette can sit on screen dimmed behind another app; then
/// the hotkey brings it to the front rather than hiding it.
pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let window = app.get_webview_window(LABEL);
    let visible = window.as_ref().and_then(|w| w.is_visible().ok()).unwrap_or(false);
    let focused = window.as_ref().and_then(|w| w.is_focused().ok()).unwrap_or(false);
    if visible && HOTKEY_PRACTICE.load(Ordering::SeqCst) {
        // Onboarding's summon step: stay open and let the UI say it worked.
        if let Some(w) = window.as_ref() {
            let _ = w.set_focus();
            let _ = w.emit("palette:hotkey", ());
        }
        return;
    }
    if visible && focused {
        hide(app);
    } else {
        show(app);
    }
}
