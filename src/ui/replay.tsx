import type { Finding } from "../agent/pipeline";
import { Tip } from "./layers";
import type { ScanState } from "../lib/scan-store";
import { copy } from "../copy";

// How saved answers (replay) are labelled. The rule: an answer that came from
// an earlier run is never shown as live. The banner says why the check used
// saved answers; when a check is part live, part saved, each finding from a
// saved answer carries its own label too.

/** Which parts of a finding came from saved answers. */
export function savedParts(f: Finding): { judged: boolean; drafted: boolean } {
  return { judged: f.judgedBy.source === "cache", drafted: f.draft?.source === "cache" };
}

export function fromSaved(f: Finding): boolean {
  const s = savedParts(f);
  return s.judged || s.drafted;
}

/**
 * True when some findings are live and some are from saved answers, so rows
 * need their own "Saved answer" label. (A single call can still fall back on
 * its own, e.g. after a 400.) When the whole check ran on saved answers, the
 * banner says it once instead.
 */
export function mixedReplay(scan: ScanState): boolean {
  return scan.findings.some(fromSaved) && scan.findings.some((f) => !fromSaved(f));
}

/** The banner under the top bar, or nothing for a live check. */
export function replayNote(scan: ScanState): React.ReactNode | undefined {
  const why = scan.replay?.why;
  if (!why && !scan.usedReplay) return undefined;
  // A check that couldn't finish has no answers to label; its error says why.
  if (scan.phase === "error" && scan.findings.length === 0) return undefined;
  const words = copy.replay;
  let text: string;
  switch (why) {
    case "forced": {
      // Started with a flag: say so; otherwise it was chosen in the demo panel.
      const detail = scan.replay?.detail;
      const byFlag = detail === copy.endpoint.startedWithFlag || detail === copy.endpoint.startedWithQuery;
      text = words.forced(byFlag && detail ? detail.replace(/\.$/, "") : words.youChose);
      break;
    }
    case "lost":
    case "offline":
    case "key_rejected":
    case "not_set_up":
    case "unavailable":
    case "browser":
      text = words[why];
      break;
    default:
      text = words.some;
  }
  return (
    <>
      <span className="font-semibold text-text">{words.lead}</span> {text}
    </>
  );
}

/** The small "Saved answer" tag. */
export function SavedTag({ title }: { title?: string }) {
  return (
    <Tip content={title ?? copy.replay.tagTitle}>
      <span className="shrink-0 rounded-full border border-info/30 px-2 py-px text-meta text-info">{copy.replay.tag}</span>
    </Tip>
  );
}

/** One line in an open finding saying which parts are saved answers. */
export function SavedNote({ finding }: { finding: Finding }) {
  const s = savedParts(finding);
  if (!s.judged && !s.drafted) return null;
  const text = s.judged && s.drafted ? copy.replay.judgedAndDrafted : s.judged ? copy.replay.judged : copy.replay.drafted;
  return <p className="mt-3 font-mono text-label text-info">{text}</p>;
}
