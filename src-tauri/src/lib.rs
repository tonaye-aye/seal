// The native shell. It stays thin on purpose: window, hotkey and menu bar icon.
// Everything the user sees is built in React (see src/).

mod llm;
mod palette;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, Wry,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// The product name, shown in the menu bar menu. Kept in sync with APP_NAME in
/// src/lib/app.ts.
const APP_NAME: &str = "Seal";

/// Hotkeys to try, in order. The first one that registers wins. Option+Space
/// is often taken (Raycast, Alfred), so it falls back rather than fails.
/// Each entry is (shortcut for the plugin, key labels for the UI).
const HOTKEYS: [(&str, &[&str]); 2] = [
    ("Alt+Space", &["⌥", "Space"]),
    ("CommandOrControl+Shift+Space", &["⌘", "⇧", "Space"]),
];

/// The hotkey that actually registered, so the UI can show the right hint.
/// Empty if none could be registered (the menu bar icon still works).
/// A Mutex (a lock) because onboarding can switch it while the app runs.
struct ActiveHotkey(Mutex<Vec<String>>);

/// The menu bar menu's items that change while the app runs: Open shows the
/// current hotkey, and Settings is greyed out until onboarding is done.
struct TrayItems {
    open: MenuItem<Wry>,
    settings: MenuItem<Wry>,
}

/// The shortcut text for some key labels, in the form the menu understands.
fn shortcut_for(labels: &[String]) -> Option<&'static str> {
    HOTKEYS
        .iter()
        .find(|(_, keys)| keys.iter().copied().eq(labels.iter().map(String::as_str)))
        .map(|(shortcut, _)| *shortcut)
}

/// A file in the app's config folder that says "fallback" once the user has
/// chosen Cmd+Shift+Space (because another app already uses Option+Space).
const HOTKEY_CHOICE_FILE: &str = "hotkey";

fn prefers_fallback(app: &AppHandle) -> bool {
    app.path()
        .app_config_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join(HOTKEY_CHOICE_FILE)).ok())
        .is_some_and(|text| text.trim() == "fallback")
}

/// Called by Hide Seal in the Settings menu, and the crash screen's Hide.
#[tauri::command]
fn hide_palette(app: AppHandle) {
    palette::hide(&app);
}

/// Called by the UI to label the hotkey hint in the footer.
#[tauri::command]
fn active_hotkey(state: State<ActiveHotkey>) -> Vec<String> {
    state.0.lock().map(|keys| keys.clone()).unwrap_or_default()
}

/// Called at launch, so the app is on screen without the hotkey.
#[tauri::command]
fn show_palette(app: AppHandle) {
    palette::show(&app);
}

/// Set once the UI has been told about LIFE_ONBOARDING, so the reset happens
/// once per launch, not every time the page reloads (in development the page
/// can reload when the window comes back, which would start onboarding over).
static ONBOARDING_FLAG_USED: AtomicBool = AtomicBool::new(false);

/// Set after the first page load, so the window opens at launch but a later
/// page reload doesn't bring it back after Maya has hidden it.
static PAGE_LOADED: AtomicBool = AtomicBool::new(false);

/// Launch options for the UI. LIFE_ONBOARDING=1 starts onboarding again
/// (to rehearse the demo): `LIFE_ONBOARDING=1 pnpm tauri dev`.
/// LIFE_REPLAY=1 uses saved model answers only, for the whole launch.
/// `firstLoad` is true only for the first page load of this launch.
#[tauri::command]
fn launch_flags() -> serde_json::Value {
    let asked = std::env::var("LIFE_ONBOARDING").is_ok_and(|v| v == "1");
    // `swap` sets the flag and returns what it was before, in one step.
    let onboarding = asked && !ONBOARDING_FLAG_USED.swap(true, Ordering::SeqCst);
    let replay = std::env::var("LIFE_REPLAY").is_ok_and(|v| v == "1");
    let first_load = !PAGE_LOADED.swap(true, Ordering::SeqCst);
    serde_json::json!({ "onboarding": onboarding, "replay": replay, "firstLoad": first_load })
}

/// Turns on the menu bar menu's Settings once onboarding is done, because
/// setup has no Settings.
#[tauri::command]
fn set_menu_settings(app: AppHandle, enabled: bool) {
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.settings.set_enabled(enabled);
    }
}

/// Whether the palette is on screen right now. The UI asks after a page
/// reload, when it has missed the shown/hidden events.
#[tauri::command]
fn palette_visible(app: AppHandle) -> bool {
    app.get_webview_window(palette::LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// The only web pages the app may open: the real complaint bodies' own forms.
/// Exact addresses, so the page can't ask for anything else on those sites.
const COMPLAINT_PAGES: [&str; 3] = [
    "https://www.tio.com.au/complaints",
    "https://www.ewov.com.au/start-a-complaint",
    "https://www.consumer.vic.gov.au/contact-us/resolve-your-problem/general-complaint",
];

/// The Seal button: opens the Mac's own app for the fix. An email link
/// ("mailto:...") opens Mail with the draft filled in, "calendar" opens the
/// Calendar app, and a complaint body's page opens in the browser. Nothing else
/// is allowed. Phone links are refused on purpose: the businesses' numbers are
/// samples and must never really be dialled. Nothing is sent: Maya does that in
/// Mail herself.
#[tauri::command]
fn open_external(target: String) -> Result<(), String> {
    // `open` is the Mac's "open this like a double-click" tool. The link is passed
    // as one argument (no shell in between), so its text can't run anything.
    let mut open = std::process::Command::new("open");
    if target == "calendar" {
        // -b picks the app by its bundle id: Apple's Calendar.
        open.args(["-b", "com.apple.iCal"]);
    } else if target.starts_with("mailto:") || COMPLAINT_PAGES.contains(&target.as_str()) {
        open.arg(&target);
    } else {
        return Err("Only email, Calendar and complaint-body links can be opened".into());
    }
    open.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Onboarding's first step: while armed, the next hotkey press proves the user
/// knows it, instead of hiding the window.
#[tauri::command]
fn set_summon_test(armed: bool) {
    palette::set_summon_test(armed);
}

/// Chooses the summon hotkey (onboarding's "Use Cmd+Shift+Space instead", and
/// Settings): `fallback` true is Cmd+Shift+Space, false is Option+Space. Drops
/// the current one, registers the choice and remembers it for next launch.
/// Returns the labels of the key that registered.
#[tauri::command]
fn use_fallback_hotkey(app: AppHandle, state: State<ActiveHotkey>, fallback: bool) -> Vec<String> {
    let _ = app.global_shortcut().unregister_all();
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join(HOTKEY_CHOICE_FILE), if fallback { "fallback" } else { "default" });
    }
    let keys = register_hotkey(&app, fallback);
    if let Ok(mut active) = state.0.lock() {
        *active = keys.clone();
    }
    // Keeps the shortcut shown in the menu bar menu in step with the new key.
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.open.set_accelerator(shortcut_for(&keys));
    }
    keys
}

/// Try each hotkey in turn and return the labels of the one that worked.
/// With `fallback_first`, Cmd+Shift+Space is tried before Option+Space.
fn register_hotkey(app: &AppHandle, fallback_first: bool) -> Vec<String> {
    let mut order = HOTKEYS.to_vec();
    if fallback_first {
        order.reverse();
    }
    for (shortcut, labels) in order {
        // The handler fires on both key down and key up; only act on key down.
        let result = app
            .global_shortcut()
            .on_shortcut(shortcut, |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    palette::toggle(app);
                }
            });
        match result {
            Ok(()) => return labels.iter().map(|s| s.to_string()).collect(),
            Err(err) => eprintln!("Could not register {shortcut}: {err}"),
        }
    }
    Vec::new()
}

/// The menu bar icon and its menu. It is the way back in if the hotkey could
/// not be registered. Passing each shortcut as an "accelerator" makes macOS
/// draw it itself, in grey at the right of the row.
fn build_tray(app: &AppHandle, hotkey: &[String]) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", format!("Open {APP_NAME}"), true, shortcut_for(hotkey))?;
    // Starts greyed out: the UI turns it on once onboarding is done.
    let settings = MenuItem::with_id(app, "settings", "Settings", false, Some("CmdOrCtrl+,"))?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &separator, &settings, &quit])?;
    app.manage(TrayItems { open: open.clone(), settings: settings.clone() });

    TrayIconBuilder::with_id("main")
        // A black-on-transparent "template" image: macOS recolours it to suit
        // light or dark menu bars.
        .icon(tauri::include_image!("icons/tray.png"))
        .icon_as_template(true)
        .tooltip(APP_NAME)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => palette::show(app),
            "settings" => {
                palette::show(app);
                let _ = app.emit("palette:open-settings", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // "Accessory" means no Dock icon and no Cmd+Tab entry: the app
            // lives in the menu bar. Its window still shows in Mission Control.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let hotkey = register_hotkey(app.handle(), prefers_fallback(app.handle()));
            build_tray(app.handle(), &hotkey)?;
            app.manage(ActiveHotkey(Mutex::new(hotkey)));
            app.manage(llm::LlmConfig::load());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_palette,
            active_hotkey,
            show_palette,
            launch_flags,
            use_fallback_hotkey,
            set_menu_settings,
            set_summon_test,
            palette_visible,
            open_external,
            llm::llm_request,
            llm::llm_configured,
            llm::llm_check
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
