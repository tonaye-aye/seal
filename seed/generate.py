#!/usr/bin/env python3
"""
Seed generator: the Whitlock household (Brunswick, VIC).

Produces everything the fake connectors serve:
  bank/        two accounts (CSV + accounts.json)
  email/       inbox.json (Maya's mailbox, ~Oct 2025 - Nov 2026)
  documents/   PDFs + pre-extracted text sidecars + one meter photo, index.json
  calendar/    events.json
  persona.json household profile + agent preferences
  connectors/  manifest.json (latency, paging, failure scenarios)
  eval/        ground truth. The running app must NEVER read this folder.

Deterministic: same output on every run (seeded RNG, fixed "now").
Run:  python3 generate.py          (PDF/JPG regeneration needs reportlab + Pillow)
Check: python3 verify.py
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import random
import textwrap
from pathlib import Path
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
TZ = ZoneInfo("Australia/Melbourne")
NOW = dt.datetime(2026, 11, 19, 9, 30, tzinfo=TZ)          # "today" inside the app
WINDOW_START = dt.date(2026, 8, 20)                           # first day on the statements
WINDOW_END = dt.date(2026, 11, 18)                            # last posted day
rng = random.Random(20261119)


def D(y, m, d):
    return dt.date(y, m, d)


def AT(y, m, d, h=9, mi=0):
    return dt.datetime(y, m, d, h, mi, tzinfo=TZ)


def iso(x):
    return x.isoformat(timespec="minutes")


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def fmt(x: float) -> str:
    return f"{x:,.2f}"


# --------------------------------------------------------------------------------------
# People
# --------------------------------------------------------------------------------------
MAYA = ("Maya Whitlock", "maya.whitlock@mailbox.example")
BEN = ("Ben Whitlock", "ben.whitlock@mailbox.example")
HOME = ("Whitlock household", "home@whitlock.example")
ADDRESS = "14 Albion Lane, Brunswick VIC 3056"

# --------------------------------------------------------------------------------------
# 1. BANK
# --------------------------------------------------------------------------------------
JE, MC = "JE", "MC"
OPEN = {JE: 4210.37, MC: -812.46}          # balance at end of 2026-08-19
TXN: list[dict] = []
SPECIAL = {17.99, 14.99, 385.00, 38.00, 29.95, 20.99, 79.00, 99.00, 55.00, 57.20, 577.20, 168.00}


def txn(acct, date, desc, amount, tag=None, prio=1):
    TXN.append(dict(account=acct, date=date, desc=desc, amount=round(amount, 2),
                    tag=tag, prio=prio, seq=len(TXN)))


def fortnights(first, last):
    d = first
    while d <= last:
        yield d
        d += dt.timedelta(days=14)


def noise_amount(lo, hi):
    while True:
        a = round(rng.uniform(lo, hi), 2)
        if a not in SPECIAL:
            return a


def build_bank():
    # income
    for d in fortnights(D(2026, 8, 20), WINDOW_END):
        txn(JE, d, "SALARY COBALT STUDIO PTY LTD", 2340.00, "salary_maya", prio=0)
    for d in fortnights(D(2026, 8, 21), WINDOW_END):
        txn(JE, d, "PAYMENT TIDEWATER LOGISTICS PAY", 2105.50, "salary_ben", prio=0)

    # fixed monthly items on the joint account
    for (y, m) in [(2026, 9), (2026, 10), (2026, 11)]:
        txn(JE, D(y, m, 1), "TRANSFER TO HARBOUR&CO PROP MGMT RENT", -2420.00, f"rent_{m}")
        txn(JE, D(y, m, 7), "TRANSIT TOP-UP ONLINE", -50.00, f"transit_{m}")
        txn(JE, D(y, m, 9), "TUNEBOX FAMILY PLAN", -20.99, f"tunebox_{m}")
        txn(JE, D(y, m, 15), "TRANSFER TO SAVINGS GOAL HOLIDAY", -1500.00, f"savings_{m}")
    txn(JE, D(2026, 8, 31), "NORTHERN CITY COUNCIL RATES INSTALMENT", -412.30, "rates_aug")

    # --- planted + decoy items ---
    # Skylink: promo price (79) rose to 99 from the October bill
    txn(JE, D(2026, 9, 14), "SKYLINK INTERNET P/L DIRECT DEBIT 0082914", -79.00, "skylink_sep")
    txn(JE, D(2026, 10, 14), "SKYLINK INTERNET P/L DIRECT DEBIT 0082914", -99.00, "skylink_oct")
    txn(JE, D(2026, 11, 14), "SKYLINK INTERNET P/L DIRECT DEBIT 0082914", -99.00, "skylink_nov")
    # StreamBox direct (Ben, since 2024) + Apple-billed duplicate (Maya, since June)
    for m in (9, 10, 11):
        txn(JE, D(2026, m, 3), "STREAMBOX AU 8800123", -17.99, f"streambox_direct_{m}")
    for m in (8, 9, 10):
        txn(MC, D(2026, m, 21), "APPLE.COM/BILL SYDNEY AU", -17.99, f"apple_streambox_{m}")
    # Gym monthly (inactive since 3 Sep)
    for m in (9, 10, 11):
        txn(JE, D(2026, m, 5), "IRONWORKS FITNESS DD 77120", -29.95, f"gym_monthly_{m}")
    # BrightPage trial that converted
    for m in (9, 10, 11):
        txn(MC, D(2026, m, 18), "BRIGHTPAGE KIDS PTY LTD SYDNEY", -14.99, f"brightpage_{m}")
    # Kestrel plumber paid twice
    txn(MC, D(2026, 9, 30), "KESTREL PLUMBING PTY LTD BRUNSWICK", -385.00, "kestrel_card")
    txn(JE, D(2026, 10, 2), "TRANSFER TO KESTREL PLUMBING INV KP-20418", -385.00, "kestrel_eft")
    # Redgum energy, estimated bill paid in full
    txn(JE, D(2026, 11, 10), "REDGUM ENERGY DIRECT DEBIT", -577.20, "energy_pay")
    # Decoy: CPI-indexed mobile plan
    txn(JE, D(2026, 9, 1), "KOOKABURRA MOBILE BILL", -55.00, "mobile_9")
    txn(JE, D(2026, 10, 1), "KOOKABURRA MOBILE BILL", -55.00, "mobile_10")
    txn(JE, D(2026, 11, 1), "KOOKABURRA MOBILE BILL", -57.20, "mobile_11")
    # Decoy: two school excursions, same day, same amount, different kids
    txn(MC, D(2026, 9, 8), "SCHOOLPAY BRUNSWICK HILL PS REF OH-Y3-0908", -38.00, "excursion_ollie")
    txn(MC, D(2026, 9, 8), "SCHOOLPAY BRUNSWICK HILL PS REF PI-PR-0908", -38.00, "excursion_pia")
    # Swim school on the card
    for (m) in (8, 9, 10):
        txn(MC, D(2026, m, 20), "AQUASTART SWIM SCHOOL BRUNSWICK", -168.00, f"swim_{m}")

    # --- everyday noise ---
    grocers = ["HARVEST MARKET BRUNSWICK", "SUNRISE GROCER SYDNEY RD", "HARVEST MARKET COBURG"]
    card_merch = [("LYGON ST ESPRESSO BRUNSWICK", (5.5, 24)), ("BREAD & BONE BAKERY", (6, 31)),
                  ("BRUNSWICK PHARMACY", (9, 58)), ("HARDWARE DEPOT THORNBURY", (12, 118)),
                  ("DUMPLING HOUSE SYDNEY RD", (28, 74)), ("PAGE & PIXEL KIDS BOOKS", (14, 46)),
                  ("DELI & CO CARLTON NTH", (11, 39))]
    d = WINDOW_START
    while d <= WINDOW_END:
        if rng.random() < (0.55 if d.weekday() in (2, 5, 6) else 0.25):
            txn(JE, d, rng.choice(grocers), -noise_amount(28, 185))
        if d.weekday() == 6 and rng.random() < 0.6:
            txn(JE, d, "NOVA FUEL BRUNSWICK W", -noise_amount(58, 96))
        if rng.random() < 0.45:
            name, (lo, hi) = rng.choice(card_merch)
            txn(MC, d, name, -noise_amount(lo, hi))
        d += dt.timedelta(days=1)

    # --- card repayments (pay the balance in full on the 12th) ---
    for pd in (D(2026, 9, 12), D(2026, 10, 12), D(2026, 11, 12)):
        bal = OPEN[MC] + sum(t["amount"] for t in TXN if t["account"] == MC and t["date"] < pd)
        pay = round(-bal, 2)
        txn(MC, pd, "PAYMENT RECEIVED - THANK YOU", pay, f"card_payment_{pd.month}", prio=0)
        txn(JE, pd, "TRANSFER TO MAYA VISA", -pay, f"card_transfer_{pd.month}")

    # --- sort, balance, ids ---
    for acct in (JE, MC):
        rows = sorted([t for t in TXN if t["account"] == acct],
                      key=lambda t: (t["date"], t["prio"], t["seq"]))
        bal = OPEN[acct]
        for n, t in enumerate(rows, 1):
            bal = round(bal + t["amount"], 2)
            t["balance"] = bal
            t["id"] = f"{acct}-{n:05d}"

    def write(acct, fname):
        rows = sorted([t for t in TXN if t["account"] == acct],
                      key=lambda t: (t["date"], t["prio"], t["seq"]))
        p = ROOT / "bank" / fname
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["TransactionId", "Date", "Description", "Debit", "Credit", "Balance"])
            for t in rows:
                a = t["amount"]
                w.writerow([t["id"], t["date"].isoformat(), t["desc"],
                            f"{-a:.2f}" if a < 0 else "", f"{a:.2f}" if a > 0 else "",
                            f"{t['balance']:.2f}"])
        return rows

    je_rows = write(JE, "joint-everyday.csv")
    mc_rows = write(MC, "maya-visa.csv")
    write_json(ROOT / "bank" / "accounts.json", {
        "institution": "Harbour Bank",
        "accounts": [
            {"id": "acc_joint_everyday", "code": JE, "name": "Joint Everyday", "type": "transaction",
             "currency": "AUD", "owners": ["Maya Whitlock", "Ben Whitlock"], "statementFile": "joint-everyday.csv",
             "openingBalance": OPEN[JE], "openingBalanceDate": "2026-08-19",
             "currentBalance": je_rows[-1]["balance"], "currentBalanceDate": WINDOW_END.isoformat()},
            {"id": "acc_maya_visa", "code": MC, "name": "Maya Visa", "type": "credit_card",
             "currency": "AUD", "owners": ["Maya Whitlock"], "statementFile": "maya-visa.csv",
             "openingBalance": OPEN[MC], "openingBalanceDate": "2026-08-19",
             "currentBalance": mc_rows[-1]["balance"], "currentBalanceDate": WINDOW_END.isoformat(),
             "creditLimit": 8000.00, "note": "Negative balance = amount owed. Paid in full on the 12th."},
        ],
        "conventions": "Dates ISO-8601 (Australia/Melbourne). Debit/Credit are positive numbers. Descriptors are "
                       "raw bank text, deliberately messy. Statement history starts 2026-08-20.",
    })


def T(tag):
    return next(t["id"] for t in TXN if t["tag"] == tag)


def Ts(prefix):
    return [t["id"] for t in TXN if t["tag"] and t["tag"].startswith(prefix)]


# --------------------------------------------------------------------------------------
# 2. DOCUMENTS
# --------------------------------------------------------------------------------------
DOCS: list[dict] = []


def doc(tag, folder, filename, title, brand, accent, blocks, modified, source):
    DOCS.append(dict(tag=tag, folder=folder, filename=filename, title=title, brand=brand,
                     accent=accent, blocks=blocks, modified=modified, source=source))


def blocks_to_text(brand, title, blocks) -> str:
    out = [brand.upper(), "=" * len(brand), title, ""]
    for kind, val in blocks:
        if kind == "h":
            out += ["", val.upper(), "-" * len(val)]
        elif kind == "p":
            out += textwrap.wrap(val, 92) + [""]
        elif kind == "kv":
            w = max(len(k) for k, _ in val)
            out += [f"{k.ljust(w)} : {v}" for k, v in val] + [""]
        elif kind == "table":
            cols = len(val[0])
            widths = [max(len(str(r[i])) for r in val) for i in range(cols)]
            for i, r in enumerate(val):
                out.append("  ".join(str(c).ljust(widths[j]) for j, c in enumerate(r)).rstrip())
                if i == 0:
                    out.append("  ".join("-" * w for w in widths))
            out.append("")
        elif kind == "note":
            out += ["NOTE: " + textwrap.fill(val, 92, subsequent_indent="      "), ""]
    return "\n".join(out).rstrip() + "\n"


def render_pdf(path: Path, brand, title, accent, blocks):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    ac = colors.HexColor(accent)
    ss = getSampleStyleSheet()
    body = ParagraphStyle("b", parent=ss["BodyText"], fontName="Helvetica", fontSize=9.5, leading=13.5)
    h = ParagraphStyle("h", parent=ss["Heading3"], fontName="Helvetica-Bold", fontSize=11, textColor=ac,
                       spaceBefore=10, spaceAfter=4)
    note = ParagraphStyle("n", parent=body, backColor=colors.HexColor("#F4F1EA"), borderPadding=6,
                          spaceBefore=6, spaceAfter=6)
    ttl = ParagraphStyle("t", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=17, alignment=0,
                         spaceAfter=8)

    def header(c, d):
        c.saveState()
        c.setFillColor(ac)
        c.rect(0, A4[1] - 22 * mm, A4[0], 22 * mm, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 15)
        c.drawString(18 * mm, A4[1] - 14 * mm, brand)
        c.setFillColor(colors.HexColor("#777777"))
        c.setFont("Helvetica", 7.5)
        c.drawString(18 * mm, 10 * mm, f"{brand}  |  fictional document generated for demo purposes  |  page {d.page}")
        c.restoreState()

    story = [Spacer(1, 6 * mm), Paragraph(escape(title), ttl)]
    for kind, val in blocks:
        if kind == "h":
            story.append(Paragraph(escape(val), h))
        elif kind == "p":
            story.append(Paragraph(escape(val), body))
            story.append(Spacer(1, 3))
        elif kind == "note":
            story.append(Paragraph(escape(val), note))
        elif kind == "kv":
            t = Table([[Paragraph(f"<b>{escape(k)}</b>", body), Paragraph(escape(v), body)] for k, v in val],
                      colWidths=[48 * mm, 118 * mm])
            t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                   ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#DDDDDD"))]))
            story.append(t)
        elif kind == "table":
            data = [[Paragraph(f"<b>{escape(str(c))}</b>" if i == 0 else escape(str(c)), body) for c in r]
                    for i, r in enumerate(val)]
            n = len(val[0])
            t = Table(data, colWidths=[(166 * mm) / n] * n if n != 2 else [70 * mm, 96 * mm], repeatRows=1)
            t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEEEEE")),
                                   ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#CCCCCC")),
                                   ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            story.append(t)
            story.append(Spacer(1, 4))
    SimpleDocTemplate(str(path), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                      topMargin=30 * mm, bottomMargin=18 * mm, title=title, author=brand).build(
        story, onFirstPage=header, onLaterPages=header)


def make_meter_photo(path: Path):
    from PIL import Image, ImageDraw, ImageFilter, ImageFont

    W, H = 1400, 1000
    img = Image.new("RGB", (W, H))
    px = ImageDraw.Draw(img)
    for y in range(H):                                       # dim cupboard gradient
        c = int(70 - 28 * y / H)
        px.line([(0, y), (W, y)], fill=(c + 8, c + 4, c))
    for _ in range(2500):                                    # wood-ish grain
        x, y = rng.randrange(W), rng.randrange(H)
        px.line([(x, y), (x + rng.randrange(20, 90), y)], fill=(52, 44, 38))

    def font(size, bold=False):
        for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf" if bold else
                  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
        return ImageFont.load_default()

    px.rounded_rectangle((230, 120, 1170, 880), 40, fill=(196, 198, 196), outline=(120, 122, 120), width=6)
    px.rounded_rectangle((290, 190, 1110, 520), 24, fill=(238, 240, 236), outline=(90, 90, 90), width=4)
    px.text((330, 215), "VOLTEX  EM-210", fill=(40, 40, 40), font=font(34, True))
    px.text((330, 262), "SINGLE PHASE  230V  50Hz", fill=(70, 70, 70), font=font(22))
    x0 = 380
    for i, ch in enumerate("47006"):                         # odometer digits
        x = x0 + i * 120
        px.rectangle((x, 330, x + 104, 450), fill=(14, 14, 14), outline=(0, 0, 0))
        px.text((x + 22, 340), ch, fill=(244, 244, 240), font=font(100, True))
    px.rectangle((x0 + 5 * 120 + 10, 330, x0 + 5 * 120 + 70, 450), fill=(150, 30, 30))
    px.text((x0 + 5 * 120 + 24, 340), "0", fill=(245, 245, 245), font=font(100, True))
    px.text((910, 470), "kWh", fill=(40, 40, 40), font=font(36, True))
    px.text((300, 560), "NMI 6002 4418 77", fill=(60, 60, 60), font=font(26))
    px.text((300, 600), "METER No. 08819342", fill=(60, 60, 60), font=font(26))
    px.rounded_rectangle((300, 680, 520, 790), 14, fill=(165, 168, 165), outline=(100, 100, 100), width=3)
    px.text((322, 715), "TEST", fill=(60, 60, 60), font=font(28, True))
    px.text((60, 930), "30 OCT 2026  16:42", fill=(255, 176, 60), font=font(30, True))   # phone timestamp
    img = img.rotate(-2.4, resample=Image.BICUBIC, expand=False, fillcolor=(40, 34, 30))
    img = img.filter(ImageFilter.GaussianBlur(0.9))
    vig = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vig)
    vd.ellipse((-250, -200, W + 250, H + 200), fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(160))
    dark = Image.new("RGB", (W, H), (10, 8, 6))
    img = Image.composite(img, dark, vig)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "JPEG", quality=84)


def build_docs():
    util, ins = "Home & Utilities", "Insurance"
    # --- Skylink agreement (24 months of promo price) ---
    doc("skylink_agreement", f"{util}/Internet", "Skylink-Customer-Agreement-Summary-2025-10.pdf",
        "Customer Agreement Summary - Fibre 100", "Skylink Internet", "#1F6FEB", [
            ("kv", [("Customer", "Maya Whitlock"), ("Service address", ADDRESS),
                    ("Agreement date", "14 October 2025"), ("Reference", "SK-2025-7730412")]),
            ("h", "Your plan"),
            ("table", [["Item", "Detail"],
                       ["Plan", "Fibre 100 (typical evening speed 97 Mbps)"],
                       ["Promotional price (Bonus Saver)", "$79.00 per month for your first 24 months"],
                       ["Standard price after the promotional period", "$99.00 per month"],
                       ["Billing", "Monthly in advance by direct debit on the 14th"],
                       ["Minimum term", "None. You may cancel at any time; the Bonus Saver price is lost if you cancel and reconnect."],
                       ["Modem", "Skylink Hub (included)"]]),
            ("h", "Price changes"),
            ("p", "The Bonus Saver price applies for the full 24-month promotional period. We will tell you in "
                  "writing at least 30 days before any change to your price."),
            ("h", "Problems with your bill"),
            ("p", "If you think your bill is wrong, contact us on 1300 000 000 or reply to your invoice email. If we "
                  "cannot resolve it you can contact the Telecommunications Industry Ombudsman."),
        ], D(2025, 10, 14), "Attachment to email 'Welcome to Skylink'")

    # --- Redgum energy bills ---
    doc("redgum_bill_jul", f"{util}/Energy", "Redgum-Energy-Bill-2026-07-29.pdf",
        "Tax invoice - electricity", "Redgum Energy", "#C2410C", [
            ("kv", [("Account number", "7782-0145-3"), ("Bill number", "RG-2607-61207"),
                    ("Issued", "29 July 2026"), ("Due", "12 August 2026"), ("Supply address", ADDRESS)]),
            ("h", "Billing period 28 Apr 2026 - 27 Jul 2026 (90 days)"),
            ("table", [["Meter reading", "Date", "Reading (kWh)"],
                       ["Previous (actual)", "27 Apr 2026", "44,788"],
                       ["Current (actual)", "27 Jul 2026", "45,880"],
                       ["Usage", "", "1,092"]]),
            ("table", [["Charge", "Quantity x rate", "Amount"],
                       ["Usage", "1,092.00 kWh x $0.2850", "$311.22"],
                       ["Supply charge", "90 days x $1.0500", "$94.50"],
                       ["Total (incl. GST)", "", "$405.72"]]),
            ("p", "Average daily usage this bill: 12.1 kWh."),
        ], D(2026, 7, 29), "Attachment to email 'Your Redgum Energy bill is ready'")

    doc("redgum_bill_oct", f"{util}/Energy", "Redgum-Energy-Bill-2026-10-27.pdf",
        "Tax invoice - electricity", "Redgum Energy", "#C2410C", [
            ("kv", [("Account number", "7782-0145-3"), ("Bill number", "RG-2610-88413"),
                    ("Issued", "27 October 2026"), ("Due", "10 November 2026"), ("Supply address", ADDRESS)]),
            ("h", "Billing period 28 Jul 2026 - 26 Oct 2026 (91 days)"),
            ("table", [["Meter reading", "Date", "Reading (kWh)"],
                       ["Previous (actual)", "27 Jul 2026", "45,880"],
                       ["Current (ESTIMATED)", "26 Oct 2026", "47,570"],
                       ["Usage", "", "1,690"]]),
            ("table", [["Charge", "Quantity x rate", "Amount"],
                       ["Usage", "1,690.00 kWh x $0.2850", "$481.65"],
                       ["Supply charge", "91 days x $1.0500", "$95.55"],
                       ["Total (incl. GST)", "", "$577.20"]]),
            ("p", "Average daily usage this bill: 18.6 kWh. Previous bill: 12.1 kWh."),
            ("note", "Your reading for this bill is estimated. We could not read your meter on 26 October (access "
                     "restricted). If you think an estimate is wrong, send us a recent meter reading and we will "
                     "correct your bill. Any overpayment is credited to your account or refunded."),
        ], D(2026, 10, 27), "Attachment to email 'Your Redgum Energy bill is ready'")

    # --- Meter photo ---
    DOCS.append(dict(tag="meter_photo", folder=f"{util}/Energy", filename="Meter-Photo-2026-10-30.jpg",
                     title="Meter photo (Ben, 30 Oct 2026)", image=True, modified=D(2026, 10, 30),
                     source="Attachment to email 'Meter reading'",
                     text="[image] Photo of electricity meter, Voltex EM-210. Odometer reads 47006 kWh. "
                          "Phone timestamp 30 OCT 2026 16:42."))

    # --- Council rates ---
    doc("council_rates", f"{util}/Council", "Council-Rates-Notice-2026-27.pdf",
        "Rates and charges notice 2026/27", "Northern City Council", "#2F6F4F", [
            ("kv", [("Property", ADDRESS), ("Notice date", "3 August 2026"),
                    ("Total for the year", "$1,649.20")]),
            ("table", [["Instalment", "Due date", "Amount"],
                       ["1 of 4", "31 August 2026", "$412.30"],
                       ["2 of 4", "30 November 2026", "$412.30"],
                       ["3 of 4", "28 February 2027", "$412.30"],
                       ["4 of 4", "31 May 2027", "$412.30"]]),
        ], D(2026, 8, 3), "Attachment to email 'Your 2026/27 rates notice'")

    # --- Insurance ---
    doc("wattle_renewal", f"{ins}/Car", "Wattle-Renewal-Notice-2026-11-03.pdf",
        "Comprehensive car insurance - renewal notice", "Wattle Insurance", "#8A5A00", [
            ("kv", [("Policy number", "WI-CAR-5521908"), ("Policyholder", "Maya Whitlock"),
                    ("Vehicle", "2019 Mazda3 Pure hatch"), ("Garaged at", ADDRESS),
                    ("Notice date", "3 November 2026")]),
            ("h", "Your renewal"),
            ("table", [["Item", "Detail"],
                       ["Renewal period", "7 December 2026 to 6 December 2027"],
                       ["Cover", "Comprehensive, agreed value $14,500"],
                       ["Excess", "$650"],
                       ["Renewal premium", "$1,485.54 (incl. GST and stamp duty)"],
                       ["Last year's premium", "$1,134.00"],
                       ["Change", "+$351.54 (+31.0%)"]]),
            ("h", "Why your premium changed"),
            ("p", "Base rates in your postcode have increased and your loyalty discount has reduced from 15% to 5%."),
            ("h", "Payment"),
            ("p", "We will charge the full premium to your card on file on 7 December 2026 unless you contact us "
                  "before then. To change or cancel your cover, call 1300 000 111 or reply to this notice."),
        ], D(2026, 11, 3), "Attachment to email 'Your car insurance renewal'")

    doc("banksia_quote", f"{ins}/Car", "Banksia-Direct-Quote-2026-11-06.pdf",
        "Comprehensive car insurance - quote", "Banksia Direct", "#0F766E", [
            ("kv", [("Quote number", "BD-8830214"), ("Prepared for", "Maya Whitlock"),
                    ("Vehicle", "2019 Mazda3 Pure hatch"), ("Quote date", "6 November 2026"),
                    ("Valid until", "4 December 2026")]),
            ("table", [["Item", "Detail"],
                       ["Cover", "Comprehensive, agreed value $14,500"],
                       ["Excess", "$650"],
                       ["Start date", "7 December 2026"],
                       ["Annual premium", "$1,109.00 (incl. GST and stamp duty)"]]),
        ], D(2026, 11, 6), "Attachment to email 'Your Banksia Direct quote'")

    # --- Gym ---
    doc("ironworks_terms", "Memberships", "IronWorks-Membership-Agreement-2024-11.pdf",
        "Membership agreement", "IronWorks Fitness", "#B91C1C", [
            ("kv", [("Member", "Ben Whitlock"), ("Club", "IronWorks Brunswick"),
                    ("Join date", "28 November 2024"), ("Membership", "Standard Monthly")]),
            ("table", [["Fee", "Amount"],
                       ["Monthly membership", "$29.95 per month, direct debit on the 5th"],
                       ["Annual membership fee", "$89.00, charged each year on your join-date anniversary (28 November)"]]),
            ("h", "Cancelling"),
            ("p", "To cancel, give written notice by email to memberships@ironworks.example. Notice must be received "
                  "at least 14 days before the date you want the cancellation to take effect."),
            ("p", "To avoid the annual membership fee, written notice must be received at least 14 days before your "
                  "anniversary date. Fees already charged are not refundable except at the club's discretion."),
        ], D(2024, 11, 28), "Attachment to email 'Welcome to IronWorks'")

    # --- Plumber invoice ---
    doc("kestrel_invoice", f"{util}/Repairs", "Kestrel-Plumbing-Invoice-KP-20418.pdf",
        "Tax invoice KP-20418", "Kestrel Plumbing", "#334155", [
            ("kv", [("Invoice number", "KP-20418"), ("Invoice date", "24 September 2026"),
                    ("Due date", "8 October 2026"), ("Customer", "Maya Whitlock"), ("Site", ADDRESS)]),
            ("table", [["Description", "Amount"],
                       ["Replace hot water heating element (2.0 h x $120.00)", "$240.00"],
                       ["Parts: element and thermostat", "$110.00"],
                       ["Call-out fee", "$35.00"],
                       ["Total (incl. GST)", "$385.00"]]),
            ("p", "Pay by card online, or by bank transfer (BSB 000-000, account 0000 0000) quoting the invoice number."),
        ], D(2026, 9, 24), "Attachment to email 'Invoice KP-20418 from Kestrel Plumbing'")

    # --- Mobile (decoy support) ---
    doc("kookaburra_terms", "Phone", "Kookaburra-Mobile-Plan-Terms-2025-11.pdf",
        "Plan terms - Everyday 40GB", "Kookaburra Mobile", "#7C3AED", [
            ("kv", [("Customer", "Maya Whitlock"), ("Plan", "Everyday 40GB"), ("Start date", "1 November 2025"),
                    ("Price", "$55.00 per month")]),
            ("h", "Price indexation"),
            ("p", "Your plan price is adjusted on 1 November each year by the 12-month CPI figure (all groups, eight "
                  "capital cities) published for the September quarter, rounded to the nearest 10 cents and capped at 6%. "
                  "We will tell you the new price in writing before it applies."),
        ], D(2025, 11, 1), "Attachment to email 'Welcome to Kookaburra Mobile'")


def render_docs():
    out = ROOT / "documents"
    index = []
    for i, d in enumerate(DOCS, 1):
        path = out / d["folder"] / d["filename"]
        path.parent.mkdir(parents=True, exist_ok=True)
        if d.get("image"):
            make_meter_photo(path)
            text = d["text"] + "\n"
            mime = "image/jpeg"
        else:
            render_pdf(path, d["brand"], d["title"], d["accent"], d["blocks"])
            text = blocks_to_text(d["brand"], d["title"], d["blocks"])
            mime = "application/pdf"
        tpath = out / "_text" / (Path(d["filename"]).stem + ".txt")
        tpath.parent.mkdir(parents=True, exist_ok=True)
        tpath.write_text(text, encoding="utf-8")
        d["id"] = f"doc_{i:03d}"
        d["path"] = f"{d['folder']}/{d['filename']}"
        d["size"] = path.stat().st_size
        d["mime"] = mime
        index.append({"id": d["id"], "path": d["path"], "folder": d["folder"], "filename": d["filename"],
                      "title": d["title"], "mimeType": mime, "sizeBytes": d["size"],
                      "modifiedAt": iso(dt.datetime.combine(d["modified"], dt.time(10, 0), TZ)),
                      "source": d["source"], "textPath": f"_text/{tpath.name}",
                      "textExtraction": "vision" if d.get("image") else "pdf-text"})
    write_json(out / "index.json", {
        "root": "Household Admin (synced folder)", "count": len(index), "documents": index,
        "note": "textPath holds pre-extracted text, as a real document connector's index would. "
                "The meter photo has no text layer: use an image-capable model.",
    })


def Dc(tag):
    return next(d["id"] for d in DOCS if d["tag"] == tag)


# --------------------------------------------------------------------------------------
# 3. EMAIL
# --------------------------------------------------------------------------------------
EM: list[dict] = []


def email(tag, when, frm, to, subject, body, labels=("INBOX",), att=(), unread=False, thread=None):
    EM.append(dict(tag=tag, when=when, frm=frm, to=to, subject=subject, body=textwrap.dedent(body).strip() + "\n",
                   labels=list(labels), att=list(att), unread=unread, thread=thread))


def build_emails():
    SK = ("Skylink Internet", "billing@skylink.example")
    SB = ("StreamBox", "receipts@streambox.example")
    AP = ("Apple", "no_reply@email.apple.example")
    BP = ("BrightPage Kids", "hello@brightpage.example")
    KP = ("Kestrel Plumbing", "accounts@kestrelplumbing.example")
    WA = ("Wattle Insurance", "renewals@wattleinsurance.example")
    BK = ("Banksia Direct", "quotes@banksiadirect.example")
    IW = ("IronWorks Fitness", "memberships@ironworks.example")
    RG = ("Redgum Energy", "bills@redgumenergy.example")
    KM = ("Kookaburra Mobile", "hello@kookaburramobile.example")
    SC = ("Brunswick Hill Primary", "office@brunswickhillps.example")
    HB = ("Harbour Bank", "noreply@harbourbank.example")
    CC = ("Northern City Council", "rates@northerncity.example")
    TB = ("TuneBox", "billing@tunebox.example")
    HM = ("Harvest Market", "specials@harvestmarket.example")

    # ---------------- Skylink ----------------
    email("skylink_welcome", AT(2025, 10, 14, 10, 12), SK, [HOME],
          "Welcome to Skylink - your Fibre 100 plan is confirmed", """
          Hi Maya,

          Thanks for choosing Skylink. Here is a summary of your new plan.

          Plan: Fibre 100
          Price: $79.00 per month for your first 24 months (Bonus Saver price), then $99.00 per month
          Billing: monthly in advance by direct debit on the 14th
          Connection date: 14 October 2025

          Your Customer Agreement Summary is attached for your records.

          Welcome aboard,
          The Skylink team
          """, att=["skylink_agreement"])
    email("skylink_change", AT(2026, 9, 9, 8, 3), SK, [HOME],
          "Changes to your Skylink plan", """
          Hi Maya,

          We're writing about a change to your Fibre 100 plan.

          From your next bill (14 October 2026), your monthly price will move to our standard rate of $99.00 per month.
          Why? Your Bonus Saver price has now finished.

          You don't need to do anything. If you have questions, call 1300 000 000.

          Thanks for being with Skylink,
          The Skylink team
          """, unread=True)
    for (y, m, amt, note) in [(2026, 8, 79, "Bonus Saver price"), (2026, 9, 79, "Bonus Saver price"),
                              (2026, 10, 99, "standard rate"), (2026, 11, 99, "standard rate")]:
        email(f"skylink_bill_{m}", AT(y, m, 14, 6, 30), SK, [HOME],
              f"Your Skylink tax invoice for {dt.date(y, m, 1).strftime('%B')}", f"""
              Hi Maya,

              Your invoice is ready.

              Fibre 100 monthly charge ({note}): ${amt:.2f}
              Total: ${amt:.2f}
              This amount will be debited on {dt.date(y, m, 14).strftime('%d %B %Y').lstrip('0')}.

              Skylink Internet
              """)

    # ---------------- StreamBox (direct, Ben) ----------------
    for (y, m) in [(2026, 8), (2026, 9), (2026, 10), (2026, 11)]:
        email(f"streambox_{m}", AT(y, m, 3, 5, 10), SB, [HOME], "Your StreamBox receipt", f"""
              Hi Ben,

              Thanks for being a StreamBox member.

              StreamBox Premium (monthly): $17.99
              Charged to your bank account on {dt.date(y, m, 3).strftime('%d %B %Y').lstrip('0')}.
              Account email: ben.whitlock@mailbox.example

              Happy watching,
              StreamBox
              """)
    # ---------------- Apple receipts (Maya, since June) ----------------
    for (y, m) in [(2026, 6), (2026, 7), (2026, 8), (2026, 9), (2026, 10)]:
        nxt = dt.date(y + (m == 12), m % 12 + 1, 21)
        email(f"apple_{m}", AT(y, m, 21, 11, 2), AP, [MAYA], "Your receipt from Apple.", f"""
              Receipt
              Order ID: MZ{rng.randrange(10**8, 10**9)}
              Date: {dt.date(y, m, 21).strftime('%d %b %Y').lstrip('0')}
              Apple ID: maya.whitlock@mailbox.example

              StreamBox - Premium (1 month)
              Renews {nxt.strftime('%d %b %Y').lstrip('0')}
              $17.99 AUD
              Billed to: Maya's Visa

              Total: $17.99 AUD
              """)
    # ---------------- BrightPage ----------------
    email("brightpage_trial", AT(2026, 9, 11, 19, 40), BP, [MAYA], "Your 7-day free trial has started", """
          Hi Maya,

          Pia's free trial of BrightPage Kids Premium is under way.

          After your 7-day trial, BrightPage Kids Premium continues at $14.99 per month.
          Cancel any time before the trial ends in Settings > Subscription.

          Happy reading!
          The BrightPage team
          """)
    email("brightpage_trial_end", AT(2026, 9, 17, 8, 0), BP, [MAYA], "Your free trial ends tomorrow", """
          Hi Maya,

          Your free trial ends on 18 September. Your first payment of $14.99 will be taken then.
          Not for you? Cancel in Settings > Subscription.
          """, unread=True)
    for (m, extra) in [(9, ""), (10, ""), (11, "")]:
        email(f"brightpage_receipt_{m}", AT(2026, m, 18, 7, 15), BP, [MAYA], "Your BrightPage Kids receipt", f"""
              Hi Maya,

              Thanks for subscribing. BrightPage Kids Premium - $14.99 for {dt.date(2026, m, 18).strftime('%B %Y')}.
              Your plan renews on {(dt.date(2026, m, 18) + dt.timedelta(days=31)).replace(day=18).strftime('%d %B %Y').lstrip('0')}.
              """)
    email("brightpage_nudge", AT(2026, 10, 2, 17, 5), BP, [MAYA], "Pia's reading streak has paused", """
          Hi Maya,

          Pia hasn't read on BrightPage for 11 days (last session: 21 September). Open the app to restart her streak!
          """, unread=True)

    # ---------------- Kestrel plumbing ----------------
    email("kestrel_booking", AT(2026, 9, 18, 9, 20), KP, [MAYA], "Booking confirmed: hot water repair Tue 22 Sep", """
          Hi Maya,

          Your booking is confirmed for Tuesday 22 September, 8am-12pm. Our plumber will check your hot water unit.

          Kestrel Plumbing
          """)
    email("kestrel_invoice_mail", AT(2026, 9, 24, 15, 30), KP, [MAYA], "Invoice KP-20418 from Kestrel Plumbing", """
          Hi Maya,

          Thanks for choosing Kestrel Plumbing. Invoice KP-20418 for $385.00 is attached and due on 8 October 2026.
          Pay online by card, or by bank transfer quoting the invoice number.

          Kestrel Plumbing
          """, att=["kestrel_invoice"])
    email("kestrel_receipt_card", AT(2026, 9, 30, 12, 11), KP, [MAYA], "Payment received - thank you", """
          Hi Maya,

          We've received your card payment of $385.00 for invoice KP-20418.
          Receipt: R-77311

          Kestrel Plumbing
          """)
    email("ben_paid_plumber", AT(2026, 10, 2, 20, 14), BEN, [MAYA], "Plumber sorted", """
          Hey, just paid the Kestrel invoice by bank transfer from the joint account. All done, one less thing!
          B
          """, thread="kestrel")
    email("kestrel_receipt_eft", AT(2026, 10, 3, 9, 2), KP, [MAYA], "Payment received - thank you", """
          Hi Maya,

          We've received your bank transfer of $385.00 for invoice KP-20418.
          Receipt: R-77402

          Kestrel Plumbing
          """)

    # ---------------- Wattle / Banksia ----------------
    email("wattle_renewal_mail", AT(2026, 11, 3, 9, 44), WA, [MAYA], "Your car insurance renewal", """
          Hi Maya,

          Your comprehensive car insurance (policy WI-CAR-5521908) renews on 7 December 2026.
          Your renewal notice is attached. Your renewal premium is $1,485.54.
          If you'd like to make changes, call us before the renewal date.

          Wattle Insurance
          """, att=["wattle_renewal"])
    email("maya_to_ben_insurance", AT(2026, 11, 6, 19, 2), MAYA, [BEN], "Car insurance went up a lot", """
          Ben, the Wattle renewal is $1,485 (was $1,134!). I just got a quote from Banksia for the same cover,
          $1,109. Can you have a look this weekend?
          M
          """, labels=("SENT",), thread="insurance")
    email("banksia_quote_mail", AT(2026, 11, 6, 18, 20), BK, [MAYA], "Your Banksia Direct quote", """
          Hi Maya,

          Thanks for getting a quote. Your quote BD-8830214 is attached: comprehensive cover, agreed value $14,500,
          excess $650, $1,109.00 for the year. It's valid until 4 December 2026.

          Banksia Direct
          """, att=["banksia_quote"])

    # ---------------- IronWorks ----------------
    email("ironworks_welcome", AT(2024, 11, 28, 18, 5), IW, [BEN], "Welcome to IronWorks", """
          Hi Ben,

          Welcome to IronWorks Brunswick. Your membership agreement is attached.

          See you at the club,
          IronWorks Fitness
          """, att=["ironworks_terms"])
    email("ironworks_miss_you", AT(2026, 10, 14, 10, 0), IW, [BEN], "We miss you!", """
          Hi Ben,

          It's been 6 weeks since your last visit (3 September). Come in this week and bring a friend for free!

          IronWorks Fitness
          """, labels=("INBOX", "PROMOTIONS"))
    email("ironworks_renewal", AT(2026, 10, 28, 8, 30), IW, [BEN], "Your annual membership fee is coming up", """
          Hi Ben,

          A quick reminder: your annual membership fee of $89.00 will be charged on 28 November 2026.

          If you'd like to cancel your membership, you must give written notice at least 14 days before your
          anniversary date (by 14 November 2026).

          IronWorks Fitness
          """, unread=True)
    email("ben_gym_reminder", AT(2026, 11, 2, 21, 30), BEN, [MAYA], "Gym", """
          Remind me to cancel the gym before the 14th or it's another $89. I haven't been since September anyway.
          """, thread="gym")

    # ---------------- Redgum ----------------
    email("redgum_bill_jul_mail", AT(2026, 7, 29, 7, 0), RG, [HOME], "Your Redgum Energy bill is ready", """
          Hi Maya,

          Your bill for 28 April to 27 July is ready. Amount due: $405.72 by 12 August 2026.
          This bill is based on an actual meter reading.

          Redgum Energy
          """, att=["redgum_bill_jul"])
    email("redgum_bill_oct_mail", AT(2026, 10, 27, 7, 0), RG, [HOME], "Your Redgum Energy bill is ready", """
          Hi Maya,

          Your bill for 28 July to 26 October is ready. Amount due: $577.20 by 10 November 2026.
          This bill is based on an estimated meter reading.

          Redgum Energy
          """, att=["redgum_bill_oct"])
    email("ben_meter", AT(2026, 10, 30, 16, 50), BEN, [MAYA], "Meter reading", """
          Just took a photo of the meter in the cupboard. It says 47006. The bill says they estimated 47570?? That
          seems way off, we haven't used that much. Can you look at it?
          """, att=["meter_photo"], thread="meter")
    email("redgum_paid", AT(2026, 11, 10, 7, 0), RG, [HOME], "Payment received", """
          Hi Maya,

          We've received your payment of $577.20. Thanks!

          Redgum Energy
          """)

    # ---------------- Kookaburra (decoy) ----------------
    email("kookaburra_welcome", AT(2025, 11, 1, 9, 0), KM, [MAYA], "Welcome to Kookaburra Mobile", """
          Hi Maya,

          Welcome! Your Everyday 40GB plan is $55.00 per month. Your plan terms are attached.
          """, att=["kookaburra_terms"])
    email("kookaburra_cpi", AT(2026, 10, 15, 9, 15), KM, [MAYA], "Your plan price is changing on 1 November", """
          Hi Maya,

          As set out in your plan terms, your plan price is indexed each November by CPI. The September quarter CPI
          figure is 4.0%, so from 1 November 2026 your Everyday 40GB plan will be $57.20 per month (currently $55.00).

          Kookaburra Mobile
          """)
    for m in (9, 10, 11):
        amt = 57.20 if m == 11 else 55.00
        email(f"kookaburra_bill_{m}", AT(2026, m, 1, 6, 0), KM, [MAYA], "Your Kookaburra bill", f"""
              Hi Maya,

              Everyday 40GB: ${amt:.2f}. Debited today. Thanks!
              """)

    # ---------------- School (decoy) ----------------
    email("school_excursion_ollie", AT(2026, 9, 1, 8, 30), SC, [MAYA, BEN], "Year 3 excursion: Melbourne Museum, Tue 15 Sept", """
          Dear families,

          Year 3 will visit Melbourne Museum on Tuesday 15 September. Cost: $38.00 per student.
          Please pay via SchoolPay by 8 September. Student: Ollie Whitlock (3B).
          """)
    email("school_excursion_pia", AT(2026, 9, 1, 8, 40), SC, [MAYA, BEN], "Prep excursion: Children's Farm, Wed 16 Sept", """
          Dear families,

          Prep will visit the Children's Farm on Wednesday 16 September. Cost: $38.00 per student.
          Please pay via SchoolPay by 8 September. Student: Pia Whitlock (Prep C).
          """)
    for who, ref, tag in [("Ollie Whitlock (3B)", "OH-Y3-0908", "ollie"), ("Pia Whitlock (Prep C)", "PI-PR-0908", "pia")]:
        email(f"school_receipt_{tag}", AT(2026, 9, 8, 7, 45 if tag == "ollie" else 46), SC, [MAYA],
              "SchoolPay receipt", f"""
              Thanks, we've received $38.00 for {who}. Reference: {ref}.
              """)

    # ---------------- Noise ----------------
    email("council_notice", AT(2026, 8, 3, 9, 0), CC, [HOME], "Your 2026/27 rates notice", """
          Your rates notice is attached. Total $1,649.20, payable in four instalments of $412.30.
          """, att=["council_rates"])
    email("council_reminder", AT(2026, 11, 16, 9, 0), CC, [HOME], "Rates instalment due 30 November", """
          Reminder: instalment 2 of 4 ($412.30) is due on 30 November 2026.
          """)
    for (y, m) in [(2026, 9), (2026, 10), (2026, 11)]:
        email(f"bank_statement_{m}", AT(y, m, 1, 5, 0), HB, [MAYA], "Your statement is ready", """
              Your latest statement for Joint Everyday is ready to view in the app.
              """)
    for (y, m) in [(2026, 8), (2026, 9), (2026, 10), (2026, 11)]:
        email(f"tunebox_{m}", AT(y, m, 9, 6, 0), TB, [HOME], "Your TuneBox receipt", """
              TuneBox Family: $20.99. Thanks for listening.
              """)
    d = D(2026, 8, 20)
    while d <= D(2026, 11, 19):
        item = rng.choice(["Free-range chicken thighs", "Seasonal stone fruit", "Sourdough 2 for $9", "Greek yoghurt 1kg",
                           "Barramundi fillets", "Avocados 3 for $5"])
        email(f"harvest_{d.isoformat()}", AT(d.year, d.month, d.day, 6, 30), HM, [HOME],
              "This week's specials", f"This week: {item}. Plus more in store.", labels=("INBOX", "PROMOTIONS"))
        d += dt.timedelta(days=7)
    for (y, m, dd, subj) in [(2026, 9, 4, "Term 3 wrap-up"), (2026, 10, 9, "Term 4 starts"),
                             (2026, 11, 6, "Parent-teacher interviews"), (2026, 11, 13, "End-of-year events")]:
        email(f"school_news_{m}_{dd}", AT(y, m, dd, 15, 0), SC, [MAYA, BEN], f"School newsletter: {subj}",
              "Dear families, this fortnight's news is below. Please see the school calendar for dates.")
    email("swim_term", AT(2026, 10, 12, 9, 0), ("Aquastart Swim School", "hello@aquastart.example"), [MAYA],
          "Term 4 lessons: Pia, Saturdays 9am", "Lessons run each Saturday until 12 December. Monthly fee $168.00.")
    email("parcel", AT(2026, 10, 22, 13, 5), ("Courier Hub", "tracking@courierhub.example"), [MAYA],
          "Your parcel is on its way", "Your parcel arrives today between 1pm and 5pm.")

    # ---- finalise ----
    EM.sort(key=lambda e: (e["when"], e["tag"]))
    inbox = []
    for i, e in enumerate(EM, 1):
        e["id"] = f"msg_{i:04d}"
    for e in EM:
        atts = []
        for k, tg in enumerate(e["att"], 1):
            dc = next(d for d in DOCS if d["tag"] == tg)
            atts.append({"id": f"{e['id']}_att{k}", "filename": dc["filename"], "mimeType": dc["mime"],
                         "sizeBytes": dc["size"], "documentId": dc["id"]})
        body = e["body"]
        inbox.append({
            "id": e["id"], "threadId": f"thr_{e['thread'] or e['id']}", "date": iso(e["when"]),
            "from": {"name": e["frm"][0], "address": e["frm"][1]},
            "to": [{"name": n, "address": a} for n, a in e["to"]], "subject": e["subject"],
            "snippet": " ".join(body.split())[:140], "body": body, "labels": e["labels"],
            "unread": e["unread"], "attachments": atts})
    write_json(ROOT / "email" / "inbox.json", {
        "account": MAYA[1], "alsoReads": HOME[1], "count": len(inbox), "messages": inbox,
        "note": "Maya's mailbox. It also receives the shared household address (home@whitlock.example). "
                "Emails from Ben appear because he sends household admin to Maya.",
    })


def E(tag):
    return next(e["id"] for e in EM if e["tag"] == tag)


def Es(prefix):
    return [e["id"] for e in EM if e["tag"].startswith(prefix)]


# --------------------------------------------------------------------------------------
# 4. CALENDAR
# --------------------------------------------------------------------------------------
CAL: list[dict] = []


def ev(tag, title, start, end=None, all_day=False, cal="Family", notes="", created=None, creator="Maya",
       recurrence=None, location=""):
    CAL.append(dict(tag=tag, calendar=cal, title=title, start=start, end=end, allDay=all_day, notes=notes,
                    createdAt=created, createdBy=creator, recurrence=recurrence, location=location))


def build_calendar():
    ev("plumber", "Kestrel Plumbing: hot water repair", iso(AT(2026, 9, 22, 8)), iso(AT(2026, 9, 22, 12)),
       cal="Family", creator="Ben", created=iso(AT(2026, 9, 18, 9, 22)))
    ev("exc_y3", "Ollie: Year 3 excursion, Melbourne Museum", "2026-09-15", all_day=True, creator="Maya",
       created=iso(AT(2026, 9, 1, 9)))
    ev("exc_prep", "Pia: Prep excursion, Children's Farm", "2026-09-16", all_day=True, creator="Maya",
       created=iso(AT(2026, 9, 1, 9)))
    ev("gym_cancel", "Cancel gym membership (deadline tomorrow!)", iso(AT(2026, 11, 13, 9)), iso(AT(2026, 11, 13, 9, 15)),
       cal="Ben", creator="Ben", created=iso(AT(2026, 11, 2, 21, 35)),
       notes="Need 14 days notice before the 28th or it's another $89.")
    ev("rates", "Council rates due: $412.30", "2026-11-30", all_day=True, creator="Maya", created=iso(AT(2026, 11, 16, 9, 5)))
    ev("insurance_due", "Car insurance renews (Wattle)", "2026-12-07", all_day=True, creator="Maya",
       created=iso(AT(2026, 11, 3, 9, 50)), notes="Banksia quote BD-8830214 valid until 4 Dec.")
    ev("car_service", "Car service", iso(AT(2026, 12, 2, 8, 30)), iso(AT(2026, 12, 2, 10)), cal="Maya", creator="Maya",
       created=iso(AT(2026, 11, 1, 10)), location="Brunswick Auto Care")
    ev("interviews", "Parent-teacher interviews", iso(AT(2026, 11, 24, 16)), iso(AT(2026, 11, 24, 16, 30)),
       creator="Maya", created=iso(AT(2026, 11, 6, 15, 10)))
    ev("dentist", "Maya: dentist", iso(AT(2026, 11, 26, 12, 30)), iso(AT(2026, 11, 26, 13, 15)), cal="Maya",
       creator="Maya", created=iso(AT(2026, 8, 25, 12)))
    ev("birthday", "Ollie's birthday party", iso(AT(2026, 12, 5, 14)), iso(AT(2026, 12, 5, 17)), creator="Maya",
       created=iso(AT(2026, 10, 20, 18)), location="Brunswick Pool")
    ev("term_end", "Last day of Term 4", "2026-12-18", all_day=True, creator="Maya", created=iso(AT(2026, 10, 9, 15, 5)))
    ev("swim", "Pia: swimming", iso(AT(2026, 10, 17, 9)), iso(AT(2026, 10, 17, 9, 45)), creator="Maya",
       created=iso(AT(2026, 10, 12, 9, 10)), recurrence="RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261212T000000Z",
       location="Aquastart Brunswick")
    ev("bins", "Bins out (recycling)", iso(AT(2026, 11, 22, 19)), iso(AT(2026, 11, 22, 19, 10)), creator="Ben",
       created=iso(AT(2026, 8, 1, 10)), recurrence="RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU")
    ev("holiday", "Family holiday (Lorne)", "2026-12-26", all_day=True, creator="Maya", created=iso(AT(2026, 9, 14, 20)),
       notes="Through 2 Jan.")
    for i, c in enumerate(CAL, 1):
        c["id"] = f"evt_{i:03d}"
    write_json(ROOT / "calendar" / "events.json", {
        "timezone": "Australia/Melbourne",
        "calendars": [{"id": "Family", "owners": ["Maya", "Ben"]}, {"id": "Maya"}, {"id": "Ben"}],
        "count": len(CAL),
        "events": [{k: v for k, v in c.items() if k != "tag"} for c in CAL],
        "note": "Recurring events carry an RRULE; the connector expands instances for a requested range.",
    })


def C(tag):
    return next(c["id"] for c in CAL if c["tag"] == tag)


# --------------------------------------------------------------------------------------
# 5. PERSONA + CONNECTORS + GROUND TRUTH + README
# --------------------------------------------------------------------------------------
def build_persona_and_connectors():
    write_json(ROOT / "persona.json", {
        "household": "The Whitlocks",
        "location": "Brunswick, Victoria, Australia",
        "asOf": iso(NOW),
        "people": [
            {"name": "Maya Whitlock", "role": "primary user, does most household admin", "email": MAYA[1],
             "work": "designer at Cobalt Studio"},
            {"name": "Ben Whitlock", "role": "partner", "email": BEN[1], "work": "operations at Tidewater Logistics"},
            {"name": "Ollie Whitlock", "role": "child, age 8, Year 3"},
            {"name": "Pia Whitlock", "role": "child, age 5, Prep"},
        ],
        "sharedMailbox": HOME[1],
        "housing": {"type": "renting", "address": ADDRESS, "rentPerMonth": 2420.00},
        "userNeeds": "Maya wants a quiet monthly check: anything quietly costing the household money, with the "
                     "evidence gathered and the fix drafted, so she only has to approve.",
        "agentPreferences": {
            "neverActWithoutApproval": ["send email", "cancel subscription", "create calendar event", "move money"],
            "tone": "friendly but firm; plain Australian English; no legalese",
            "signOff": "Thanks, Maya",
            "flagThresholdPerMonthAud": 10.00,
            "sendFrom": MAYA[1],
        },
    })
    write_json(ROOT / "connectors" / "manifest.json", {
        "asOf": iso(NOW),
        "connectors": [
            {"id": "bank", "name": "Harbour Bank", "kind": "banking", "status": "connected", "access": "read-only",
             "scopes": ["accounts.read", "transactions.read"], "source": "bank/accounts.json",
             "lastSyncedAt": iso(AT(2026, 11, 19, 6, 0)), "pageSize": 50,
             "latencyMs": {"p50": 260, "p95": 900}, "operations": ["listAccounts", "listTransactions"]},
            {"id": "email", "name": "Mailbox (Maya)", "kind": "email", "status": "connected", "access": "read + draft",
             "scopes": ["mail.read", "mail.compose"], "source": "email/inbox.json", "pageSize": 25,
             "lastSyncedAt": iso(AT(2026, 11, 19, 9, 25)), "latencyMs": {"p50": 180, "p95": 650},
             "operations": ["search", "getMessage", "createDraft"],
             "notes": "Sending is never exposed; the agent can only create drafts."},
            {"id": "documents", "name": "Household Admin folder", "kind": "documents", "status": "connected",
             "access": "read-only", "source": "documents/index.json", "pageSize": 20,
             "lastSyncedAt": iso(AT(2026, 11, 19, 9, 0)), "latencyMs": {"p50": 120, "p95": 400},
             "operations": ["list", "read", "readText"], "notes": "Images need a vision-capable model."},
            {"id": "calendar", "name": "Family calendar", "kind": "calendar", "status": "connected",
             "access": "read + create", "source": "calendar/events.json", "lastSyncedAt": iso(AT(2026, 11, 19, 9, 20)),
             "latencyMs": {"p50": 150, "p95": 500}, "operations": ["listEvents", "createEvent"]},
        ],
        "scenarios": [
            {"id": "calendar_reauth", "default": False, "connector": "calendar",
             "behaviour": "Calls fail with 401 'token expired'. UI should offer a reconnect."},
            {"id": "bank_rate_limit", "default": False, "connector": "bank",
             "behaviour": "Every 4th listTransactions call returns 429 with retryAfterSeconds=3."},
            {"id": "slow_documents", "default": False, "connector": "documents",
             "behaviour": "readText takes 4-6 seconds (tests waiting states)."},
        ],
    })


def build_ground_truth():
    leaks = [
        {"id": "L1", "slug": "skylink-promo-ended-early", "title": "Internet price rose after 12 months, but the agreement promised 24",
         "kind": "price_increase_vs_contract", "merchant": "Skylink Internet", "severity": "medium",
         "evidence": {"transactions": [T("skylink_sep"), T("skylink_oct"), T("skylink_nov")],
                      "emails": [E("skylink_welcome"), E("skylink_change")] + Es("skylink_bill_"),
                      "documents": [Dc("skylink_agreement")], "calendar": []},
         "amounts": {"recoverable_to_date": 40.00, "ongoing_per_month": 20.00,
                     "remaining_charges_in_promo": 10, "total_at_stake": 240.00},
         "deadlines": [{"date": "2026-12-14", "what": "next $99 charge"}],
         "expected_action": "Draft a message to Skylink citing the 24-month Bonus Saver term; ask to restore $79 and "
                            "credit the $40 overcharged to date.",
         "draft_should_mention": ["24 months", "$79.00", "14 October 2025", "Oct and Nov charges"]},
        {"id": "L2", "slug": "streambox-duplicate", "title": "StreamBox is paid twice: directly (Ben) and through Apple (Maya)",
         "kind": "duplicate_subscription", "merchant": "StreamBox", "severity": "medium",
         "evidence": {"transactions": Ts("streambox_direct_") + Ts("apple_streambox_"),
                      "emails": Es("streambox_") + Es("apple_"), "documents": [], "calendar": []},
         "amounts": {"charges_visible_in_statements": 3, "charges_since_june_per_emails": 5,
                     "duplicate_total_since_june": 89.95, "ongoing_per_month": 17.99},
         "deadlines": [{"date": "2026-11-21", "what": "next Apple renewal; cancel at least a day before (by 2026-11-20)"}],
         "expected_action": "Recommend cancelling one (the Apple-billed subscription, started 21 June); explain how. "
                            "Optionally draft a refund request for duplicate months.",
         "difficulty_notes": "The card descriptor says only APPLE.COM/BILL; the product is revealed only in the Apple receipt emails."},
        {"id": "L3", "slug": "gym-annual-fee-missed-notice", "title": "Gym annual fee renews in 9 days; the 14-day cancellation deadline passed on 14 Nov",
         "kind": "renewal_trap", "merchant": "IronWorks Fitness", "severity": "medium",
         "evidence": {"transactions": Ts("gym_monthly_"),
                      "emails": [E("ironworks_welcome"), E("ironworks_miss_you"), E("ironworks_renewal"), E("ben_gym_reminder")],
                      "documents": [Dc("ironworks_terms")], "calendar": [C("gym_cancel")]},
         "amounts": {"annual_fee_at_risk": 89.00, "monthly_fee": 29.95, "last_visit": "2026-09-03"},
         "deadlines": [{"date": "2026-11-14", "what": "notice deadline (already missed)"},
                       {"date": "2026-11-28", "what": "annual fee charged"}],
         "expected_action": "Draft a cancellation notice plus a goodwill request to waive the annual fee: no visits since 3 Sep, "
                            "Ben tried to cancel (calendar reminder). Be honest that the notice period was missed.",
         "difficulty_notes": "Requires date arithmetic (14 days before 28 Nov) against 'today' = 19 Nov."},
        {"id": "L4", "slug": "brightpage-trial-converted", "title": "Kids' reading app trial converted to $14.99/month and is unused",
         "kind": "trial_converted", "merchant": "BrightPage Kids", "severity": "low",
         "evidence": {"transactions": Ts("brightpage_"), "emails": [E("brightpage_trial"), E("brightpage_trial_end"),
                                                                     E("brightpage_nudge")] + Es("brightpage_receipt_"),
                      "documents": [], "calendar": []},
         "amounts": {"paid_to_date": 44.97, "ongoing_per_month": 14.99},
         "deadlines": [{"date": "2026-12-18", "what": "next charge"}],
         "expected_action": "Recommend cancelling; optionally ask for a refund of the most recent month."},
        {"id": "L5", "slug": "kestrel-double-payment", "title": "Plumber invoice KP-20418 paid twice (card and bank transfer)",
         "kind": "duplicate_payment", "merchant": "Kestrel Plumbing", "severity": "high",
         "evidence": {"transactions": [T("kestrel_card"), T("kestrel_eft")],
                      "emails": [E("kestrel_invoice_mail"), E("kestrel_receipt_card"), E("ben_paid_plumber"),
                                 E("kestrel_receipt_eft")], "documents": [Dc("kestrel_invoice")], "calendar": []},
         "amounts": {"refund_due": 385.00},
         "deadlines": [],
         "expected_action": "Draft a refund request quoting invoice KP-20418 and both receipts (R-77311, R-77402); ask for "
                            "$385.00 back to the card or account of their choice."},
        {"id": "L6", "slug": "wattle-renewal-31pct", "title": "Car insurance renewal up 31%, with a cheaper like-for-like quote in hand",
         "kind": "renewal_price_creep", "merchant": "Wattle Insurance", "severity": "high",
         "evidence": {"transactions": [], "emails": [E("wattle_renewal_mail"), E("maya_to_ben_insurance"), E("banksia_quote_mail")],
                      "documents": [Dc("wattle_renewal"), Dc("banksia_quote")], "calendar": [C("insurance_due")]},
         "amounts": {"renewal_premium": 1485.54, "last_year": 1134.00, "increase": 351.54, "increase_pct": 31.0,
                     "competitor_quote": 1109.00, "potential_saving": 376.54},
         "deadlines": [{"date": "2026-12-04", "what": "Banksia quote expires"}, {"date": "2026-12-07", "what": "Wattle charges the renewal"}],
         "expected_action": "Draft a retention request to Wattle referencing the loyalty discount drop and the $1,109 quote; "
                            "surface the decision (switch vs retain) before 4 Dec.",
         "difficulty_notes": "Same cover, same agreed value and excess: the agent should verify the quote is comparable."},
        {"id": "L7", "slug": "redgum-estimated-read", "title": "Electricity bill based on an inflated estimated reading",
         "kind": "billing_error", "merchant": "Redgum Energy", "severity": "high",
         "evidence": {"transactions": [T("energy_pay")], "emails": [E("redgum_bill_jul_mail"), E("redgum_bill_oct_mail"),
                                                                    E("ben_meter"), E("redgum_paid")],
                      "documents": [Dc("redgum_bill_jul"), Dc("redgum_bill_oct"), Dc("meter_photo")], "calendar": []},
         "amounts": {"billed": 577.20, "estimated_overbilling_aud": 175.00, "tolerance": 15.00,
                     "method": "Photo reads 47,006 kWh on 30 Oct. Back out ~4 days at 12.1 kWh/day (~49 kWh) to 26 Oct: ~46,957. "
                               "Actual usage ~1,077 kWh vs billed 1,690 kWh: ~613 kWh x $0.285 = ~$175."},
         "deadlines": [],
         "expected_action": "Draft a bill-correction request attaching the meter photo and asking for a credit or refund of "
                            "roughly $175 (already paid on 10 Nov).",
         "difficulty_notes": "Needs the image model to read the odometer, then arithmetic done in code. The red digit is the "
                             "tenths: the reading is 47,006 kWh, not 470,060 (a realistic misread to guard against)."},
    ]
    decoys = [
        {"id": "D1", "slug": "kookaburra-cpi", "title": "Mobile plan rose $55.00 to $57.20 (4.0%)",
         "why_not_a_leak": "Plan terms provide for annual CPI indexation, the 4.0% notice was sent in advance, and "
                           "55.00 x 1.04 = 57.20 exactly.",
         "evidence": {"transactions": Ts("mobile_"), "emails": [E("kookaburra_welcome"), E("kookaburra_cpi")],
                      "documents": [Dc("kookaburra_terms")]}},
        {"id": "D2", "slug": "school-excursions", "title": "Two $38.00 SchoolPay charges on the same day",
         "why_not_a_leak": "Different children, different references (OH-Y3-0908 vs PI-PR-0908), two separate excursion notices.",
         "evidence": {"transactions": [T("excursion_ollie"), T("excursion_pia")],
                      "emails": [E("school_excursion_ollie"), E("school_excursion_pia"), E("school_receipt_ollie"),
                                 E("school_receipt_pia")]}},
    ]
    upcoming = [
        {"date": "2026-11-21", "what": "StreamBox renewal via Apple ($17.99)", "leak": "L2"},
        {"date": "2026-11-28", "what": "IronWorks annual fee ($89.00)", "leak": "L3"},
        {"date": "2026-11-30", "what": "Council rates instalment 2 of 4 ($412.30)", "leak": None},
        {"date": "2026-12-03", "what": "StreamBox direct debit ($17.99)", "leak": "L2"},
        {"date": "2026-12-05", "what": "IronWorks monthly ($29.95)", "leak": "L3"},
        {"date": "2026-12-07", "what": "Wattle renewal charged ($1,485.54)", "leak": "L6"},
        {"date": "2026-12-14", "what": "Skylink direct debit ($99.00)", "leak": "L1"},
        {"date": "2026-12-18", "what": "BrightPage renewal ($14.99)", "leak": "L4"},
    ]
    write_json(ROOT / "eval" / "ground_truth.json", {
        "WARNING": "Evaluation only. The running app must not read this folder.",
        "asOf": iso(NOW), "leaks": leaks, "decoys": decoys, "upcoming_charges": upcoming,
        "scoring": {
            "recall": "found leaks / 7", "precision": "true leaks / flagged items (D1 and D2 must not be flagged)",
            "amounts": "correct to the cent unless a tolerance is given",
            "drafts": "must cite real evidence (ids/amounts/dates) and not invent facts",
        },
    })


README = """# Seed data: the Whitlock household

A fictional Melbourne household (Maya, Ben, Ollie 8, Pia 5) with three months of bank history, a year of
email, a synced documents folder and a family calendar. Everything is fictional; brand names are invented.

"Today" inside the app is **Thursday 19 November 2026, 9:30am (Australia/Melbourne)**.

| Folder | What the fake connector serves |
| --- | --- |
| `bank/` | `joint-everyday.csv`, `maya-visa.csv`, `accounts.json` (history from 2026-08-20) |
| `email/inbox.json` | Maya's mailbox plus the shared household address (~75 messages) |
| `documents/` | PDFs, a meter photo, `index.json`, and `_text/` pre-extracted text |
| `calendar/events.json` | Family, Maya and Ben calendars (some recurring) |
| `connectors/manifest.json` | Connection state, paging, latency, opt-in failure scenarios |
| `persona.json` | Household profile and the agent's standing preferences |
| `eval/` | Ground truth for scoring. **The app must never load this.** |

## Regenerate / check

```bash
python3 generate.py   # deterministic; PDFs need reportlab, the photo needs Pillow
python3 verify.py     # balances, cross-references, arithmetic
```

## Conventions

- Dates are ISO-8601 in Australia/Melbourne. Bank descriptors are intentionally messy.
- Card balance is negative when money is owed and is paid in full on the 12th.
- Documents carry a text sidecar, as a real connector's index would. The meter photo has none: use a vision model.
"""


def main():
    build_bank()
    build_docs()
    render_docs()
    build_emails()
    build_calendar()
    build_persona_and_connectors()
    build_ground_truth()
    (ROOT / "README.md").write_text(README, encoding="utf-8")
    print("txns:", len(TXN), "| docs:", len(DOCS), "| emails:", len(EM), "| events:", len(CAL))


if __name__ == "__main__":
    main()
