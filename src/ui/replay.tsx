import type { Finding } from "../agent/pipeline";
import type { ScanState } from "../lib/scan-store";

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

const EARLIER = "so these answers are from an earlier run, not live from the model.";

/** The banner under the top bar, or nothing for a live check. */
export function replayNote(scan: ScanState): React.ReactNode | undefined {
  const why = scan.replay?.why;
  if (!why && !scan.usedReplay) return undefined;
  // A check that couldn't finish has no answers to label; its error says why.
  if (scan.phase === "error" && scan.findings.length === 0) return undefined;
  const lead = <span className="font-medium text-amber">Replay mode.</span>;
  switch (why) {
    case "forced":
      return (
        <>
          {lead} {scan.replay?.detail?.startsWith("Started with") ? scan.replay.detail.replace(/\.$/, "") : "You chose saved answers"}: everything here is from an
          earlier run,
          not live from the model.
        </>
      );
    case "lost":
      return (
        <>
          {lead} Lost the model endpoint partway through, so the check was redone from saved answers: everything here is from an earlier run.
        </>
      );
    case "offline":
      return (
        <>
          {lead} Couldn't reach the model endpoint, {EARLIER}
        </>
      );
    case "key_rejected":
      return (
        <>
          {lead} The model endpoint didn't accept the API key, {EARLIER}
        </>
      );
    case "not_set_up":
      return (
        <>
          {lead} The model endpoint isn't set up (no API key), {EARLIER}
        </>
      );
    case "unavailable":
      return (
        <>
          {lead} The model endpoint answered with an error, {EARLIER}
        </>
      );
    case "browser":
      return (
        <>
          {lead} Browser preview: there's no model connection here, {EARLIER}
        </>
      );
    default:
      return (
        <>
          {lead} Some answers are saved replies from an earlier run, not live from the model.
        </>
      );
  }
}

/** The small "Saved answer" tag. */
export function SavedTag({ title }: { title?: string }) {
  return (
    <span className="shrink-0 rounded-full border border-amber/30 px-2 py-px text-[11px] text-amber" title={title ?? "From a saved answer, not live from the model"}>
      Saved answer
    </span>
  );
}

/** One line in an open finding saying which parts are saved answers. */
export function SavedNote({ finding }: { finding: Finding }) {
  const s = savedParts(finding);
  if (!s.judged && !s.drafted) return null;
  const text =
    s.judged && s.drafted
      ? "Judged and drafted from saved answers, from an earlier run, not live from the model."
      : s.judged
        ? "Judged from a saved answer, from an earlier run. The draft is live."
        : "The draft is a saved answer from an earlier run. The judgment is live.";
  return <p className="mt-3 font-mono text-[10.5px] text-amber">{text}</p>;
}
