import type { EndpointState, EndpointStatus } from "../../lib/endpoint";
import { copy } from "../../copy";
import { DOT } from "./StatusStrip";

// How the model endpoint's state reads in the Settings menu and its Models tab.

const NOTICE: Partial<Record<EndpointState, { text: string; tone: "info" | "danger" }>> = {
  slow: { text: copy.model.chip.slow, tone: "info" },
  offline: { text: copy.model.chip.offline, tone: "danger" },
  key_rejected: { text: copy.model.chip.key_rejected, tone: "danger" },
  not_set_up: { text: copy.model.chip.not_set_up, tone: "danger" },
  unavailable: { text: copy.model.chip.unavailable, tone: "danger" },
  forced: { text: copy.model.chip.forced, tone: "info" },
  browser: { text: copy.model.chip.browser, tone: "info" },
};

/** The models, in the order they work on a check. */
export const MODEL_ROLES = ["fast", "judge", "flash"] as const;

/** What the endpoint is doing, in a few words. */
export function endpointText(e: EndpointStatus): string {
  const words = copy.model.state;
  if (e.state === "live" || e.state === "slow") return words[e.state](e.ms);
  return words[e.state];
}

/** The shortest version, for a row in the Settings menu. */
export function modelNote(state: EndpointState): string {
  if (NOTICE[state]) return NOTICE[state].text;
  return state === "live" ? copy.model.chip.live : copy.model.chip.checking;
}

export function endpointDot(state: EndpointState): string {
  if (state === "live") return DOT.ok;
  if (state === "checking" || state === "unknown") return DOT.connecting;
  if (state === "slow" || state === "forced" || state === "browser") return DOT.retrying;
  return DOT.error;
}

/** The colour for the endpoint's state in words. */
export function endpointTone(state: EndpointState): string {
  const tone = NOTICE[state]?.tone;
  return tone === "danger" ? "text-danger" : tone === "info" ? "text-info" : "text-faint";
}

/** Whether the endpoint needs a look, for the dot on the Settings cog. */
export function modelAttention(state: EndpointState): "info" | "danger" | undefined {
  return NOTICE[state]?.tone;
}
