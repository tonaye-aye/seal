import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import { Palette } from "./ui/Palette/Palette";
import { CrashBoundary } from "./ui/CrashScreen";
import { LayerProvider } from "./ui/layers";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPaletteHidden } from "./lib/native";
import { getScan, restoreLastCheck, startBackgroundChecks, startScan } from "./lib/scan-store";
import { getConnectors } from "./connectors/live";
import { launchFlags, showPalette } from "./lib/native";
import { getOnboarding, onboardingDone, resetOnboarding, resumeOnboarding } from "./lib/onboarding";
import { checkEndpoint, getEndpoint, setReplayFlag } from "./lib/endpoint";

/**
 * At launch: after onboarding, reopen the last finished check so the findings
 * are ready. With none to reopen, run the monthly check straight away. Before
 * onboarding is done, pick it up where it was left. Either way the window
 * opens at launch, but a later page reload leaves it as it was, unless
 * onboarding is still running. LIFE_ONBOARDING=1
 * (desktop) or ?onboarding (browser) starts onboarding again from an empty
 * account and forgets the saved check. LIFE_REPLAY=1 (or ?replay) uses saved
 * model answers only for this launch. The model endpoint is always checked
 * (a new check does it itself), so the app knows if live rewrites can run.
 */
async function boot() {
  const flags = await launchFlags().catch(() => ({ onboarding: false, replay: false, firstLoad: true }));
  if (flags.replay) setReplayFlag(true);
  if (flags.onboarding) await resetOnboarding();
  if (onboardingDone()) {
    if (restoreLastCheck()) void checkEndpoint();
    else void startScan();
    if (flags.firstLoad) showPalette();
    return;
  }
  void checkEndpoint();
  resumeOnboarding();
  showPalette();
}

/**
 * Dev only: __life.crash() in the console makes this throw while React draws.
 * It has to be during drawing, because the crash screen can't catch errors
 * from clicks, keys or background work.
 */
function DevCrash() {
  const [crashed, setCrashed] = React.useState(false);
  React.useEffect(() => {
    const w = window as unknown as { __life?: Record<string, unknown> };
    w.__life = { ...w.__life, crash: () => setCrashed(true) };
  }, []);
  if (crashed) throw new Error("Test crash from __life.crash()");
  return null;
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// In a plain browser tab there is no desktop behind the window: paint a
// backdrop so the panel's round corners don't sit on white.
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
    new WebviewWindow("gallery", { url: "/", title: "Seal gallery", maximized: true, focus: true });
  };
  const palette = () => (isTauri() && getCurrentWindow().label === "gallery" ? getCurrentWindow().close() : go(""));
  w.__life = { ...w.__life, gallery: openGallery, palette };
  if (gallery) {
    void import("./gallery/Gallery").then(({ Gallery }) =>
      root.render(
        <React.StrictMode>
          <LayerProvider>
            <Gallery />
          </LayerProvider>
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
      <CrashBoundary>
        <LayerProvider>
          <Palette />
          {import.meta.env.DEV && <DevCrash />}
        </LayerProvider>
      </CrashBoundary>
    </React.StrictMode>,
  );
}
