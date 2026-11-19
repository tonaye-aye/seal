// Showing and hiding the palette window.
//
// The palette is the app's only window. It starts hidden and is summoned by the
// global hotkey or the menu bar icon, like Raycast or Spotlight.

use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The window's label, set in tauri.conf.json.
pub const LABEL: &str = "palette";

/// Hide the palette when the user clicks into another app.
/// Set this to false while using the webview devtools, otherwise opening
/// them steals focus and the palette disappears.
pub const HIDE_ON_BLUR: bool = true;

/// Centre the palette on screen, show it, focus it and tell the UI it opened
/// (the UI uses that event to reset itself and replay its entrance animation).
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    let _ = window.center();
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
    // On macOS, hiding the app (not just the window) is what returns focus to
    // the previous app, so the user can keep typing where they were.
    #[cfg(target_os = "macos")]
    let _ = app.hide();
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
