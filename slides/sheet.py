"""
The shared sheet every Witness slide is drawn on.

Same material as dashboard/index.html: warm paper, a drafting graticule, the
tooth of the paper, and the warmth at the edge of a sheet lying on a desk.
Every layer sits at the edge of perception — if you notice one AS a texture, it
is turned up too far.

Colour is reserved for the state of the work and is never decoration. That rule
is inherited from the supervisor view and it is why these slides have almost no
colour in them: a status on a submittal register IS the state of the work, so
red and green are allowed there and nowhere else.

Pillow + numpy. No network, no external assets.
"""
from PIL import Image, ImageDraw, ImageFont
import numpy as np

W, H = 1920, 1080
MARGIN = 140

PAPER       = (251, 250, 247)
INK         = (21, 23, 26)
INK_2       = (85, 89, 95)
INK_3       = (139, 144, 151)
RULE        = (228, 224, 216)
RULE_STRONG = (201, 195, 184)

# Reserved for the state of the work. Chosen to sit on warm paper rather than
# to glow on black.
STOP        = (179, 38, 30)
STOP_WASH   = (247, 233, 231)
OK          = (26, 115, 70)
OK_WASH     = (231, 241, 235)
CHECK       = (138, 90, 0)
CHECK_WASH  = (248, 239, 222)

_F = "/usr/share/fonts/truetype/lato/Lato-%s.ttf"
_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


def font(weight, size):
    return ImageFont.truetype(_F % weight, size)


def mono(size, bold=False):
    """For part numbers and codes, where a lowercase l next to a 1 is the point."""
    path = _MONO.replace("Mono.ttf", "Mono-Bold.ttf") if bold else _MONO
    return ImageFont.truetype(path, size)


def tracked(draw, xy, text, fnt, fill, track=0.0):
    """
    Draw text with letter-spacing, which Pillow has no concept of.

    Tracking is the difference between small caps that look like a drawing label
    and small caps that look like a web page, so it is worth the loop. Negative
    values set headlines. Returns the advance width.
    """
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += fnt.getlength(ch) + track
    return x - xy[0]


def tracked_width(text, fnt, track=0.0):
    return sum(fnt.getlength(c) for c in text) + track * max(0, len(text) - 1)


def hairline(draw, x0, y, x1, colour, alpha=255, width=1):
    draw.line([(x0, y), (x1, y)], fill=tuple(colour) + (alpha,), width=width)


def sheet():
    """Paper, graticule, light, tooth."""
    img = Image.new("RGB", (W, H), PAPER)

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

    # Fades toward the edges so the page never reads as tiled wallpaper.
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.sqrt(((xx - W * .34) / (W * .78)) ** 2 + ((yy - H * .42) / (H * .80)) ** 2)
    grid = Image.fromarray((np.asarray(grid) * np.clip(1.25 - r * 1.35, 0, 1) ** 1.5).astype(np.uint8))
    img.paste(Image.new("RGB", (W, H), RULE_STRONG), (0, 0), grid)

    warm = np.zeros((H, W, 3), np.float32)
    d1 = np.sqrt(((xx - W * .20) / (W * .72)) ** 2 + ((yy + H * .14) / (H * .80)) ** 2)
    d2 = np.sqrt(((xx - W * 1.02) / (W * .62)) ** 2 + ((yy - H * .06) / (H * .70)) ** 2)
    a, b = np.clip(1 - d1, 0, 1), np.clip(1 - d2, 0, 1)
    warm[..., 0] = a * 5.0 + b * 5.0
    warm[..., 1] = a * 4.2 + b * 2.6
    warm[..., 2] = a * 2.4 - b * 1.6
    img = Image.fromarray(np.clip(np.asarray(img).astype(np.float32) + warm, 0, 255).astype(np.uint8))

    noise = np.random.default_rng(7).normal(0, 5.0, (H, W, 1))
    return Image.fromarray(np.clip(np.asarray(img).astype(np.float32) + noise, 0, 255).astype(np.uint8))


def page(section):
    """A new sheet with the running head already set. Returns (img, draw)."""
    img = sheet()
    d = ImageDraw.Draw(img, "RGBA")
    x = MARGIN + tracked(d, (MARGIN, 120), "WITNESS", font("Semibold", 15), INK_2, 2.4)
    d.ellipse([x + 16, 127, x + 21, 132], fill=RULE_STRONG)
    tracked(d, (x + 37, 120), section.upper(), font("Regular", 15), INK_3, 2.4)
    hairline(d, MARGIN, 165, W - MARGIN, INK, alpha=41)
    return img, d


def headline(d, text, y=236, size=100, track=-2.6, fill=INK, weight="Medium"):
    tracked(d, (MARGIN, y), text, font(weight, size), fill, track)


def save(img, path):
    img.save(path, "JPEG", quality=95, subsampling=0, optimize=True, dpi=(144, 144))
    return path
