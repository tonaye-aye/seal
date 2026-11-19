// The app's idea of "now". It is fixed so the seed data always lines up with
// the story (the household's monthly check on Thu 19 Nov 2026, 9:30 am in
// Melbourne). All logic asks this module for the time, never the real clock.

export const TIME_ZONE = "Australia/Melbourne";

// Melbourne is on daylight saving time (UTC+11) in November.
const FIXED_NOW = "2026-11-19T09:30:00+11:00";

export function now(): Date {
  return new Date(FIXED_NOW);
}

/** "Thu 19 Nov": short day label in Melbourne time. */
export function formatDay(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: TIME_ZONE,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}
