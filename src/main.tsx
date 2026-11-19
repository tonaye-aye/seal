import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import { Palette } from "./ui/Palette/Palette";
import { startScan } from "./lib/scan-store";

// Run the monthly check as soon as the app starts, so the findings are ready
// (or well on the way) by the time the palette is first summoned.
void startScan();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Palette />
  </React.StrictMode>,
);
