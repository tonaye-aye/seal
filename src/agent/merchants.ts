// Turning messy bank text and email senders into comparable merchant names.
// "SKYLINK INTERNET P/L DIRECT DEBIT 0082914" and the sender "Skylink
// Internet" both become the key "skylink". Plain rules, no model: these
// matches decide which evidence gets looked at, so they must be predictable.

/** Words that say how money moved or where, not who it went to. */
const NOISE = new Set([
  "pty", "ltd", "p", "l", "inc", "co", "the", "and", "au", "aus", "com", "www", "bill", "billing",
  "direct", "debit", "dd", "transfer", "to", "from", "payment", "pay", "ref", "inv", "invoice",
  "online", "instalment", "receipt", "your", "sydney", "melbourne", "brunswick", "coburg",
  "carlton", "nth", "thornbury", "rd", "st", "w", "vic", "nsw",
]);

/**
 * Words that name a kind of business rather than a business. They help match
 * everyday words ("gym") to bank text ("FITNESS") but never identify a merchant
 * on their own.
 */
export const CATEGORY_WORDS: Record<string, string> = {
  fitness: "fitness", gym: "fitness",
  internet: "internet", nbn: "internet", wifi: "internet", fibre: "internet",
  mobile: "phone", phone: "phone",
  energy: "energy", electricity: "energy", power: "energy", meter: "energy",
  plumbing: "plumbing", plumber: "plumbing",
  // Not "premium" or "policy": receipts say "Premium plan" and "privacy policy".
  insurance: "insurance", cover: "insurance", excess: "insurance", comprehensive: "insurance",
  kids: "kids", books: "books", school: "school", swim: "swim",
  market: "grocery", grocer: "grocery", bakery: "food", espresso: "food", deli: "food",
  house: "food", fuel: "fuel", pharmacy: "health", hardware: "hardware", council: "council",
  rates: "council", rent: "rent", savings: "savings", salary: "income", family: "family",
  plan: "plan", streaming: "streaming", music: "music", transit: "transport",
};

/** Lower-case words with noise, numbers and reference codes removed. */
export function merchantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 1 && !NOISE.has(word) && !/\d/.test(word));
}

/** The words that identify a business (not its category). */
export function distinctiveTokens(text: string): string[] {
  return merchantTokens(text).filter((word) => !(word in CATEGORY_WORDS) && word.length >= 3);
}

/** The categories a piece of text mentions, e.g. "Cancel gym membership" gives ["fitness"]. */
export function categories(text: string): string[] {
  return [...new Set(merchantTokens(text).flatMap((w) => (w in CATEGORY_WORDS ? [CATEGORY_WORDS[w]] : [])))];
}

/** A short key for grouping: the first distinctive word, e.g. "skylink". */
export function merchantKey(text: string): string {
  return distinctiveTokens(text)[0] ?? merchantTokens(text)[0] ?? text.toLowerCase().trim();
}

/** Readable name from bank text: "KESTREL PLUMBING PTY LTD BRUNSWICK" to "Kestrel Plumbing". */
export function displayName(text: string): string {
  const words = merchantTokens(text).slice(0, 2);
  if (words.length === 0) return text.trim();
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

/** Payment reference codes such as "OH-Y3-0908" or "KP-20418". */
export function references(text: string): string[] {
  return text.match(/\b[A-Z]{1,4}(?:-[A-Z0-9]{1,6})+\b/g) ?? [];
}

/**
 * Card descriptors that name a payment platform, not the seller. The real
 * merchant has to be found elsewhere (usually a receipt email).
 */
const PLATFORMS = ["apple.com/bill", "itunes", "google", "paypal", "amazon", "sq *", "square"];
export function isOpaqueDescriptor(description: string): boolean {
  const lower = description.toLowerCase();
  return PLATFORMS.some((p) => lower.includes(p));
}
