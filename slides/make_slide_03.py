"""
Slide 03 — "The scan is the sign-off." Rendered straight to JPEG.

    python slides/make_slide_03.py

For the narration:

    "And here is what makes people actually use it. The scan is the sign-off.
     There is no form to fill in afterwards. Verifying it, and recording it,
     are the same single action."

Same material as slides 01 and 02 and the supervisor view: warm paper, a
drafting graticule, ink, and colour spent on nothing decorative. Drawn rather
than screenshotted so the type sits on the paper at full resolution instead of
being resampled out of a browser.

The one idea the picture has to carry is COLLAPSE — two obligations becoming
one act. So the two things being collapsed are set as pale, ruled, separate
rows on the left, and the thing they become is a single filled block on the
right. Filled, because it is the only element on the page that is solid: the
eye should land there and understand the argument before reading a word.

Pillow + numpy. No network.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np
from pathlib import Path

W, H = 1920, 1080
OUT = Path(__file__).resolve().parent / "03-the-scan-is-the-signoff.jpg"

# Same palette as dashboard/index.html.
PAPER      = (251, 250, 247)
INK        = (21, 23, 26)
INK_2      = (85, 89, 95)
INK_3      = (139, 144, 151)
RULE       = (228, 224, 216)
RULE_STRONG= (201, 195, 184)

F = "/usr/share/fonts/truetype/lato/Lato-%s.ttf"
def font(weight, size):
    return ImageFont.truetype(F % weight, size)

MARGIN = 140


# ── helpers ──────────────────────────────────────────────────────────────────

def tracked(draw, xy, text, fnt, fill, track=0.0, anchor_y="top"):
    """
    Draw text with letter-spacing, which Pillow has no concept of.

    Tracking is the difference between small caps that look like a drawing
    label and small caps that look like a web page, so it is worth the loop.
    Returns the advance width.
    """
    x, y = xy
    if anchor_y == "mid":
        asc, desc = fnt.getmetrics()
        y -= (asc + desc) / 2
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += fnt.getlength(ch) + track
    return x - xy[0]


def tracked_width(text, fnt, track=0.0):
    return sum(fnt.getlength(c) for c in text) + track * max(0, len(text) - 1)


def tight(draw, xy, text, fnt, fill, track=0.0):
    """Headline setting: the same loop, used with NEGATIVE tracking."""
    return tracked(draw, xy, text, fnt, fill, track)


def hairline(draw, x0, y, x1, colour, alpha=255, width=1):
    draw.line([(x0, y), (x1, y)], fill=colour + (alpha,), width=width)


# ── the sheet ────────────────────────────────────────────────────────────────

def sheet():
    """Paper, graticule, light and tooth. Every layer at the edge of perception."""
    img = Image.new("RGB", (W, H), PAPER)

    # Engineering graticule: fine 12px squares inside a 120px module, exactly
    # like the drawing sheet the supervisor view is set on.
    grid = Image.new("L", (W, H), 0)
    g = ImageDraw.Draw(grid)
    for x in range(0, W, 12):
        g.line([(x, 0), (x, H)], fill=46)
    for y in range(0, H, 12):
        g.line([(0, y), (W, y)], fill=46)
    for x in range(0, W, 120):
        g.line([(x, 0), (x, H)], fill=104)
    for y in range(0, H, 120):
        g.line([(0, y), (W, y)], fill=104)

    # Fade it out toward the edges so the page does not read as tiled wallpaper.
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.sqrt(((xx - W * 0.34) / (W * 0.78)) ** 2 + ((yy - H * 0.42) / (H * 0.80)) ** 2)
    mask = np.clip(1.25 - r * 1.35, 0, 1) ** 1.5
    grid = Image.fromarray((np.asarray(grid) * mask).astype(np.uint8))
    img.paste(Image.new("RGB", (W, H), RULE_STRONG), (0, 0), grid)

    # The warmth a sheet picks up where light falls on it. Off-centre, so it
    # reads as light rather than as a vignette filter.
    warm = np.zeros((H, W, 3), np.float32)
    d1 = np.sqrt(((xx - W * 0.20) / (W * 0.72)) ** 2 + ((yy + H * 0.14) / (H * 0.80)) ** 2)
    d2 = np.sqrt(((xx - W * 1.02) / (W * 0.62)) ** 2 + ((yy - H * 0.06) / (H * 0.70)) ** 2)
    warm[..., 0] = np.clip(1 - d1, 0, 1) * 5.0 + np.clip(1 - d2, 0, 1) * 5.0
    warm[..., 1] = np.clip(1 - d1, 0, 1) * 4.2 + np.clip(1 - d2, 0, 1) * 2.6
    warm[..., 2] = np.clip(1 - d1, 0, 1) * 2.4 - np.clip(1 - d2, 0, 1) * 1.6
    base = np.asarray(img).astype(np.float32) + warm
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))

    # Paper tooth. Real paper is not flat, and a perfectly flat off-white reads
    # as a screen. Felt rather than seen.
    noise = np.random.default_rng(7).normal(0, 5.0, (H, W, 1))
    img = Image.fromarray(np.clip(np.asarray(img).astype(np.float32) + noise, 0, 255).astype(np.uint8))
    return img


# ── the page ─────────────────────────────────────────────────────────────────

img = sheet()
d = ImageDraw.Draw(img, "RGBA")

# running head — identical to slides 01 and 02, so the deck reads as one document
f_head = font("Semibold", 15)
x = MARGIN
x += tracked(d, (x, 120), "WITNESS", f_head, INK_2, track=2.4)
d.ellipse([x + 16, 127, x + 21, 132], fill=RULE_STRONG)
tracked(d, (x + 37, 120), "ADOPTION", font("Regular", 15), INK_3, track=2.4)
hairline(d, MARGIN, 165, W - MARGIN, INK, alpha=41)

# headline
f_h1 = font("Medium", 104)
tight(d, (MARGIN, 236), "The scan is the sign-off.", f_h1, INK, track=-2.6)

# subline
f_sub = font("Regular", 32)
d.text((MARGIN, 386), "There is no form to fill in afterwards.", font=f_sub, fill=INK_2)


# ── the diagram: two obligations collapsing into one act ─────────────────────

TOP, GAP = 528, 126
f_lab = font("Semibold", 19)
f_body = font("Regular", 25)

rows = [
    ("VERIFY IT", "a supervisor confirms the right part went in"),
    ("RECORD IT", "somebody enters it into the system, later"),
]
for i, (label, body) in enumerate(rows):
    y = TOP + i * GAP
    hairline(d, MARGIN, y - 34, MARGIN + 620, RULE_STRONG)
    tracked(d, (MARGIN, y - 18), label, f_lab, INK_3, track=2.2)
    d.text((MARGIN, y + 16), body, font=f_body, fill=INK_2)

# The paperwork that used to close the loop, struck out where it used to sit —
# under the two rows it belonged to, not next to the thing that replaced it.
f_form = font("Regular", 24)
fy = TOP + GAP + 98
txt = "Field Verification Record — Form QA-14"
d.text((MARGIN, fy), txt, font=f_form, fill=INK_3)
fw = f_form.getlength(txt)
d.line([(MARGIN - 8, fy + 18), (MARGIN + fw + 8, fy + 13)], fill=INK_3 + (215,), width=2)

# The brace that joins the two rows. Two elbows and a stem: a curly brace at
# this weight turns to mush, and an arrow between the rows would imply sequence
# when the whole point is simultaneity.
BX, MID = MARGIN + 700, TOP + GAP // 2 + 4
for i in range(2):
    y = TOP + i * GAP - 4
    d.line([(MARGIN + 640, y), (BX, y)], fill=INK_3 + (150,), width=2)
d.line([(BX, TOP - 4), (BX, TOP + GAP - 4)], fill=INK_3 + (150,), width=2)
d.line([(BX, MID), (BX + 58, MID)], fill=INK + (210,), width=2)
d.polygon([(BX + 58, MID - 9), (BX + 84, MID), (BX + 58, MID + 9)], fill=INK + (210,))

# The single act. The only solid element on the page — the eye lands here and
# has the argument before it reads a word.
BL, BR = BX + 122, W - MARGIN
BT, BB = TOP - 92, TOP + GAP + 84
d.rectangle([BL, BT, BR, BB], fill=INK)

f_one = font("Semibold", 78)
d.text((BL + 58, BT + 84), "One scan.", font=f_one, fill=PAPER)
tracked(d, (BL + 62, BT + 194), "AT THE BEAM  ·  UNDER A SECOND  ·  OFFLINE",
        font("Regular", 19), (176, 180, 186), track=2.6)


# ── the closing band ─────────────────────────────────────────────────────────
# Full width, so the page ends on a line rather than trailing off in one corner.

FY = 872
hairline(d, MARGIN, FY, W - MARGIN, INK, alpha=255)
tracked(d, (MARGIN, FY + 26), "WHY IT GETS USED", font("Semibold", 15), INK_3, track=2.4)
f_foot = font("Regular", 30)
d.text((MARGIN, FY + 62), "Verifying it and recording it are", font=f_foot, fill=INK)
d.text((MARGIN, FY + 104), "the same single action.", font=font("Semibold", 30), fill=INK)

# Right of the same band, and quieter: the reason that matters commercially.
f_note = font("Regular", 26)
for i, line in enumerate(["A tool that costs the worker time",
                          "gets left in the site office."]):
    w_ = f_note.getlength(line)
    d.text((W - MARGIN - w_, FY + 64 + i * 38), line, font=f_note, fill=INK_2)


# ── out ──────────────────────────────────────────────────────────────────────

img.save(OUT, "JPEG", quality=95, subsampling=0, optimize=True, dpi=(144, 144))
print(f"{OUT}  {OUT.stat().st_size/1024:.0f} KB  {W}x{H}")
