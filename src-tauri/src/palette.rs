// Showing and hiding the palette window.
//
// The palette is the app's only window. It opens at launch and behaves like a
// normal Mac window: another app can sit in front of it, and it shows in Mission
// Control. It only closes from Hide Seal or the global hotkey.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The window's label, set in tauri.conf.json.
pub const LABEL: &str = "palette";

/// The dev-only gallery window (opened from the webview console with `__life.gallery()`).
pub const GALLERY_LABEL: &str = "gallery";

/// Onboarding's first step asks the user to press the hotkey. While this is
/// true, the next press counts as that proof instead of hiding the window.
/// An atomic bool is a true/false that is safe to read and write from any thread.
static SUMMON_TEST: AtomicBool = AtomicBool::new(false);

pub fn set_summon_test(armed: bool) {
    SUMMON_TEST.store(armed, Ordering::SeqCst);
}

/// Show the palette and focus it. If it was closed, also tell the UI it opened
/// (the UI uses that event to reset itself and replay its entrance animation).
/// If it was only behind another app, nothing resets, so Maya's place is kept.
/// It opens where the user last left it: it starts centred (tauri.conf.json)
/// and can be dragged by its top bar; a double-click there centres it again.
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    let was_open = window.is_visible().unwrap_or(false);
    let _ = window.show();
    let _ = window.set_focus();
    if !was_open {
        let _ = window.emit("palette:shown", ());
    }
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

/// The hotkey toggles: close if open and in front, otherwise open. If the
/// palette is open behind another app, the hotkey brings it to the front
/// rather than hiding it.
pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let window = app.get_webview_window(LABEL);
    let visible = window.as_ref().and_then(|w| w.is_visible().ok()).unwrap_or(false);
    let focused = window.as_ref().and_then(|w| w.is_focused().ok()).unwrap_or(false);
    // `swap` turns the test off and says whether it was on, in one step, so
    // only the first press counts. Every press after this one toggles as usual.
    if SUMMON_TEST.swap(false, Ordering::SeqCst) {
        if !(visible && focused) {
            show(app);
        }
        if let Some(window) = window {
            let _ = window.emit("palette:summon-proved", ());
        }
        return;
    }
    if visible && focused {
        hide(app);
    } else {
        show(app);
    }
}
