// Fake family calendar. Like a real calendar API it expands repeating events
// (RRULE) into individual occurrences for the dates asked about. New events
// can be added only through createEvent, which the UI calls after Maya
// confirms. The optional "token expired" scenario fails every call with a 401
// until reconnect() is called.

import { now } from "../lib/clock.ts";
import { addDays, localDate, toZonedIso, weekday, zonedInstant } from "../lib/dates.ts";
import { ConnectorError, networkDelay, once, type ConnectorRuntime } from "./runtime.ts";
import type { CalendarInstance, EventInput } from "./types.ts";

export type EventQuery = {
  /** Inclusive "YYYY-MM-DD" bounds, Melbourne. */
  from: string;
  to: string;
};

export interface CalendarConnector {
  listEvents(query: EventQuery): Promise<CalendarInstance[]>;
  createEvent(input: EventInput): Promise<CalendarInstance>;
  /** Removes an event the agent created (this is how "undo" works). */
  deleteEvent(id: string): Promise<void>;
  /** Signs in again after the token expired. */
  reconnect(): Promise<void>;
}

type RawEvent = {
  id: string;
  calendar: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  notes: string;
  location: string;
  createdBy: string;
  createdAt: string;
  recurrence: string | null;
};

// ---------- Repeat rules ----------

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

type Rule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  byDay?: number[]; // 0 = Sunday
  until?: Date;
  count?: number;
};

/** Reads the common parts of an iCalendar repeat rule, e.g. "FREQ=WEEKLY;BYDAY=SA". */
export function parseRule(text: string): Rule {
  const fields = Object.fromEntries(
    text
      .replace(/^RRULE:/, "")
      .split(";")
      .map((pair) => pair.split("=") as [string, string]),
  );
  if (!["DAILY", "WEEKLY", "MONTHLY"].includes(fields.FREQ)) {
    throw new Error(`Unsupported repeat rule: ${text}`);
  }
  const until = fields.UNTIL
    ? // "20261212T000000Z" to "2026-12-12T00:00:00Z"
      new Date(fields.UNTIL.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"))
    : undefined;
  return {
    freq: fields.FREQ as Rule["freq"],
    interval: Number(fields.INTERVAL ?? 1),
    byDay: fields.BYDAY?.split(",").map((code: string) => DAY_CODES.indexOf(code)),
    until,
    count: fields.COUNT ? Number(fields.COUNT) : undefined,
  };
}

/** Local start date, time ("HH:MM", absent for all-day) and length of an event. */
function splitStart(event: RawEvent) {
  if (event.allDay) return { date: event.start.slice(0, 10), time: undefined, lengthMs: 0 };
  const startMs = Date.parse(event.start);
  const endMs = event.end ? Date.parse(event.end) : startMs;
  return { date: event.start.slice(0, 10), time: event.start.slice(11, 16), lengthMs: endMs - startMs };
}

/** Every start date the rule produces, in order, up to `lastDate`. */
function* ruleDates(firstDate: string, rule: Rule, lastDate: string): Generator<string> {
  const step = rule.interval;
  if (rule.freq === "DAILY") {
    for (let d = firstDate; d <= lastDate; d = addDays(d, step)) yield d;
    return;
  }
  if (rule.freq === "WEEKLY") {
    const days = [...(rule.byDay ?? [weekday(firstDate)])].sort(
      // Weeks start on Monday (the iCalendar default), so Sunday sorts last.
      (a, b) => ((a + 6) % 7) - ((b + 6) % 7),
    );
    let monday = addDays(firstDate, -((weekday(firstDate) + 6) % 7));
    while (monday <= lastDate) {
      for (const day of days) {
        const date = addDays(monday, (day + 6) % 7);
        if (date >= firstDate && date <= lastDate) yield date;
      }
      monday = addDays(monday, 7 * step);
    }
    return;
  }
  // MONTHLY on the same day of the month; months without that day are skipped.
  const [year, month, day] = firstDate.split("-").map(Number);
  for (let i = 0; ; i += step) {
    const y = year + Math.floor((month - 1 + i) / 12);
    const m = ((month - 1 + i) % 12) + 1;
    const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (date > lastDate) return;
    if (new Date(`${date}T00:00:00Z`).getUTCDate() === day) yield date;
  }
}

/** The occurrences of one event that fall between `from` and `to`. */
export function expandEvent(event: RawEvent, from: string, to: string): CalendarInstance[] {
  const { date: firstDate, time, lengthMs } = splitStart(event);
  const base = {
    eventId: event.id,
    calendar: event.calendar,
    title: event.title,
    allDay: event.allDay,
    notes: event.notes,
    location: event.location,
    createdBy: event.createdBy,
    createdAt: event.createdAt,
  };

  const occurrence = (date: string, recurring: boolean): CalendarInstance => {
    const id = recurring ? `${event.id}:${date}` : event.id;
    if (!time) return { ...base, id, start: date, recurring };
    const start = zonedInstant(date, time);
    return {
      ...base,
      id,
      start: toZonedIso(start),
      end: toZonedIso(new Date(start.getTime() + lengthMs)),
      recurring,
    };
  };

  if (!event.recurrence) {
    const day = firstDate;
    return day >= from && day <= to ? [occurrence(day, false)] : [];
  }

  const rule = parseRule(event.recurrence);
  const out: CalendarInstance[] = [];
  let produced = 0;
  for (const date of ruleDates(firstDate, rule, to)) {
    const startsAt = time ? zonedInstant(date, time) : new Date(`${date}T00:00:00Z`);
    if (rule.until && startsAt > rule.until) break;
    if (rule.count !== undefined && produced >= rule.count) break;
    produced += 1;
    if (date >= from) out.push(occurrence(date, true));
  }
  return out;
}

// ---------- Connector ----------

export function createCalendarConnector(runtime: ConnectorRuntime): CalendarConnector {
  const created: RawEvent[] = [];
  let createdCount = 0;
  let signedIn = !runtime.scenarios.has("calendar_reauth");

  // Switching the scenario on again expires the token again.
  runtime.scenarios.subscribe(() => {
    if (runtime.scenarios.has("calendar_reauth")) signedIn = false;
  });

  const load = once(async () => {
    const file = JSON.parse(await runtime.source.readText("calendar/events.json")) as {
      events: RawEvent[];
    };
    return file.events;
  });

  function checkToken() {
    if (!signedIn) {
      throw new ConnectorError({
        connector: "calendar",
        code: "unauthorized",
        status: 401,
        message: "Calendar access expired. Reconnect to keep checking deadlines.",
      });
    }
  }

  return {
    async listEvents({ from, to }) {
      await networkDelay(runtime, "calendar");
      checkToken();
      const events = [...(await load()), ...created];
      return events
        .flatMap((event) => expandEvent(event, from, to))
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    },

    async createEvent(input) {
      await networkDelay(runtime, "calendar");
      checkToken();
      createdCount += 1;
      const event: RawEvent = {
        id: `evt_new_${String(createdCount).padStart(3, "0")}`,
        calendar: input.calendar,
        title: input.title,
        start: input.start,
        end: input.end ?? null,
        allDay: input.allDay,
        notes: input.notes ?? "",
        location: "",
        createdBy: "Agent (approved by Maya)",
        createdAt: toZonedIso(now()),
        recurrence: null,
      };
      created.push(event);
      const day = input.start.slice(0, 10);
      return expandEvent(event, day, day)[0];
    },

    async deleteEvent(id) {
      await networkDelay(runtime, "calendar");
      checkToken();
      const index = created.findIndex((e) => e.id === id);
      if (index >= 0) created.splice(index, 1);
    },

    async reconnect() {
      await networkDelay(runtime, "calendar");
      signedIn = true;
    },
  };
}

/** All-day events sort before timed ones on the same day. */
function sortKey(instance: CalendarInstance): string {
  if (instance.allDay) return `${instance.start} 0`;
  return `${localDate(new Date(instance.start))} 1 ${instance.start}`;
}
