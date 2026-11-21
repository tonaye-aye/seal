// "Remind me" (key L): the calendar reminder Seal adds for a finding, only
// when Maya asks. This file works out its date and words; the scan store
// adds it to the calendar, keeps it, and undoes it.

import type { Finding } from "../agent/pipeline.ts";
import type { EventInput } from "../connectors/types.ts";
import { copy } from "../copy.ts";
import { shortDate } from "../ui/format.ts";
import { now } from "./clock.ts";
import { addDays, localDate } from "./dates.ts";

/** Days before a deadline the reminder lands, so there is time to act. */
const DAYS_BEFORE = 2;
/** With no deadline: how long to give the business to reply. */
const REPLY_DAYS = 14;

export type Reminder = {
  /** The calendar event, once it is in the calendar (undefined if putting it back after a restart failed). */
  eventId?: string;
  /** All-day, "YYYY-MM-DD". */
  date: string;
  title: string;
  /** Real time it was added (for "4 min ago" on the timeline). */
  at: number;
};

/**
 * The day to remind Maya: two days before the deadline, but never before
 * tomorrow, and never after the deadline itself. With no deadline, two weeks
 * from today (time for a reply).
 */
export function reminderDate(finding: Finding, today = localDate(now())): string {
  const tomorrow = addDays(today, 1);
  const deadline = finding.deadline?.date;
  if (!deadline) return addDays(today, REPLY_DAYS);
  const early = addDays(deadline, -DAYS_BEFORE);
  const date = early < tomorrow ? tomorrow : early;
  // A deadline today: remind today, not after it.
  return date > deadline ? (deadline < today ? today : deadline) : date;
}

/** The calendar event for a finding. Once approved, it's about checking for a reply. */
export function reminderEvent(finding: Finding, approved: boolean): EventInput {
  const words = copy.reminders;
  const date = reminderDate(finding);
  const title = approved
    ? words.checkReplied(finding.merchant)
    : finding.deadline
      ? words.beforeDeadline(finding.merchant, finding.deadline.label, shortDate(finding.deadline.date))
      : words.lookAgain(finding.merchant);
  return { calendar: words.calendar, title: `${title} ${words.suffix}`, start: date, allDay: true, notes: words.notes(finding.title) };
}
