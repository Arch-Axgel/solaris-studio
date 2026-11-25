"""The branded end card appended to every clip.

Clip ends -> the Solaris badge rises into place and the star twinkles ->
"Made with" / "Solaris Studio" / "Free & Open Source" lands -> hard cut.
2.9 seconds.

This is organic marketing: a clip in someone's feed is the only distribution
the app gets for free, so a viewer should be able to see what made it. ON by
default, because a feature nobody enables markets nothing.

Everything about the animation lives in this one file, so it can be redrawn
later without the pipeline knowing. The pipeline's entire interface is
`append(clip, config)`.

Three things are worth knowing before changing anything here:

**The badge is not redrawn.** docs/brand/solaris-emblem.png IS the badge --
the same file scripts/build_brand_assets.py makes the app icon and the Store
tiles from. This module only moves, scales and lights it, so the end card can
never drift from the icon. The star's position is found in the artwork itself
(its brightest point), not typed in, so a redrawn badge keeps its twinkle.

**The clip is never re-encoded.** The outro is generated to match the clip's
exact width, height, fps, pixel format and audio parameters, then appended
with the concat demuxer and `-c copy`. That match is what makes the append
free and lossless -- and it is why the cache is keyed on all of it.

**It is built once per format, not once per video.** Prebuilt cards ship
for every format the pipeline actually emits -- both canvases at 30 and
60fps -- so in practice nothing is ever rendered on a user's machine.
Anything unusual renders once, in about 20 seconds, and is then cached.
"""

from __future__ import annotations

import contextlib
import json
import math
import os
import shutil
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from core.paths import discard, resolve_data_dir

# --------------------------------------------------------------------------
# The design, in reference coordinates. Everything scales uniformly from here,
# so a square clip gets the same composition on a different field rather than
# a re-choreographed one. Landscape gets its own two-column arrangement.
# --------------------------------------------------------------------------
REF_W, REF_H = 1080, 1920
DURATION = 2.9                 # seconds; 87 frames at 30fps, 174 at 60

# The app's theme (ui/src/renderer/src/theme.css).
BASE = (19, 10, 13)            # --color-base      #130a0d
BURGUNDY = (143, 36, 69)       # --color-accent    #8f2445
GOLD = (216, 178, 99)          # --color-gold      #d8b263
IVORY = (246, 237, 231)        # --color-ink       #f6ede7

# The two-tone wordmark, set the way the app sets it: "Solaris" in ink,
# "Studio" in gold. On the wine-black ground both clear 9:1, so it needs none
# of the outline the old orange card had to give it.
SOLARIS = IVORY
STUDIO = GOLD
INK_SOFT = (205, 176, 170)     # kicker and tagline: ivory, warmed toward rose

KICKER, WORDMARK, TAGLINE = "Made with", "Solaris Studio", "Free & Open Source"
KICK_PT, WORD_PT, TAG_PT = 64, 118, 60  # 118: keeps "Solaris Studio" clear of the 940px action rail
GAP_KICK, GAP_TAG, GAP_BADGE = 22, 34, 84

# TikTok's published safe zones for a 1080x1920 creative, and the strictest of
# the platforms these get posted to. Nothing in the frame may enter them.
TOP_SAFE = 150                 # status bar; TikTok's own line is 130
BOTTOM_SAFE = REF_H - 483      # 1437: caption, username
RIGHT_RAIL = REF_W - 140       # 940: like / comment / share column

BADGE_FRAC = 0.56              # the badge's ink, as a fraction of REF_W

# Landscape only. The badge is sized from the frame's HEIGHT (a 16:9 frame has
# height to spare and width to fill), and the frame is split into two columns.
LAND_BADGE_FRAC = 0.56         # its ink, as a fraction of frame height
LAND_BADGE_CX = 0.28           # its centre, as a fraction of width
LAND_TEXT_CX = 0.67            # the type block's centre

# The choreography, in seconds.
BADGE_IN = (0.04, 0.62)        # scales up from small, overshoots, settles
PULSE = (0.40, 0.95)           # a gold ring leaves the rim as it lands
TWINKLES = ((0.66, 1.16, 1.00),  # (start, end, strength) on the big star
            (2.12, 2.52, 0.62))
GLINT = (1.52, 1.86)           # the small star at the sun's heart
TEXT_IN = 1.10                 # the wordmark starts resolving here

BADGE_START, BADGE_OVERSHOOT = 0.42, 1.06
PULSE_REACH = 1.20             # the ring's final radius, in badge radii

# Two locks, deliberately. `_art_lock` guards the per-size caches of the
# badge, its glow and the sparkle: renders run on threads, and two threads
# building the same size at once would both pay for it. `_build_lock`
# serialises rendering a cache entry so two clips never render the same card
# at once. They must stay SEPARATE: ensure_outro holds _build_lock across
# _render, which reaches the art caches -- one non-reentrant lock for both
# deadlocked once already.
_art_lock = threading.RLock()
_build_lock = threading.Lock()


# ==========================================================================
# Finding files, in a checkout and in the frozen build
# ==========================================================================
def _asset(rel: str) -> Path | None:
    """A data file that ships with the app, wherever this copy keeps it.

    Searched the same way core/binaries.py finds bundled tools, because a
    repo-relative path is wrong in a frozen build: PyInstaller one-dir puts
    data under _internal/ beside the exe, not beside the module. The spec
    bundles each file at its repo-relative path, so one name works in both.
    """
    roots: list[Path] = []
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).parent
        roots += [exe_dir, exe_dir / "_internal"]
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            roots.append(Path(meipass))
    roots.append(Path(__file__).resolve().parent.parent)
    for root in roots:
        candidate = root / rel
        if candidate.exists() and candidate.stat().st_size > 0:
            return candidate
    return None


EMBLEM = "docs/brand/solaris-emblem.png"


# ==========================================================================
# The badge, its light, and the star
# ==========================================================================
_emblem_src: dict[str, object] = {}
_art_cache: dict[tuple, object] = {}


def _emblem() -> tuple[Image.Image, tuple[int, int, int, int], dict]:
    """The badge artwork, its ink box, and where its two stars are.

    The stars are located by brightness rather than typed in: the big one is
    the brightest point in the badge's top-right corner, the small one the
    brightest under the sun. Redraw the badge and the twinkle follows it.
    """
    cached = _emblem_src.get("v")
    if cached is not None:
        return cached
    with _art_lock:
        cached = _emblem_src.get("v")
        if cached is not None:
            return cached
        path = _asset(EMBLEM)
        if path is None:
            raise FileNotFoundError(f"the end card's badge is missing: {EMBLEM}")
        img = Image.open(path).convert("RGBA")
        bbox = img.getbbox() or (0, 0, img.width, img.height)
        a = np.asarray(img, dtype=np.float32)
        # Brightness weighted by opacity, lightly blurred so a single hot
        # anti-aliasing pixel on an arm cannot outrank the star's core.
        lum = (a[..., :3] @ np.array([0.30, 0.59, 0.11], dtype=np.float32)) * (a[..., 3] / 255)
        lum = np.asarray(Image.fromarray(lum.astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(img.width / 200)), dtype=np.float32)
        W, H = img.size

        def brightest(x0, y0, x1, y1):
            region = lum[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)]
            iy, ix = np.unravel_index(int(region.argmax()), region.shape)
            return (int(x0 * W) + int(ix), int(y0 * H) + int(iy))

        stars = {"big": brightest(0.62, 0.0, 1.0, 0.36),
                 "small": brightest(0.40, 0.56, 0.62, 0.72)}
        _emblem_src["v"] = cached = (img, bbox, stars)
        return cached


def _cached(key, build):
    hit = _art_cache.get(key)
    if hit is not None:
        return hit
    with _art_lock:
        hit = _art_cache.get(key)
        if hit is None:
            hit = _art_cache[key] = build()
        return hit


def _badge_master(ink: int) -> Image.Image:
    """The badge resolved so its INK is `ink` px across at full size.

    Kept a little larger than that, so the overshoot is a downscale too and
    the badge never softens at the peak of its bounce.
    """
    def build():
        img, bbox, _ = _emblem()
        k = ink * BADGE_OVERSHOOT / (bbox[2] - bbox[0])
        side = max(8, round(img.width * k))
        return img.resize((side, side), Image.LANCZOS)
    return _cached(("badge", ink), build)


def _halo(r: int) -> Image.Image:
    """Warm burgundy light behind the badge, radius `r`, at full strength."""
    def build():
        side = r * 2
        mask = Image.new("L", (side, side), 0)
        ImageDraw.Draw(mask).ellipse((side * 0.22, side * 0.22,
                                      side * 0.78, side * 0.78), fill=150)
        mask = mask.filter(ImageFilter.GaussianBlur(side * 0.12))
        layer = Image.new("RGBA", (side, side), (*BURGUNDY, 0))
        layer.putalpha(mask)
        return layer
    return _cached(("halo", r), build)


def _sparkle(size: int) -> Image.Image:
    """A four-point glint with a soft bloom, `size` px across. Drawn at 4x
    and reduced, so the needle-thin points stay smooth."""
    def build():
        ss = 4
        n = size * ss
        c = n / 2
        img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

        def star(radius, waist, fill):
            # Four needle points joined by concave sides that pinch to
            # `waist` between them -- the shape of the badge's own star.
            pts = []
            for q in range(4):
                base = math.pi / 2 * q
                for j in range(12):
                    u = j / 12
                    rr = waist + (radius - waist) * abs(1 - 2 * u) ** 3
                    ang = base + u * math.pi / 2
                    pts.append((c + rr * math.cos(ang), c - rr * math.sin(ang)))
            ImageDraw.Draw(img).polygon(pts, fill=fill)

        bloom = Image.new("L", (n, n), 0)
        ImageDraw.Draw(bloom).ellipse((c - n * 0.16, c - n * 0.16,
                                       c + n * 0.16, c + n * 0.16), fill=170)
        bloom = bloom.filter(ImageFilter.GaussianBlur(n * 0.08))
        glow = Image.new("RGBA", (n, n), (*GOLD, 0))
        glow.putalpha(bloom)
        img.alpha_composite(glow)
        star(n * 0.48, n * 0.045, (244, 214, 150, 255))
        star(n * 0.34, n * 0.030, (255, 246, 222, 255))
        return img.resize((size, size), Image.LANCZOS)
    return _cached(("sparkle", size), build)


def _fade(img: Image.Image, alpha: float) -> Image.Image:
    if alpha >= 0.999:
        return img
    out = img.copy()
    out.putalpha(out.getchannel("A").point(lambda v: int(v * alpha)))
    return out


def _blit(dst, src, at):
    """alpha_composite that tolerates the source hanging off the canvas."""
    x, y = int(round(at[0])), int(round(at[1]))
    sx, sy = max(0, -x), max(0, -y)
    dx, dy = max(0, x), max(0, y)
    w = min(src.width - sx, dst.width - dx)
    h = min(src.height - sy, dst.height - dy)
    if w <= 0 or h <= 0:
        return
    if (sx, sy, w, h) != (0, 0, src.width, src.height):
        src = src.crop((sx, sy, sx + w, sy + h))
    dst.alpha_composite(src, (dx, dy))


def background(w: int, h: int) -> Image.Image:
    """The ground every frame is drawn on: the app's wine-black, with a wide
    burgundy wash centred on the badge and a gentle vignette.

    Static on purpose -- everything that moves is drawn over it -- so the
    safe-zone test can diff a frame against this and see only what was added.
    """
    def build():
        L = _Layout(w, h)
        small_w, small_h = max(8, w // 8), max(8, h // 8)
        yy, xx = np.mgrid[0:small_h, 0:small_w].astype(np.float32)
        cx, cy = L.badge_cx / 8, L.badge_cy / 8
        reach = max(w, h) / 8 * 0.62
        d = np.hypot(xx - cx, yy - cy) / reach
        wash = np.clip(1.0 - d, 0, 1) ** 2 * 0.22
        edge = np.hypot((xx / small_w - 0.5) * 2, (yy / small_h - 0.5) * 2)
        vignette = np.clip(edge - 0.6, 0, 1) * 0.35
        base = np.array(BASE, dtype=np.float32)
        col = base + (np.array(BURGUNDY, dtype=np.float32) - base) * wash[..., None]
        col = col * (1.0 - vignette[..., None])
        img = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), "RGB")
        return img.resize((w, h), Image.BICUBIC).convert("RGBA")
    return _cached(("bg", w, h), build).copy()


# ==========================================================================
# The sting
# ==========================================================================
def _env(n, sr, attack=0.01, decay=0.25):
    a = int(sr * attack)
    e = np.ones(n)
    e[:a] = np.linspace(0, 1, a)
    e[a:] = np.exp(-np.linspace(0, 1, n - a) / decay)
    return e


def _tone(sr, freq, dur, amp=0.25, decay=0.25, bend=0.0, attack=0.01,
          harmonics=(1.0, 0.35, 0.12)):
    n = int(sr * dur)
    t = np.linspace(0, dur, n, endpoint=False)
    f = freq * (1.0 + bend * t / max(dur, 1e-6))
    phase = 2 * np.pi * np.cumsum(f) / sr
    wave_ = sum(h * np.sin(phase * (i + 1)) for i, h in enumerate(harmonics))
    return amp * wave_ / sum(harmonics) * _env(n, sr, attack=attack, decay=decay)


def _sting(sr, channels, duration):
    """Original, generated, nothing licensed.

    Deliberately gentle: this plays at the end of somebody else's video, often
    straight after speech, and a harsh sound there is worse than silence -- it
    reads as an ad interrupting rather than a signature. A soft swell as the
    badge rises, a bell for the twinkle, a major arpeggio under the wordmark,
    and then it decays to silence under the held name.
    """
    total = int(sr * duration)
    buf = np.zeros(total)

    def place(sig, at):
        i = int(sr * at)
        end = min(total, i + len(sig))
        if end > i:
            buf[i:end] += sig[: end - i]

    place(_tone(sr, 261.63, 0.60, amp=0.13, attack=0.30, decay=0.20,
                bend=0.5, harmonics=(1.0, 0.2)), 0.02)                # the rise
    place(_tone(sr, 392.00, 0.40, amp=0.15, decay=0.22), 0.42)          # it lands
    place(_tone(sr, 1567.98, 0.50, amp=0.07, decay=0.22,
                harmonics=(1.0, 0.1)), 0.78)                            # twinkle
    for k, (f, off) in enumerate(((523.25, 0.0), (659.25, 0.11), (783.99, 0.22))):
        place(_tone(sr, f, 0.55, amp=0.22 - k * 0.02, decay=0.30), 1.18 + off)
    place(_tone(sr, 1046.5, 0.45, amp=0.08, decay=0.26), 1.74)

    fade = int(sr * 0.18)
    buf[-fade:] *= np.linspace(1, 0, fade)
    peak = np.max(np.abs(buf))
    if peak > 0:
        buf = buf / peak * 0.55        # headroom; never louder than the clip
    return np.column_stack([buf] * channels).astype(np.float32)


def _write_wav(path, sr, channels, duration):
    pcm = (np.clip(_sting(sr, channels, duration), -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


# ==========================================================================
# The animation
# ==========================================================================
def _ease_out(t):
    return 1 - (1 - t) ** 3


def _ease_out_back(t, c1=1.70158):
    c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def _clamp01(t):
    return max(0.0, min(1.0, t))


def _seg(t, a, b):
    return _clamp01((t - a) / (b - a)) if b > a else 0.0


def _bump(t, a, b):
    """0 -> 1 -> 0 across the window. One beat of a movement."""
    return math.sin(math.pi * _seg(t, a, b))


def _lerp(a, b, t):
    return a + (b - a) * t


def _font(filename, size, expect):
    """The app's own face, asserted by family name.

    ui/src/renderer/src/theme.css, site/styles.css and web/app/globals.css all
    declare 'Segoe UI', and the Dashboard sets the wordmark with Tailwind's
    font-bold -- weight 700. Resolved through %WINDIR% rather than a hardcoded
    C:. Falling back silently to some default face would put the one piece of
    branding carrying the product name in the wrong type, on every clip a user
    posts, with nothing failing.
    """
    fonts = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    f = ImageFont.truetype(str(fonts / filename), size)
    family, style = f.getname()
    if (family, style) != expect:
        raise RuntimeError(f"{filename} is {family!r}/{style!r}, expected {expect}")
    return f


def badge_scale(t: float) -> float:
    """The badge's size over time, as a fraction of its resting size: up from
    BADGE_START, past 1.0 by the overshoot, back to rest, then a slow breath."""
    p = _seg(t, *BADGE_IN)
    if p <= 0:
        return 0.0
    # ease_out_back's peak is ~1.1 at c1=1.70158; c1=1.2 lands it near 1.06,
    # which is what BADGE_OVERSHOOT budgets the master image and safe zones for.
    s = _lerp(BADGE_START, 1.0, _ease_out_back(p, 1.2))
    breath = 0.008 * math.sin((t - BADGE_IN[1]) * 2.4) * _seg(t, BADGE_IN[1], BADGE_IN[1] + 0.6)
    return min(BADGE_OVERSHOOT, s + breath)


class _Layout:
    """Where everything sits, for one output size.

    Positions come from measurement, not from nominal numbers:

    * Type is placed by its **ink box**. Putting the wordmark a fixed distance
      below the kicker left a 70px hole, because the bold face carries over
      50px of padding above its caps.
    * The badge is placed by its **ink box** too: the artwork has transparent
      margin, and the star pokes past the disc at the top right.
    * Portrait stacks badge over type and centres the pair in the band the
      platforms leave visible (150..1437), not on the frame's middle -- the
      bottom quarter is covered by the caption, so centring on the frame would
      push the whole lockup toward it.
    """

    def __init__(self, w, h):
        self.w, self.h = w, h
        # Landscape is NOT the portrait design made smaller. Scaling uniformly
        # by min(w/1080, h/1920) gives 0.5625 at 16:9, which left the content
        # in a narrow centre column with two thirds of the frame empty. It
        # gets two columns instead: the badge on the left, the name on the
        # right, both centred on the frame's middle.
        self.landscape = w > h
        self.k = k = (h / REF_H * 1.55) if self.landscape \
            else min(w / REF_W, h / REF_H)
        self.oy = (h - REF_H * k) / 2      # where the reference canvas starts

        self.f_kick = _font("seguisb.ttf", max(8, round(KICK_PT * k)),
                            ("Segoe UI", "Semibold"))
        self.f_word_pt = max(8, round(WORD_PT * k))
        self.f_tag = _font("seguisb.ttf", max(8, round(TAG_PT * k)),
                           ("Segoe UI", "Semibold"))
        self._word_fonts: dict[int, ImageFont.FreeTypeFont] = {}

        probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
        self.ink = lambda text, font: probe.textbbox((0, 0), text, font=font)
        self.kb = self.ink(KICKER, self.f_kick)
        self.wb = self.ink(WORDMARK, self.word_font(self.f_word_pt))
        self.tb = self.ink(TAGLINE, self.f_tag)
        self.kh = self.kb[3] - self.kb[1]
        self.wh = self.wb[3] - self.wb[1]
        self.th = self.tb[3] - self.tb[1]
        self.gap_kick = round(GAP_KICK * k)
        self.gap_tag = round(GAP_TAG * k)
        self.text_h = self.kh + self.gap_kick + self.wh + self.gap_tag + self.th

        # The badge's INK width at rest. Everything about it -- its master
        # image, the halo, the pulse -- is measured from this.
        self.badge = max(16, round(h * LAND_BADGE_FRAC) if self.landscape
                         else round(REF_W * BADGE_FRAC * k))
        self.badge_r = self.badge / 2

        if self.landscape:
            self.badge_cx = w * LAND_BADGE_CX
            self.badge_cy = h / 2
            self.text_cx = w * LAND_TEXT_CX
            self.text_top = h / 2 - self.text_h / 2
        else:
            band_top = self.oy + TOP_SAFE * k
            band_bottom = self.oy + BOTTOM_SAFE * k
            stack = self.badge + round(GAP_BADGE * k) + self.text_h
            top = (band_top + band_bottom) / 2 - stack / 2
            self.badge_cx = w / 2
            self.badge_cy = top + self.badge_r
            self.text_cx = w / 2
            self.text_top = top + self.badge + round(GAP_BADGE * k)

        img, bbox, stars = _emblem()
        # Artwork px -> output px at rest, and where its ink centre falls.
        self.art_k = self.badge / (bbox[2] - bbox[0])
        self.art_c = ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
        self.stars = {name: self.from_art(xy) for name, xy in stars.items()}
        self.sparkle = max(12, round(self.badge * 0.30))

    def from_art(self, xy, scale=1.0):
        """A point in the badge artwork, in frame px, at `scale` of rest size."""
        return (self.badge_cx + (xy[0] - self.art_c[0]) * self.art_k * scale,
                self.badge_cy + (xy[1] - self.art_c[1]) * self.art_k * scale)

    def text_x(self, ink_w):
        """Left edge for a centred line of type."""
        if self.landscape:
            return round(self.text_cx - ink_w / 2)
        return (self.w - ink_w) // 2

    def word_font(self, pt):
        f = self._word_fonts.get(pt)
        if f is None:
            f = self._word_fonts[pt] = _font("segoeuib.ttf", pt,
                                             ("Segoe UI", "Bold"))
        return f

    def extent(self):
        """The furthest the badge and its effects ever reach: the box the
        overshoot, the pulse ring and the halo stay inside, in frame px."""
        r = self.badge_r * max(BADGE_OVERSHOOT, PULSE_REACH)
        return (self.badge_cx - r, self.badge_cy - r,
                self.badge_cx + r, self.badge_cy + r)


def _draw_badge(img, L, t):
    s = badge_scale(t)
    if s <= 0:
        return
    appear = _ease_out(_seg(t, BADGE_IN[0], BADGE_IN[0] + 0.24))

    # Light first, under everything: it swells in with the badge and flares
    # briefly as the badge lands.
    flare = 1.0 + 0.35 * _bump(t, PULSE[0], PULSE[0] + 0.4)
    halo = _halo(max(8, round(L.badge_r * 1.05)))
    _blit(img, _fade(halo, min(1.0, appear * flare * 0.8)),
          (L.badge_cx - halo.width / 2, L.badge_cy - halo.height / 2))

    master = _badge_master(L.badge)
    side = max(4, round(master.width * s / BADGE_OVERSHOOT))
    badge = master.resize((side, side), Image.LANCZOS) if side != master.width else master
    spin = -10.0 * (1 - _ease_out(_seg(t, *BADGE_IN)))
    if abs(spin) >= 0.25:
        badge = badge.rotate(spin, resample=Image.BICUBIC)
    # The artwork's ink centre goes on the badge's centre, not its canvas
    # centre: the star makes the ink box sit off the image's middle.
    img_k = side / _emblem()[0].width
    ax, ay = L.art_c
    _blit(img, _fade(badge, appear),
          (L.badge_cx - ax * img_k, L.badge_cy - ay * img_k))


def _draw_pulse(img, L, t):
    """A thin gold ring that leaves the rim as the badge lands and fades as
    it widens: the moment of arrival, without a flash."""
    p = _seg(t, *PULSE)
    if p <= 0 or p >= 1:
        return
    r = L.badge_r * _lerp(0.98, PULSE_REACH, _ease_out(p))
    alpha = (1 - p) ** 1.4 * 0.9
    ss = 2
    pad = 6
    side = int((r + pad) * 2 * ss)
    layer = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    width = max(2, round(6 * L.k * ss * (1 - 0.6 * p)))
    c = side / 2
    ImageDraw.Draw(layer).ellipse((c - r * ss, c - r * ss, c + r * ss, c + r * ss),
                                  outline=(*GOLD, int(255 * alpha)), width=width)
    layer = layer.resize((side // ss, side // ss), Image.LANCZOS)
    _blit(img, layer, (L.badge_cx - layer.width / 2, L.badge_cy - layer.height / 2))


def _twinkle(img, L, at, size, strength):
    if strength <= 0.02:
        return
    px = max(4, round(size * strength))
    sp = _sparkle(L.sparkle).resize((px, px), Image.LANCZOS)
    _blit(img, _fade(sp, min(1.0, strength * 1.4)),
          (at[0] - sp.width / 2, at[1] - sp.height / 2))


def _draw_stars(img, L, t):
    s = badge_scale(t)
    if s <= 0:
        return
    big = L.from_art(_emblem()[2]["big"], s)
    for a, b, strength in TWINKLES:
        p = _seg(t, a, b)
        if 0 < p < 1:
            # Fast up, slow out: a glint catches, then lingers.
            # It stays upright and sits exactly on the artwork's star, so the
            # star itself seems to flare -- a rotating copy read as a second,
            # eight-pointed star laid over the first.
            env = math.sin(math.pi * p ** 0.6) * strength
            _twinkle(img, L, big, L.sparkle, env)
    p = _seg(t, *GLINT)
    if 0 < p < 1:
        small = L.from_art(_emblem()[2]["small"], s)
        _twinkle(img, L, small, L.sparkle * 0.55, math.sin(math.pi * p) * 0.8)


def _text(img, L, t):
    """'Made with' / Solaris Studio / 'Free & Open Source'.

    The name appears once. "with" stays lowercase: it is a preposition inside
    a fragment running into the name, not a title.

    Timings come from reading time -- the wordmark is legible from 1.40s and
    the frame cuts at 2.90, so it holds for a second and a half.
    """
    p = _seg(t, TEXT_IN, TEXT_IN + 0.30)
    if p <= 0:
        return
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    a = int(255 * _clamp01(p * 1.6))
    rise = round(16 * L.k * (1 - _ease_out(p)))

    y = L.text_top
    d.text((L.text_x(L.kb[2] - L.kb[0]), y - L.kb[1] + rise), KICKER,
           font=L.f_kick, fill=(*INK_SOFT, a))
    y += L.kh + L.gap_kick

    # Two-tone, the way the app's sidebar sets it, drawn as two runs positioned
    # by the advance width of "Solaris " so the pair keeps its kerning. The
    # settle scales about the wordmark's ink centre, so the line beneath it
    # does not shuffle while it lands.
    fw = L.word_font(max(8, int(L.f_word_pt * (0.88 + 0.12 * _ease_out_back(p)))))
    wb = L.ink(WORDMARK, fw)
    wx = L.text_x(wb[2] - wb[0]) - wb[0]
    wy = y + L.wh / 2 - (wb[3] - wb[1]) / 2 - wb[1]
    first, second = WORDMARK.split()
    d.text((wx, wy), first, font=fw, fill=(*SOLARIS, a))
    d.text((wx + d.textlength(first + " ", font=fw), wy), second, font=fw,
           fill=(*STUDIO, a))
    y += L.wh

    # A gold hairline under the name, drawn outward from its centre -- the
    # rule the lockup in docs/brand/solaris-logo.png sets under "Studio".
    q = _seg(t, TEXT_IN + 0.14, TEXT_IN + 0.50)
    if q > 0:
        half = max(1, round((L.wb[2] - L.wb[0]) * 0.36 * _ease_out(q)))
        lw = max(2, round(3 * L.k))
        # Brightest at the centre, fading to nothing at both ends.
        f = np.abs(np.linspace(-1.0, 1.0, 2 * half))
        ramp = (235 * (1 - f ** 2) * _clamp01(q * 2)).astype(np.uint8)
        rule = Image.new("RGBA", (2 * half, lw), (*GOLD, 0))
        rule.putalpha(Image.fromarray(np.tile(ramp, (lw, 1)), "L"))
        layer.alpha_composite(rule, (round(L.text_cx - half),
                                     round(y + L.gap_tag / 2 - lw / 2)))
    y += L.gap_tag

    r = _seg(t, TEXT_IN + 0.20, TEXT_IN + 0.45)
    if r > 0:
        d.text((L.text_x(L.tb[2] - L.tb[0]),
                y - L.tb[1] + round(20 * L.k * (1 - _ease_out(r)))), TAGLINE,
               font=L.f_tag, fill=(*INK_SOFT, int(255 * _clamp01(r * 1.6))))

    img.alpha_composite(layer)


def frame(L: _Layout, t: float) -> Image.Image:
    """One frame of the card at time `t`, as RGB."""
    img = background(L.w, L.h)
    _draw_badge(img, L, t)
    _draw_pulse(img, L, t)
    _draw_stars(img, L, t)
    _text(img, L, t)
    return img.convert("RGB")


def frames(w, h, fps):
    """The animation, one PIL image per frame.

    The badge rises out of the dark with a small overshoot and a quarter-turn
    of settle, a gold ring leaves its rim as it lands, the star catches the
    light, and the name resolves beneath it. Then it holds, breathing very
    slightly, so the last second and a half is reading time rather than
    motion.
    """
    L = _Layout(w, h)
    n = max(1, round(fps * DURATION))
    return [frame(L, i / fps) for i in range(n)]


# ==========================================================================
# Building, caching and appending
# ==========================================================================
def _ffmpeg():
    from core import binaries
    return binaries.ffmpeg()


def _ffprobe():
    from core import binaries
    return binaries.ffprobe()


def _timescale(time_base: str | None) -> int:
    """The denominator of a `1/30000` time_base, which MP4 calls timescale.

    Falls back to 30000 rather than 1: a timescale of 1 would quantise every
    timestamp to whole seconds.
    """
    _, _, den = (time_base or "").partition("/")
    try:
        value = int(den)
    except (TypeError, ValueError):
        return 30000
    return value if value > 1 else 30000


def probe(path: Path) -> dict | None:
    """The clip's format, which the outro has to match exactly for `-c copy`."""
    r = subprocess.run(
        [_ffprobe(), "-v", "error", "-show_streams", "-of", "json", str(path)],
        capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        streams = json.loads(r.stdout)["streams"]
    except (ValueError, KeyError):
        return None
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not v:
        return None
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    rate = (v.get("r_frame_rate") or "30/1").strip()
    num, _, den = rate.partition("/")
    try:
        fps = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        fps, rate = 30.0, "30/1"
    return {
        "w": int(v["width"]), "h": int(v["height"]),
        "fps": round(fps, 3),
        # The EXACT rate and the container timescale, not just the rounded
        # float. 29.97 is 30000/1001, and a card rendered at the rounded
        # 2997/100 lands in timebase 1/11988 against the clip's 1/30000.
        # Concat then has to rescale the card's timestamps, and that rescale
        # is half of why the card lost its video. The other half is B-frames.
        "rate": rate,
        "timescale": _timescale(v.get("time_base")),
        "pix_fmt": v.get("pix_fmt", "yuv420p"),
        "sample_rate": int(a["sample_rate"]) if a else 48000,
        "channels": int(a["channels"]) if a else 2,
    }


def _fps_tag(fps, rate: str = "") -> str:
    """`30`, not `30.0`.

    probe() reads r_frame_rate and divides, so a plain 30fps clip arrives as
    the float 30.0 and keyed the cache as `..._30.0_...` -- which never matched
    the shipped `..._30_...` card, so every install rendered its own copy of a
    file it already had. Fractional rates (29.97) keep their decimals.
    """
    num, _, den = (rate or "").partition("/")
    if num.isdigit() and den.isdigit():
        # Integer rates keep the bare number, so the cards shipped with the
        # app are still matched rather than re-rendered.
        return num if int(den) == 1 else f"{num}-{den}"
    f = float(fps)
    return str(int(f)) if f.is_integer() else str(round(f, 3))


def _key(fmt: dict) -> str:
    # The prefix is bumped whenever a card already cached on users' machines
    # must never be reused. "outro2" retired the cards built with B-frames,
    # which froze when appended; "outro3" retires the old mascot card for the
    # Solaris badge, so nobody's clips keep ending on the old brand.
    return ("outro3_{w}x{h}_{fps}_{pix_fmt}_{sample_rate}_{channels}.mp4"
            .format(**{**fmt, "fps": _fps_tag(fmt["fps"], fmt.get("rate", ""))}))


def _cache_dir(config: dict) -> Path:
    d = resolve_data_dir(config) / "outro"
    d.mkdir(parents=True, exist_ok=True)
    # _render cleans up after itself, but only if the process survives; a kill
    # mid-render leaves its scratch directory behind forever. Sweep anything
    # older than an hour, which cannot be a build still in progress.
    cutoff = time.time() - 3600
    for stale in d.glob(".build_*"):
        # A scratch directory that cannot be read or removed is somebody else's
        # build still running, or a permission we do not have. Either way it is
        # not this call's problem.
        with contextlib.suppress(OSError):
            if stale.is_dir() and stale.stat().st_mtime < cutoff:
                shutil.rmtree(stale, ignore_errors=True)
    return d


def _bundled(name: str) -> Path | None:
    """The prebuilt card that ships with the app, if one matches this format.

    The common paths — both canvases at 30 and 60fps — then render nothing at
    all, ever. Anything else renders once and is cached. Found through
    _asset(), so the frozen build's _internal/ is searched as well.
    """
    return _asset(f"assets/outro/{name}")


def ensure_outro(fmt: dict, config: dict) -> Path:
    """The outro MP4 for this exact clip format, built once and kept.

    Keyed on width, height, fps, pixel format and audio parameters, because
    those are precisely the things concat's `-c copy` requires to agree. Built
    once per format on a machine -- not once per video, and not once per clip.
    """
    name = _key(fmt)
    cached = _cache_dir(config) / name
    if cached.exists() and cached.stat().st_size > 0:
        return cached

    with _build_lock:
        if cached.exists() and cached.stat().st_size > 0:
            return cached          # another thread built it while we waited
        shipped = _bundled(name)
        if shipped:
            shutil.copyfile(shipped, cached)
            return cached
        _render(fmt, cached)
    return cached


def _render(fmt: dict, dst: Path) -> None:
    """Draw and encode. Written to a temp name and renamed, so a crash or a
    second process never leaves a half-written file in the cache."""
    tmp_dir = dst.parent / f".build_{os.getpid()}_{threading.get_ident()}"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    try:
        imgs = frames(fmt["w"], fmt["h"], fmt["fps"])
        for i, im in enumerate(imgs):
            im.save(tmp_dir / f"{i:05d}.png")
        wav = tmp_dir / "sting.wav"
        _write_wav(wav, fmt["sample_rate"], fmt["channels"],
                   len(imgs) / fmt["fps"])
        tmp_mp4 = tmp_dir / "outro.mp4"
        r = subprocess.run([
            _ffmpeg(), "-y", "-v", "error",
            "-framerate", str(fmt.get("rate") or fmt["fps"]),
            "-i", str(tmp_dir / "%05d.png"),
            "-i", str(wav),
            # -bf 0: NO B-FRAMES. This is the whole reason the end card
            # played as a frozen frame with its audio running.
            #
            # B-frames make the first packets carry NEGATIVE DTS (-0.067,
            # -0.033, 0). Appending that to a clip whose timeline is already
            # at 29 seconds walks the timestamps backwards, so FFmpeg clamps
            # each one to previous+1 -- 86 "Non-monotonic DTS" warnings, on
            # stderr, discarded because the command still exits 0 -- and the
            # card's 86 frames collapse into 86 consecutive ticks. The video
            # stream ends three seconds before the container does, and a
            # player holds the last frame while the audio plays on.
            #
            # Measured: with B-frames, 86 warnings and the video 2.836s
            # short. Without them, zero warnings and 0.067s short, which is
            # two frames of rounding. The concat stays `-c copy` and still
            # takes a tenth of a second.
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-bf", "0",
            "-pix_fmt", fmt["pix_fmt"],
            "-c:a", "aac", "-b:a", "128k",
            "-ar", str(fmt["sample_rate"]), "-ac", str(fmt["channels"]),
            # The clip's own container timescale, so concat has nothing to
            # rescale when it appends this.
            "-video_track_timescale", str(fmt.get("timescale") or 30000),
            "-shortest", "-movflags", "+faststart", str(tmp_mp4),
        ], capture_output=True, text=True)
        if r.returncode != 0 or not tmp_mp4.exists():
            raise RuntimeError(f"outro encode failed: {r.stderr.strip()[-400:]}")
        tmp_mp4.replace(dst)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def enabled(config: dict) -> bool:
    """Absent means ON, so existing users get it on upgrade without their
    settings.yaml being rewritten, and anyone who turned it off keeps it off."""
    return bool(config.get("clips", {}).get("outro", True))


# How long to keep trying the atomic rename before writing in place instead.
# Short on purpose: a scanner's memory map clears in seconds, and anything
# still holding the file after that is a reader the rename can never beat.
REPLACE_BUDGET = 10.0

# Per-job tally. Until this existed the only way to know how many clips got an
# end card was to probe every file and compare its duration against the window
# in its filename -- which is how "31 of 55" was found, days after the fact.
_tally = {"added": 0, "skipped": 0}


def reset_tally() -> None:
    _tally["added"] = _tally["skipped"] = 0


def summary() -> str:
    """One line for the end of a job, or "" when there is nothing to say."""
    added, skipped = _tally["added"], _tally["skipped"]
    if not (added or skipped):
        return ""
    line = f"End card added to {added} of {added + skipped} clip(s)"
    return line if not skipped else f"{line} ({skipped} skipped — see above)"


def _overwrite_in_place(src: Path, dst: Path) -> bool:
    """Copy `src`'s bytes over `dst`, keeping `dst`'s identity.

    This is the one that beats a reader. Measured, with a file held the way a
    media player holds it (read access, sharing read+write but NOT delete):

        os.replace(src, dst)   -> BLOCKED, WinError 5 Access is denied
        open(dst, "r+b") write -> SUCCEEDS

    MoveFileEx(REPLACE_EXISTING) has to DELETE the destination and the reader's
    share mode forbids exactly that; writing to the existing file needs only
    write access, which it permits. That asymmetry is why the renderer could
    overwrite a clip without complaint while the end card's replace failed on
    the very same file.

    Not atomic, so it is a fallback and never the first move. `src` is left on
    disk until the result is verified, so the bytes are always recoverable.
    """
    payload = src.read_bytes()
    for attempt in (1, 2):
        try:
            with open(dst, "r+b") as f:
                f.seek(0)
                f.write(payload)
                f.truncate()
                f.flush()
                os.fsync(f.fileno())
        except OSError as exc:
            if attempt == 2:
                print(f"  outro skipped: could not write {dst.name} ({exc})")
                return False
            time.sleep(0.5)
            continue
        if dst.stat().st_size == len(payload):
            return True
        # Short write. src still holds the good bytes, so try once more before
        # giving up -- and if it never verifies, say where the copy is rather
        # than deleting the only intact version of the clip.
        if attempt == 2:
            print(f"  outro skipped: {dst.name} did not verify after writing; "
                  f"the joined copy is at {src}")
            return False
    return False


def _replace_with_retry(src: Path, dst: Path, budget: float = REPLACE_BUDGET) -> bool:
    """Put `src` in `dst`'s place, against whatever is holding the file.

    Two strategies, because two different things block this and they need
    opposite answers:

    * **A scanner** memory-maps a just-written clip, which blocks the rename
      AND a write, and clears after a few seconds. Waiting is the answer.
    * **The app itself** holds a clip open whenever the desktop UI previews it
      (`GET /media/<id>` keeps a Chromium media handle). That is held for as
      long as the user leaves it open, so waiting never wins -- one clip sat
      locked for the full 59s budget and still lost its end card. Writing in
      place is the answer, because a reader permits writes but not deletes.

    So: rename first, briefly -- it is atomic and it is right for the scanner
    -- then fall back to the in-place write, which beats the reader. The first
    budget is deliberately short now that a fallback exists; the old 60s bought
    nothing except a minute of stalling per held clip.

    Returns False rather than raising: the caller then leaves the clip exactly
    as it was, which is the right outcome either way.
    """
    started = time.monotonic()
    delay = 0.1
    while True:
        try:
            src.replace(dst)
            waited = time.monotonic() - started
            if waited > 0.5:
                print(f"      End card: {dst.name} was locked for "
                      f"{waited:.1f}s — added anyway")
            return True
        except PermissionError:
            if time.monotonic() - started + delay >= budget:
                break
            time.sleep(delay)
            delay = min(delay * 2, 2.0)      # ceiling, not unbounded doubling

    # Still held after the rename budget: almost certainly a preview open in
    # the app rather than a scan, so stop waiting and write through it.
    if _overwrite_in_place(src, dst):
        print(f"      End card: {dst.name} was open elsewhere — written in "
              f"place instead")
        return True

    # Both refused, which a memory-mapped file will do. Say so: a clip that
    # quietly comes out without an end card and no reason in the log is how
    # this went unexplained for days.
    print(f"  outro skipped: {dst.name} could not be replaced or written "
          f"({time.monotonic() - started:.0f}s)")
    return False


def append(clip: Path, config: dict) -> bool:
    """Append the outro to a finished clip, IN PLACE. Returns whether it ran.

    Never raises. A clip with no outro is worth far more than no clip, so any
    failure here leaves the file exactly as it was and prints why -- the same
    stance as the CPU-encoder fallback added for #84.
    """
    try:
        if not enabled(config):
            return False        # off: not a skip, nothing to report

        # ABSOLUTE, always. The concat demuxer resolves the paths inside its
        # list file, and a relative one does not survive that: `data/clips/X/
        # clip.mp4` written into a list that itself lives in `data/clips/X/`
        # resolves to `data/clips/X/data/clips/X/clip.mp4` and opens nothing.
        #
        # It matters because the database holds both shapes -- settings.yaml's
        # data_dir is relative in a checkout -- and that quietly cost 365 of
        # 1098 clips their end card. Every one of the relative ones failed and
        # every absolute one worked, which is what made it visible at all.
        clip = Path(clip).resolve()
        fmt = probe(clip)
        if not fmt:
            print(f"  outro skipped: could not probe {clip.name}")
            _tally["skipped"] += 1
            return False
        outro = ensure_outro(fmt, config).resolve()

        listing = clip.parent / f".{clip.stem}.outro.txt"
        joined = clip.parent / f".{clip.stem}.outro.mp4"
        listing.write_text(
            f"file '{clip.as_posix()}'\nfile '{outro.as_posix()}'\n",
            encoding="utf-8")
        try:
            r = subprocess.run([
                _ffmpeg(), "-y", "-v", "error", "-f", "concat", "-safe", "0",
                "-i", str(listing), "-c", "copy", "-movflags", "+faststart",
                str(joined),
            ], capture_output=True, text=True)
            if r.returncode != 0 or not joined.exists() or joined.stat().st_size == 0:
                print(f"  outro skipped: {r.stderr.strip()[-200:] or 'concat failed'}")
                _tally["skipped"] += 1
                return False
            short = _video_falls_short(joined)
            if short is not None:
                # The join produced a file whose VIDEO ends before its
                # container does: the card is there in duration and audio but
                # has no frames, so it plays as a frozen image. That shipped
                # for months because concat exits 0 while saying so only on
                # stderr, which is discarded on success.
                print(f"  outro skipped: the card lost its video ({short:.2f}s short). "
                      f"{r.stderr.strip()[-160:]}")
                _tally["skipped"] += 1
                return False
            if not _replace_with_retry(joined, clip):
                _tally["skipped"] += 1
                return False
            _tally["added"] += 1
            return True
        finally:
            # discard(), not unlink(): this runs in a `finally`, and on Windows
            # a file still held open raises PermissionError, which would
            # REPLACE whatever error was already in flight. That is issue #74,
            # and unlink(missing_ok=True) does not cover it -- missing_ok only
            # suppresses FileNotFoundError.
            discard(listing)
            discard(joined)
    except Exception as exc:  # never lose a clip
        print(f"  outro skipped: {type(exc).__name__}: {exc}")
        _tally["skipped"] += 1
        return False


def _video_falls_short(path: Path, tolerance: float = 0.5) -> float | None:
    """How far the video stream ends before the container does, or None.

    A frozen end card is exactly this: the container and the audio run the
    full length and the video stops early, so a player holds the last frame.
    Checking it costs one ffprobe and is the difference between noticing on
    the first render and noticing after publishing.

    Returns None when it cannot tell. An unreadable probe must not throw away
    a clip that is probably fine.
    """
    try:
        r = subprocess.run(
            [_ffprobe(), "-v", "error", "-select_streams", "v:0", "-show_entries",
             "frame=pts_time", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True)
        stamps = []
        for line in r.stdout.splitlines():
            head = line.split(",")[0].strip()
            try:
                stamps.append(float(head))
            except ValueError:
                continue  # not a timestamp (a blank or a warning): says nothing
        if not stamps:
            return None
        d = subprocess.run(
            [_ffprobe(), "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)], capture_output=True, text=True)
        duration = float((d.stdout or "0").strip() or 0)
        if duration <= 0:
            return None
        gap = duration - max(stamps)
        return gap if gap > tolerance else None
    except Exception:
        return None


def has_outro(clip: Path, window_seconds: float) -> bool | None:
    """Whether `clip` already carries an end card.

    Compared against the window it was cut from rather than any marker in the
    file: a clip is its window long, plus the card if one was appended. Half
    the card's length is the threshold, which no rounding or keyframe drift can
    cross in either direction.

    None when the file cannot be read, so a probe failure is never mistaken for
    "needs one" and does not get a second card bolted on.
    """
    fmt_dur = subprocess.run(
        [_ffprobe(), "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(clip)], capture_output=True, text=True).stdout.strip()
    try:
        actual = float(fmt_dur)
    except ValueError:
        return None
    return (actual - window_seconds) > DURATION / 2


def backfill(db, config: dict, video_id: str | None = None) -> dict:
    """Add the end card to finished clips that never got one.

    Clips do not need re-rendering for this -- append() works on any finished
    file -- which matters because a library can hold hundreds of them and a
    re-render is minutes each.

    Safe to run repeatedly: a clip already longer than its window is skipped,
    so nothing is ever double-carded.
    """
    rows = db.conn.execute(
        "SELECT path, start_s, end_s FROM clips WHERE path IS NOT NULL"
        + (" AND video_id = ?" if video_id else ""),
        (video_id,) if video_id else (),
    ).fetchall()

    reset_tally()
    stats = {"checked": 0, "added": 0, "already": 0, "missing": 0, "failed": 0}
    for row in rows:
        clip = Path(row["path"] if hasattr(row, "keys") else row[0])
        start, end = (row["start_s"], row["end_s"]) if hasattr(row, "keys") else (row[1], row[2])
        if not clip.exists():
            stats["missing"] += 1
            continue
        stats["checked"] += 1
        state = has_outro(clip, float(end) - float(start))
        if state is None:
            stats["failed"] += 1
            continue
        if state:
            stats["already"] += 1
            continue
        if append(clip, config):
            stats["added"] += 1
            print(f"      + {clip.name}")
        else:
            stats["failed"] += 1
    return stats


def finish(src: Path, dst: Path, config: dict) -> bool:
    """Write `dst` as `src` followed by the end card. Returns whether it ran.

    THIS is the one the render path uses, and the difference from append() is
    the whole point: append() modifies a file that already exists, finish()
    PRODUCES the file. CapCut works the same way -- the outro is part of the
    export, not something bolted on afterwards.

    It matters because of a measured asymmetry on Windows. With a clip held the
    way the desktop app holds it while previewing (read access, sharing read
    and write, but not delete):

        os.replace(joined, clip)  -> BLOCKED, WinError 5 Access is denied
        ffmpeg -y ... -> clip     -> SUCCEEDS

    A reader forbids DELETING the file and permits WRITING it. Every earlier
    version replaced, so a clip open in the UI lost its card no matter how long
    we waited -- one run managed only 37 of 49, and spent twelve minutes
    stalling on locks it could never win. Producing the file cannot hit that
    operation at all.

    Never loses the clip: three attempts, each of which WRITES `dst` rather
    than replacing it, so the lock cannot block any of them.
    """
    src = Path(src).resolve()
    dst = Path(dst).resolve()
    try:
        fmt = probe(src)
        if fmt:
            card = ensure_outro(fmt, config).resolve()
            listing = src.with_suffix(".cardlist.txt")
            # Absolute paths: the concat demuxer resolves entries relative to
            # the list file, so a relative one points nowhere. That cost 365
            # clips their card once already.
            listing.write_text(
                f"file '{src.as_posix()}'\nfile '{card.as_posix()}'\n",
                encoding="utf-8")
            try:
                r = subprocess.run([
                    _ffmpeg(), "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", str(listing), "-c", "copy", "-movflags", "+faststart",
                    str(dst),
                ], capture_output=True, text=True)
            finally:
                discard(listing)
            if r.returncode == 0 and dst.exists() and dst.stat().st_size > 0:
                _tally["added"] += 1
                discard(src)
                return True
            print(f"  end card skipped: {r.stderr.strip()[-200:] or 'concat failed'}")
        else:
            print(f"  end card skipped: could not probe {src.name}")
    except Exception as exc:  # never lose a clip
        print(f"  end card skipped: {type(exc).__name__}: {exc}")

    # The card could not be made. The clip itself still has to arrive at dst,
    # and both fallbacks WRITE it, so a held file cannot block them either.
    _tally["skipped"] += 1
    try:
        r = subprocess.run([_ffmpeg(), "-y", "-v", "error", "-i", str(src),
                            "-c", "copy", "-movflags", "+faststart", str(dst)],
                           capture_output=True, text=True)
        if r.returncode == 0 and dst.exists() and dst.stat().st_size > 0:
            discard(src)
            return False
    except OSError:
        # The remux was a shortcut. Falling through to the copy below is the
        # whole point of trying it, so there is nothing to report.
        pass
    shutil.copyfile(src, dst)                 # last resort; still a write
    discard(src)
    return False
