import { useEffect, useRef, useState } from "react";
import { activeHotkey, hidePalette, onPaletteShown } from "../../lib/native";
import { CommandBar } from "./CommandBar";
import { EmptyFindings } from "./EmptyFindings";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { StatusStrip } from "./StatusStrip";

// The summoned palette. It fills the native window; the window itself is
// transparent with a macOS blur behind, so this panel adds the warm tint.
export function Palette() {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Bumped on every summon so React remounts the panel and the entrance
  // animation plays again.
  const [openCount, setOpenCount] = useState(0);
  const [hotkey, setHotkey] = useState<string[]>([]);

  useEffect(() => {
    activeHotkey().then(setHotkey).catch(() => setHotkey([]));
    return onPaletteShown(() => {
      if (inputRef.current) inputRef.current.value = "";
      setOpenCount((n) => n + 1);
    });
  }, []);

  // Land focus on the panel (not the input) each time it opens.
  useEffect(() => {
    panelRef.current?.focus();
  }, [openCount]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const input = inputRef.current;
      const typing = document.activeElement === input;

      if (event.key === "/" && !typing) {
        event.preventDefault();
        input?.focus();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Esc steps back one level: clear the text, then leave the input,
        // then close the palette.
        if (typing && input && input.value) {
          input.value = "";
        } else if (typing) {
          panelRef.current?.focus();
        } else {
          hidePalette();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      key={openCount}
      ref={panelRef}
      tabIndex={-1}
      className="palette-enter flex h-full flex-col overflow-hidden rounded-[14px] border border-white/[0.06] bg-bg/[0.86] outline-none"
    >
      <Header />
      <CommandBar ref={inputRef} />
      <div className="h-px bg-hairline" />
      <EmptyFindings />
      <StatusStrip />
      <Footer hotkey={hotkey} />
    </div>
  );
}
