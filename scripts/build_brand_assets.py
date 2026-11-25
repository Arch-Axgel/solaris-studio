"""Build every Solaris Studio brand image from the two master files.

    python scripts/build_brand_assets.py [path/to/original-logo.png]

With a path, the original artwork is cleaned first (its soft orange halo from
background removal is tightened away) and saved as docs/brand/solaris-logo.png,
the full lockup: emblem, "Solaris Studio", "by Arch".

The small mark is a round badge built from the logo's own parts, because the
artwork's emblem cannot be lifted out on its own: the "Solaris" lettering is
painted over the bottom of its disc, and its wide tilted ellipse would be a
sliver in a square icon anyway. The parts were cut from the logo by colour:

    docs/brand/solaris-sun.png      the gold sun (rays, half-sun, inner sparkle)
    docs/brand/solaris-star.png     the four-point star
    docs/brand/solaris-emblem.png   the badge, built from those two (output)

Small sizes (app icon, tiles, favicons) use the badge, because the script
lettering is unreadable below ~128 px; places with room use the full lockup.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "docs" / "brand"
LOGO = BRAND / "solaris-logo.png"
EMBLEM = BRAND / "solaris-emblem.png"
SUN = BRAND / "solaris-sun.png"
STAR = BRAND / "solaris-star.png"

BASE = (19, 10, 13)          # --color-base
BURGUNDY = (143, 36, 69)     # --color-accent
GOLD = (216, 178, 99)        # --color-gold

# Microsoft Store (MSIX) tiles. electron-builder's appx target looks for these
# in ui/build/appx/ and quietly substitutes generic Electron placeholders for
# any that are missing, which is how an app ends up in the Store wearing
# someone else's icon. Transparent: Windows paints them on the tile colour
# from `backgroundColor` in electron-builder.yml. The 2:1 shapes are fitted,
# never stretched. .github/workflows/msix.yml checks these exist at these sizes.
#   name -> (width, height, source, fill)
APPX_DIR = ROOT / "ui" / "build" / "appx"
APPX = {
    "Square150x150Logo.png": (150, 150, "emblem", 0.86),  # medium Start tile
    "Square44x44Logo.png": (44, 44, "emblem", 1.0),       # taskbar and app list
    "StoreLogo.png": (50, 50, "emblem", 1.0),             # Store listing and installer
    "Wide310x150Logo.png": (310, 150, "emblem", 0.86),    # wide Start tile
    "SplashScreen.png": (620, 300, "logo", 0.92),         # shown while the app starts
}
APPX_SIZES = {name: (w, h) for name, (w, h, _src, _fill) in APPX.items()}


def clean(src: Image.Image) -> Image.Image:
    """Tighten the alpha so the orange-red glow left around every edge goes."""
    im = src.convert("RGBA")
    r, g, b, a = im.split()
    lo, hi = 70, 235
    a = a.point(lambda v: 0 if v <= lo else 255 if v >= hi else round((v - lo) * 255 / (hi - lo)))
    return Image.merge("RGBA", (r, g, b, a))


def trim(im: Image.Image, pad: float = 0.04) -> Image.Image:
    box = im.getbbox()
    im = im.crop(box)
    side = max(im.size)
    p = round(side * pad)
    out = Image.new("RGBA", (im.width + 2 * p, im.height + 2 * p), (0, 0, 0, 0))
    out.alpha_composite(im, (p, p))
    return out


def square(im: Image.Image, pad: float = 0.06) -> Image.Image:
    side = round(max(im.size) * (1 + 2 * pad))
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
    return out


def fit(im: Image.Image, w: int, h: int, fill: float = 1.0) -> Image.Image:
    """`im` scaled to fit inside w*h (times `fill`), centred on a clear canvas."""
    k = min(w * fill / im.width, h * fill / im.height)
    small = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(small, ((w - small.width) // 2, (h - small.height) // 2))
    return out


def backdrop(w: int, h: int) -> Image.Image:
    """The app's background: wine-black with a soft burgundy glow."""
    bg = Image.new("RGB", (w, h), BASE)
    glow = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(glow)
    r = round(max(w, h) * 0.55)
    d.ellipse((w // 2 - r, h // 2 - r, w // 2 + r, h // 2 + r), fill=55)
    glow = glow.filter(ImageFilter.GaussianBlur(max(w, h) // 5))
    bg.paste(Image.new("RGB", (w, h), BURGUNDY), (0, 0), glow)
    return bg


def on_backdrop(art: Image.Image, w: int, h: int, fill: float) -> Image.Image:
    bg = backdrop(w, h).convert("RGBA")
    bg.alpha_composite(fit(art, w, h, fill))
    return bg.convert("RGB")


def make_masters(original: Path) -> None:
    src = clean(Image.open(original))
    BRAND.mkdir(parents=True, exist_ok=True)
    trim(src).save(LOGO, optimize=True)


def make_badge(size: int = 1024) -> Image.Image:
    """Burgundy disc, gold ring, the logo's sun rising on a gold horizon, its star."""
    k = size / 1024
    mid = size // 2
    sun, star = Image.open(SUN).convert("RGBA"), Image.open(STAR).convert("RGBA")
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    r_disc = round(470 * k)
    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    g = ImageDraw.Draw(grad)
    for i in range(60):  # radial gradient, lightest a little below centre
        t = i / 59
        r = round(r_disc * (1 - t))
        col = tuple(round(a + (b - a) * t) for a, b in zip((72, 12, 30), (160, 40, 78)))
        dy = round(40 * k * t)
        g.ellipse((mid - r, mid - r + dy, mid + r, mid + r + dy), fill=col + (255,))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((mid - r_disc, mid - r_disc, mid + r_disc, mid + r_disc), fill=255)
    img.paste(grad, (0, 0), mask)
    ring = ImageDraw.Draw(img)
    ring.ellipse((mid - r_disc, mid - r_disc, mid + r_disc, mid + r_disc),
                 outline=(176, 124, 48, 255), width=round(30 * k))
    inset = round(5 * k)
    ring.ellipse((mid - r_disc + inset, mid - r_disc + inset, mid + r_disc - inset, mid + r_disc - inset),
                 outline=(236, 200, 124, 255), width=max(1, round(10 * k)))
    sun_w = round(760 * k)
    s = sun.resize((sun_w, round(sun.height * sun_w / sun.width)), Image.LANCZOS)
    horizon = mid + s.height // 2 - round(10 * k)
    img.alpha_composite(s, (mid - sun_w // 2, horizon - s.height))
    line = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ld = ImageDraw.Draw(line)
    half = round(370 * k)
    for x in range(mid - half, mid + half):
        fade = 1 - abs((x - mid) / half) ** 3
        ld.line((x, horizon + round(6 * k), x, horizon + round(15 * k)), fill=(226, 186, 108, round(255 * fade)))
    img.alpha_composite(line)
    star_h = round(330 * k)
    st = star.resize((round(star.width * star_h / star.height), star_h), Image.LANCZOS)
    img.alpha_composite(st, (mid + round(215 * k), mid - round(500 * k)))
    return img


def build() -> list[Path]:
    make_badge().save(EMBLEM, optimize=True)
    logo, emblem = Image.open(LOGO).convert("RGBA"), Image.open(EMBLEM).convert("RGBA")
    out: list[Path] = []

    def save(img: Image.Image, rel: str, **kw) -> None:
        p = ROOT / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        img.save(p, **kw)
        out.append(p)

    # Desktop app
    save(fit(emblem, 256, 256), "ui/src/renderer/src/assets/solaris-studio-logo.png", optimize=True)
    save(fit(logo, 1024, 1024), "ui/src/renderer/src/assets/solaris-logo-full.png", optimize=True)
    icon = fit(emblem, 256, 256)
    save(icon, "ui/build/icon.ico",
         sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    # Windows Store (MSIX) tiles: transparent, the Store paints the tile colour
    sources = {"emblem": emblem, "logo": logo}
    for name, (w, h, src, fill) in APPX.items():
        save(fit(sources[src], w, h, fill), (APPX_DIR / name).relative_to(ROOT).as_posix())
    # Store listing art (opaque, on the app's own background)
    save(on_backdrop(logo, 1080, 1080, 0.78), "docs/store-art/box-art-1x1.png")
    save(on_backdrop(emblem, 71, 71, 0.9), "docs/store-art/display-tile-71.png")
    save(on_backdrop(emblem, 150, 150, 0.86), "docs/store-art/display-tile-150.png")
    save(on_backdrop(emblem, 300, 300, 0.86), "docs/store-art/display-tile-300.png")
    save(on_backdrop(logo, 1440, 2160, 0.8), "docs/store-art/poster-art-2x3.png")
    save(on_backdrop(logo, 1920, 1080, 0.7), "docs/store-art/super-hero-art-16x9.png")
    # Website, web app, Whop app
    save(fit(logo, 1024, 1024), "site/assets/logo.png", optimize=True)
    save(fit(emblem, 256, 256), "site/assets/emblem.png", optimize=True)
    save(on_backdrop(logo, 1200, 630, 0.82), "site/assets/og-image.png", optimize=True)
    save(fit(emblem, 128, 128), "web/public/emblem.png", optimize=True)
    save(fit(logo, 1024, 1024), "whop-app/public/logo.png", optimize=True)
    save(fit(emblem, 256, 256), "whop-app/public/emblem.png", optimize=True)
    save(icon, "whop-app/app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
    return out


if __name__ == "__main__":
    if len(sys.argv) > 1:
        make_masters(Path(sys.argv[1]))
    for p in build():
        print(p.relative_to(ROOT))
