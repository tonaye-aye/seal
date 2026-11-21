import type { Finding } from "../agent/pipeline";
import type { TraceLine } from "../lib/scan-store";
import { copy } from "../copy";

// The trace for one finding (the trace icon in its button row, or T inside
// it): what the agent did for this case, written by code from the finding's
// own record. The check's live trace is about the whole run and only names a
// finding when it is found or drafted, so this one is rebuilt from what the
// finding keeps: its evidence, the figures code checked, which model judged it
// and how long that took, any doubts, and each try at the draft.

/** A trace line with no time of its own (the finding's record keeps how long each model call took, which goes in the words). */
export type FindingTraceLine = Omit<TraceLine, "t"> & { t?: number };

const words = copy.trace.finding;

/** "Qwen 3.6 35B" for "basecompute/qwen3.6-35b-a3b"; anything unknown keeps its name after the slash. */
export function modelName(id: string): string {
  return words.models[id] ?? id.split("/").pop() ?? id;
}

/** "in 4.9s", or "from saved answers" when the reply was replayed. */
function how(source: "live" | "cache", ms: number): string {
  return source === "cache" ? words.fromSaved : words.took((ms / 1000).toFixed(1));
}

export function findingTrace(f: Finding): FindingTraceLine[] {
  const lines: FindingTraceLine[] = [];
  const add = (text: string, tone: TraceLine["tone"] = "info") => lines.push({ id: lines.length + 1, text, tone });

  // What it gathered, by kind, and how much of it the verdict relies on.
  const count = (kind: Finding["evidence"][number]["kind"]) => f.evidence.filter((e) => e.kind === kind).length;
  const parts = [
    [count("email"), words.emails],
    [count("doc"), words.documents],
    [count("txn"), words.bankLines],
    [count("event"), words.events],
  ] as const;
  const gathered = parts.filter(([n]) => n > 0).map(([n, label]) => label(n));
  add(words.gathered(gathered.join(", "), f.evidence.filter((e) => e.cited).length));

  if (f.figures.length) add(words.figures(f.figures.length), "good");

  // Mid-sentence, so the kind's capital goes ("paying twice").
  const label = copy.shared.kind[f.kind];
  const kind = label.charAt(0).toLowerCase() + label.slice(1);
  add(words.judged(modelName(f.judgedBy.model), how(f.judgedBy.source, f.judgedBy.ms), kind, f.confidence));
  for (const doubt of f.doubts) add(words.doubt(doubt), "warn");

  const draft = f.draft;
  if (!draft) {
    add(f.action.kind === "none" ? words.nothingToDraft : words.noDraftYet);
    return lines;
  }
  // Each try at the draft, in order: Flash first, the 35B only if Flash's draft failed the claim check.
  for (const attempt of draft.attempts) {
    const model = modelName(attempt.model);
    const took = how(attempt.source, attempt.ms);
    if (attempt.problems.length) add(words.draftFailed(model, took, attempt.problems.join("; ")), "warn");
    else add(words.draftPassed(model, took), "good");
  }
  add(draft.grounded ? copy.trace.drafted(draft.to.name) : copy.trace.draftedUnchecked(draft.to.name), draft.grounded ? "good" : "warn");
  return lines;
}
