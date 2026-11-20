import { useState } from "react";
import { Cpu } from "lucide-react";
import { toggleSavedOnly, useEndpoint, useModelDemo, type EndpointState, type EndpointStatus } from "../../lib/endpoint";
import { startScan, useScan } from "../../lib/scan-store";
import { CheckNowIcon } from "../icons";
import { Kbd } from "../Kbd";
import { Menu, MenuItem } from "./Menu";
import { DOT } from "./StatusStrip";
import { ago } from "./Timeline";

// The model endpoint in the footer. Hidden while it answers normally, so the
// footer stays calm. When it is slow, can't be reached, or saved answers are
// in use, a chip says so; clicking it opens a menu to try live again or
// switch to saved answers. The Connectors menu also lists it as a row.

const CHIP: Partial<Record<EndpointState, { text: string; tone: "amber" | "danger" }>> = {
  slow: { text: "Model: slow", tone: "amber" },
  offline: { text: "Model: offline", tone: "danger" },
  key_rejected: { text: "Model: key not accepted", tone: "danger" },
  not_set_up: { text: "Model: not set up", tone: "danger" },
  unavailable: { text: "Model: error", tone: "danger" },
  forced: { text: "Model: saved answers", tone: "amber" },
  browser: { text: "Model: saved answers", tone: "amber" },
};

/** What the endpoint is doing, in a few words (the Connectors menu row and the chip's menu). */
export function endpointText(e: EndpointStatus): string {
  switch (e.state) {
    case "unknown":
      return "Not checked yet";
    case "checking":
      return "Checking…";
    case "live":
      return e.ms !== undefined ? `Live, answered in ${(e.ms / 1000).toFixed(1)} s` : "Live";
    case "slow":
      return e.ms !== undefined ? `Slow, a tiny test took ${(e.ms / 1000).toFixed(1)} s` : "Slow";
    case "offline":
      return "Can't reach it";
    case "key_rejected":
      return "Key not accepted";
    case "not_set_up":
      return "No API key";
    case "unavailable":
      return "Answered with an error";
    case "forced":
      return "Saved answers only";
    case "browser":
      return "Saved answers (browser)";
  }
}

export function endpointDot(state: EndpointState): string {
  if (state === "live") return DOT.ok;
  if (state === "checking" || state === "unknown") return DOT.connecting;
  if (state === "slow" || state === "forced" || state === "browser") return DOT.retrying;
  return DOT.error;
}

/** A row for the Connectors menu: the model endpoint, next to the data sources. */
export function ModelRow() {
  const e = useEndpoint();
  const bad = CHIP[e.state]?.tone === "danger";
  return (
    <li className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px]" title={e.detail}>
      <span className={`size-1.5 shrink-0 rounded-full ${endpointDot(e.state)}`} aria-hidden="true" />
      <span className="flex-1 text-text">Model endpoint</span>
      <span className={`font-mono text-[11px] ${bad ? "text-danger" : e.state === "slow" || e.state === "forced" || e.state === "browser" ? "text-amber" : "text-faint"}`}>
        {endpointText(e)}
      </span>
    </li>
  );
}

export function ModelChip({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const e = useEndpoint();
  const demo = useModelDemo();
  const scan = useScan();
  const [open, setOpen] = useState(defaultOpen);
  const chip = CHIP[e.state];
  if (!chip) return null;
  const checking = scan.phase === "scanning" || scan.refreshing;
  const tone = chip.tone === "danger" ? "border-danger/30 text-danger hover:bg-danger/10" : "border-amber/30 text-amber hover:bg-amber-glow/20";
  const choose = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        tabIndex={-1}
        data-menu-button
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(ev) => ev.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        title={e.detail}
        className={`fade-in flex h-6 min-w-0 cursor-pointer items-center gap-1.5 truncate rounded-full border px-2.5 text-[11.5px] ${tone}`}
      >
        <Cpu size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{chip.text}</span>
      </button>
      <Menu open={open} onClose={() => setOpen(false)} label="Model endpoint">
        <p className="px-2.5 pt-1.5 pb-1 font-mono text-[10.5px] tracking-[0.06em] text-faint uppercase">Model endpoint</p>
        <div className="w-[330px] px-2.5 pb-2 text-[12px]">
          <p className="flex flex-wrap items-center gap-x-2 text-text">
            <span className={`size-1.5 shrink-0 rounded-full ${endpointDot(e.state)}`} aria-hidden="true" />
            {endpointText(e)}
            {e.checkedAt && <span className="font-mono text-[11px] whitespace-nowrap text-faint">checked {ago(e.checkedAt)}</span>}
          </p>
          {e.detail && <p className="mt-1 text-muted">{e.detail}</p>}
          <p className="mt-1 text-faint">Saved answers come from an earlier run and are always labelled Replay mode.</p>
        </div>
        {!checking && e.state !== "forced" && e.state !== "browser" && (
          <MenuItem icon={<CheckNowIcon />} label="Try live again" keys={<Kbd keys={["R"]} />} onSelect={choose(() => void startScan())} />
        )}
        {e.state !== "browser" && !demo.byFlag && (
          <MenuItem
            icon={<Cpu size={14} strokeWidth={1.75} aria-hidden="true" />}
            label={demo.saved ? "Go back to live answers" : "Use saved answers only"}
            onSelect={choose(toggleSavedOnly)}
          />
        )}
        {demo.byFlag && <p className="px-2.5 pb-1.5 text-[11.5px] text-faint">Started with LIFE_REPLAY=1. Restart without it to go live.</p>}
      </Menu>
    </div>
  );
}
