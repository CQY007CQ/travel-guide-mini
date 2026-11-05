#!/usr/bin/env python3
# 重绘底部 4 个 tab 图标（paper plane / map pin / compass / ellipsis）
# 243x243 输出，5x 超采样 + LANCZOS 抗锯齿，几何更精致、线条更顺。
# 配色沿用现有：深色主题未选=#8495ad，浅色主题未选=#4a5568，选中=金 #d4a94e。
# 用法：python3 tools/_gen-tab-icons.py
import math
from PIL import Image, ImageDraw

SIZE = 243
SS = 5                      # 超采样倍数（3 -> 5，边缘明显更顺）
BIG = SIZE * SS
f = BIG / 24.0

C_DARK = (132, 149, 173, 255)   # 深色主题·未选
C_LIGHT = (74, 85, 104, 255)    # 浅色主题·未选
C_GOLD = (212, 169, 78, 255)    # 选中
GOLD_DARK = (150, 115, 50, 255) # 选中态内的暗金（制造立体感）
WHITE = (255, 255, 255, 255)


def P(x, y):
    return (x * f, y * f)


def sw(u):
    """24-grid 单位 -> BIG 像素（整数，靠超采样获得亚像素平滑）。"""
    return max(1, int(round(u * f)))


def draw_plane(d, color, filled):
    # Material「send」纸飞机（朝右）：左缘上下两段直尾翼(C-D / F-A) + 深 V 缺口 E；
    # 折缝 B-E 把机身分成上翼(亮金)/下翼(暗金)，而非平滑箭头。
    A, B, C, D, E, F = (3, 21), (22, 12), (3, 3), (3, 10), (15, 12), (3, 14)
    if filled:
        d.polygon([P(*B), P(*C), P(*D), P(*E)], fill=color)        # 上翼（亮金）
        d.polygon([P(*B), P(*E), P(*F), P(*A)], fill=GOLD_DARK)    # 下翼（暗金折面）
    else:
        w = sw(1.7)
        d.line([P(*A), P(*B), P(*C), P(*D), P(*E), P(*F), P(*A)], fill=color, width=w, joint="curve")
        d.line([P(*B), P(*E)], fill=color, width=w, joint="curve")


def draw_pin(d, color, filled):
    # 经典地图钉：圆头 + 收尖到底部一点，内嵌空心圆（"你在这里"）
    cx, cy, r = 12, 9, 5.6
    tip = (12, 21)
    ang = math.radians(58)
    lx, ly = cx - r * math.sin(ang), cy + r * math.cos(ang)
    rx, ry = cx + r * math.sin(ang), cy + r * math.cos(ang)
    if filled:
        d.ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], fill=color)
        d.polygon([P(lx, ly), P(rx, ry), P(*tip)], fill=color)
        ir = 2.3
        d.ellipse([P(cx - ir, cy - ir), P(cx + ir, cy + ir)], fill=WHITE)
    else:
        w = sw(1.7)
        d.ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], outline=color, width=w)
        d.line([P(lx, ly), P(*tip)], fill=color, width=w, joint="curve")
        d.line([P(rx, ry), P(*tip)], fill=color, width=w, joint="curve")
        ir = 2.3
        d.ellipse([P(cx - ir, cy - ir), P(cx + ir, cy + ir)], outline=color, width=w)


def draw_plan(d, color, filled):
    # 指南针：外环 + 四方位刻度 + 四芒针（北长南短）+ 中心轴
    cx, cy, r = 12, 12, 8.2
    tk = 1.3
    ticks = [
        ((cx, cy - r + tk), (cx, cy - r - tk)),
        ((cx, cy + r - tk), (cx, cy + r + tk)),
        ((cx - r + tk, cy), (cx - r - tk, cy)),
        ((cx + r - tk, cy), (cx + r + tk, cy)),
    ]
    if filled:
        d.ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], fill=color)
        d.polygon([P(12, 4.2), P(13.3, 12), P(12, 19.8), P(10.7, 12)], fill=GOLD_DARK)  # 竖直针
        d.polygon([P(4.2, 12), P(12, 10.7), P(19.8, 12), P(12, 13.3)], fill=GOLD_DARK)  # 水平针
        d.ellipse([P(cx - 1.7, cy - 1.7), P(cx + 1.7, cy + 1.7)], fill=WHITE)
        for a, b in ticks:
            d.line([P(*a), P(*b)], fill=GOLD_DARK, width=sw(1.0))
    else:
        w = sw(1.7)
        d.ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], outline=color, width=w)
        d.polygon([P(12, 4.2), P(13.3, 12), P(12, 19.8), P(10.7, 12)], fill=color)
        d.polygon([P(4.2, 12), P(12, 10.7), P(19.8, 12), P(12, 13.3)], fill=color)
        d.ellipse([P(cx - 1.7, cy - 1.7), P(cx + 1.7, cy + 1.7)], fill=color)
        for a, b in ticks:
            d.line([P(*a), P(*b)], fill=color, width=sw(1.0))


def draw_more(d, color, filled):
    for cx in (5, 12, 19):
        rr = 2.5
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
