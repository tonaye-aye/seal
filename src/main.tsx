import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import { Palette } from "./ui/Palette/Palette";
import { sync } from "./connectors/live";

// Sync the connectors as soon as the app starts, so the palette has data
// ready by the time it is first summoned.
void sync();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Palette />
  </React.StrictMode>,
);
