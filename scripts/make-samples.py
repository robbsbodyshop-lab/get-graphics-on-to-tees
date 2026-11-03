#!/usr/bin/env python3
"""Generate sample inputs for DTF Prep into samples/."""
import math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'samples')
os.makedirs(ROOT, exist_ok=True)
FONTS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
         '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
         '/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf']

def font(size):
    for f in FONTS:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()

def star(cx, cy, r_out, r_in, n=5, rot=-90):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = math.radians(rot + i * 180 / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def centered_text(d, cx, cy, text, f, fill, stroke=0, stroke_fill=None):
    b = d.textbbox((0, 0), text, font=f, stroke_width=stroke)
    d.text((cx - (b[0] + b[2]) / 2, cy - (b[1] + b[3]) / 2), text, font=f, fill=fill,
           stroke_width=stroke, stroke_fill=stroke_fill)

def logo():
    S = 2400  # draw big, downsample for anti-aliasing
    im = Image.new('RGB', (S, S), 'white')
    d = ImageDraw.Draw(im)
    red, navy, gold = (214, 40, 57), (20, 33, 61), (252, 163, 17)
    c = S // 2
    d.ellipse([160, 160, S - 160, S - 160], fill=navy)
    d.ellipse([300, 300, S - 300, S - 300], fill='white')
    d.ellipse([380, 380, S - 380, S - 380], fill=red)
    d.polygon(star(c, c - 160, 560, 230), fill=gold, outline=navy, width=40)
    # banner
    d.rounded_rectangle([420, 1520, S - 420, 1900], radius=60, fill=navy)
    centered_text(d, c, 1710, 'DTF PREP', font(300), 'white')
    centered_text(d, c, 2060, 'EST. 2024', font(120), navy)
    im = im.resize((600, 600), Image.LANCZOS)
    path = os.path.join(ROOT, 'logo-600.jpg')
    im.save(path, quality=80)
    return path

def photo():
    W, H = 1200, 900
    rng = np.random.default_rng(7)
    y = np.linspace(0, 1, H)[:, None]
    x = np.linspace(0, 1, W)[None, :]
    stops = [(0.0, (30, 40, 95)), (0.45, (190, 80, 110)), (0.7, (250, 150, 70)), (1.0, (255, 215, 140))]
    sky = np.zeros((H, W, 3))
    yy = np.broadcast_to(y, (H, W))
    for ch in range(3):
        sky[..., ch] = np.interp(yy, [s[0] for s in stops], [s[1][ch] for s in stops])
    sx, sy = 0.62 * W, 0.6 * H
    X, Y = np.meshgrid(np.arange(W), np.arange(H))
    dist = np.hypot(X - sx, Y - sy)
    glow = np.exp(-(dist / 220) ** 2) * 0.9 + np.exp(-(dist / 60) ** 1.5) * 0.4
    sky += glow[..., None] * np.array([255, 190, 90])
    disc = np.clip((55 - dist) / 3, 0, 1)
    sky = sky * (1 - disc[..., None]) + disc[..., None] * np.array([255, 245, 210])
    img = Image.fromarray(np.clip(sky, 0, 255).astype(np.uint8))

    def ridge(base, amp, rough, seed):
        r = np.random.default_rng(seed)
        h = np.zeros(W)
        for o in range(6):
            n = 4 * 2 ** o
            pts = r.standard_normal(n + 2)
            h += np.interp(np.linspace(0, n, W), np.arange(n + 2), pts) * amp / (rough ** o)
        return base + h

    layers = [(0.58, 90, 1.9, 1, (120, 70, 100), 1.6), (0.68, 110, 1.9, 2, (70, 40, 75), 1.0),
              (0.80, 120, 1.8, 3, (28, 20, 40), 0.0)]
    for base, amp, rough, seed, col, blur in layers:
        top = ridge(base * H, amp, rough, seed)
        mask = (np.arange(H)[:, None] > top[None, :]).astype(np.uint8) * 255
        m = Image.fromarray(mask)
        layer = Image.new('RGB', (W, H), col)
        # haze: lighten toward the horizon
        if blur:
            m = m.filter(ImageFilter.GaussianBlur(blur))
        img = Image.composite(layer, img, m)
        if blur:
            img = img.filter(ImageFilter.GaussianBlur(0.6))
    arr = np.asarray(img).astype(np.float32)
    arr += rng.normal(0, 4.5, arr.shape[:2])[..., None] + rng.normal(0, 2, arr.shape)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    path = os.path.join(ROOT, 'photo.jpg')
    img.save(path, quality=88)
    return path

def shadow():
    W, H = 1000, 800
    S = 2
    layer = Image.new('L', (W * S, H * S), 0)
    d = ImageDraw.Draw(layer)
    bolt = [(560, 40), (250, 400), (440, 400), (360, 640), (700, 270), (510, 270), (620, 40)]
    d.polygon([(x * S, y * S) for x, y in bolt], fill=255)
    f = font(150 * S)
    centered_text(d, 500 * S, 700 * S, 'RELIC', f, 255)
    mask = layer.resize((W, H), Image.LANCZOS)
    # colour: gradient orange -> red
    arr = np.zeros((H, W, 4), np.uint8)
    yy = np.linspace(0, 1, H)[:, None]
    arr[..., 0] = 255
    arr[..., 1] = (200 - 150 * yy).astype(np.uint8).repeat(W, 1)
    arr[..., 2] = 30
    shape = arr.copy()
    shape[..., 3] = np.asarray(mask)
    # shadow: offset + gaussian blur, black 60 %
    sh_mask = Image.new('L', (W, H), 0)
    sh_mask.paste(mask, (22, 26))
    sh_mask = sh_mask.filter(ImageFilter.GaussianBlur(18))
    sh = np.zeros((H, W, 4), np.uint8)
    sh[..., 3] = (np.asarray(sh_mask).astype(np.float32) * 0.6).astype(np.uint8)
    base = Image.fromarray(sh, 'RGBA')
    top = Image.fromarray(shape, 'RGBA')
    out = Image.alpha_composite(base, top)
    path = os.path.join(ROOT, 'shadow.png')
    out.save(path)
    return path

for p in (logo(), photo(), shadow()):
    im = Image.open(p)
    n = 0
    if im.mode == 'RGBA':
        a = np.asarray(im)[..., 3]
        n = int(((a > 0) & (a < 255)).sum())
    print(os.path.basename(p), im.size, im.mode, 'semi-transparent px:', n)
