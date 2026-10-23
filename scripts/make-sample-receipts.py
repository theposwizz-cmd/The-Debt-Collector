"""Generate the sample receipt photos in samples/ (used by the demo seed and for live upload demos).

Usage: python scripts/make-sample-receipts.py   (needs Pillow)
"""
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "samples")


def font(size, bold=False):
    candidates = (
        ["consolab.ttf", "DejaVuSansMono-Bold.ttf", "Menlo.ttc"] if bold else ["consola.ttf", "DejaVuSansMono.ttf", "Menlo.ttc"]
    )
    for name in candidates:
        for base in ["C:/Windows/Fonts", "/usr/share/fonts/truetype/dejavu", "/System/Library/Fonts"]:
            path = os.path.join(base, name)
            if os.path.exists(path):
                return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def receipt(filename, header, sub, meta, items, total, footer, seed):
    random.seed(seed)
    w = 560
    f, fb, fh = font(22), font(22, True), font(34, True)
    lines = []  # (text, font, align)
    lines += [(header, fh, "c")] + [(s, f, "c") for s in sub] + [("", f, "l")]
    lines += [(m, f, "l") for m in meta] + [("-" * 38, f, "l")]
    for name, qty, price in items:
        lines.append((name, f, "l"))
        lines.append((f"  {qty} x {price:.2f}".ljust(28) + f"{qty * price:>10.2f}", f, "l"))
    lines += [("-" * 38, f, "l"), (f"{'UKUPNO / TOTAL EUR':<26}{total:>12.2f}", fb, "l"), ("", f, "l")]
    lines += [(x, f, "c") for x in footer]

    h = 60 + sum(44 if fnt is fh else 30 for _, fnt, _ in lines) + 40
    paper = Image.new("RGB", (w, h), (250, 248, 242))
    d = ImageDraw.Draw(paper)
    y = 40
    for text, fnt, align in lines:
        tw = d.textlength(text, font=fnt)
        x = (w - tw) / 2 if align == "c" else 36
        d.text((x, y), text, font=fnt, fill=(40, 38, 36))
        y += 44 if fnt is fh else 30
    # faint paper noise
    for _ in range(2500):
        px, py = random.randrange(w), random.randrange(h)
        c = random.randrange(225, 245)
        paper.putpixel((px, py), (c, c, c - 5))

    # place on a "table" with a shadow and a slight rotation, like a phone photo
    bg_w, bg_h = w + 220, h + 220
    bg = Image.new("RGB", (bg_w, bg_h), (92, 68, 50))
    bd = ImageDraw.Draw(bg)
    for i in range(0, bg_h, 7):
        tone = 80 + int(18 * random.random())
        bd.line([(0, i), (bg_w, i + random.randint(-4, 4))], fill=(tone + 12, tone - 6, tone - 22), width=3)
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 140))
    paper_rgba = paper.convert("RGBA")
    angle = random.uniform(-3.5, 3.5)
    shadow = shadow.rotate(angle, expand=True).filter(ImageFilter.GaussianBlur(14))
    paper_rot = paper_rgba.rotate(angle, expand=True, resample=Image.BICUBIC)
    ox, oy = (bg_w - paper_rot.width) // 2, (bg_h - paper_rot.height) // 2
    bg.paste(shadow, (ox + 14, oy + 18), shadow)
    bg.paste(paper_rot, (ox, oy), paper_rot)
    bg = bg.filter(ImageFilter.GaussianBlur(0.6))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, filename)
    bg.save(path, quality=88)
    print("wrote", path)


konoba_items = [
    ("Brancin na žaru", 2, 24.00),
    ("Crni rižot", 2, 16.50),
    ("Janjetina ispod peke", 1, 38.00),
    ("Blitva", 2, 6.00),
    ("Kućno vino 1L", 2, 18.00),
    ("Mineralna voda", 3, 3.80),
    ("Rožata", 2, 4.00),
]
receipt(
    "receipt-konoba-mate.jpg",
    "KONOBA MATE",
    ["Ulica sv. Marka 12, 21450 Hvar", "OIB 48291736510"],
    ["Račun br. 1184/1/1", "Datum: 15.10.2026   21:47", "Stol: 7      Konobar: Ivo"],
    konoba_items,
    sum(q * p for _, q, p in konoba_items),
    ["PDV uključen u cijenu", "Hvala i doviđenja!"],
    seed=7,
)

tommy_items = [
    ("Kruh polubijeli", 2, 1.85),
    ("Pršut 200g", 1, 7.90),
    ("Paški sir", 1, 12.40),
    ("Rajčica 1.2kg", 1, 3.12),
    ("Maslinovo ulje 0.75L", 1, 11.99),
    ("Pivo 6x0.5L", 2, 7.49),
    ("Krema za sunčanje SPF50", 1, 9.76),
]
receipt(
    "receipt-tommy.jpg",
    "TOMMY d.o.o.",
    ["Market Hvar - Križna luka", "OIB 63706829042"],
    ["Račun: 0312-77-2219", "Datum: 17.10.2026   10:12", "Blagajna 2"],
    tommy_items,
    sum(q * p for _, q, p in tommy_items),
    ["Hvala na kupnji!"],
    seed=11,
)
