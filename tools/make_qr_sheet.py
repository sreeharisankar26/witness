#!/usr/bin/env python3
"""
Prints the physical QR tags you stick on real equipment.

Error correction level H: roughly 30% of the tag can be destroyed and it still
reads. That is what backs the "works dirty" claim in the deck - it is a property
of the tag, not a trick.

Output: witness_qr_tags.pdf - A4, 6 tags per page, cut guides, and the serial
printed in human-readable text so a worker can fall back to manual entry when
the code is unreadable.
"""
import json, pathlib, io
import qrcode
from qrcode.constants import ERROR_CORRECT_H
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED = json.loads((ROOT / "app" / "src" / "data" / "witness_seed.json").read_text())
OUT = ROOT / "witness_qr_tags.pdf"


def payload(sku: str, serial: str) -> str:
    """Versioned so a future tag format cannot be silently misread."""
    return f"WTNS:1|{sku}|{serial}"


tags = [(d["sku"], d["serial"], d["rev"], d["note"]) for d in SEED["demo_tags"]]
extra = [u for u in SEED["units"] if u["serial"] not in {t[1] for t in tags}][:6]
tags += [(u["sku"], u["serial"], u["rev"], "spare") for u in extra]

W, H = A4
COLS, ROWS = 2, 3
CW, CH = W / COLS, H / ROWS

c = canvas.Canvas(str(OUT), pagesize=A4)
for i, (sku, serial, rev, note) in enumerate(tags):
    slot = i % (COLS * ROWS)
    if slot == 0 and i:
        c.showPage()
    col, row = slot % COLS, slot // COLS
    x0, y0 = col * CW, H - (row + 1) * CH

    c.setStrokeColorRGB(.82, .82, .82)
    c.setDash(2, 3)
    c.rect(x0 + 6 * mm, y0 + 6 * mm, CW - 12 * mm, CH - 12 * mm)
    c.setDash()

    qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_H, box_size=10, border=2)
    qr.add_data(payload(sku, serial))
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    buf = io.BytesIO(); img.save(buf, format="PNG"); buf.seek(0)

    size = 56 * mm
    c.drawImage(ImageReader(buf), x0 + (CW - size) / 2, y0 + CH - size - 22 * mm,
                width=size, height=size)

    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica-Bold", 15)
    c.drawCentredString(x0 + CW / 2, y0 + CH - size - 32 * mm, f"{sku}   .   {serial}")
    c.setFont("Helvetica", 8.5)
    c.setFillColorRGB(.35, .35, .35)
    c.drawCentredString(x0 + CW / 2, y0 + CH - size - 40 * mm, "WITNESS ASSET TAG  |  scan with the Witness app")
    c.setFont("Helvetica-Oblique", 7)
    c.setFillColorRGB(.65, .65, .65)
    c.drawCentredString(x0 + CW / 2, y0 + 12 * mm, f"[crew note: unit is Rev {rev} - {note}]")

c.save()
print(f"wrote {OUT}  ({len(tags)} tags)")
print("Print at 100% scale. Laminate or use white vinyl. Print two copies - you will lose one.")
