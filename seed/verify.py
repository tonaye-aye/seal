#!/usr/bin/env python3
"""Integrity checks for the seed data. Exits non-zero on any failure."""
from __future__ import annotations

import csv
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
fails: list[str] = []
passes = 0


def check(cond: bool, msg: str):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)
        print("FAIL:", msg)


def load(p):
    return json.loads((ROOT / p).read_text(encoding="utf-8"))


def read_csv(name):
    with (ROOT / "bank" / name).open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def amt(r):
    return -float(r["Debit"]) if r["Debit"] else float(r["Credit"])


accounts = {a["code"]: a for a in load("bank/accounts.json")["accounts"]}
je = read_csv("joint-everyday.csv")
mc = read_csv("maya-visa.csv")
by_id = {}

# ---- bank: balances, ids, window ------------------------------------------------------
for code, rows in (("JE", je), ("MC", mc)):
    bal = accounts[code]["openingBalance"]
    last = None
    for r in rows:
        bal = round(bal + amt(r), 2)
        check(abs(bal - float(r["Balance"])) < 0.005, f"{code} running balance wrong at {r['TransactionId']}")
        check(r["TransactionId"] not in by_id, f"duplicate txn id {r['TransactionId']}")
        by_id[r["TransactionId"]] = r
        d = dt.date.fromisoformat(r["Date"])
        check(dt.date(2026, 8, 20) <= d <= dt.date(2026, 11, 18), f"{r['TransactionId']} outside window")
        check(last is None or d >= last, f"{code} not date-sorted at {r['TransactionId']}")
        last = d
    check(abs(bal - accounts[code]["currentBalance"]) < 0.005, f"{code} closing balance mismatch")
check(min(float(r["Balance"]) for r in je) > 500, "joint account balance dips too low")
check(max(float(r["Balance"]) for r in mc) <= 0.0001, "card should never show a positive balance")

# card repayments mirror joint transfers
cp = sorted((r["Date"], amt(r)) for r in mc if r["Description"].startswith("PAYMENT RECEIVED"))
jt = sorted((r["Date"], -amt(r)) for r in je if r["Description"] == "TRANSFER TO MAYA VISA")
check(cp == jt and len(cp) == 3, "card payments and joint transfers do not mirror each other")

# ---- planted facts as visible in the statements ---------------------------------------
def find(rows, needle):
    return [r for r in rows if needle in r["Description"]]


sky = find(je, "SKYLINK")
check([amt(r) for r in sky] == [-79.0, -99.0, -99.0], "Skylink charges should be 79, 99, 99")
check(len(find(je, "STREAMBOX")) == 3 and len(find(mc, "APPLE.COM/BILL")) == 3, "StreamBox duplicate counts")
check(all(amt(r) == -17.99 for r in find(je, "STREAMBOX") + find(mc, "APPLE.COM/BILL")), "StreamBox amounts")
check(len(find(je, "IRONWORKS")) == 3 and all(amt(r) == -29.95 for r in find(je, "IRONWORKS")), "gym monthly")
check(len(find(mc, "BRIGHTPAGE")) == 3 and all(amt(r) == -14.99 for r in find(mc, "BRIGHTPAGE")), "BrightPage")
kc, ke = find(mc, "KESTREL"), find(je, "KESTREL")
check(len(kc) == 1 and len(ke) == 1 and amt(kc[0]) == amt(ke[0]) == -385.0, "Kestrel double payment")
check(amt(find(je, "REDGUM")[0]) == -577.20, "Redgum payment")
mob = [amt(r) for r in find(je, "KOOKABURRA")]
check(mob == [-55.0, -55.0, -57.2], "mobile CPI sequence")
check(round(55.00 * 1.04, 2) == 57.20, "CPI arithmetic")
exc = find(mc, "SCHOOLPAY")
check(len(exc) == 2 and exc[0]["Date"] == exc[1]["Date"] and amt(exc[0]) == amt(exc[1]) == -38.0, "excursion decoy")
check(exc[0]["Description"] != exc[1]["Description"], "excursion refs must differ")

# no stray amounts colliding with planted amounts
special = {17.99, 14.99, 385.0, 29.95, 20.99, 577.2}
planted_desc = ("STREAMBOX", "APPLE.COM", "BRIGHTPAGE", "KESTREL", "REDGUM", "IRONWORKS", "TUNEBOX")
for r in je + mc:
    if abs(amt(r)) in special:
        check(any(k in r["Description"] for k in planted_desc), f"noise txn collides with planted amount: {r['TransactionId']}")

# ---- arithmetic inside the documents -------------------------------------------------
check(round(1690 * 0.285, 2) == 481.65 and round(91 * 1.05, 2) == 95.55 and round(481.65 + 95.55, 2) == 577.20, "Oct bill sums")
check(round(1092 * 0.285, 2) == 311.22 and round(90 * 1.05, 2) == 94.50 and round(311.22 + 94.50, 2) == 405.72, "Jul bill sums")
check(round(1690 / 91, 1) == 18.6 and round(1092 / 90, 1) == 12.1, "bill daily averages")
check(47570 - 45880 == 1690 and 45880 - 44788 == 1092, "meter reading differences")
est_oct26 = 47006 - round(12.13 * 4)
over_kwh = 1690 - (est_oct26 - 45880)
check(abs(over_kwh * 0.285 - 175.0) <= 15, f"overbilling estimate off: {over_kwh * 0.285:.2f}")
check(round(1134.00 * 1.31, 2) == 1485.54 and round(1485.54 - 1134.00, 2) == 351.54 and round(1485.54 - 1109.00, 2) == 376.54, "insurance maths")
check(dt.date(2026, 11, 28) - dt.timedelta(days=14) == dt.date(2026, 11, 14), "gym notice deadline")
check(dt.date(2026, 11, 19).strftime("%A") == "Thursday", "today should be a Thursday")
check(round(5 * 17.99, 2) == 89.95 and round(3 * 14.99, 2) == 44.97, "duplicate / trial totals")
check(round(4 * 412.30, 2) == 1649.20, "rates total")

# ---- text sidecars carry the evidence -------------------------------------------------
idx = load("documents/index.json")["documents"]
doc_ids = {d["id"] for d in idx}
for d in idx:
    check((ROOT / "documents" / d["path"]).exists(), f"missing file {d['path']}")
    check((ROOT / "documents" / d["textPath"]).exists(), f"missing text {d['textPath']}")
txt = {d["filename"]: (ROOT / "documents" / d["textPath"]).read_text(encoding="utf-8") for d in idx}
check("47,570" in txt["Redgum-Energy-Bill-2026-10-27.pdf"] and "ESTIMATED" in txt["Redgum-Energy-Bill-2026-10-27.pdf"], "Oct bill text")
check("47006" in txt["Meter-Photo-2026-10-30.jpg"], "meter text")
check("24 months" in txt["Skylink-Customer-Agreement-Summary-2025-10.pdf"], "Skylink agreement text")
check("14 days" in txt["IronWorks-Membership-Agreement-2024-11.pdf"], "gym terms text")
check("31.0%" in txt["Wattle-Renewal-Notice-2026-11-03.pdf"], "Wattle text")
check("CPI" in txt["Kookaburra-Mobile-Plan-Terms-2025-11.pdf"], "mobile terms text")

# ---- email -------------------------------------------------------------------------------
inbox = load("email/inbox.json")["messages"]
msg_ids = [m["id"] for m in inbox]
check(len(set(msg_ids)) == len(msg_ids), "duplicate message ids")
dates = [m["date"] for m in inbox]
check(dates == sorted(dates), "inbox not sorted by date")
check(all(m["date"] <= "2026-11-19T09:30" or m["date"].startswith("2026-11-19T0") for m in inbox), "email dated after 'now'")
for m in inbox:
    for a in m["attachments"]:
        check(a["documentId"] in doc_ids, f"{m['id']} attachment points at missing doc")
mail = {m["subject"] + "|" + m["date"][:10]: m for m in inbox}
bills = {m["date"][:7]: m["body"] for m in inbox if m["subject"].startswith("Your Skylink tax invoice")}
check("$79.00" in bills["2026-09"] and "$99.00" in bills["2026-10"] and "$99.00" in bills["2026-11"], "Skylink invoice emails vs bank")
apple = [m for m in inbox if m["subject"] == "Your receipt from Apple."]
check(len(apple) == 5 and all("StreamBox" in m["body"] for m in apple), "Apple receipts name StreamBox")
check(any("R-77311" in m["body"] for m in inbox) and any("R-77402" in m["body"] for m in inbox), "Kestrel receipts")

# ---- calendar -----------------------------------------------------------------------------
cal = load("calendar/events.json")["events"]
cal_ids = {e["id"] for e in cal}
check(len(cal_ids) == len(cal), "duplicate event ids")

# ---- ground truth refs -------------------------------------------------------------------
gt = load("eval/ground_truth.json")


def refs_ok(ev, where):
    for t in ev.get("transactions", []):
        check(t in by_id, f"{where}: unknown txn {t}")
    for e in ev.get("emails", []):
        check(e in msg_ids, f"{where}: unknown email {e}")
    for d in ev.get("documents", []):
        check(d in doc_ids, f"{where}: unknown doc {d}")
    for c in ev.get("calendar", []):
        check(c in cal_ids, f"{where}: unknown event {c}")


check(len(gt["leaks"]) == 7 and len(gt["decoys"]) == 2, "expected 7 leaks and 2 decoys")
for L in gt["leaks"]:
    refs_ok(L["evidence"], L["id"])
    check(sum(len(v) for v in L["evidence"].values()) >= 2, f"{L['id']} has too little evidence")
for D_ in gt["decoys"]:
    refs_ok(D_["evidence"], D_["id"])

print(f"\n{passes} checks passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
