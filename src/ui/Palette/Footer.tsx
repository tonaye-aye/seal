import { hidePalette } from "../../lib/native";
import { KeyButton } from "../Kbd";
import { SimulatingChip } from "./ScenariosSheet";
import { StatusStrip } from "./StatusStrip";

// Bottom bar: the four connections on the left, the keys that always work on
// the right (each can also be clicked). In mouse mode the key caps are hidden.
// While a demo failure is switched on, an amber "Simulating" chip sits between them.
export function Footer({
  hotkey,
  mouse,
  onTrace,
  onKeys,
  onScenarios,
}: {
  hotkey: string[];
  mouse: boolean;
  onTrace: () => void;
  onKeys: () => void;
  onScenarios: () => void;
}) {
  return (
    <footer className="flex h-10 shrink-0 items-center justify-between gap-3 border-t border-hairline px-3 text-[11.5px]">
      <div className="flex min-w-0 items-center gap-2">
        <StatusStrip />
        <SimulatingChip onClick={onScenarios} />
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <KeyButton keys={["T"]} label="Trace" tone="faint" mouse={mouse} onClick={onTrace} />
        <KeyButton keys={["?"]} label="Keys" tone="faint" mouse={mouse} onClick={onKeys} />
        <KeyButton keys={hotkey.length > 0 ? hotkey : ["Esc"]} label={hotkey.length > 0 ? "Hide" : "Close"} tone="faint" mouse={mouse} onClick={hidePalette} />
      </div>
    </footer>
  );
}
