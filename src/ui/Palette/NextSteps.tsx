import { Bell, ExternalLink } from "lucide-react";
import type { Finding } from "../../agent/pipeline";
import { now } from "../../lib/clock";
import { addDays, localDate } from "../../lib/dates";
import type { Escalation } from "../../agent/routes";
import { useScan, type ScanState } from "../../lib/scan-store";
import { copy } from "../../copy";
import { expectation } from "../next-steps";
import { sealNote, sealTarget } from "../seal";
import { chosenRoute } from "../fix-route";
import { SampleChip } from "./RoutePanel";
import { KeyButton } from "../Kbd";
import { AttachIcon, EditIcon, RemoveReminderIcon } from "../icons";
import { hasAttachmentWork, notFileLines, type MailAttachments } from "../mail-attachments";
import { Tip } from "../layers";
import { daysUntil, shortDate, urgency } from "../format";
import { DOT, RAIL, weekdayOf } from "./Timeline";

// What happens now that Maya has approved a finding, or asked to be reminded:
// a small timeline in the same style as the timeline view. Done steps have a
// tick; what's coming has a dot (amber within 7 days, like everywhere else).
// Plain words from code: the app doesn't check that any of it happens.

type Line = {
  key: string;
  /** "YYYY-MM-DD"; a step with no date of its own leaves the date column empty. */
  date?: string;
  done?: boolean;
  title: string;
  /** Said after the title on the same line, quieter (who the saved draft is to, and its subject). */
  aside?: string;
  detail?: string;
  /** The saved draft: hovering the line shows a pencil that edits it (takes the approval back). */
  editable?: boolean;
  /** Where to go if the business says no: this line gets a button to open it. */
  escalate?: Escalation;
  /** What Maya must add in Mail herself, because a mail link can't carry files. */
  attachments?: MailAttachments;
};

/** The timeline's lines, in order: what's done, what Maya does next, then what's coming by date. */
export function nextLines(finding: Finding, scan: ScanState): Line[] {
  const approved = finding.status === "approved";
  const reminder = scan.reminders[finding.id];
  const today = localDate(now());
  const lines: Line[] = [];
  const dated: Line[] = [];

  const route = chosenRoute(finding, scan);
  const other = route && route.kind !== "email" ? route : undefined;
  if (approved && route && route.kind !== "email") {
    // A call, chat or online step: nothing was saved, so it says which way was approved.
    lines.push({ key: "approved", date: today, done: true, title: copy.routes.chosen[route.kind], aside: `${route.provider}, ${route.label}` });
  } else if (approved) {
    // The draft itself is hidden once approved: this line says what was saved, and a pencil (on hover) edits it.
    const draft = finding.draft;
    lines.push(
      draft
        ? { key: "approved", date: today, done: true, title: copy.next.saved, aside: copy.detail.draftTo(draft.to.name, draft.subject), editable: true }
        : { key: "approved", date: today, done: true, title: copy.next.handled },
    );
  }
  if (reminder) {
    lines.push({ key: "reminded", date: today, done: true, title: copy.next.reminderCreated, detail: copy.next.reminderCreatedFor(shortDate(reminder.date)) });
    dated.push({ key: "reminder", date: reminder.date, title: copy.next.reminderDue, detail: reminder.title.replace(` ${copy.reminders.suffix}`, "") });
  }
  const expect = approved ? expectation(finding, scan) : undefined;
  if (approved) {
    // Sending the draft (or the step Maya takes herself), and what the Seal button opens for it.
    const target = sealTarget(finding, scan.corpus, scan);
    const title = other && other.kind !== "email" ? copy.routes.doIt[other.kind] : finding.draft ? copy.next.sendIt : finding.action.summary;
    const attachments = target?.kind === "email" && hasAttachmentWork(target.attachments) ? target.attachments : undefined;
    lines.push({ key: "send", title, detail: target && sealNote(target), attachments });
    // If the business says no: a dated next step, only where somewhere can actually take it.
    const body = finding.fix?.escalation;
    if (body) dated.push({ key: "escalate", date: addDays(today, body.afterDays), title: copy.routes.escalate.title(body.shortName), detail: body.whenToUse, escalate: body });
  }
  if (finding.deadline) {
    // The deadline itself; once approved, what to expect by then.
    dated.push({ key: "deadline", date: finding.deadline.date, title: finding.deadline.label, detail: expect && copy.next.thenExpect(expect) });
  }
  // A warranty has a second date that matters: the claim itself must be in by the day it ends.
  const claimBy = finding.kind === "warranty_claim" ? finding.figures.find((f) => f.id === "warranty_ends")?.value : undefined;
  if (typeof claimBy === "string" && claimBy !== finding.deadline?.date) {
    dated.push({ key: "claim-by", date: claimBy, title: copy.next.warrantyEnds });
  }
  // An expectation with no deadline to hang it on (a refund, a credit) follows the step,
  // ahead of the dated lines, so "If they say no" reads as what comes after it.
  if (expect && !finding.deadline) lines.push({ key: "expect", title: copy.next.thenExpect(expect) });
  dated.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  lines.push(...dated);
  return lines;
}

/**
 * Shown once a finding is approved or has a reminder. The Seal button itself is
 * in the top bar, where Approve was. The "Send it" line says what it opens.
 */
export function NextSteps({
  finding,
  mouse,
  onEdit,
  onRemoveReminder,
  onEscalate,
}: {
  finding: Finding;
  mouse: boolean;
  onEdit: () => void;
  /** O, or the button on the "If they say no" line. */
  onEscalate: () => void;
  /** The notice's Remove reminder (L again does the same): out of the calendar, and Remind me comes back. */
  onRemoveReminder: () => void;
}) {
  const scan = useScan();
  const reminder = scan.reminders[finding.id];
  const lines = nextLines(finding, scan);
  return (
    <div className="mb-4">
      {reminder && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-md border border-info/25 bg-info/8 px-3 py-2 text-meta text-text">
          <Bell size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-info" />
          <span className="min-w-0 flex-1">{copy.next.remindedIn(copy.dates.days(daysUntil(reminder.date)), shortDate(reminder.date))}</span>
          <KeyButton keys={["L"]} label={copy.next.removeReminder} icon={<RemoveReminderIcon />} mouse={mouse} onClick={onRemoveReminder} />
        </div>
      )}
      <h3 className="mb-1 label text-faint">{copy.next.title}</h3>
      <ol aria-label={copy.next.title} className="flex flex-col">
        {lines.map((line, i) => (
          // Like the timeline view, a date shows once, on the first line of its day.
          <NextLine
            key={line.key}
            line={line}
            showDate={!!line.date && line.date !== lines[i - 1]?.date}
            first={i === 0}
            last={i === lines.length - 1}
            mouse={mouse}
            onEdit={onEdit}
            onEscalate={onEscalate}
          />
        ))}
      </ol>
    </div>
  );
}

/** The files to add in Mail, by their real names, and anything the draft claims that isn't a file. */
function AddInMail({ attachments }: { attachments: MailAttachments }) {
  return (
    <span className="mt-1.5 block text-meta">
      {attachments.files.length > 0 && (
        <>
          <span className="block text-muted">{copy.next.attachments.add}</span>
          <span role="list" className="mt-0.5 flex flex-col gap-0.5">
            {attachments.files.map((file) => (
              <span role="listitem" key={file} className="flex min-w-0 items-center gap-1.5 text-text">
                <span className="shrink-0 text-faint">
                  <AttachIcon />
                </span>
                <span className="min-w-0 truncate font-mono">{file}</span>
              </span>
            ))}
          </span>
        </>
      )}
      {notFileLines(attachments).map((text) => (
        <span key={text} className="mt-1 block text-muted">
          {text}
        </span>
      ))}
    </span>
  );
}

function NextLine({
  line,
  showDate,
  first,
  last,
  mouse,
  onEdit,
  onEscalate,
}: {
  line: Line;
  showDate: boolean;
  first: boolean;
  last: boolean;
  mouse: boolean;
  onEdit: () => void;
  onEscalate: () => void;
}) {
  const days = line.date && !line.done ? daysUntil(line.date) : undefined;
  const tone = line.date && !line.done ? urgency(line.date) : "none";
  const soon = tone === "soon";
  // With files listed the line is tall, so its button and dot stay level with its title.
  const tall = !!line.attachments;
  return (
    <li className={`group flex min-h-10 gap-3 py-1 text-small ${tall ? "items-start" : "items-center"}`}>
      {/* The date, as the timeline view writes it: day number over the weekday. */}
      <span className="flex w-8 shrink-0 flex-col items-end leading-none">
        {line.date && showDate && (
          <>
            <span className={`figure text-small ${soon ? "text-amber" : line.done ? "text-muted" : "text-text"}`}>{Number(line.date.slice(8, 10))}</span>
            <span className="mt-0.5 font-mono text-label text-faint uppercase">{weekdayOf(line.date)}</span>
          </>
        )}
      </span>
      {/* The rail: a hairline joining the dots, from the first dot to the last. */}
      <span className={`${RAIL} relative self-stretch ${tall ? "items-start pt-2.5" : "items-center"}`}>
        <span
          className={`absolute left-1/2 w-px -translate-x-1/2 bg-hairline ${first ? (tall ? "top-3.5" : "top-1/2") : "top-0"} ${last ? (tall ? "h-3.5" : "bottom-1/2") : "bottom-0"}`}
          aria-hidden="true"
        />
        {line.done ? (
          <span className="relative grid size-4 place-items-center rounded-full bg-positive/15 text-positive" aria-label={copy.next.doneLabel}>
            <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
              {/* Only the approval's tick can draw itself (useDrawTick in motion.ts). */}
              <path
                d="m2.5 6.5 2.25 2.25L9.5 3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={line.key === "approved" ? 1 : undefined}
                data-draw-tick={line.key === "approved" ? "" : undefined}
              />
            </svg>
          </span>
        ) : (
          <span className={`relative rounded-full ${soon ? DOT.soon : DOT.upcoming}`} aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`flex min-w-0 items-center gap-1.5 ${tall ? "min-h-7" : ""}`}>
          <span className={`min-w-0 truncate ${line.done ? "text-muted" : "font-medium text-text"}`}>
            {line.title}
            {line.aside && <span className="text-faint">: {line.aside}</span>}
          </span>
          {/* The saved draft: a pencil appears on hover, the same as Edit (E). */}
          {line.editable && (
            <Tip content={copy.actions.edit} keys={["E"]}>
              <button
                type="button"
                tabIndex={-1}
                aria-label={copy.actions.edit}
                onMouseDown={(e) => e.preventDefault()}
                onClick={onEdit}
                className="press grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-faint opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 hover:bg-raised hover:text-text focus-visible:opacity-100"
              >
                <EditIcon />
              </button>
            </Tip>
          )}
        </span>
        {line.detail && <span className="mt-0.5 block text-meta text-faint">{line.detail}</span>}
        {line.attachments && <AddInMail attachments={line.attachments} />}
      </span>
      {line.escalate && (
        <span className="flex shrink-0 items-center gap-2 text-meta">
          {!line.escalate.real && <SampleChip />}
          <Tip content={line.escalate.real ? copy.routes.escalate.realTip(line.escalate.shortName) : copy.routes.escalate.sampleTip(line.escalate.shortName)}>
            <span className="inline-flex">
              <KeyButton
                keys={["O"]}
                label={copy.routes.escalate.open(line.escalate.shortName)}
                icon={<ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />}
                tone="muted"
                mouse={mouse}
                onClick={onEscalate}
              />
            </span>
          </Tip>
        </span>
      )}
      {days !== undefined && (
        <span className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 figure text-label ${soon ? "bg-amber-glow text-amber" : "text-faint"}`}>
          {copy.dates.days(days)}
        </span>
      )}
    </li>
  );
}
