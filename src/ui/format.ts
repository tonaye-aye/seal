// Small helpers that turn agent data into words for the screen.

import type { FindingKind } from "../agent/judge.ts";
import type { Finding } from "../agent/pipeline.ts";
import type { Figure } from "../agent/verify.ts";
import { now } from "../lib/clock.ts";
import { daysBetween, localDate } from "../lib/dates.ts";
import { formatAUD } from "../lib/money.ts";

export const KIND_LABEL: Record<FindingKind, string> = {
  price_increase: "Price rise",
  duplicate_subscription: "Paying twice",
  duplicate_payment: "Paid twice",
  trial_converted: "Trial ended",
  renewal_trap: "Renewal",
  renewal_price_creep: "Renewal price",
  billing_error: "Bill error",
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-28" to "28 Nov". Adds the year only when it isn't this year. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const thisYear = Number(localDate(now()).slice(0, 4));
  return `${d} ${SHORT_MONTHS[m - 1]}${y === thisYear ? "" : ` ${y}`}`;
}

/** Days from today (Melbourne) to a date. */
export function daysUntil(iso: string): number {
  return daysBetween(localDate(now()), iso.slice(0, 10));
}

export function daysText(days: number): string {
  if (days < 0) return days === -1 ? "yesterday" : `${-days} days ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** Deadlines this close are "soon" and shown in amber. */
export const SOON_DAYS = 14;

/** "2026-11-19T09:30+11:00" to "9:30 am". */
export function clockTime(iso: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return iso;
  const h = Number(match[1]);
  return `${h % 12 || 12}:${match[2]} ${h < 12 ? "am" : "pm"}`;
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
      return `${v} days`;
    case "kwh":
      return `${Number(v).toLocaleString("en-AU")} kWh`;
    case "percent":
      return `${v}%`;
    case "cents_per_kwh":
      return `${v}c per kWh`;
    case "yes_no":
      return v ? "Yes" : "No";
    default:
      return String(v);
  }
}

/** The one number shown on a finding's row. */
export function headlineAmount(f: Finding): { cents: number; label: string } | undefined {
  if (f.amounts.atStake !== undefined) return { cents: f.amounts.atStake, label: "at stake" };
  if (f.amounts.recoverable !== undefined) return { cents: f.amounts.recoverable, label: "to recover" };
  if (f.amounts.perMonth !== undefined) return { cents: f.amounts.perMonth, label: "a month" };
  return undefined;
}

/** Low confidence, or anything code doubted: show "Not sure". */
export function isUnsure(f: Finding): boolean {
  return f.confidence === "low" || f.doubts.length > 0;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
