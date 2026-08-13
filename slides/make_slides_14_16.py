"""
Slides 14–16 — the limits, the thesis restated, and the end card.

    python slides/make_slides_14_16.py

  14  "It cannot see bad workmanship. It cannot tell you a part was fitted
       backwards. It will not catch a part that nobody chose to scan. Those are
       not bugs we are going to fix."

  15  "The model reads. The logic rules. Everything a model touches here is
       optional… which is exactly why this still works with the network off,
       the API key missing, and the clock wrong."

  16  "That's Witness. Thank you for watching."

The close has to do the opposite of what a pitch usually does at the end. It
narrows. So slide 14 draws a boundary rather than listing failures, slide 15
returns to the exact frame the video turned on, and slide 16 says almost
nothing.

Same sheet as slides 01-13.
"""
from pathlib import Path
from sheet import (
    W, H, MARGIN, PAPER, INK, INK_2, INK_3, RULE, RULE_STRONG,
    STOP, STOP_WASH, OK, OK_WASH, CHECK, CHECK_WASH,
    font, mono, tracked, tracked_width, hairline, page, headline, save, sheet,
)
from PIL import ImageDraw

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


def centred(d, y, text, fnt, fill, track=0.0):
    x = (W - tracked_width(text, fnt, track)) / 2
    tracked(d, (x, y), text, fnt, fill, track)


# ── 14 · the boundary ────────────────────────────────────────────────────────

def slide_14():
    """
    A list of things it cannot do reads as an apology. The same facts drawn as a
    BOUNDARY read as a specification — so both sides are set identically, in the
    same type at the same size, separated by one rule. Nothing on the right is
    struck out or reddened: these are not failures, and marking them as failures
    would contradict the sentence being spoken over them.
    """
    img, d = page("Scope")
    headline(d, "What it cannot see.")
    d.text((MARGIN, 372), "Named out loud, because a system that hid this would deserve less trust.",
           font=font("Regular", 32), fill=INK_2)

    TOP, ROW = 500, 96
    MID = W / 2
    cols = [
        (MARGIN, "IT RULES ON", INK, INK, [
            "an identity",
            "a revision",
            "an approved record for this place",
        ]),
        (MID + 60, "IT CANNOT SEE", INK_3, INK_3, [
            "bad workmanship",
            "a part fitted backwards",
            "a part nobody chose to scan",
        ]),
    ]
    for x, name, lc, tc, items in cols:
        label(d, (x, TOP), name, lc, 16)
        hairline(d, x, TOP + 34, x + 700, RULE_STRONG if lc == INK else RULE)
        for i, item in enumerate(items):
            d.text((x, TOP + 66 + i * ROW), item,
                   font=font("Medium" if lc == INK else "Regular", 40), fill=tc)

    # The line between them. Vertical, full height of the two lists, because the
    # claim is a boundary and a boundary is a line.
    d.line([(MID, TOP - 10), (MID, TOP + 66 + 2 * ROW + 60)], fill=RULE_STRONG + (255,), width=1)

    footer(d, [("Those are not bugs we are going to fix.", "Regular"),
               ("They are outside what this system claims to do.", "Semibold")],
           y=856,
           right_lines=["The moment it is confidently wrong, even once,",
                        "nobody believes the green verdicts either."])
    return save(img, HERE / "14-what-it-cannot-see.jpg")


# ── 15 · the thesis, restated ────────────────────────────────────────────────

def slide_15():
    """
    Deliberately the same frame as slide 02 — same words, same grey-to-black
    pivot, same rule drawn between them. The video should end where it turned.

    What is added is the evidence: three conditions under which every model in
    the system is unavailable, and the verdict is unchanged. That is what makes
    "optional" a fact rather than a claim.
    """
    img, d = page("The close")

    centred(d, 236, "The model reads.", font("Medium", 100), INK_2, -2.6)
    d.line([(W / 2 - 260, 384), (W / 2 + 260, 384)], fill=INK + (56,), width=1)
    centred(d, 406, "The logic rules.", font("Medium", 100), INK, -2.6)

    TOP, BW, BH = 610, 470, 150
    GAP = (RIGHT - MARGIN - 3 * BW) // 2
    conditions = [
        ("NETWORK OFF", "the record is already on the phone"),
        ("API KEY MISSING", "the ladder falls to patterns, and says so"),
        ("CLOCK WRONG", "freshness is unknown, so it downgrades itself"),
    ]
    for i, (name, why) in enumerate(conditions):
        x = MARGIN + i * (BW + GAP)
        d.rectangle([x, TOP, x + BW, TOP + BH], outline=RULE_STRONG + (255,), width=1)
        label(d, (x + 28, TOP + 26), name, INK, 16)
        d.text((x + 28, TOP + 62), why, font=font("Regular", 22), fill=INK_2)
        tracked(d, (x + 28, TOP + 104), "STILL RULES", font("Semibold", 20), INK, 2.4)

    footer(d, [("Everything a model touches here is optional.", "Regular"),
               ("None of it can change a verdict.", "Semibold")],
           y=856,
           right_lines=["Which is exactly why all three of these",
                        "change nothing about the answer."])
    return save(img, HERE / "15-the-model-reads.jpg")


# ── 16 · end card ────────────────────────────────────────────────────────────

def slide_16():
    """
    Nothing to argue any more. A wordmark, the one sentence the whole thing is
    for, who made it, and where the code is — so a judge who wants to check
    anything has the address while the last frame is still up.

    No running head: this is not a page of the document, it is the cover.
    """
    img = sheet()
    d = ImageDraw.Draw(img, "RGBA")

    centred(d, 336, "WITNESS", font("Semibold", 132), INK, 12.0)
    d.line([(W / 2 - 330, 520), (W / 2 + 330, 520)], fill=INK + (60,), width=1)
    centred(d, 552, "Catches the wrong part before it goes into a building.",
            font("Regular", 34), INK_2)

    centred(d, 664, "KAYA AI  ·  IIT INDIA HACKATHON 2026  ·  TRACK 1, PHYSICAL AI",
            font("Semibold", 17), INK_3, 3.0)
    centred(d, 716, "TEAM ESPADA — IIT HYDERABAD", font("Semibold", 17), INK_3, 3.0)
    centred(d, 762, "Sree Harisankar · Priyanshu Kripashankar Singh · Mithun N · Nishanth A",
            font("Regular", 25), INK_2)

    centred(d, 860, "github.com/sreeharisankar26/kaya_espada", mono(25), INK)
    centred(d, 906, "189 tests · zero runtime dependencies on the safety path",
            font("Regular", 22), INK_3)

    return save(img, HERE / "16-end-card.jpg")


if __name__ == "__main__":
    for fn in (slide_14, slide_15, slide_16):
        p = fn()
        print(f"{p.name:32} {p.stat().st_size/1024:6.0f} KB")
