// Date helpers that always work in the household's time zone (Melbourne),
// whatever time zone the computer running the app is set to. Melbourne
// switches between UTC+10 and UTC+11 for daylight saving, so offsets are
// looked up per moment rather than hard-coded.

import { TIME_ZONE } from "./clock.ts";

/** Minutes ahead of UTC in `timeZone` at a given moment (600 or 660 for Melbourne). */
export function zoneOffsetMinutes(instant: Date, timeZone = TIME_ZONE): number {
  const label =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(label);
  if (!match) return 0; // "GMT" on its own means an offset of zero
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/**
 * The moment a Melbourne wall-clock time happens, e.g. ("2026-12-05", "09:00").
 * Used to expand repeating calendar events: "every Saturday at 9" stays at 9
 * even when daylight saving starts or ends.
 */
export function zonedInstant(localDate: string, localTime: string, timeZone = TIME_ZONE): Date {
  const asIfUtc = Date.parse(`${localDate}T${localTime}:00Z`);
  // First guess the offset, then correct it once (enough for real time zones).
  const guess = asIfUtc - zoneOffsetMinutes(new Date(asIfUtc), timeZone) * 60_000;
  return new Date(asIfUtc - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000);
}

/** Local date and time parts of a moment in `timeZone`. */
function localParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** "2026-11-19" for a moment, in Melbourne. */
export function localDate(instant: Date, timeZone = TIME_ZONE): string {
  return localParts(instant, timeZone).date;
}

/** "2026-12-05T09:00+11:00": the same shape the seed data uses. */
export function toZonedIso(instant: Date, timeZone = TIME_ZONE): string {
  const { date, time } = localParts(instant, timeZone);
  const offset = zoneOffsetMinutes(instant, timeZone);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${date}T${time}${sign}${hh}:${mm}`;
}

/** Calendar-day arithmetic on "YYYY-MM-DD" text, e.g. addDays("2026-11-28", -14). */
export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Day of the week for "YYYY-MM-DD": 0 is Sunday, 6 is Saturday. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
