// Showing and hiding the palette window.
//
// The palette is the app's only window. It starts hidden and is summoned by the
// global hotkey or the menu bar icon, like Raycast or Spotlight.

use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The window's label, set in tauri.conf.json.
pub const LABEL: &str = "palette";

/// The dev-only gallery window (opened from the webview console with `__life.gallery()`).
pub const GALLERY_LABEL: &str = "gallery";

/// Hide the palette when the user clicks into another app.
/// Set this to false while using the webview devtools, otherwise opening
/// them steals focus and the palette disappears.
pub const HIDE_ON_BLUR: bool = true;

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

/// The hotkey toggles: open if hidden, close if already open.
pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let visible = app
        .get_webview_window(LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if visible {
        hide(app);
    } else {
        show(app);
    }
}
