import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import { Palette } from "./ui/Palette/Palette";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPaletteHidden } from "./lib/native";
import { getScan, startBackgroundChecks, startScan } from "./lib/scan-store";
import { getConnectors } from "./connectors/live";
import { launchFlags, showPalette } from "./lib/native";
import { getOnboarding, onboardingDone, resetOnboarding, resumeOnboarding } from "./lib/onboarding";
import { checkEndpoint, getEndpoint, setReplayFlag } from "./lib/endpoint";

/**
 * At launch: after onboarding, run the monthly check straight away so the
 * findings are ready (or well on the way) by the time the palette is first
 * summoned. Before that, pick onboarding up where it was left and show the
 * palette, so the welcome is waiting. LIFE_ONBOARDING=1 (desktop) or
 * ?onboarding (browser) starts onboarding again from an empty account.
 * LIFE_REPLAY=1 (or ?replay) uses saved model answers only for this launch.
 * Either way the model endpoint is checked first (the scan does it itself).
 */
async function boot() {
  const flags = await launchFlags().catch(() => ({ onboarding: false, replay: false }));
  if (flags.replay) setReplayFlag(true);
  if (flags.onboarding) await resetOnboarding();
  if (onboardingDone()) {
    void startScan();
    return;
  }
  void checkEndpoint();
  resumeOnboarding();
  showPalette();
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// In a plain browser tab there is no native blur behind the window: paint a
// dark backdrop so the translucent panel doesn't sit on white.
if (!isTauri()) document.documentElement.dataset.preview = "";

// Dev only: #/gallery (or the app's "gallery" window) shows every palette
// state from sample data, with no scan. In a production build
// import.meta.env.DEV is false, so this whole branch (and the gallery files)
// is left out of the bundle.
const gallery = import.meta.env.DEV && (location.hash === "#/gallery" || (isTauri() && getCurrentWindow().label === "gallery"));

if (import.meta.env.DEV) {
  const w = window as unknown as { __life?: Record<string, unknown> };
  const go = (hash: string) => {
    location.hash = hash;
    location.reload();
  };
  // From the console. In a browser the page itself switches. In the desktop
  // app the gallery opens in its own normal window, maximized (the palette
  // is small, always on top and hides when it loses focus), and
  // __life.palette() in that window closes it.
  const openGallery = async () => {
    if (!isTauri()) return go("#/gallery");
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const open = await WebviewWindow.getByLabel("gallery");
    if (open) {
      await open.unminimize();
      return open.setFocus();
    }
    new WebviewWindow("gallery", { url: "/", title: "Life gallery", maximized: true, focus: true });
  };
  const palette = () => (isTauri() && getCurrentWindow().label === "gallery" ? getCurrentWindow().close() : go(""));
  w.__life = { ...w.__life, gallery: openGallery, palette };
  if (gallery) {
    void import("./gallery/Gallery").then(({ Gallery }) =>
      root.render(
        <React.StrictMode>
          <Gallery />
        </React.StrictMode>,
      ),
    );
  }
}

if (!gallery) {
  void boot();

  // Then check again every 30 minutes while the app sits in the menu bar
  // (only while the palette is hidden, so results never change under Maya).
  startBackgroundChecks(isPaletteHidden);

  // Dev only, from the webview console: run a background check now, read the
  // scan state, or list what is in the Drafts folder.
  if (import.meta.env.DEV) {
    const w = window as unknown as { __life?: Record<string, unknown> };
    w.__life = {
      ...w.__life,
      checkInBackground: () => startScan({ background: true }),
      state: getScan,
      endpoint: getEndpoint,
      checkEndpoint,
      drafts: async () => (await getConnectors()).email.listDrafts(),
      resetOnboarding,
      onboarding: getOnboarding,
    };
  }

  root.render(
    <React.StrictMode>
      <Palette />
    </React.StrictMode>,
  );
}
