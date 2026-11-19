import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import { Palette } from "./ui/Palette/Palette";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Palette />
  </React.StrictMode>,
);
