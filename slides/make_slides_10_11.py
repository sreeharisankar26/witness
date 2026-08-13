"""
Slides 10–11 — the real document, and the zone drill-down.

    python slides/make_slides_10_11.py

  10  "Its reference numbers put the contract number first, and our fallback
       parser expected them to start with sub. It found zero rows, while the
       model found five. A fallback that silently returns nothing is the worst
       possible way to fail. Fixed, and regression tested."
       -> shown immediately AFTER the Hanford PDF is on screen

  11  "Every zone opens up. What is approved here. What is correctly installed.
       What was misinstalled. What is damaged. And the workers' own notes, in
       their own words."
       -> only if you do not record the dashboard. Real footage beats this.

Same sheet as slides 01-09.
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
    return tracked(d, xy, text.upper(), font("Semibold", size), colour, 2.2)


def footer(d, left_lines, y=880, right_lines=None):
    hairline(d, MARGIN, y, RIGHT, INK)
    for i, (txt, weight) in enumerate(left_lines):
        d.text((MARGIN, y + 34 + i * 42), txt, font=font(weight, 30), fill=INK)
    if right_lines:
        f = font("Regular", 26)
        for i, line in enumerate(right_lines):
            d.text((RIGHT - f.getlength(line), y + 36 + i * 38), line, font=f, fill=INK_2)


# ── 10 · the fallback that returned nothing ──────────────────────────────────

def slide_10():
    """
    Two failures are being described and only one is interesting. "Our regex was
    wrong" is a bug; "it returned nothing and called that success" is the point.
    So the reference strings get the top half — set in mono, because the whole
    problem is where a string begins — and the bottom half is the scoreboard
    that makes the silence visible: zero against five.
    """
    img, d = page("A real document")
    headline(d, "Zero rows. No error.")
    d.text((MARGIN, 372), "The reference numbers put the contract number first.",
           font=font("Regular", 32), fill=INK_2)

    TOP = 480
    f_code = mono(40)

    # What the parser insisted on.
    label(d, (MARGIN, TOP), "OUR PATTERN EXPECTED A LINE TO BEGIN", INK_3, 15)
    d.text((MARGIN, TOP + 40), "SUB-001", font=f_code, fill=INK_2)
    # The anchor that did the damage, called out under the first character.
    d.line([(MARGIN - 2, TOP + 96), (MARGIN + f_code.getlength("SUB") + 2, TOP + 96)],
           fill=INK_3 + (200,), width=2)
    tracked(d, (MARGIN, TOP + 106), "ANCHORED HERE", font("Semibold", 15), INK_3, 2.2)

    # What the document actually carries.
    y2 = TOP + 176
    label(d, (MARGIN, y2), "WHAT THE DOCUMENT ACTUALLY CARRIES", STOP, 15)
    prefix, rest = "XXXXXX-XXX-", "SUB-001"
    d.rectangle([MARGIN - 10, y2 + 34, MARGIN + f_code.getlength(prefix) + 6, y2 + 96],
                fill=STOP_WASH)
    d.text((MARGIN, y2 + 40), prefix, font=f_code, fill=STOP)
    d.text((MARGIN + f_code.getlength(prefix), y2 + 40), rest, font=f_code, fill=INK)
    # Under the string, not beside it — beside it runs into the scoreboard.
    d.text((MARGIN, y2 + 108),
           "eleven characters before the thing we were looking for",
           font=font("Regular", 24), fill=INK_2)

    # The scoreboard. Zero has to be the loud one, so it gets the wash and the
    # rule; five is set quietly, because the model being right is not the story.
    SX, SY = MARGIN + 1000, TOP - 16
    for i, (who, n, bad) in enumerate([("THE PATTERN EXTRACTOR", "0", True),
                                       ("THE MODEL", "5", False)]):
        y = SY + i * 176
        if bad:
            d.rectangle([SX - 30, y - 18, RIGHT + 22, y + 138], fill=STOP_WASH)
            d.rectangle([SX - 30, y - 18, SX - 25, y + 138], fill=STOP)
        label(d, (SX, y), who, STOP if bad else INK_3, 15)
        d.text((SX, y + 32), n, font=font("Medium", 96), fill=STOP if bad else INK_2)
        d.text((SX + 96, y + 78), "rows found", font=font("Regular", 28),
               fill=INK if bad else INK_3)

    footer(d, [("A fallback that silently returns nothing", "Regular"),
               ("is the worst possible way to fail.", "Semibold")],
           y=880,
           right_lines=["Fixed, and regression tested.",
                        "That is what a real document is for."])
    return save(img, HERE / "10-zero-rows.jpg")


# ── 11 · the zone drill-down ─────────────────────────────────────────────────

def slide_11():
    """
    Four of these five come out of the record by arithmetic. The fifth does not,
    and cannot — so it is set apart, below its own rule, in a different weight.
    A slide that listed all five identically would be quietly claiming the
    testimony is derived like the rest, which is the one thing it is not.
    """
    img, d = page("The record")
    headline(d, "Every zone opens up.")

    TOP, ROW = 424, 86
    items = [
        ("APPROVED HERE",       "the revision this zone is allowed to receive"),
        ("CORRECTLY INSTALLED", "scanned, matched, and signed off at the beam"),
        ("MISINSTALLED",        "wrong revision, confirmed by a human, NCR raised"),
        ("DAMAGED",             "cracked on arrival — firm immediately, no committee"),
    ]
    for i, (name, body) in enumerate(items):
        y = TOP + i * ROW
        hairline(d, MARGIN, y - 26, RIGHT, RULE)
        label(d, (MARGIN, y), name, INK_3, 17)
        d.text((MARGIN + 480, y - 6), body, font=font("Regular", 27), fill=INK_2)

    # The one that is testimony rather than arithmetic.
    y = TOP + len(items) * ROW + 22
    hairline(d, MARGIN, y - 26, RIGHT, INK)
    label(d, (MARGIN, y), "THE WORKERS' OWN NOTES", INK, 17)
    d.text((MARGIN + 480, y - 8), "in their own words, attributed, and never a verdict",
           font=font("Semibold", 27), fill=INK)

    footer(d, [("The first four are derived from the record.", "Regular"),
               ("The last one is the only thing the record cannot know.", "Semibold")],
           y=880,
           right_lines=["Only the worker was standing there."])
    return save(img, HERE / "11-every-zone-opens.jpg")


if __name__ == "__main__":
    for fn in (slide_10, slide_11):
        p = fn()
        print(f"{p.name:32} {p.stat().st_size/1024:6.0f} KB")
