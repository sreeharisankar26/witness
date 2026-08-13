"""
Slides 12–13 — one bad delivery, and the question that is never sent.

    python slides/make_slides_12_13.py

  12  "It isn't three mistakes. It is one bad delivery. And nobody on site can
       see that, because nobody on site is looking at all three at once. Only
       the record is. It proposes. A supervisor confirms."

  13  "And every held row becomes a drafted question. Addressed, referenced,
       asking one thing that has an actual answer. Not sent."

Both slides are about the same discipline from two directions: the system may
notice, and may propose, and may never act. So both are built the same way —
what the system produces is set as ordinary paper, and the human step is the
line that closes the page.

Same sheet as slides 01-11.
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


# ── 12 · one bad delivery ────────────────────────────────────────────────────

def slide_12():
    """
    The argument is about point of view, so the slide is two points of view side
    by side and nothing else. Left is what a person at the beam sees: three
    separate incidents, each complete, each in its own box, none of them wrong.
    Right is the same three facts with one thing added — being looked at
    together — and that is the whole inference.

    The headline pivots grey to black across the two sentences, the same device
    slide 02 uses for the thesis, because it is the same shape of claim: the
    second line corrects the first.
    """
    img, d = page("The record")
    headline(d, "It isn't three mistakes.", 226, 92, fill=INK_2)
    headline(d, "It is one bad delivery.", 322, 92)

    TOP = 496
    CW = 700

    # LEFT — three separate incidents, as they arrive at the beam.
    label(d, (MARGIN, TOP), "WHAT THE BEAM SEES", INK_3, 15)
    units = [("SN-2214", "Zone A"), ("SN-2251", "Zone A"), ("SN-2263", "Zone A")]
    for i, (serial, zone) in enumerate(units):
        y = TOP + 44 + i * 86
        d.rectangle([MARGIN, y, MARGIN + CW, y + 68], outline=RULE_STRONG + (255,), width=1)
        d.text((MARGIN + 22, y + 18), serial, font=mono(26), fill=INK_2)
        d.text((MARGIN + 200, y + 20), "GT-12 fitted at Rev B", font=font("Regular", 24), fill=INK_2)
        d.text((MARGIN + CW - 90, y + 20), zone, font=font("Regular", 24), fill=INK_3)
        d.text((MARGIN + CW + 26, y + 20), "one mistake", font=font("Regular", 23), fill=INK_3)

    # RIGHT — the same three, looked at together. Solid, because the inference
    # is only available here.
    BX, BY = MARGIN + 1010, TOP + 28
    d.rectangle([BX, BY, RIGHT, BY + 214], fill=INK)
    tracked(d, (BX + 44, BY + 36), "WHAT THE RECORD SEES", font("Semibold", 15), (150, 155, 162), 2.4)
    d.text((BX + 42, BY + 68), "1 return batch", font=font("Semibold", 58), fill=PAPER)
    d.text((BX + 46, BY + 152), "GT-12 · Rev B · 3 distinct units",
           font=mono(23), fill=(176, 180, 186))

    d.text((BX, BY + 258), "Nobody on site is looking at all three at once.",
           font=font("Regular", 26), fill=INK_2)

    footer(d, [("It proposes. A supervisor confirms.", "Semibold")],
           y=880,
           right_lines=["Sending stock back to a supplier is",
                        "a commercial act, not an observation."])
    return save(img, HERE / "12-one-bad-delivery.jpg")


# ── 13 · drafted, not sent ───────────────────────────────────────────────────

def slide_13():
    """
    The draft has to look like real correspondence or the restraint means
    nothing — refusing to send a vague blob is easy, refusing to send something
    finished is the point. So the left half is the actual RFI text the tool
    produces, set as a letter, and the only mark on it is the one that says it
    never left the building.
    """
    img, d = page("Held rows")
    headline(d, "Drafted. Not sent.")
    d.text((MARGIN, 372), "Every held row is an unanswered question, so it is written as one.",
           font=font("Regular", 32), fill=INK_2)

    # The letter.
    LX, LY, LW = MARGIN, 470, 1020
    d.rectangle([LX, LY, LX + LW, LY + 344], fill=(253, 252, 250), outline=RULE_STRONG + (255,), width=1)
    d.text((LX + 34, LY + 30), "RFI-001", font=mono(24), fill=INK)
    d.text((LX + 34, LY + 64), "Hillside Tower — Block C · PRJ-4471",
           font=font("Regular", 21), fill=INK_3)
    hairline(d, LX + 34, LY + 104, LX + LW - 34, RULE)

    lines = [
        ("Subject", "SUB-0008 — part number not recognised (GT-l2)"),
        ("Reference", "SUB-0008 (submittal-register-A.pdf)"),
    ]
    for i, (k, v) in enumerate(lines):
        y = LY + 124 + i * 40
        d.text((LX + 34, y), k, font=font("Regular", 21), fill=INK_3)
        d.text((LX + 170, y), v, font=font("Regular", 22), fill=INK_2)

    body = [
        "Please confirm whether \"GT-l2\" is a typographical error",
        "for \"GT-12\", or a part we have not been issued.",
        "We have deliberately not assumed.",
    ]
    for i, line in enumerate(body):
        d.text((LX + 34, LY + 224 + i * 34), line,
               font=font("Regular" if i < 2 else "Semibold", 24), fill=INK)

    # The mark that matters. Set as a label rather than a stamp, because a
    # rubber stamp would imply a person had already handled it.
    SX = LX + LW + 70
    d.rectangle([SX, LY, SX + 6, LY + 344], fill=STOP)
    tracked(d, (SX + 34, LY + 8), "NOT SENT", font("Semibold", 42), STOP, 5.0)
    for i, line in enumerate(["An RFI is correspondence on a",
                              "construction contract. A person",
                              "reads this and presses send."]):
        d.text((SX + 36, LY + 84 + i * 38), line, font=font("Regular", 26), fill=INK_2)

    hairline(d, SX + 34, LY + 220, RIGHT, RULE_STRONG)
    for i, line in enumerate(["A system emailing a consultant",
                              "in a coordinator's name is not",
                              "a feature."]):
        d.text((SX + 36, LY + 242 + i * 36), line,
               font=font("Semibold" if i == 2 else "Regular", 26), fill=INK)

    footer(d, [("Addressed, referenced, and asking one thing", "Regular"),
               ("that has an actual answer.", "Semibold")],
           y=880,
           right_lines=["2 held rows  ·  2 questions drafted  ·  0 sent"])
    return save(img, HERE / "13-drafted-not-sent.jpg")


if __name__ == "__main__":
    for fn in (slide_12, slide_13):
        p = fn()
        print(f"{p.name:32} {p.stat().st_size/1024:6.0f} KB")
