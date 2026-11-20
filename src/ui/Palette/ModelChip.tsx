import { useState } from "react";
import { Cpu } from "lucide-react";
import { toggleSavedOnly, useEndpoint, useModelDemo, type EndpointState, type EndpointStatus } from "../../lib/endpoint";
import { startScan, useScan } from "../../lib/scan-store";
import { CheckNowIcon } from "../icons";
import { copy } from "../../copy";
import { Kbd } from "../Kbd";
import { Menu, MenuItem, Tip } from "../layers";
import { DOT, StatusRow } from "./StatusStrip";
import { ago } from "./Timeline";

// The model endpoint in the footer. Hidden while it answers normally, so the
// footer stays calm. When it is slow, can't be reached, or saved answers are
// in use, a chip says so; clicking it opens a menu to try live again or
// switch to saved answers. The Connectors menu also lists it as a row.

const CHIP: Partial<Record<EndpointState, { text: string; tone: "info" | "danger" }>> = {
  slow: { text: copy.model.chip.slow, tone: "info" },
  offline: { text: copy.model.chip.offline, tone: "danger" },
  key_rejected: { text: copy.model.chip.key_rejected, tone: "danger" },
  not_set_up: { text: copy.model.chip.not_set_up, tone: "danger" },
  unavailable: { text: copy.model.chip.unavailable, tone: "danger" },
  forced: { text: copy.model.chip.forced, tone: "info" },
  browser: { text: copy.model.chip.browser, tone: "info" },
};

/** What the endpoint is doing, in a few words (the Connectors menu row and the chip's menu). */
export function endpointText(e: EndpointStatus): string {
  const words = copy.model.state;
  if (e.state === "live" || e.state === "slow") return words[e.state](e.ms);
  return words[e.state];
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
  const note = e.state === "slow" || e.state === "forced" || e.state === "browser";
  return <StatusRow dot={endpointDot(e.state)} label={copy.model.title} state={endpointText(e)} tone={bad ? "danger" : note ? "info" : "faint"} tip={e.detail} />;
}

export function ModelChip({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const e = useEndpoint();
  const demo = useModelDemo();
  const scan = useScan();
  const [open, setOpen] = useState(defaultOpen);
  const chip = CHIP[e.state];
  if (!chip) return null;
  const checking = scan.phase === "scanning" || scan.refreshing;
  const tone = chip.tone === "danger" ? "border-danger/30 text-danger hover:bg-danger/10" : "border-info/30 text-info hover:bg-info/10";
  const canTryLive = !checking && e.state !== "forced" && e.state !== "browser";
  const choose = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  return (
    <div className="min-w-0">
      <Menu
        open={open}
        onOpenChange={setOpen}
        label={copy.model.title}
        shortcuts={canTryLive ? { r: () => void startScan() } : undefined}
        trigger={
          <Tip content={e.detail}>
            <button
              type="button"
              tabIndex={-1}
              className={`press fade-in flex h-6 min-w-0 cursor-pointer items-center gap-1.5 truncate rounded-full border px-2.5 text-meta ${tone}`}
            >
              <Cpu size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{chip.text}</span>
            </button>
          </Tip>
        }
      >
          <p className="px-2.5 pt-1.5 pb-1 label text-faint">{copy.model.title}</p>
          <div className="w-[330px] px-2.5 pb-2 text-meta">
            <p className="flex flex-wrap items-center gap-x-2 text-text">
              <span className={`size-1.5 shrink-0 rounded-full ${endpointDot(e.state)}`} aria-hidden="true" />
              {endpointText(e)}
              {e.checkedAt && <span className="font-mono text-label whitespace-nowrap text-faint">{copy.model.checkedAgo(ago(e.checkedAt))}</span>}
            </p>
            {e.detail && <p className="mt-1 text-muted">{e.detail}</p>}
            <p className="mt-1 text-faint">{copy.model.savedNote}</p>
          </div>
          {canTryLive && (
            <MenuItem icon={<CheckNowIcon />} label={copy.model.tryLive} keys={<Kbd keys={["R"]} />} onSelect={choose(() => void startScan())} />
          )}
          {e.state !== "browser" && !demo.byFlag && (
            <MenuItem
              icon={<Cpu size={14} strokeWidth={1.75} aria-hidden="true" />}
              label={demo.saved ? copy.model.goLive : copy.model.useSaved}
              onSelect={choose(toggleSavedOnly)}
            />
          )}
          {demo.byFlag && <p className="px-2.5 pb-1.5 text-meta text-faint">{copy.model.byFlag}</p>}
      </Menu>
    </div>
  );
}
