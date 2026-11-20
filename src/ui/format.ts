// Small helpers that turn agent data into words for the screen (the words
// themselves live in src/copy.ts).

import type { Finding } from "../agent/pipeline.ts";
import type { Figure } from "../agent/verify.ts";
import { now } from "../lib/clock.ts";
import { daysBetween, localDate } from "../lib/dates.ts";
import { formatAUD } from "../lib/money.ts";
import { copy } from "../copy.ts";

/** "2026-11-28" to "28 Nov". Adds the year only when it isn't this year. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const thisYear = Number(localDate(now()).slice(0, 4));
  return `${d} ${copy.dates.shortMonths[m - 1]}${y === thisYear ? "" : ` ${y}`}`;
}

/** Days from today (Melbourne) to a date. */
export function daysUntil(iso: string): number {
  return daysBetween(localDate(now()), iso.slice(0, 10));
}

/** Deadlines this close are "soon": the only ones shown in amber. */
export const SOON_DAYS = 7;
/** Deadlines this close are "near": brighter than later ones, but not amber. */
export const NEAR_DAYS = 14;

/** How pressing a deadline is: soon (amber), near, later, or none at all. */
export type Urgency = "soon" | "near" | "later" | "none";
export function urgency(date: string | undefined): Urgency {
  if (!date) return "none";
  const days = daysUntil(date);
  return days <= SOON_DAYS ? "soon" : days <= NEAR_DAYS ? "near" : "later";
}

/** "2026-11-19T09:30+11:00" to "9:30 am". */
export function clockTime(iso: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return iso;
  const h = Number(match[1]);
  return `${h % 12 || 12}:${match[2]} ${h < 12 ? copy.dates.am : copy.dates.pm}`;
}

/** A figure's value as Maya would read it. */
export function figureValue(f: Figure): string {
  const v = f.value;
  switch (f.unit) {
    case "cents":
      return formatAUD(Number(v));
    case "date":
      return shortDate(String(v));
    case "days":
      return copy.figures.days(v);
    case "kwh":
      return copy.figures.kwh(Number(v).toLocaleString("en-AU"));
    case "percent":
      return copy.figures.percent(v);
    case "cents_per_kwh":
      return copy.figures.centsPerKwh(v);
    case "yes_no":
      return v ? copy.figures.yes : copy.figures.no;
    default:
      return String(v);
  }
}

/** The one number shown on a finding's row. */
export function headlineAmount(f: Finding): { cents: number; label: string } | undefined {
  if (f.amounts.atStake !== undefined) return { cents: f.amounts.atStake, label: copy.shared.amount.atStake };
  if (f.amounts.recoverable !== undefined) return { cents: f.amounts.recoverable, label: copy.shared.amount.recoverable };
  if (f.amounts.perMonth !== undefined) return { cents: f.amounts.perMonth, label: copy.shared.amount.perMonth };
  return undefined;
}

/** Low confidence, or anything code doubted: show "Not sure". */
export function isUnsure(f: Finding): boolean {
  return f.confidence === "low" || f.doubts.length > 0;
}
