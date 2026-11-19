import { hidePalette } from "../../lib/native";
import { KeyButton } from "../Kbd";
import { StatusStrip } from "./StatusStrip";

// Bottom bar: the four connections on the left, the keys that always work on
// the right (each can also be clicked).
export function Footer({ hotkey, onTrace, onKeys }: { hotkey: string[]; onTrace: () => void; onKeys: () => void }) {
  return (
    <footer className="flex h-10 shrink-0 items-center justify-between gap-3 border-t border-hairline px-3 text-[11.5px]">
      <StatusStrip />
      <div className="flex shrink-0 items-center gap-2.5">
        <KeyButton keys={["T"]} label="Trace" tone="faint" onClick={onTrace} />
        <KeyButton keys={["?"]} label="Keys" tone="faint" onClick={onKeys} />
        <KeyButton keys={hotkey.length > 0 ? hotkey : ["Esc"]} label={hotkey.length > 0 ? "Hide" : "Close"} tone="faint" onClick={hidePalette} />
      </div>
    </footer>
  );
}
