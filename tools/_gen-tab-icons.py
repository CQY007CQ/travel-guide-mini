#!/usr/bin/env python3
# 重绘底部 4 个 tab 图标（paper plane / map pin / compass / ellipsis）
# 当前全部 32x32 px，高分屏发虚；本脚本按原设计矢量重绘为 162x162（3x 超采样 + LANCZOS 抗锯齿）。
# 配色沿用现有：深色主题未选=#8495ad，浅色主题未选=#4a5568，选中=金 #d4a94e。
# 用法：python3 tools/_gen-tab-icons.py
import math
from PIL import Image, ImageDraw

SIZE = 243
SS = 3
BIG = SIZE * SS
f = BIG / 24.0

C_DARK = (132, 149, 173, 255)
C_LIGHT = (74, 85, 104, 255)
C_GOLD = (212, 169, 78, 255)
GOLD_DARK = (150, 115, 50, 255)
WHITE = (255, 255, 255, 255)


def P(x, y):
    return (x * f, y * f)


def sw(u):
    return max(1.0, u * f)


def draw_plane(d, color, filled):
    # Feather "send" 纸飞机几何：更 recognizable
    N, Ut, F, Lt = (22, 2), (2, 9), (11, 13), (15, 22)
    if filled:
        d.polygon([P(*N), P(*Ut), P(*F), P(*Lt)], fill=color)
        d.line([P(*N), P(*F)], fill=GOLD_DARK, width=max(1, int(sw(1.7) * 0.5)))
    else:
        w = int(sw(1.7))
        d.line([P(*N), P(*Ut), P(*F), P(*Lt), P(*N)], fill=color, width=w)
        d.line([P(*N), P(*F)], fill=color, width=w)


def draw_pin(d, color, filled):
    cx, cy, r = 12, 8.5, 6.2
    tip = (12, 21)
    ang = math.radians(55)
    lx, ly = cx - r * math.sin(ang), cy + r * math.cos(ang)
    rx, ry = cx + r * math.sin(ang), cy + r * math.cos(ang)
    if filled:
        d.ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], fill=color)
        d.polygon([P(lx, ly), P(rx, ry), P(*tip)], fill=color)
        chk = [(9.2, 8.5), (11.2, 10.6), (15, 6.2)]
        d.line([P(*chk[0]), P(*chk[1])], fill=WHITE, width=int(sw(2.0)))
        d.line([P(*chk[1]), P(*chk[2])], fill=WHITE, width=int(sw(2.0)))
    else:
        w = int(sw(1.7))
        d.ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], outline=color, width=w)
        d.line([P(lx, ly), P(*tip)], fill=color, width=w)
        d.line([P(rx, ry), P(*tip)], fill=color, width=w)
        ir = 2.6
        d.ellipse([P(cx - ir, cy - ir), P(cx + ir, cy + ir)], outline=color, width=w)
        # 内部勾：未选态用同色（白底/深色底都可见），不画白色（白底会隐身）
        chk = [(9.2, 8.5), (11.2, 10.6), (15, 6.2)]
        d.line([P(*chk[0]), P(*chk[1])], fill=color, width=w)
        d.line([P(*chk[1]), P(*chk[2])], fill=color, width=w)


def draw_plan(d, color, filled):
    cx, cy, r = 12, 12, 8
    needle = [(12, 5.5), (13.6, 12), (12, 18.5), (10.4, 12)]
    if filled:
        d.ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], fill=color)
        d.polygon([P(*p) for p in needle], fill=GOLD_DARK)
        d.ellipse([P(cx - 1.8, cy - 1.8), P(cx + 1.8, cy + 1.8)], fill=GOLD_DARK)
    else:
        w = int(sw(1.7))
        d.ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], outline=color, width=w)
        # 未选态：指针/中心点用同色（白底/深色底都可见），不画白色
        d.polygon([P(*p) for p in needle], fill=color)
        d.ellipse([P(cx - 1.8, cy - 1.8), P(cx + 1.8, cy + 1.8)], fill=color)


def draw_more(d, color, filled):
    for cx in (6, 12, 18):
        rr = 2.7
        d.ellipse([P(cx - rr, 12 - rr), P(cx + rr, 12 + rr)], fill=color)


def render(glyph, mode):
    img = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    color = {"gold": C_GOLD, "dark": C_DARK, "light": C_LIGHT}[mode]
    if glyph == "index":
        draw_plane(d, color, mode == "gold")
    elif glyph == "today":
        draw_pin(d, color, mode == "gold")
    elif glyph == "plan":
        draw_plan(d, color, mode == "gold")
    elif glyph == "more":
        draw_more(d, color, mode == "gold")
    return img.resize((SIZE, SIZE), Image.LANCZOS)


jobs = [
    ("images/tab-index.png", "index", "dark"),
    ("images/tab-light-index.png", "index", "light"),
    ("images/tab-index-active.png", "index", "gold"),
    ("images/tab-today.png", "today", "dark"),
    ("images/tab-light-today.png", "today", "light"),
    ("images/tab-today-active.png", "today", "gold"),
    ("images/tab-plan.png", "plan", "dark"),
    ("images/tab-light-plan.png", "plan", "light"),
    ("images/tab-plan-active.png", "plan", "gold"),
    ("images/tab-more.png", "more", "dark"),
    ("images/tab-light-more.png", "more", "light"),
    ("images/tab-more-active.png", "more", "gold"),
]

if __name__ == "__main__":
    for path, glyph, mode in jobs:
        render(glyph, mode).save(path)
        print("wrote", path)
