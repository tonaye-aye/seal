import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import { Palette } from "./ui/Palette/Palette";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPaletteHidden } from "./lib/native";
import { getScan, startBackgroundChecks, startScan } from "./lib/scan-store";
import { getConnectors } from "./connectors/live";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

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
  // Run the monthly check as soon as the app starts, so the findings are ready
  // (or well on the way) by the time the palette is first summoned.
  void startScan();

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
      drafts: async () => (await getConnectors()).email.listDrafts(),
    };
  }

  root.render(
    <React.StrictMode>
      <Palette />
    </React.StrictMode>,
  );
}
