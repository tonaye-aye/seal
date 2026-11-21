// Checks the fake connectors behave like real ones: paging, totals, repeating
// events, drafts-only email, and the three failure scenarios. Delays are
// switched off so it runs in about a second.
//
// Run: node scripts/connectors-check.ts

import { createConnectors, syncAll, type ConnectorStatus } from "../src/connectors/index.ts";
import { ConnectorError } from "../src/connectors/runtime.ts";
import { nodeSeedSource } from "./seed-source.ts";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
}

const instant = { source: nodeSeedSource, latencyScale: 0 };

// ---------- A normal sync ----------
console.log("Normal sync");
{
  const c = await createConnectors(instant);
  const seen: ConnectorStatus[] = [];
  const snap = await syncAll(c, (s) => seen.push(s));

  check("no connector failed", Object.keys(snap.failed).length === 0);
  check("2 accounts", snap.accounts?.length === 2);
  check("134 transactions, paged 50 at a time per account", snap.transactions?.length === 134);
  check("78 emails", snap.messages?.length === 78);
  check("12 documents", snap.documents?.length === 12);
  check("email summaries leave out the body", snap.messages?.every((m) => !("body" in m)) ?? false);

  const ids = new Set(snap.transactions?.map((t) => t.id));
  check("transaction ids are unique", ids.size === 134);

  // Seed balances must reconcile: opening + every amount = the stated closing.
  for (const account of snap.accounts ?? []) {
    const rows = snap.transactions!.filter((t) => t.accountId === account.id);
    const last = rows[rows.length - 1];
    check(`${account.name} last row balance matches account`, last.balanceCents === account.currentBalanceCents,
      `${last.balanceCents} vs ${account.currentBalanceCents}`);
  }

  const apple = snap.transactions!.find((t) => t.description.startsWith("APPLE.COM/BILL"));
  check("card charges are negative cents", apple?.amountCents === -1799, String(apple?.amountCents));

  // Pia swimming: weekly on Saturday from 17 Oct until 12 Dec (UTC), so
  // 17 Oct to 12 Dec = 9 Saturdays.
  const swim = snap.events!.filter((e) => e.eventId === "evt_012");
  check("weekly event expands to 9 Saturdays", swim.length === 9, `${swim.length}`);
  check("repeats keep 9am local time", swim.every((e) => e.start.slice(11, 16) === "09:00"));
  // Bins: every 2nd Sunday from 22 Nov, within the 90 days ahead window.
  const bins = snap.events!.filter((e) => e.eventId === "evt_013").map((e) => e.start.slice(0, 10));
  check("fortnightly event steps 14 days", bins[0] === "2026-11-22" && bins[1] === "2026-12-06", bins.slice(0, 3).join(", "));

  const states = seen.filter((s) => s.id === "bank").map((s) => s.state);
  check("bank went connecting, syncing, ok", states[0] === "connecting" && states.includes("syncing") && states.at(-1) === "ok");
}

// ---------- Search, drafts, documents ----------
console.log("Email and documents");
{
  const c = await createConnectors(instant);
  const apple = await c.email.search({ text: "streambox", from: "apple" });
  check("search finds Apple receipts for StreamBox", apple.total > 0, `${apple.total} found`);
  const full = await c.email.getMessage(apple.items[0].id);
  check("getMessage returns the body", typeof full.body === "string" && full.body.length > 0);

  const draft = await c.email.createDraft({ to: [{ name: "Skylink", address: "help@skylink.example" }], subject: "Test", body: "Hi" });
  check("draft is saved", (await c.email.listDrafts()).length === 1);
  await c.email.discardDraft(draft.id);
  check("draft can be discarded (undo)", (await c.email.listDrafts()).length === 0);
  check("email has no send operation", !("send" in c.email));

  const docs = await c.documents.list();
  const photo = docs.items.find((d) => d.mimeType.startsWith("image/"))!;
  check("photo is marked as having no text", photo.hasText === false);
  check("photo text is not served (vision must read it)", (await c.documents.readText(photo.id)) === null);
  const image = await c.documents.readImage(photo.id);
  check("photo is served as base64 jpeg", image.mimeType === "image/jpeg" && image.base64.length > 1000);
  const pdf = docs.items.find((d) => d.hasText)!;
  check("pdf text is served", ((await c.documents.readText(pdf.id)) ?? "").length > 50);

  let refused = false;
  try {
    await nodeSeedSource.readText("eval/ground_truth.json");
  } catch {
    refused = true;
  }
  check("seed/eval/ is refused", refused);
}

// ---------- Failure scenarios ----------
console.log("Failure scenarios");
{
  // Bank rate limit: the sync must ride through the 429s.
  const waits: number[] = [];
  const c = await createConnectors({
    ...instant,
    scenarios: ["bank_rate_limit"],
    latencyScale: 1,
    // Record waits instead of sleeping, so the check stays fast.
    sleep: async (ms) => void waits.push(ms),
  });
  const seen: ConnectorStatus[] = [];
  const snap = await syncAll(c, (s) => seen.push(s));
  check("rate-limited bank still reads all 134", snap.transactions?.length === 134);
  check("bank showed a retrying state", seen.some((s) => s.id === "bank" && s.state === "retrying"));
  check("waited the 3 seconds the bank asked for", waits.includes(3000));
}
{
  const c = await createConnectors({ ...instant, scenarios: ["calendar_reauth"] });
  const seen: ConnectorStatus[] = [];
  const snap = await syncAll(c, (s) => seen.push(s));
  const error = snap.failed.calendar;
  check("calendar fails with 401", error instanceof ConnectorError && error.status === 401);
  check("calendar asks for reconnect", seen.filter((s) => s.id === "calendar").at(-1)?.state === "needs_reconnect");
  check("other connectors still synced", snap.transactions?.length === 134 && snap.messages?.length === 78);
  await c.calendar.reconnect();
  const again = await syncAll(c);
  check("reconnect fixes it", again.events !== undefined && !again.failed.calendar);
  c.runtime.scenarios.set("calendar_reauth", false);
  c.runtime.scenarios.set("calendar_reauth", true);
  check("turning the scenario on again expires the token", (await syncAll(c)).failed.calendar !== undefined);
}
{
  const waits: number[] = [];
  const c = await createConnectors({ ...instant, scenarios: ["slow_documents"], latencyScale: 1, sleep: async (ms) => void waits.push(ms) });
  await c.documents.readText("doc_001");
  check("slow documents take 4 to 6 seconds", waits.length === 1 && waits[0] >= 4000 && waits[0] <= 6000, `${Math.round(waits[0])} ms`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
