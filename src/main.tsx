import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import { Palette } from "./ui/Palette/Palette";
import { onPaletteHidden, onPaletteShown } from "./lib/native";
import { getScan, startBackgroundChecks, startScan } from "./lib/scan-store";
import { getConnectors } from "./connectors/live";

// Run the monthly check as soon as the app starts, so the findings are ready
// (or well on the way) by the time the palette is first summoned.
void startScan();

// Then check again every 30 minutes while the app sits in the menu bar. The
// window starts hidden; these events keep track of whether it is open.
let hidden = true;
onPaletteShown(() => (hidden = false));
onPaletteHidden(() => (hidden = true));
startBackgroundChecks(() => hidden);

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Palette />
  </React.StrictMode>,
);
