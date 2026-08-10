from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "icons"
OUTPUT.mkdir(parents=True, exist_ok=True)


def gradient(size: int) -> Image.Image:
    image = Image.new("RGB", (size, size), "#080910")
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            glow = max(0.0, 1.0 - (((x - size * 0.62) ** 2 + (y - size * 0.25) ** 2) ** 0.5) / (size * 0.85))
            pixels[x, y] = (
                int(8 + 34 * glow),
                int(9 + 23 * glow),
                int(16 + 55 * glow),
            )
    return image


def draw_mark(image: Image.Image, safe: float = 0.18) -> None:
    size = image.width
    draw = ImageDraw.Draw(image)
    left = int(size * safe)
    top = int(size * safe)
    right = size - left
    bottom = size - top
    radius = int(size * 0.16)
    draw.rounded_rectangle((left, top, right, bottom), radius=radius, fill="#15172a", outline="#7772ff", width=max(3, size // 70))
    inset = int(size * 0.14)
    x1, y1, x2, y2 = left + inset, top + inset, right - inset, bottom - inset
    length = int(size * 0.10)
    width = max(4, size // 45)
    cyan = "#0ce4e8"
    for x, y, sx, sy in ((x1, y1, 1, 1), (x2, y1, -1, 1), (x1, y2, 1, -1), (x2, y2, -1, -1)):
        draw.line((x, y, x + sx * length, y), fill=cyan, width=width)
        draw.line((x, y, x, y + sy * length), fill=cyan, width=width)
    center = size // 2
    draw.ellipse((center - size * .08, center - size * .08, center + size * .08, center + size * .08), fill="#aaa6ff")
    draw.ellipse((center - size * .035, center - size * .035, center + size * .035, center + size * .035), fill="#080910")


def icon(size: int, filename: str, safe: float = 0.18) -> None:
    image = gradient(size)
    draw_mark(image, safe)
    image.save(OUTPUT / filename, optimize=True)


icon(192, "icon-192.png")
icon(512, "icon-512.png")
icon(512, "icon-maskable-512.png", safe=0.24)
icon(180, "apple-touch-icon.png")

splash = Image.new("RGB", (1170, 2532), "#080910")
glow = Image.new("RGBA", splash.size, (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
glow_draw.ellipse((180, 610, 990, 1420), fill=(72, 65, 255, 75))
glow = glow.filter(ImageFilter.GaussianBlur(115))
splash.paste(glow, (0, 0), glow)
mark = gradient(340)
draw_mark(mark, .18)
splash.paste(mark, ((1170 - 340) // 2, 880))
text_draw = ImageDraw.Draw(splash)
text_draw.text((585, 1280), "VISION AI", anchor="mm", fill="#f4f4ff", font_size=58)
text_draw.text((585, 1350), "NEURAL SCANNER", anchor="mm", fill="#0ce4e8", font_size=24)
splash.save(OUTPUT / "apple-splash-1170x2532.png", optimize=True)

print(f"Generated PWA assets in {OUTPUT}")
