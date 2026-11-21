// Firmer and Shorter: steer the agent's email without a chat box.
// Quiet secondary controls, so no violet (that's Approve). They sit in a row
// docked under the draft, so the row doesn't move when the text changes length.

import { Scissors, Shield, type LucideIcon } from "lucide-react";
import type { Finding } from "../../agent/pipeline";
import { VERBS, type Verb } from "../../agent/rewrite";
import { copy } from "../../copy";
import { activeVerb } from "../../lib/draft-versions";
import { isEdited, useScan } from "../../lib/scan-store";
import { Kbd } from "../Kbd";
import { Tip } from "../layers";

/** Shift plus a number: matched on the physical key, because Shift+1 types "!". */
export const VERB_BY_CODE: Record<string, Verb> = { Digit1: "firmer", Digit2: "shorter" };

const ICON: Record<Verb, LucideIcon> = { firmer: Shield, shorter: Scissors };

function VerbButton({
  verb,
  index,
  active,
  busy,
  disabled,
  mouse,
  onPress,
}: {
  verb: Verb;
  index: number;
  active: boolean;
  busy: boolean;
  disabled: boolean;
  mouse: boolean;
  onPress: () => void;
}) {
  const Icon = ICON[verb];
  const tone = disabled
    ? "cursor-default text-faint opacity-60"
    : active
      ? "cursor-pointer bg-raised font-semibold text-text"
      : "cursor-pointer text-muted hover:bg-raised hover:text-text";
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      aria-pressed={active}
      // Keep keyboard focus on the palette, so the keys keep working after a click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={`press inline-flex h-6.5 shrink-0 items-center gap-1.5 rounded-md px-1.5 leading-none whitespace-nowrap ${busy ? "shimmer text-text" : tone}`}
    >
      {mouse ? <Icon size={14} strokeWidth={1.75} aria-hidden="true" /> : <Kbd keys={["⇧", String(index + 1)]} />}
      {copy.verbs.name[verb]}
    </button>
  );
}

export function DraftVerbs({
  finding,
  editing,
  mouse,
  onVerb,
}: {
  finding: Finding;
  editing: boolean;
  mouse: boolean;
  onVerb: (verb: Verb) => void;
}) {
  const scan = useScan();
  const original = scan.findings.find((f) => f.id === finding.id)?.draft;
  const entry = scan.rewrites[finding.id];
  const active = activeVerb(original, entry);
  const busy = scan.rewriting[finding.id];
  const edited = isEdited(finding.id, scan);
  const blocked = editing ? copy.verbs.finishEditing : edited ? copy.verbs.revertTip : undefined;
  const version = active ? entry?.versions[active] : undefined;

  let status: React.ReactNode = null;
  if (busy) status = copy.verbs.writing(copy.verbs.name[busy]);
  else if (edited) status = copy.verbs.editedNote;
  else if (version) {
    status = (
      <>
        {version.source === "cache" ? copy.verbs.checkedSaved : copy.verbs.checked}
        <Kbd keys={["⌘", "Z"]} />
        {copy.verbs.backHint}
      </>
    );
  }

  return (
    <div role="group" aria-label={copy.verbs.label} className="flex h-10 shrink-0 items-center justify-between gap-3 px-5 text-meta">
      <div className="flex items-center gap-1">
        {VERBS.map((verb, index) => {
          const button = (
            <VerbButton
              verb={verb}
              index={index}
              active={active === verb}
              busy={busy === verb}
              disabled={!!blocked}
              mouse={mouse}
              onPress={() => onVerb(verb)}
            />
          );
          // A disabled button doesn't report the pointer, so the tooltip hangs on a wrapper.
          return (
            <Tip key={verb} content={blocked}>
              {blocked ? <span className="inline-flex">{button}</span> : button}
            </Tip>
          );
        })}
      </div>
      <span role="status" className="inline-flex min-w-0 items-center gap-1.5 truncate text-faint">
        {status}
      </span>
    </div>
  );
}
