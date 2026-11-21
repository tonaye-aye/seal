import { copy } from "../../copy";
import { RULE_REASONS, type Rule, type RuleReason } from "../../lib/rules";
import { Kbd } from "../Kbd";
import { ruleUntil } from "../rule-words";

// The three answers to "why isn't it a leak?", on keys 1, 2 and 3. The caps
// always show, so nothing shifts between keyboard and mouse.

export function RuleChoices({ chosen, onChoose }: { chosen?: RuleReason; onChoose: (reason: RuleReason) => void }) {
  return (
    <div role="group" aria-label={copy.rules.question} className="flex items-center gap-1">
      {RULE_REASONS.map((reason, i) => (
        <button
          key={reason}
          type="button"
          tabIndex={-1}
          aria-pressed={reason === chosen}
          // Focus stays on the palette, so its keys keep working after a click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChoose(reason)}
          className={`press flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-meta whitespace-nowrap hover:bg-hairline hover:text-text ${
            reason === chosen ? "bg-hairline text-text" : "text-muted"
          }`}
        >
          <Kbd keys={[String(i + 1)]} />
          {copy.rules.reasons[reason]}
        </button>
      ))}
    </div>
  );
}

/** On a finding marked "Not a leak": what Maya said, or a way to say it now. */
export function SetAsideNote({ rule, onChoose }: { rule?: Rule; onChoose: (reason: RuleReason) => void }) {
  const reason = rule?.reason;
  return (
    <section aria-label={copy.rules.question} className="mb-3 rounded-md bg-raised/60 px-3 py-2.5">
      <h3 className="text-small font-semibold text-text">{reason ? copy.rules.youSaid[reason] : copy.rules.question}</h3>
      <p className="mt-0.5 mb-2 text-meta text-muted">{reason && rule ? ruleUntil(rule) : copy.rules.askLater}</p>
      <div className="-ml-1.5">
        <RuleChoices chosen={reason} onChoose={onChoose} />
      </div>
    </section>
  );
}
