#!/usr/bin/env python3
"""
Generates the submittal register PDFs that ingestion is tested against.

SYNTHETIC, and deliberately messy. Real submittal registers are exported from a
dozen different systems and none of them agree: revisions written five ways,
dates in three formats, a superseding note buried in free text, a row that is
still PENDING sitting in the same table as approved ones.

The mess here is not decoration. Each defect below exists because a naive
"OCR the table into JSON" pipeline gets it wrong, and the validator in
server/ingest.mjs has to catch it:

  * PENDING and REJECTED rows        - must never become an approved revision
  * "Rev. C" / "REV-C" / "C1"        - revision written inconsistently
  * a blank zone                     - approval with no location is not actionable
  * conflicting revs, same SKU+zone  - the document contradicts itself
  * a superseding note in prose      - the table says B, the note says do not fit B
  * an OCR-plausible typo (GT-l2)    - letter l for digit 1

Output: docs/submittals/*.pdf
"""
import pathlib
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "submittals"
OUT.mkdir(parents=True, exist_ok=True)

PROJECT = "HILLSIDE TOWER - BLOCK C"
JOB = "PRJ-4471"

# id, sku, description, discipline, zone, rev, date, status
ROWS_A = [
    ("SUB-0001", "GT-12",  "Grout Termination Unit, 50mm",   "Structural", "Zone A", "Rev C",  "31-Jul-2026", "APPROVED"),
    ("SUB-0002", "GT-12",  "Grout Termination Unit, 50mm",   "Structural", "Zone B", "REV-C",  "31/07/2026",  "APPROVED"),
    ("SUB-0003", "VLV-22", "Isolation Valve, DN50 PN16",     "Mechanical", "Zone B", "Rev. C", "2026-07-28",  "APPROVED"),
    ("SUB-0004", "AHU-04", "Air Handling Unit, 4000 CFM",    "Mechanical", "Zone C", "D",      "28-Jul-2026", "APPROVED"),
    # Still in review. A pipeline that ingests this creates an "approved"
    # revision that nobody approved.
    ("SUB-0005", "PNL-08", "Distribution Panel, 400A",       "Electrical", "Zone C", "Rev B",  "09-Aug-2026", "PENDING"),
    # No location. An approval that does not say where is not a ruling.
    ("SUB-0006", "DMP-15", "Fire Damper, 600x400",           "Mechanical", "",       "Rev A",  "12-Jul-2026", "APPROVED"),
    ("SUB-0007", "VLV-22", "Isolation Valve, DN50 PN16",     "Mechanical", "Zone D", "Rev C",  "28-Jul-2026", "APPROVED"),
    # OCR-plausible: lowercase L instead of the digit one.
    ("SUB-0008", "GT-l2",  "Grout Termination Unit, 50mm",   "Structural", "Zone D", "Rev C",  "31-Jul-2026", "APPROVED"),
]

ROWS_B = [
    ("SUB-0011", "AHU-04", "Air Handling Unit, 4000 CFM",    "Mechanical", "Zone A", "Rev D",  "28-Jul-2026", "APPROVED"),
    ("SUB-0012", "AHU-04", "Air Handling Unit, 4000 CFM",    "Mechanical", "Zone B", "Rev D",  "28-Jul-2026", "APPROVED"),
    # Directly contradicts SUB-0001 in the other document.
    ("SUB-0013", "GT-12",  "Grout Termination Unit, 50mm",   "Structural", "Zone A", "Rev B",  "04-Jun-2026", "APPROVED"),
    ("SUB-0014", "PNL-08", "Distribution Panel, 400A",       "Electrical", "Zone D", "Rev C",  "01-Aug-2026", "APPROVED"),
    ("SUB-0015", "DMP-15", "Fire Damper, 600x400",           "Mechanical", "Zone C", "Rev B",  "22-Jul-2026", "REJECTED"),
]

NOTES_A = [
    "NOTES / TRANSMITTAL REMARKS",
    "1. SUB-0013 (GT-12 Rev B, Zone A) is SUPERSEDED BY SUB-0001 Rev C dated 31-Jul-2026.",
    "   Rev B units are not to be installed in Zone A. Any already fitted to be removed.",
    "2. SUB-0005 remains PENDING consultant approval. Do not release for installation.",
    "3. SUB-0006 zone allocation to be confirmed by the mechanical coordinator.",
    "4. Issued for construction unless marked otherwise above.",
]

NOTES_B = [
    "NOTES / TRANSMITTAL REMARKS",
    "1. SUB-0015 REJECTED - damper rating does not meet the 90 minute requirement.",
    "   Resubmission required. Nothing to be installed against this reference.",
    "2. AHU-04 Rev D supersedes Rev C across all zones.",
]


def sheet(path, title, ref, issued, rows, notes):
    c = canvas.Canvas(str(path), pagesize=A4)
    W, H = A4
    y = H - 22 * mm

    c.setFont("Helvetica-Bold", 15)
    c.drawString(18 * mm, y, PROJECT)
    y -= 6 * mm
    c.setFont("Helvetica", 9.5)
    c.drawString(18 * mm, y, f"Job No. {JOB}      {title}")
    y -= 5 * mm
    c.drawString(18 * mm, y, f"Transmittal ref: {ref}      Issued: {issued}")
    y -= 8 * mm
    c.setLineWidth(0.8)
    c.line(18 * mm, y, W - 18 * mm, y)
    y -= 7 * mm

    cols = [18, 42, 62, 112, 140, 158, 172]      # mm
    heads = ["REF", "ITEM", "DESCRIPTION", "DISCIPLINE", "LOCATION", "REV", "STATUS"]
    c.setFont("Helvetica-Bold", 7.6)
    for x, h in zip(cols, heads):
        c.drawString(x * mm, y, h)
    y -= 2.5 * mm
    c.setLineWidth(0.4)
    c.line(18 * mm, y, W - 18 * mm, y)
    y -= 5 * mm

    c.setFont("Helvetica", 7.8)
    for sub, sku, desc, disc, zone, rev, date, status in rows:
        vals = [sub, sku, desc[:34], disc, zone or "-", rev, status]
        for x, v in zip(cols, vals):
            c.drawString(x * mm, y, v)
        c.setFont("Helvetica", 6.4)
        c.drawString(cols[5] * mm, y - 3 * mm, date)
        c.setFont("Helvetica", 7.8)
        y -= 8 * mm

    y -= 4 * mm
    c.setLineWidth(0.4)
    c.line(18 * mm, y, W - 18 * mm, y)
    y -= 7 * mm
    for i, line in enumerate(notes):
        c.setFont("Helvetica-Bold" if i == 0 else "Helvetica", 8.2 if i == 0 else 7.6)
        c.drawString(18 * mm, y, line)
        y -= 5 * mm

    c.setFont("Helvetica-Oblique", 6.5)
    c.drawString(18 * mm, 12 * mm,
                 "SYNTHETIC DOCUMENT - generated by tools/make_submittals.py for testing Witness ingestion.")
    c.showPage()
    c.save()
    return path


a = sheet(OUT / "submittal-register-A.pdf", "SUBMITTAL REGISTER - SHEET 1 OF 2",
          "TR-2026-0148", "09-Aug-2026", ROWS_A, NOTES_A)
b = sheet(OUT / "submittal-register-B.pdf", "SUBMITTAL REGISTER - SHEET 2 OF 2",
          "TR-2026-0149", "10-Aug-2026", ROWS_B, NOTES_B)

print(f"wrote {a}")
print(f"wrote {b}")
print(f"  {len(ROWS_A) + len(ROWS_B)} rows, of which "
      f"{sum(1 for r in ROWS_A + ROWS_B if r[7] != 'APPROVED')} are not approved")


# ---------------------------------------------------------------------------
# A register built on a REAL one.
#
# The layout, column headings, terminology and status vocabulary below are
# taken from a genuine US Department of Energy document: Hanford Mission
# Integration Solutions, Project L-895, "Appendix A - Submittal Register",
# Rev 0, 10/11/2021 (docs/submittals/L-895_Appendix_A_Rev_0.pdf).
#
# Why this exists. The published L-895 register is PRE-AWARD: every reference
# is a placeholder ("XXXXXX-XXX shall be updated to the contract-release number
# upon award") and the status column is empty, because Document Control fills
# it in later. So it proves the pipeline does not hallucinate - it correctly
# refuses all five rows - but it cannot exercise the approval logic at all.
#
# This file is that same document at the stage it reaches on a live project:
# contract number issued, status codes entered. We did not choose the format,
# the headings, or what A/B/C mean - Hanford did, and their own definitions are
# reproduced verbatim on the sheet. What is synthetic is only the equipment
# rows, because L-895 tracks document deliverables rather than materials.
#
# Status codes, quoted from the source document:
#     A = Conforms to the subcontract requirements
#     B = Minor comments, approved with exceptions as corrected
#     C = Revise and resubmit
#
# Note the trap it sets, which is why it is worth testing against: column 5
# carries AP and APW - SUBMITTAL TYPE, not approval. Both start with "A".

HANFORD_ROWS = [
    # sub no,  ver, sow,   description,                        type, format,     item,     zone,     rev,     status
    ("SUB-001", "001", "5.1.2", "Grout Termination Unit, 50mm",     "APW", "PDF, MFC", "GT-12",  "Zone A", "Rev C", "A"),
    ("SUB-002", "001", "5.1.2", "Grout Termination Unit, 50mm",     "APW", "PDF, MFC", "GT-12",  "Zone B", "Rev C", "A"),
    # Approved WITH exceptions. Still an approval; the corrections matter.
    ("SUB-003", "002", "3.1",   "Isolation Valve, DN50 PN16",       "AP",  "PDF",      "VLV-22", "Zone D", "Rev C", "B"),
    # Revise and resubmit. Not approved, and sitting in the same table.
    ("SUB-004", "001", "3.1",   "Air Handling Unit, 4000 CFM",      "AP",  "DWG, PDF", "AHU-04", "Zone C", "Rev B", "C"),
    ("SUB-005", "001", "3.2",   "Distribution Panel, 400A",         "APW", "PDF, MFC", "PNL-08", "Zone D", "Rev C", "A"),
    # Milestone code "EC" in the duration column, bare "A" in status. Both are
    # single letters in a real register and mean entirely different things.
    ("SUB-006", "001", "3.2",   "Fire Damper, 600x400",             "AP",  "PDF",      "DMP-05", "Zone C", "Rev A", "A"),
]

CONTRACT = "354825-001"


def hanford_sheet(path):
    c = canvas.Canvas(str(path), pagesize=(297 * mm, 210 * mm))   # A4 landscape
    W, H = 297 * mm, 210 * mm
    y = H - 16 * mm

    c.setFont("Helvetica", 7)
    c.drawRightString(W - 14 * mm, y, "Project L-895, Fire Protection Infrastructure for Plateau Raw Water")
    y -= 4 * mm
    c.drawRightString(W - 14 * mm, y, "RFP Number: 354825      Rev. 1      Date: 12/08/2026")
    y -= 9 * mm

    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(W / 2, y, "Hanford Mission Integration Solutions")
    y -= 5 * mm
    c.drawCentredString(W / 2, y, "Appendix A - Submittal Register")
    y -= 9 * mm

    c.setFont("Helvetica", 7.5)
    c.drawString(14 * mm, y, f"Contract No:        {CONTRACT}")
    c.drawString(150 * mm, y, "A/E Subcontractor Name:  Espada Mechanical Ltd")
    y -= 8 * mm

    c.setLineWidth(0.7)
    c.line(14 * mm, y, W - 14 * mm, y)
    y -= 5 * mm

    cols = [14, 52, 64, 78, 140, 158, 180, 205, 232, 252, 268]   # mm
    heads = ["SUB. NO.", "VER.", "SOW", "DESCRIPTION / DOCUMENT TITLE", "SUB. TYPE",
             "FORMAT", "ITEM", "LOCATION", "REV", "A/E DUR.", "STATUS"]
    c.setFont("Helvetica-Bold", 6.2)
    for x, h in zip(cols, heads):
        c.drawString(x * mm, y, h)
    y -= 2.5 * mm
    c.setLineWidth(0.4)
    c.line(14 * mm, y, W - 14 * mm, y)
    y -= 6 * mm

    c.setFont("Helvetica", 6.8)
    for sub, ver, sow, desc, styp, fmt, item, zone, rev, status in HANFORD_ROWS:
        vals = [f"{CONTRACT}-{sub}", ver, sow, desc, styp, fmt, item, zone, rev, "KO + 8d", status]
        for x, v in zip(cols, vals):
            c.drawString(x * mm, y, v)
        y -= 7 * mm

    y -= 4 * mm
    c.line(14 * mm, y, W - 14 * mm, y)
    y -= 7 * mm
    c.setFont("Helvetica-Bold", 6.6)
    c.drawString(14 * mm, y, "9. STATUS CODE: Submittal review status code. For use primarily by Project Document Control.")
    y -= 4.5 * mm
    c.setFont("Helvetica", 6.4)
    for line in [
        "A = Conforms to the subcontract requirements",
        "B = Minor comments, approved with exceptions as corrected",
        "C = Revise and resubmit",
        "",
        "5. SUBMITTAL TYPE:  AP = Approval Required (work may proceed prior to Buyer approval).",
        "                    APW = Approval Required Prior to Work.",
        "",
        "NOTES:  1. 354825-001-SUB-004 (AHU-04 Rev B, Zone C) is SUPERSEDED BY 354825-001-SUB-011 Rev C.",
    ]:
        c.drawString(20 * mm, y, line)
        y -= 4.2 * mm

    c.setFont("Helvetica-Oblique", 5.8)
    c.drawString(14 * mm, 10 * mm,
                 "Layout, headings and status vocabulary reproduced from Hanford L-895 Appendix A (real DOE document). "
                 "Equipment rows are synthetic - the published register is pre-award and tracks document deliverables.")
    c.showPage()
    c.save()
    return path


h = hanford_sheet(OUT / "submittal-register-C-hanford-format.pdf")
print(f"wrote {h}")
print(f"  {len(HANFORD_ROWS)} rows in the real DOE register format (A/B/C status codes)")
