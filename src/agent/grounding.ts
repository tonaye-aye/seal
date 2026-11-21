// Checks that a value a model gave us really appears in the source text.
// Small models can copy a number wrongly or invent one; these checks catch
// that before any number is trusted. The same checks guard drafts later.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Does the money amount (in cents) appear in the text, e.g. "$1,485.54" or "99.00"? */
export function amountIn(cents: number, text: string): boolean {
  const flat = text.replace(/(\d),(\d{3})/g, "$1$2");
  const dollars = cents / 100;
  const forms = new Set([dollars.toFixed(2)]);
  if (cents % 100 === 0) forms.add(String(dollars)); // "$99" for 9900
  return [...forms].some((form) =>
    new RegExp(`(^|[^0-9.])${form.replace(".", "\\.")}(?![0-9]|\\.[0-9])`).test(flat),
  );
}

/** Does a plain number (kWh, months, days) appear in the text, e.g. "47,570"? */
export function numberIn(value: number, text: string): boolean {
  const flat = text.replace(/(\d),(\d{3})/g, "$1$2");
  // A whole number may be written with zero decimals: 4 matches "4.0%".
  const zeros = Number.isInteger(value) ? "(?:\\.0+)?" : "";
  return new RegExp(`(^|[^0-9.])${String(value).replace(".", "\\.")}${zeros}(?![0-9]|\\.[0-9])`).test(flat);
}

/** Does the date appear in any common written form ("4 December", "04/12/2026")? */
export function dateIn(iso: string, text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [year, month, day] = [m[1], Number(m[2]), Number(m[3])];
  const long = MONTHS[month - 1];
  const short = long.slice(0, 3);
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  const lower = text.toLowerCase();
  return [
    `${day} ${long}`, `${day} ${short}`, `${long} ${day}`, `${short} ${day}`,
    `${dd}/${mm}/${year}`, `${day}/${month}/${year}`, iso,
  ].some((form) => new RegExp(`(^|[^0-9])${form.toLowerCase()}(?![0-9])`).test(lower));
}

/**
 * Is this exact date, year included, written in the text? Stricter than
 * `dateIn`: "6 December 2024" does not count as "6 December 2025".
 */
export function exactDateIn(iso: string, text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [year, month, day] = [m[1], Number(m[2]), Number(m[3])];
  const long = MONTHS[month - 1].toLowerCase();
  // September is the one month also commonly shortened to four letters.
  const names = month === 9 ? "september|sept|sep" : `${long}|${long.slice(0, 3)}`;
  const dayWord = `0?${day}(?:st|nd|rd|th)?`;
  const lower = text.toLowerCase();
  return [
    `${dayWord}\\s+(?:of\\s+)?(?:${names})\\.?,?\\s+${year}`,
    `(?:${names})\\.?\\s+${dayWord},?\\s+${year}`,
    `${m[3]}/${m[2]}/${year}`, `${day}/${month}/${year}`, iso,
  ].some((form) => new RegExp(`(^|[^0-9])${form}(?![0-9])`).test(lower));
}

/** Does the reference ("KP-20418") appear, ignoring case and spacing? */
export function referenceIn(reference: string, text: string): boolean {
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  return reference.trim().length >= 3 && squash(text).includes(squash(reference));
}

/**
 * Is a quoted clause close to something the source says? Models paraphrase a
 * little, so this asks for most of the clause's words, not an exact copy.
 */
export function clauseIn(clause: string, text: string, minShare = 0.8): boolean {
  // Words and numbers, ignoring commas inside numbers ("1,109.00") and full
  // stops at the end of a sentence.
  const words = (s: string) =>
    (s.toLowerCase().replace(/(\d),(\d{3})/g, "$1$2").match(/[a-z0-9$%]+(?:\.[0-9]+)?/g) ?? []);
  const source = new Set(words(text));
  const mine = words(clause).filter((w) => w.length > 2);
  if (mine.length === 0) return false;
  return mine.filter((w) => source.has(w)).length / mine.length >= minShare;
}
