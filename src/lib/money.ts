// Money is kept as whole cents (integers) everywhere in code, so adding and
// comparing amounts never suffers from floating point rounding (0.1 + 0.2).

/** "17.99" or "1,485.54" to 1799 / 148554. Empty text means no amount (null). */
export function parseCents(text: string): number | null {
  const clean = text.trim().replace(/[$,\s]/g, "");
  if (clean === "") return null;
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) throw new Error(`Not a money amount: "${text}"`);
  const [, minus, dollars, cents = "0"] = match;
  const value = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  return minus ? -value : value;
}

/** 148554 to "$1,485.54" (Australian dollars). Negative shows as "-$12.00". */
export function formatAUD(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-AU");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
