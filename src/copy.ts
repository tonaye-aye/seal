// Every word the app shows, in one place, so the wording can be read and
// changed without hunting through the code.
//
// How to read this file:
// - Plain text is in quotes. Text that includes a number, amount, name or
//   date is a small function: the parts in ${...} are filled in by the app.
// - [J] or [⌘ Z] in a sentence draws a key cap (keys separated by spaces).
//   {name} marks a spot the app fills with something richer, like an error.
//   Both are drawn by src/ui/KeyText.tsx.
// - Grouped by where the text shows up: header, list, detail, timeline,
//   footer, toasts, endpoint, replay, onboarding, sheets, trace.
//
// What is NOT here, on purpose: anything a model reads (the prompts in
// src/agent, and the notes and figure labels in src/agent/verify.ts). Changing
// those changes the saved answers, so they need a live run and a re-check.

import type { FindingKind } from "./agent/judge.ts";
import type { Stage } from "./agent/pipeline.ts";
import { APP_NAME } from "./lib/app.ts";
import { formatAUD } from "./lib/money.ts";

// ---------- Helpers ----------

/** The right word for a count, without the number: pick(1, "needs", "need") is "needs". */
export function pick(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** A count with its noun: plural(1, "thing") is "1 thing", plural(3, "match", "matches") is "3 matches". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${pick(n, one, many)}`;
}

/** Seconds from milliseconds, one decimal: 1234 is "1.2". */
const secs = (ms: number) => (ms / 1000).toFixed(1);

const andList = (names: string[]) => names.join(" and ");

export const copy = {
  appName: APP_NAME,

  // ---------- Words used all over ----------
  shared: {
    /** The chip on each finding: what kind of problem it is. */
    kind: {
      price_increase: "Price rise",
      duplicate_subscription: "Paying twice",
      duplicate_payment: "Paid twice",
      trial_converted: "Trial ended",
      renewal_trap: "Renewal",
      renewal_price_creep: "Renewal price",
      billing_error: "Bill error",
    } satisfies Record<FindingKind, string>,
    /** The four data sources, by their short name. */
    source: { bank: "Bank", email: "Email", documents: "Documents", calendar: "Calendar" },
    /** The small label next to a row's amount. */
    amount: { atStake: "at stake", recoverable: "to recover", perMonth: "a month" },
    notSure: "Not sure",
    looksFine: "Looks fine",
    /** A decided finding's chip, instead of its kind. */
    decided: { approved: "Ready to send", handled: "Handled", snoozed: "Snoozed", dismissed: "Not a leak" },
    somethingWentWrong: "Something went wrong.",
  },

  // ---------- Dates and times ----------
  dates: {
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    shortMonths: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    am: "am",
    pm: "pm",
    /** How far a date is from today: "tomorrow", "in 9 days", "3 days ago". */
    days(days: number): string {
      if (days < 0) return days === -1 ? "yesterday" : `${-days} days ago`;
      if (days === 0) return "today";
      if (days === 1) return "tomorrow";
      return `in ${days} days`;
    },
    /** How long ago something happened today: "just now", "4 min ago", "2 h ago". */
    ago(minutes: number): string {
      if (minutes < 1) return "just now";
      if (minutes < 60) return `${minutes} min ago`;
      return `${Math.round(minutes / 60)} h ago`;
    },
  },

  /** How a checked figure's value reads ("Checked by code" in a finding). */
  figures: {
    days: (v: unknown) => `${String(v)} days`,
    kwh: (v: string) => `${v} kWh`,
    percent: (v: unknown) => `${String(v)}%`,
    centsPerKwh: (v: unknown) => `${String(v)}c per kWh`,
    yes: "Yes",
    no: "No",
  },

  // ---------- Top bar ----------
  header: {
    /** What the agent is doing, next to the dot on the right. */
    stage: {
      sync: "Syncing",
      read: "Reading",
      detect: "Looking",
      retrieve: "Gathering evidence",
      extract: "Reading evidence",
      verify: "Checking figures",
      judge: "Deciding",
      draft: "Drafting",
    } satisfies Record<Stage, string>,
    starting: "Starting",
    progress: (stage: string, done: number, total: number) => `${stage} ${done}/${total}`,
    notChecked: "Not checked yet",
    checkingAgain: "Checking again",
    checkedAt: (time: string) => `Checked ${time}`,
    didntFinish: "Check didn't finish",
    /** The breadcrumb after the app name ("Life / Timeline / Skylink Internet"), read out by screen readers. */
    breadcrumb: "Where you are",
    /** The "now" mark, read out by screen readers. */
    now: {
      working: "Checking now",
      waiting: (n: number) => `${n} waiting for you`,
      idle: "Nothing waiting",
    },
  },

  // ---------- Search (the top bar's magnifier; list and timeline) ----------
  search: {
    /** Also the closed magnifier's tooltip. */
    findingsLabel: "Search findings",
    /** Short: the open field is 248 px, and the label already says "Search". */
    findingsPlaceholder: "Business or problem",
    timelineLabel: "Search the timeline",
    timelinePlaceholder: "Business or date",
    /** The × in the open field, in mouse mode. */
    clear: "Clear search",
    matches: (n: number, query: string) => `${plural(n, "match", "matches")} for "${query}"`,
    noMatches: (query: string) => `No matches for "${query}"`,
  },

  // ---------- Findings list ----------
  list: {
    label: "Findings",
    /** The heading. */
    nothingSoFar: "Nothing needs you so far",
    allClear: "All clear this month",
    allDealtWith: "You've dealt with everything",
    needAttention: (n: number) => `${plural(n, "thing")} ${pick(n, "needs", "need")} attention`,
    /** The line under the heading. */
    findingsAppear: "Findings appear here as soon as each one is checked.",
    allClearLine: "Nothing looks wrong or unwanted. The ones below were checked and look fine.",
    allDealtWithLine: "Approved drafts are waiting in your mailbox. Nothing was sent.",
    stillChecking: "Still checking the rest.",
    /** The line under the heading while searching. */
    searchHelp: "Try a business, like Skylink, or a problem, like price rise. Esc clears the search",
    searchOfOpen: (hits: number, open: number) => `${hits} of the ${open} that need you`,
    searchCleared: (n: number) => `${n} checked and left alone`,
    searchBack: (cents: number) => `up to ${formatAUD(cents)} to save or get back`,
    searchMonthly: (cents: number) => `${formatAUD(cents)} a month`,

    /** The 3-line hint on the first palette. */
    hint: [
      "Move with [J] [K], open one with [↵] to see the evidence and the draft.",
      "Approve with [A]: it saves the draft to your Drafts folder. Nothing is ever sent.",
      "[⌘ Z] undoes, [?] shows every key.",
    ],
    hintDismiss: "Got it",

    /** Rows. */
    quickActions: "Quick actions",
    quickActionsFor: (merchant: string) => `Quick actions for ${merchant}`,
    stillDeciding: (n: number) => `Still deciding on ${plural(n, "more")}`,
    undecidedGroup: "Couldn't decide: check these yourself",
    /** Approved findings, after the ones that still need Maya. */
    approvedGroup: (n: number) => `Approved · ${n}`,
    clearedGroup: "Checked and left alone",

    /** Notes above the rows. */
    stoppedEarly: "The check stopped early: {error} Press [R] to try again.",
    notConnected: (names: string[]) =>
      `${andList(names)} ${pick(names.length, "wasn't", "weren't")} connected, so this check didn't look at ${pick(names.length, "it", "them")}. Connect from Connectors at the bottom.`,
    couldntRead: (names: string[]) =>
      `${andList(names)} couldn't be read, so this check is missing what's in it. Press [R] to reconnect and check again.`,

    /** Whole-area states. */
    scanningTitle: "Checking this month's money",
    scanningLine: "Reading your bank, email, documents and calendar. Findings appear here as soon as each one is checked.",
    slowDocuments: (done: number) => `Documents are slow to respond. ${done > 0 ? `${done} read so far, ` : ""}still waiting on the rest.`,
    allClearTitle: "All clear this month",
    allClearBody: (charges: number) =>
      `Looked closely at ${plural(charges, "charge")} and nothing looks wrong or unwanted. It checks again next month, or press [R] to check now.`,
    errorTitle: "The check didn't finish",
    errorHint: "Press [R] to try again. Nothing was sent or changed.",
    notCheckedTitle: "Not checked yet",
    notCheckedBody: "Press [R] to check your bank, email, documents and calendar for charges that look wrong or unwanted.",
  },

  // ---------- Actions (row menu, action bar, footer hints) ----------
  actions: {
    approve: "Approve",
    approveToDrafts: "Approve: save to Drafts",
    markHandled: "Mark handled",
    edit: "Edit",
    snooze: "Snooze",
    notALeak: "Not a leak",
    remind: "Remind me",
    /** The ⋯ menu's Remind me, when the calendar wasn't connected. */
    remindNoCalendar: "Remind me: connect Calendar first",
    /** The ⋯ menu's Remind me, once one is set. */
    remindSet: (date: string) => `Reminder set for ${date}`,
    undo: "Undo",
    checkAgain: "Check again",
    open: "Open",
    move: "Move",
    scroll: "Scroll",
    evidence: "Evidence",
    switchPane: "Switch pane",
    /** In an open finding: Enter on a sidebar line, and where Tab goes. */
    close: "Close",
    toDraft: "Draft",
    toEvidence: "Evidence",
    /** What a click does, in mouse mode. */
    clickForDetail: "Click for more detail",
    clickWhyFine: "Click to see why it looks fine",
    /** The "Checked and left alone" header, in the footer. */
    show: "Show",
    hide: "Hide",
    clickToShow: "Click to show them",
    clickToHide: "Click to hide them",
    clickEvidence: "Click any evidence to read it",
  },

  // ---------- One finding, opened ----------
  detail: {
    label: "Finding",
    /** Header. */
    deadlineChip: (date: string, when: string) => `${date} · ${when}`,
    nextDate: (label: string, date: string) => `Next date: ${label}, ${date}`,
    atStake: "At stake",
    canRecover: "Can recover",
    perMonth: "Per month",
    notSure: "Not sure: check evidence. ",
    lessConfident: "The agent is less confident about this one.",
    /** The sidebar (right): evidence, then the figures code checked. */
    sidebarLabel: "Evidence and checks",
    reliedOn: (n: number) => `Evidence it relied on · ${n}`,
    alsoGathered: (n: number) => `Also gathered · ${n}`,
    cited: "Cited",
    photoFailed: "Couldn't load the photo.",
    loadingPhoto: "Loading photo",
    /** Draft (main column). */
    draftedEmail: "Drafted email",
    editedByYou: "Edited by you",
    checkBeforeSending: "Check before sending",
    to: "To",
    subject: "Subject",
    attach: "Attach",
    attachments: (n: number) => `${plural(n, "document")} from the evidence`,
    draftBody: "Draft body",
    editsNotChecked: "Your edits aren't re-checked by code, so read the figures once more.",
    revert: "Revert",
    doneEditing: "Done",
    nothingToSend: "Nothing to send yet",
    writingDraftLabel: "Writing the draft",
    writingDraft: "Writing the draft…",
    couldntDraft: "Couldn't draft this one. The evidence and figures are still here to act on yourself.",
    checkedByCode: "Checked by code",
    /** A finding that looked fine. */
    whyLeftAlone: "Why it was left alone",
    nothingToDo: "Nothing to do. If you think it's wrong, the evidence it relied on is on the right.",
  },

  /** How each piece of evidence is labelled in the trail. */
  evidence: {
    item: "Item",
    notAvailable: "Not available in this check",
    bank: "Bank",
    bankAccount: "Bank account",
    email: "Email",
    unread: "unread",
    photo: "Photo",
    document: "Document",
    calendar: "Calendar",
    repeats: "repeats",
  },

  // ---------- After approve ----------
  /** The "Next" block on an approved finding, and the lines about what should happen once the draft is sent. */
  next: {
    title: "Next",
    saved: "Saved in Drafts",
    send: "Send it from your mail app. Nothing goes until you do.",
    handled: "Marked as handled",
    thenExpect: (expect: string) => `Then expect ${expect}.`,
    /** The reminder Maya asked for (L). */
    reminder: (date: string) => `Reminder in your calendar on ${date}.`,
    /** The same, short, beside the next date in a finding's header. */
    reminderShort: (date: string) => `Reminder ${date}`,
    /** Read after "Then expect" or "Once sent, expect", so they start in lower case. Written by code from checked figures. */
    expect: {
      priceRestored: (back: string, price: string, on: string) => `${back} back, and ${price} on the ${on} debit`,
      moneyBack: (back: string) => `${back} back`,
      noChargeFrom: (amount: string, from: string, on: string) => `no ${amount} charge from ${from} on ${on}`,
      noCharge: (amount: string, on: string) => `no ${amount} charge on ${on}`,
      refund: (amount: string) => `a ${amount} refund`,
      replyBefore: (until: string) => `a reply before the quote ends on ${until}`,
      credit: (amount: string) => `a credit of about ${amount} on your next bill`,
    },
  },

  /** The calendar event Remind me (L) adds. Titles end in "(Life)" so Maya knows where it came from. */
  reminders: {
    calendar: "Maya",
    suffix: "(Life)",
    checkReplied: (merchant: string) => `Check ${merchant} replied`,
    beforeDeadline: (merchant: string, label: string, date: string) => `${merchant}: ${label}, ${date}`,
    lookAgain: (merchant: string) => `Look at ${merchant} again`,
    notes: (title: string) => `${title}. Added by Life when you asked for a reminder. Nothing was sent.`,
  },

  // ---------- Timeline ----------
  timeline: {
    label: "Timeline",
    title: "What's coming",
    expected: (cents: number) => `${formatAUD(cents)} expected to leave your accounts in the next 30 days`,
    soonDates: (n: number, before: string) => `${plural(n, "date")} that ${pick(n, "needs", "need")} you before ${before}`,
    searchHelp: "Try a business, like Skylink, or a date, like 28 Nov. Esc clears the search",
    stillChecking: "Still checking, so more may appear.",
    now: "Now",
    nowLabel: (day: string) => `Now: ${day}`,
    /** Lines on the timeline. */
    expectedCharge: "Expected charge",
    checked: (why: string) => `Checked: ${why}`,
    sameAsLastTime: "Same as last time",
    calendar: "Calendar",
    calendarFor: (title: string) => `Calendar · ${title}`,
    fromCalendar: "From your calendar",
    /** Today's agent activity. */
    checkingNow: "Checking now",
    checkingNowWhat: "Reading your bank, email, documents and calendar",
    checkedEverything: "Checked everything",
    found: (findings: number, fine: number) => `Found ${findings} to look at, ${fine} that look fine`,
    stillNeedYou: (n: number) => `${n} still need you. Nothing was sent or changed.`,
    nothingSent: "Nothing was sent or changed.",
    didntFinish: "Check didn't finish",
    somethingWentWrong: "Something went wrong",
    did: { snoozed: "Snoozed", dismissed: "Marked not a leak" } as Record<string, string>,
    savedDraftTo: (name: string) => `Saved a draft to ${name}`,
    /** When the draft goes to the business the line already names. */
    savedDraft: "Saved a draft",
    /** Today's line for an approved finding, with what to expect once it's sent. */
    readyToSend: (expect?: string) => (expect ? `Ready to send. Then expect ${expect}.` : "Ready to send. Nothing was sent."),
    /** A coming line of an approved finding, instead of its title. */
    onceSent: (expect: string) => `Once sent, expect ${expect}`,
    /** Remind me (L). */
    reminder: "Reminder in your calendar",
    addedReminder: (date: string) => `Added a reminder for ${date}`,
    addedReminderDetail: "In your calendar. Nothing was sent.",
  },

  // ---------- Icon rail ----------
  /** The column of icons on the left: View at the top, Trace and Settings at the foot. */
  rail: {
    label: "Sidebar",
    /** The View button and its menu. */
    view: "View",
    viewTip: (current: string) => `View: ${current}`,
    list: "Findings",
    timeline: "Timeline",
    trace: "Trace",
    /** The Filter button (its menu is under `filters`). */
    filter: "Filter findings",
    /** Its tooltip in the timeline: F takes you back to the findings first. */
    filterFromTimeline: "Filter findings (back to Findings)",
    /** Screen reader text for the small count on the button. */
    filtersOn: (n: number) => `${plural(n, "filter")} on`,
  },

  // ---------- Filters (the findings list) ----------
  filters: {
    label: "Filter findings",
    soon: "Due within 7 days",
    unsure: "Not sure",
    clear: "Clear filters",
    /** The menu with nothing in the list to filter yet. */
    nothing: "Nothing to filter yet",
    /** In front of the chips under the heading. */
    filteredBy: "Filtered by",
    remove: (label: string) => `Remove the ${label} filter`,
    /** The chips line's key hint (keyboard mode) and button (mouse mode). */
    removeLast: "Remove last",
    clearAll: "Clear all",
    /** The heading while filtered. */
    of: (hits: number, open: number) => `${hits} of ${open} ${pick(open, "needs", "need")} attention`,
    showing: (n: number) => `${plural(n, "match", "matches")}`,
    /** Filtered, and nothing that still needs Maya passes (only decided or left-alone rows do). */
    noneOpen: "Nothing here needs attention",
    noMatches: "Nothing matches these filters",
    noMatchesHelp: "Press [⌫] to remove the last filter, [Esc] to clear them, or [F] to change them.",
    /** The same, with a search held too: Esc clears that first. */
    noMatchesSearchHelp: "[Esc] clears the search, then [⌫] removes the last filter or [F] changes them.",
  },

  // ---------- Footer ----------
  footer: {
    connectors: "Connectors",
    whatsConnected: "What's connected",
    /** Screen reader text after the count. */
    needAttention: (n: number) => `, ${n} need attention`,
    connectedCount: (n: number) => `, ${n} connected`,
    connectorsNote: "Read-only. Demo connectors over sample data.",
    connect: "Connect",
    reconnect: "Reconnect",
    countRead: (n: number) => `${n} read`,
    /** The strip of connection chips (gallery). */
    connectionsLabel: "Connections",
    slowShort: "Slow",
    /** The settings cog at the foot of the icon rail. */
    settings: "Settings",
    keysItem: "Keyboard shortcuts",
    hide: `Hide ${APP_NAME}`,
    close: "Close",
  },

  /** A data source's state, in a few words. */
  connector: {
    connecting: "Connecting",
    syncing: "Syncing",
    retrying: (seconds: number) => `Retrying in ${seconds}s`,
    ok: "Up to date",
    needsReconnect: "Needs reconnecting",
    error: "Couldn't sync",
    notConnectedYet: "Not connected yet",
    slow: (done: number) => `Slow to respond, ${done} read so far`,
    /** Shown while a source syncs (its tooltip). */
    readOf: (n: number, total: number, noun: string) => `Read ${n} of ${total} ${noun}`,
    nouns: { bank: "transactions", email: "emails", documents: "documents" },
    bankSlowDown: "Bank asked us to slow down",
    readingEvents: "Reading events",
  },

  // ---------- Model endpoint (footer chip and menu) ----------
  model: {
    title: "Model endpoint",
    chip: {
      slow: "Model: slow",
      offline: "Model: offline",
      key_rejected: "Model: key not accepted",
      not_set_up: "Model: not set up",
      unavailable: "Model: error",
      forced: "Model: saved answers",
      browser: "Model: saved answers",
    },
    /** What the endpoint is doing, in a few words. */
    state: {
      unknown: "Not checked yet",
      checking: "Checking…",
      live: (ms?: number) => (ms !== undefined ? `Live, answered in ${secs(ms)} s` : "Live"),
      slow: (ms?: number) => (ms !== undefined ? `Slow, a tiny test took ${secs(ms)} s` : "Slow"),
      offline: "Can't reach it",
      key_rejected: "Key not accepted",
      not_set_up: "No API key",
      unavailable: "Answered with an error",
      forced: "Saved answers only",
      browser: "Saved answers (browser)",
    },
    checkedAgo: (ago: string) => `checked ${ago}`,
    savedNote: "Saved answers come from an earlier run and are always labelled Replay mode.",
    tryLive: "Try live again",
    goLive: "Go back to live answers",
    useSaved: "Use saved answers only",
    byFlag: "Started with LIFE_REPLAY=1. Restart without it to go live.",
  },

  /** Why the endpoint is in its state (the chip's tooltip and menu, and errors). */
  endpoint: {
    startedWithFlag: "Started with LIFE_REPLAY=1.",
    startedWithQuery: "Started with ?replay.",
    chosenInPanel: "Chosen in the demo panel.",
    browser: "A browser tab has no model connection, only the answers saved by the scripts.",
    noKey: "There's no API key. Add BC_API_KEY to .env, then restart the app.",
    keyRejected: (status: number) => `The endpoint didn't accept the API key (it answered ${status}).`,
    error: (status: number) => `The endpoint answered with an error (${status}).`,
    missingModels: (ids: string[]) => `The endpoint doesn't list ${ids.join(", ")}.`,
    modelsError: (status: number) => `The models answered with an error (${status}).`,
    slow: (ms: number) => `A tiny test took ${secs(ms)} s, so this check may take a few minutes.`,
    unreachable: "Couldn't reach the endpoint. Check the network.",
    macOffline: "The Mac went offline.",
    lostPartway: (reason: string) => `Lost partway through a check: ${reason}.`,
    /** Why the endpoint was lost during a check (lower case: it follows a colon). */
    lost: {
      key: "the endpoint stopped accepting the API key",
      rateLimited: "the endpoint kept asking us to slow down",
      error: (status?: number) => `the endpoint answered with an error (${status})`,
      tooSlow: "the endpoint stopped answering in time",
      stopped: "the endpoint stopped answering",
    },
    simulatedDrop: "Simulated: the endpoint stopped answering.",
    noAnswerWithin: (seconds: number) => `The endpoint didn't answer within ${seconds} seconds`,
    /** Shown in "Couldn't decide" when a call has no saved answer. */
    noSavedAnswerOffline: "The model endpoint couldn't be reached and there's no saved answer for this one.",
    noSavedAnswer: "There's no saved answer for this one.",
    /** The error when a check on saved answers finds none saved. */
    noSavedAnswers: {
      forced: "There are no saved answers for this check yet. Turn off saved answers only (⌘⇧D, then M) and run a live check first.",
      not_set_up: "The model endpoint isn't set up, and there are no saved answers yet. Add BC_API_KEY to .env, then restart the app.",
      key_rejected: "The model endpoint didn't accept the API key, and there are no saved answers yet. Check BC_API_KEY in .env, then restart the app.",
      offline: "Couldn't reach the model endpoint, and there are no saved answers yet. Check the network, then press R.",
    },
  },

  // ---------- Replay mode (saved answers) ----------
  replay: {
    /** The banner under the top bar starts with this. */
    lead: "Replay mode.",
    youChose: "You chose saved answers",
    forced: (who: string) => `${who}: everything here is from an earlier run, not live from the model.`,
    lost: "Lost the model endpoint partway through, so the check was redone from saved answers: everything here is from an earlier run.",
    offline: "Couldn't reach the model endpoint, so these answers are from an earlier run, not live from the model.",
    key_rejected: "The model endpoint didn't accept the API key, so these answers are from an earlier run, not live from the model.",
    not_set_up: "The model endpoint isn't set up (no API key), so these answers are from an earlier run, not live from the model.",
    unavailable: "The model endpoint answered with an error, so these answers are from an earlier run, not live from the model.",
    browser: "Browser preview: there's no model connection here, so these answers are from an earlier run, not live from the model.",
    some: "Some answers are saved replies from an earlier run, not live from the model.",
    /** The tag on a row from a saved answer, and its tooltip. */
    tag: "Saved answer",
    tagTitle: "From a saved answer, not live from the model",
    /** The line in an open finding. */
    judgedAndDrafted: "Judged and drafted from saved answers, from an earlier run, not live from the model.",
    judged: "Judged from a saved answer, from an earlier run. The draft is live.",
    drafted: "The draft is a saved answer from an earlier run. The judgment is live.",
  },

  // ---------- Toasts (the note at the bottom after an action) ----------
  toasts: {
    stillWriting: "The draft is still being written. Try again in a moment.",
    markedHandled: (merchant: string) => `Marked ${merchant} as handled.`,
    couldntSave: (error: string) => `Couldn't save the draft: ${error}`,
    savedToDrafts: (to: string) => `Saved to Drafts for ${to}. Send it from your mail app when you're ready.`,
    snoozed: (merchant: string) => `Snoozed ${merchant}. It stays in the list, below the rest.`,
    dismissed: (merchant: string) => `Marked ${merchant} as not a leak.`,
    undoneDraft: (merchant?: string) => `Undone: the draft for ${merchant} was removed from Drafts.`,
    undone: (merchant?: string) => `Undone: ${merchant} is back in the list.`,
    reminderAdded: (date: string) => `Added a reminder to your calendar for ${date}.`,
    reminderAlready: (date: string) => `There's already a reminder for this on ${date}.`,
    reminderReauth: "Couldn't add the reminder: Calendar needs reconnecting. Press R to reconnect.",
    reminderFailed: (error: string) => `Couldn't add the reminder: ${error}`,
    reminderNoCalendar: "Calendar isn't connected, so there's nowhere to add a reminder.",
    reminderNotNow: "Reminders are for findings that still need you or are approved.",
    undoneReminder: (merchant?: string) => `Undone: the reminder for ${merchant} was removed from your calendar.`,
    /** Stands in for the business's name when it isn't known. */
    it: "it",
    undo: "Undo",
    dismiss: "Dismiss",
    /** What each decision is called in the undo list. */
    decision: { approved: "Saved to Drafts", snoozed: "Snoozed", dismissed: "Not a leak", new: "", handled: "Marked as handled", reminder: "Reminder added" },
  },

  // ---------- Onboarding ----------
  onboarding: {
    step: (n: number) => `Step ${n} of 3`,
    /** 1. Welcome. */
    welcomeTitle: `Hi, I'm ${APP_NAME}`,
    welcomeBody:
      "Once a month I look through your bank, email, documents and calendar for charges that are wrong or unwanted. I gather the proof and draft the fix, and you approve it. I never send, cancel or pay for anything.",
    noShortcut: "The keyboard shortcut couldn't be set up on this Mac, so open me from the ring icon in the menu bar.",
    openWith: "Open and hide me from any app with {keys}",
    menuBar: "I also live in the menu bar.",
    useFallback: "Taken by another app? Use [⌘ ⇧ Space] instead",
    getStarted: "Get started",
    /** 2. Connect. */
    connectTitle: "Connect your data",
    connectBody: "I can only read, and save drafts in your email. I can't send, cancel or pay for anything.",
    connectNote: "Demo connectors over sample data. No sign-in needed.",
    runFirstCheck: "Run my first check",
    sources: {
      bank: { name: "Harbour Bank", what: "Your joint everyday account and Visa card", by: "Harbour Bank", unit: ["transaction", "transactions"] },
      email: { name: "Mailbox", what: "Your inbox and the shared home address", by: "your email provider", unit: ["email", "emails"] },
      documents: { name: "Household Admin folder", what: "Bills, agreements and receipts you've saved", by: "your files", unit: ["document", "documents"] },
      calendar: { name: "Family calendar", what: "Renewals, reminders and appointments", by: "your calendar", unit: ["event", "events"] },
    } as const,
    /** More things people would connect: off in this demo. Fictional brands. */
    more: {
      ferro: { name: "Ferro Credit Union", what: "A second bank account", by: "Ferro Credit Union" },
      southerly: { name: "Southerly Super", what: "Statements and fees from your super fund", by: "Southerly Super" },
      kinbridge: { name: "Kinbridge Health", what: "Health cover renewals and claims", by: "Kinbridge Health" },
      cloudnest: { name: "Cloudnest Drive", what: "Documents stored in the cloud", by: "Cloudnest" },
    },
    connected: "Connected",
    connecting: "Connecting",
    signedOut: "Signed out",
    couldntRead: "Couldn't read",
    reconnect: "Reconnect",
    tryAgain: "Try again",
    notInDemo: "Not in this demo",
    by: (who: string) => `by ${who}`,
    connectSource: (name: string) => `Connect ${name}`,
    /** 3. The first check, in a banner under the top bar. */
    firstCheckLead: "Your first check.",
    firstCheckBody: "It reads everything, so it takes a little while. You can hide me, I'll keep going.",
  },

  // ---------- Sheets ----------
  shortcuts: {
    label: "Keyboard shortcuts",
    groups: [
      {
        title: "Findings",
        keys: [
          [["J"], "Next"],
          [["K"], "Previous"],
          [["↵"], "Open evidence and draft"],
          [["Space"], "Open or close a group or evidence"],
          [["C"], "Checked by code (in a finding)"],
          [["A"], "Approve: save the draft to Drafts"],
          [["E"], "Edit the draft"],
          [["S"], "Snooze"],
          [["D"], "Not a leak"],
          [["L"], "Remind me: add it to your calendar"],
          [["F"], "Filter"],
          [["⌫"], "Remove the last filter"],
          [["⌘", "Z"], "Undo"],
        ],
      },
      {
        title: "Everywhere",
        keys: [
          [["⌘", "↵"], "Timeline: what's coming"],
          [["V"], "View: findings or timeline"],
          [["/"],"Search findings or the timeline"],
          [["Tab"], "Draft or evidence (in a finding)"],
          [["T"], "Show what the agent did"],
          [["R"], "Check again (reconnects first)"],
          [["Esc"], "Back, then close"],
          [["⌘", ","], "Settings"],
          [["?"], "This sheet"],
        ],
      },
    ] as { title: string; keys: [string[], string][] }[],
    footnote: "Nothing is ever sent. Approving saves a draft you send yourself.",
  },

  /** The hidden demo panel (⌘⇧D). */
  demo: {
    title: "Demo controls",
    intro: "Simulate failures for demos. These are demo connectors over seed data, so nothing real breaks. Switches stay on until you turn them off.",
    badge: "Demo",
    youllSee: (what: string) => `You'll see: ${what}`,
    scenarios: {
      calendar_reauth: {
        name: "Calendar sign-in expires",
        short: "Calendar signed out",
        simulates: "Every calendar call fails with 401, like an expired token.",
        expect:
          "Connectors at the bottom turns red with a 1 (open it for Reconnect), and the findings list says the calendar couldn't be read. Press R again to reconnect.",
      },
      bank_rate_limit: {
        name: "Bank rate limit",
        short: "Bank rate limit",
        simulates: "Every 4th transactions call is refused with 429, asking to wait 3 seconds.",
        expect:
          'once per check, Connectors at the bottom counts down "Retrying in 3s" and the checking screen says the bank asked us to slow down. It carries on by itself.',
      },
      slow_documents: {
        name: "Slow documents",
        short: "Slow documents",
        simulates: "Each document read takes 4 to 6 seconds.",
        expect:
          "for about 15 s while documents are read, a loading card under the steps on the checking screen; the Connectors count at the bottom pulses blue, and its menu says Documents are slow to respond.",
      },
    },
    modelTitle: "Model endpoint",
    saved: {
      name: "Use saved answers only",
      simulates: "Every model answer comes from the saved answers of earlier runs. No model calls are made.",
      expect:
        'a "Replay mode" banner says you chose saved answers, and a "Model: saved answers" chip sits at the bottom. Run one live check first so there is something saved.',
      locked: "On for this launch: started with LIFE_REPLAY=1. Restart without it to go live.",
    },
    drop: {
      name: "Endpoint drops partway",
      short: "Endpoint drops",
      simulates: (calls: number) => `The first ${calls} model calls of the next check answer, then the endpoint stops answering.`,
      expect:
        'the trace says the endpoint was lost and the check starts again from saved answers; a "Replay mode" banner says so, and a "Model: offline" chip sits at the bottom.',
    },
    resetTitle: "Start onboarding again",
    resetWait: "Wait for the check to finish first.",
    resetBody: "Forgets decisions, results and connections, then shows the welcome. Simulated failures stay as they are.",
    resetButton: "Reset onboarding",
    statusRunning: "A check is running. Changes may not show until the next one.",
    statusPending: "Shows up on the next check. Check now closes this so you can watch.",
    statusIdle: "The next check uses these settings.",
    checkNow: "Check now",
    checkInProgress: "Check in progress",
    close: "Close",
    /** The footer chip while a failure is simulated. */
    simulating: (first: string, more: number) => `Simulating: ${first}${more > 0 ? ` +${more}` : ""}`,
    simulatingTitle: (names: string[]) => `Simulating: ${names.join(", ")}. Click to change.`,
  },

  // ---------- Trace (what the agent did, T) ----------
  trace: {
    title: "What the agent did",
    close: "Close",
    nothingYet: "Nothing yet.",
    privacy: "Connectors are read-only. Nothing is sent anywhere except to your model endpoint (on-device in production).",
    /** Each stage as it starts. */
    stage: {
      sync: "Syncing bank, email, documents and calendar",
      read: "Reading emails and documents",
      detect: "Looking for charges worth a closer look",
      retrieve: "Gathering the evidence for each one",
      extract: "Reading the facts out of each piece of evidence",
      verify: "Checking the numbers and dates in code",
      judge: "Deciding which ones are real problems",
      draft: "Drafting the fixes",
    } satisfies Record<Stage, string>,
    /** Each stage as it ends (written by src/agent/pipeline.ts). */
    couldntReadSources: (ids: string[]) => `Couldn't read: ${ids.join(", ")}`,
    readCounts: (txns: number, emails: number, docs: number, events: number) =>
      `${txns} transactions, ${emails} emails, ${docs} documents, ${events} calendar entries`,
    candidates: (n: number) => `${plural(n, "thing")} worth a closer look`,
    evidence: (n: number) => `${plural(n, "piece")} of evidence`,
    extracted: (read: number, failed: number) => `${read} read, ${failed} failed`,
    figuresChecked: (n: number) => `${plural(n, "figure")} checked`,
    draftStart: "each finding is drafted as soon as it is judged",
    judged: (problems: number, fine: number) => `${problems} need you, ${fine} look fine`,
    drafts: (ready: number, unchecked: number) =>
      `${plural(ready, "draft")} ready${unchecked ? `, ${unchecked} need checking` : ", every claim checked"}`,
    /** Problems, in red. */
    keyed: (key: string, error: string) => `${key}: ${error}`,
    draftNeedsChecking: (merchant: string, problems: string[]) => `${merchant}: draft needs checking (${problems.join("; ")})`,
    couldntDraft: (merchant: string, error: string) => `${merchant}: couldn't draft (${error})`,
    /** Connectors during a check. */
    slowDown: (name: string, seconds: number) => `${name} asked us to slow down, trying again in ${seconds} s`,
    answeredAgain: (name: string) => `${name} answered again, carrying on`,
    needsReconnect: (name: string) => `${name} needs reconnecting, so it was skipped`,
    couldntRead: (name: string) => `Couldn't read ${name}`,
    /** Findings as they arrive. */
    found: (title: string) => `Found: ${title}`,
    drafted: (to: string) => `Drafted a message to ${to}, every figure checked`,
    draftedUnchecked: (to: string) => `Drafted a message to ${to}, but some claims need checking`,
    looksFine: (merchant: string, why: string) => `${merchant} looks fine: ${why}`,
    /** The end of a check. */
    done: (ms: number) => `Done in ${secs(ms)} s. Nothing was sent or changed.`,
    checkedAgain: (ms: number) => `Checked again in ${secs(ms)} s. Nothing was sent or changed.`,
    backgroundStart: "Checking again in the background",
    backgroundNoEndpoint: "The model endpoint isn't available, so the last results stay. The next background check will try again.",
    backgroundFailed: (error: string) => `The background check didn't finish: ${error}`,
    /** The model endpoint. */
    checkingEndpoint: "Checking the model endpoint",
    endpointLive: (ms: number) => `Model endpoint answered in ${secs(ms)} s`,
    endpointSlow: (detail: string) => `Model endpoint is slow today: ${detail}`.trim(),
    savedOnlyByFlag: "Using saved answers only (started with LIFE_REPLAY=1)",
    savedOnlyChosen: "Using saved answers only, as chosen",
    browser: "Browser preview: using saved answers from an earlier run",
    endpointFallback: (detail?: string) => `${detail ?? "Couldn't use the model endpoint."} Using saved answers from an earlier run.`,
    /** What a stage is doing, for "Lost the model endpoint while ...". */
    doing: { extract: "reading the evidence", judge: "deciding and drafting", draft: "drafting" } as Partial<Record<Stage, string>>,
    lost: (doing: string | undefined, reason: string, background: boolean) =>
      `Lost the model endpoint${doing ? ` while ${doing}` : ""}: ${reason}. ${background ? "The last results stay." : "Starting the check again from saved answers."}`,
  },

  // ---------- Findings written by code ----------
  // When the model and the checks in code disagree, code writes the finding
  // itself (src/agent/pipeline.ts). No model reads these.
  agent: {
    checkTitle: (names: string[]) => `Check ${andList(names)}`,
    checkAction: "Look at the evidence and decide: the checks and the model disagree.",
    modelSaidFine: (why: string, problems: string[]) => `The model judged this fine ("${why}"), but code found: ${problems.join(" ")}`,
    codeSaysFine: (fine: string[]) => `Code found reasons this may be fine: ${fine.join(" ")}`,
  },
};
