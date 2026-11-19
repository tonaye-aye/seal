// The native shell. It stays thin on purpose: window, hotkey and menu bar icon.
// Everything the user sees is built in React (see src/).

mod llm;
mod palette;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, State, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Placeholder product name, shown in the menu bar menu. Kept in sync with
/// APP_NAME in src/lib/app.ts until the real name is chosen.
const APP_NAME: &str = "Life";

/// Hotkeys to try, in order. The first one that registers wins. Option+Space
/// is often taken (Raycast, Alfred), so we fall back rather than fail.
/// Each entry is (shortcut for the plugin, key labels for the UI).
const HOTKEYS: [(&str, &[&str]); 2] = [
    ("Alt+Space", &["⌥", "Space"]),
    ("CommandOrControl+Shift+Space", &["⌘", "⇧", "Space"]),
];

/// The hotkey that actually registered, so the UI can show the right hint.
/// Empty if none could be registered (the menu bar icon still works).
struct ActiveHotkey(Vec<String>);

/// Called by the UI on Esc.
#[tauri::command]
fn hide_palette(app: AppHandle) {
    palette::hide(&app);
}

/// Called by the UI to label the hotkey hint in the footer.
#[tauri::command]
fn active_hotkey(state: State<ActiveHotkey>) -> Vec<String> {
    state.0.clone()
}

/// Try each hotkey in turn and return the labels of the one that worked.
fn register_hotkey(app: &AppHandle) -> Vec<String> {
    for (shortcut, labels) in HOTKEYS {
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

/// The menu bar icon with a two-item menu. It is the way back in if the
/// hotkey could not be registered.
fn build_tray(app: &AppHandle, hotkey: &[String]) -> tauri::Result<()> {
    let open_label = if hotkey.is_empty() {
        format!("Open {APP_NAME}")
    } else {
        format!("Open {APP_NAME}    {}", hotkey.join(""))
    };
    let open = MenuItem::with_id(app, "open", open_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", format!("Quit {APP_NAME}"), true, Some("CmdOrCtrl+Q"))?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &separator, &quit])?;

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
            // lives in the menu bar and appears only when summoned.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let hotkey = register_hotkey(app.handle());
            build_tray(app.handle(), &hotkey)?;
            app.manage(ActiveHotkey(hotkey));
            app.manage(llm::LlmConfig::load());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Clicking into another app hides the palette, like Spotlight.
            if let WindowEvent::Focused(false) = event {
                if palette::HIDE_ON_BLUR && window.label() == palette::LABEL {
                    palette::hide(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            hide_palette,
            active_hotkey,
            llm::llm_request,
            llm::llm_configured
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
