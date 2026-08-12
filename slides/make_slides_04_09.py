"""
Slides 04–09 — the gate, and the ensemble.

    python slides/make_slides_04_09.py

Covers the longest stretch of narration in the video, which is also the
stretch with nothing obvious to point a camera at:

  04  "This row is still pending consultant approval. Same table. Same columns."
  05  "…the app is confidently, deterministically wrong. The lie got in at the door."
  06  "That reads G T, dash, lowercase L, two… and we still refuse the row."
  07  "Three outcomes. Never two."
  08  "We measure where the model contradicts itself."
  09  "Two out of three is a coin that landed twice."

Each slide carries ONE idea. Where a slide would have to explain two things, it
is two slides — a held frame is cheap, a confused viewer is not.

Drawn straight to JPEG so the type is crisp at full resolution rather than
resampled out of a browser window.
"""
from pathlib import Path
from sheet import (
    W, H, MARGIN, PAPER, INK, INK_2, INK_3, RULE, RULE_STRONG,
    STOP, STOP_WASH, OK, OK_WASH, CHECK, CHECK_WASH,
    font, mono, tracked, tracked_width, hairline, page, headline, save,
)

HERE = Path(__file__).resolve().parent
RIGHT = W - MARGIN


def label(d, xy, text, colour=INK_3, size=19):
    """A drawing label: small, semibold, tracked."""
    return tracked(d, xy, text.upper(), font("Semibold", size), colour, 2.2)


def footer(d, left_lines, y=880, right_lines=None):
    """The closing band. Full width, so the page ends on a line."""
    hairline(d, MARGIN, y, RIGHT, INK)
    for i, (txt, weight) in enumerate(left_lines):
        d.text((MARGIN, y + 34 + i * 42), txt, font=font(weight, 30), fill=INK)
    if right_lines:
        f = font("Regular", 26)
        for i, line in enumerate(right_lines):
            d.text((RIGHT - f.getlength(line), y + 36 + i * 38), line, font=f, fill=INK_2)


# ── 04 · the pending row ─────────────────────────────────────────────────────

def slide_04():
    """
    The argument is that the dangerous row is INDISTINGUISHABLE, so the table
    has to be set as an ordinary table. The only thing that separates the
    refused row from the approved ones is one word in one column — which is
    exactly the claim — so that is the only thing allowed to differ.
    """
    img, d = page("The gate")
    headline(d, "It sits in the same table.")
    d.text((MARGIN, 372), "Same columns. Right next to the ones that were approved.",
           font=font("Regular", 32), fill=INK_2)

    COLS = [(MARGIN, "REF"), (410, "ITEM"), (1000, "ZONE"), (1190, "REV"), (1330, "STATUS")]
    TOP, ROW = 486, 74

    for x, name in COLS:
        label(d, (x, TOP), name, INK_3, 14)
    hairline(d, MARGIN, TOP + 30, RIGHT, RULE_STRONG)

    rows = [
        ("SUB-0001", "GT-12 grille assembly",   "Zone A", "C", "APPROVED", False),
        ("SUB-0002", "GT-12 grille assembly",   "Zone B", "C", "APPROVED", False),
        ("SUB-0005", "PNL-08 control panel",    "Zone C", "B", "PENDING",  True),
        ("SUB-0007", "VLV-22 balancing valve",  "Zone D", "C", "APPROVED", False),
        ("SUB-0011", "AHU-04 air handling unit","Zone A", "D", "APPROVED", False),
    ]
    f_ref, f_body = mono(23), font("Regular", 25)

    for i, (ref, item, zone, rev, status, danger) in enumerate(rows):
        y = TOP + 46 + i * ROW
        if danger:
            # A wash, not a border. The row must still look like it belongs.
            d.rectangle([MARGIN - 22, y - 12, RIGHT + 22, y + ROW - 24], fill=STOP_WASH)
            d.rectangle([MARGIN - 22, y - 12, MARGIN - 17, y + ROW - 24], fill=STOP)
        d.text((MARGIN, y + 4), ref, font=f_ref, fill=INK if danger else INK_2)
        d.text((410, y), item, font=f_body, fill=INK if danger else INK_2)
        d.text((1000, y), zone, font=f_body, fill=INK_2)
        d.text((1190, y), rev, font=font("Medium", 26), fill=INK_2)
        tracked(d, (1330, y + 5), status, font("Semibold", 18),
                STOP if danger else OK, 1.8)
        hairline(d, MARGIN, y + ROW - 22, RIGHT, RULE)

    footer(d, [("One word, in one column,", "Regular"),
               ("is the whole difference.", "Semibold")],
           y=880,
           right_lines=["Nobody approved SUB-0005.",
                        "It is still with the consultant."])
    return save(img, HERE / "04-same-table.jpg")


# ── 05 · the lie at the door ─────────────────────────────────────────────────

def slide_05():
    """
    A pipeline drawn left to right, with the corruption marked at the FIRST
    arrow and every stage after it labelled honest. The shape of the picture is
    the argument: the failure is at the entrance, not in the machinery.
    """
    img, d = page("The gate")
    headline(d, "The lie gets in at the door.")

    BW, BH, TOP = 356, 178, 496
    GAP = (RIGHT - MARGIN - 4 * BW) // 3
    stages = [
        ("THE REGISTER", ["SUB-0005", "status: PENDING"], "mono"),
        ("OCR TO JSON",  ['"ref": "SUB-0005"', '"approved": true'], "mono"),
        ("THE APP",      ["Rev B is approved", "for Zone C"], "sans"),
        ("THE WORKER",   ["fits it, and", "signs it off"], "sans"),
    ]

    for i, (name, lines, kind) in enumerate(stages):
        x = MARGIN + i * (BW + GAP)
        bad = i >= 1
        d.rectangle([x, TOP, x + BW, TOP + BH],
                    fill=STOP_WASH if bad else None,
                    outline=(STOP + (110,)) if bad else (RULE_STRONG + (255,)), width=1)
        label(d, (x + 26, TOP + 26), name, STOP if bad else INK_3, 14)
        f = mono(21) if kind == "mono" else font("Regular", 24)
        for j, line in enumerate(lines):
            d.text((x + 26, TOP + 74 + j * 34), line, font=f,
                   fill=INK if (bad and j == 1) else INK_2)

        if i < 3:
            ax = x + BW + 14
            ay = TOP + BH // 2
            d.line([(ax, ay), (ax + GAP - 34, ay)], fill=INK_3 + (170,), width=2)
            d.polygon([(ax + GAP - 34, ay - 8), (ax + GAP - 12, ay),
                       (ax + GAP - 34, ay + 8)], fill=INK_3 + (170,))

    # The one place it went wrong, marked on the first arrow.
    dx = MARGIN + BW + GAP // 2 - 6
    d.line([(dx, TOP + BH // 2 - 46), (dx, TOP + BH // 2 - 14)], fill=STOP, width=3)
    t = "HERE"
    tw = tracked_width(t, font("Semibold", 17), 2.4)
    tracked(d, (dx - tw / 2, TOP + BH // 2 - 78), t, font("Semibold", 17), STOP, 2.4)

    # Everything after the door behaves perfectly. That is the problem.
    y = TOP + BH + 42
    d.text((MARGIN + BW + GAP, y),
           "Every stage after this one does its job correctly.",
           font=font("Regular", 26), fill=INK_2)

    footer(d, [("Everything downstream is honest.", "Regular"),
               ("That is what makes it dangerous.", "Semibold")],
           y=880,
           right_lines=["Confidently wrong.", "Out loud. To a worker."])
    return save(img, HERE / "05-the-lie-at-the-door.jpg")


# ── 06 · GT-l2 ───────────────────────────────────────────────────────────────

def slide_06():
    """
    Set in a monospaced face for one reason: in most sans faces a lowercase l
    and a digit 1 are near-identical, and the whole slide is about a reader
    being unable to tell them apart. Mono makes the trap visible, which is the
    only way an audience can feel why it is a trap.
    """
    img, d = page("The gate")
    headline(d, "We know what it should say.")

    f_big = mono(150, bold=True)
    x, y = MARGIN, 436

    # Draw it a glyph at a time so the offending character can be inked in red.
    for ch in "GT-l2":
        d.text((x, y), ch, font=f_big, fill=STOP if ch == "l" else INK)
        if ch == "l":
            cw = f_big.getlength(ch)
            d.line([(x - 4, y + 178), (x + cw + 4, y + 178)], fill=STOP, width=4)
            tracked(d, (x - 34, y + 196), "LOWERCASE L", font("Semibold", 16), STOP, 2.2)
        x += f_big.getlength(ch)

    # What it almost certainly is, set quieter and beside it.
    ax = x + 96
    d.text((ax, y + 34), "→", font=font("Regular", 74), fill=INK_3)
    d.text((ax + 104, y), "GT-12", font=mono(150), fill=INK_3)
    tracked(d, (ax + 108, y + 196), "ALMOST CERTAINLY", font("Semibold", 16), INK_3, 2.2)

    # The two facts, stacked in the closing band, weighted so the second lands.
    footer(d, [("We print the suggestion.", "Regular"),
               ("We refuse the row anyway.", "Semibold")],
           y=828,
           right_lines=["A part number that gets silently corrected",
                        "is a wrong part, confidently approved."])
    return save(img, HERE / "06-gt-l2.jpg")


# ── 07 · three outcomes ──────────────────────────────────────────────────────

def slide_07():
    img, d = page("The gate")
    headline(d, "Three outcomes. Never two.")

    COLW = (RIGHT - MARGIN - 2 * 70) // 3
    TOP = 452
    cols = [
        ("Accepted", OK, OK_WASH,
         ["Every field verified against", "the project's own zones", "and parts."]),
        ("Held", CHECK, CHECK_WASH,
         ["Readable, but not", "verifiable. Sent to a human", "with the reason."]),
        ("Refused", STOP, STOP_WASH,
         ["Positively disqualified.", "Never enters the", "approved record."]),
    ]
    for i, (name, colour, wash, lines) in enumerate(cols):
        x = MARGIN + i * (COLW + 70)
        d.rectangle([x, TOP, x + COLW, TOP + 10], fill=colour)
        d.text((x, TOP + 44), name, font=font("Medium", 62), fill=INK)
        hairline(d, x, TOP + 140, x + COLW, RULE_STRONG)
        for j, line in enumerate(lines):
            d.text((x, TOP + 168 + j * 40), line, font=font("Regular", 27), fill=INK_2)

    footer(d, [("If you only have accept and reject, you are forced", "Regular"),
               ("to guess about everything in between.", "Semibold")],
           y=848,
           right_lines=["And guessing is the whole", "thing we are trying to avoid."])
    return save(img, HERE / "07-three-outcomes.jpg")


# ── 08 · disagreement, not confidence ────────────────────────────────────────

def slide_08():
    """
    Two reads set as two identical columns, so the eye finds the one row that
    differs before the narration names it. The disagreement is the content; the
    layout just has to get out of its way.
    """
    img, d = page("Ensemble")
    headline(d, "We measure where it", 226, 92)
    headline(d, "contradicts itself.", 322, 92)
    d.text((MARGIN, 448), "Not how confident it says it is.",
           font=font("Regular", 32), fill=INK_2)

    fields = [("ref", "SUB-0009", "SUB-0009"),
              ("part", "VLV-22", "VLV-22"),
              ("zone", "Zone D", "Zone D"),
              ("rev", "C", "B")]

    TOP, ROW, CW = 566, 62, 380
    for c, (name, x) in enumerate([("READ 1", MARGIN), ("READ 2", MARGIN + CW + 60)]):
        label(d, (x, TOP), name, INK_3, 15)
        hairline(d, x, TOP + 28, x + CW, RULE_STRONG)

    for i, (fname, a, b) in enumerate(fields):
        y = TOP + 48 + i * ROW
        differs = a != b
        for c, val in enumerate((a, b)):
            x = MARGIN + c * (CW + 60)
            if differs:
                d.rectangle([x - 14, y - 8, x + CW, y + 40], fill=STOP_WASH)
            d.text((x, y), fname, font=font("Regular", 24), fill=INK_3)
            d.text((x + 130, y), val, font=mono(26, bold=differs),
                   fill=STOP if differs else INK_2)
            hairline(d, x, y + 48, x + CW, RULE)

    # The consequence, set as the only solid block on the page.
    BX, BY = MARGIN + 2 * (CW + 60) + 40, TOP + 20
    d.rectangle([BX, BY, RIGHT, BY + 214], fill=INK)
    d.text((BX + 44, BY + 40), "Held.", font=font("Semibold", 68), fill=PAPER)
    for i, line in enumerate(["One field is unreliable on this",
                              "document. A person decides it."]):
        d.text((BX + 46, BY + 132 + i * 34), line, font=font("Regular", 24), fill=(176, 180, 186))

    footer(d, [("Self-reported confidence is poorly calibrated,", "Regular"),
               ("and it fails silently. Disagreement does not.", "Semibold")], y=880)
    return save(img, HERE / "08-disagreement.jpg")


# ── 09 · we do not vote ──────────────────────────────────────────────────────

def slide_09():
    img, d = page("Ensemble")
    headline(d, "Two out of three is a coin", 226, 92)
    headline(d, "that landed twice.", 322, 92)

    TOP = 500
    label(d, (MARGIN, TOP), "THREE READS OF THE SAME ROW", INK_3, 15)
    reads = [("read 1", "Rev C"), ("read 2", "Rev C"), ("read 3", "Rev B")]
    for i, (name, val) in enumerate(reads):
        y = TOP + 48 + i * 74
        d.text((MARGIN, y), name, font=font("Regular", 25), fill=INK_3)
        d.text((MARGIN + 150, y - 4), val, font=mono(30), fill=INK_2)
        hairline(d, MARGIN, y + 52, MARGIN + 420, RULE)

    # The move everybody else makes, struck out.
    VX = MARGIN + 540
    label(d, (VX, TOP), "WHAT SELF-CONSISTENCY DOES", INK_3, 15)
    txt = "majority wins → Rev C"
    f = font("Regular", 34)
    d.text((VX, TOP + 52), txt, font=f, fill=INK_3)
    d.line([(VX - 10, TOP + 78), (VX + f.getlength(txt) + 10, TOP + 72)], fill=STOP, width=3)
    d.text((VX, TOP + 124), "A majority is not evidence", font=font("Regular", 26), fill=INK_2)
    d.text((VX, TOP + 160), "about an approved revision.", font=font("Regular", 26), fill=INK_2)

    # What we do instead.
    BX, BY = MARGIN + 1150, TOP - 34
    d.rectangle([BX, BY, RIGHT, BY + 244], fill=INK)
    d.text((BX + 44, BY + 44), "Held.", font=font("Semibold", 68), fill=PAPER)
    for i, line in enumerate(["The row goes to a person", "instead. Every time."]):
        d.text((BX + 46, BY + 142 + i * 34), line, font=font("Regular", 24), fill=(176, 180, 186))

    footer(d, [("We deliberately do not take a majority.", "Semibold")],
           y=880, right_lines=["Read twice. Compare.", "Hold what disagrees."])
    return save(img, HERE / "09-we-do-not-vote.jpg")


if __name__ == "__main__":
    for fn in (slide_04, slide_05, slide_06, slide_07, slide_08, slide_09):
        p = fn()
        print(f"{p.name:32} {p.stat().st_size/1024:6.0f} KB")
