#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tabBar 图标生成器 —— 微信小程序「旅行攻略生成器」 v1.2 视觉打磨
生成 4 组 (正常/选中) 81x81 PNG，4x 超采样抗锯齿，线条艺术风格。

设计系统：暗色玻璃拟态 #0d1424
  - 正常态 #8495ad（蓝灰，与文字色一致）
  - 选中态 #d4a94e（琥珀金，与文字选中色一致）

语义：
  index 出发 -> 纸飞机 (旅行启程)
  today 今天 -> 时钟   (当前时刻三态)
  plan  行程 -> 定位图钉 (目的地串联)
  more  更多 -> 三点   (更多功能)

运行：<venv>/bin/python tools/gen-tab-icons.py
输出：images/tab-*.png / tab-*-active.png
"""
import math
import os
from PIL import Image, ImageDraw

S = 4                     # 超采样倍数
SIZE = 81
C = 162                   # 中心 (SIZE*S/2)
NORMAL = (132, 149, 173, 255)   # #8495ad
ACTIVE = (212, 169, 78, 255)    # #d4a94e
BG = (0, 0, 0, 0)


def canvas():
    img = Image.new("RGBA", (SIZE * S, SIZE * S), BG)
    return img, ImageDraw.Draw(img)


def px(v):
    """324 空间的归一化坐标,支持 (x,y) 与单值"""
    if isinstance(v, tuple):
        return tuple(int(round(x * S)) for x in v)
    return int(round(v * S))


def round_line(d, a, b, w, color):
    """粗线 + 两端圆帽"""
    a, b, w = px(a), px(b), px(w)
    d.line([a, b], fill=color, width=w)
    r = w // 2
    for p in (a, b):
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=color)


def poly_round(d, pts, w, color):
    """闭合多段线,圆角顶点(线条艺术外轮廓)"""
    n = len(pts)
    for i in range(n):
        round_line(d, pts[i], pts[(i + 1) % n], w, color)


def circle(d, cxy, r, color, width=None, fill=None):
    """圆; width 给定则描边,否则/同时 fill 可填充"""
    x, y = px(cxy)
    r = px(r)
    box = [x - r, y - r, x + r, y + r]
    if width is not None:
        d.ellipse(box, outline=color, width=px(width), fill=fill)
    else:
        d.ellipse(box, fill=color)


def disc(d, cxy, r, color):
    circle(d, cxy, r, color)


# ---------- 图标绘制(坐标在 81 空间,内部 *S) ----------

def draw_plane(d, color):
    """纸飞机(右倾上扬), 外轮廓 + 中缝折线"""
    pts = [(61, 21), (17, 14), (30, 37), (17, 42)]
    # 21+ → 保证图形在 14..61 左右; 顶点圆角闭合
    poly_round(d, pts, 5.5, color)
    # 折痕(机头->凹槽)
    round_line(d, (61, 21), (30, 37), 3.2, color)


def draw_clock(d, color):
    """时钟 10:10 —— 时针左上,分针右上,均朝上方张开,避开横穿中心"""
    circle(d, (40.5, 40.5), 24.5, color, width=5.5)
    # 10 点: 角度 -150° (12点为 -90°, 屏幕坐标 y 向下为正)
    # x = r*cos(theta)+cx; y = r*sin(theta)+cy
    # 时针长 12.5: 终点 (40.5 + 12.5*cos(-150°), 40.5 + 12.5*sin(-150°)) = (29.7, 34.25)
    # 分针长 18:   终点 (40.5 + 18*cos(-30°),  40.5 + 18*sin(-30°))  = (56.1, 31.5)
    round_line(d, (40.5, 40.5), (29.7, 34.25), 4.4, color)
    round_line(d, (40.5, 40.5), (56.1, 31.5), 4.4, color)
    disc(d, (40.5, 40.5), 2.6, color)


def draw_pin(d, color):
    """定位图钉: 圆头环 + 锥体 + 中心点"""
    head = (40.5, 25.0)
    tip = (40.5, 62.0)
    r = 14.5
    # 锥体两条斜边(从头圈下缘向尖端收拢)
    lx, rx = head[0] - r * 0.78, head[0] + r * 0.78
    ly = head[1] + r * 0.52
    round_line(d, (lx, ly), tip, 4.6, color)
    round_line(d, (rx, ly), tip, 4.6, color)
    # 圆头环
    circle(d, head, r, color, width=4.6)
    # 中心实心点(环内高光)
    disc(d, head, 4.2, color)


def draw_more(d, color):
    """水平三点"""
    for cx in (15.5, 40.5, 65.5):
        disc(d, (cx, 40.5), 6.4, color)


ICONS = {
    "index": draw_plane,
    "today": draw_clock,
    "plan": draw_pin,
    "more": draw_more,
}


def render(fn, color):
    img, d = canvas()
    fn(d, color)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "images")
    os.makedirs(out, exist_ok=True)
    for name, fn in ICONS.items():
        for suffix, color in (("", NORMAL), ("-active", ACTIVE)):
            p = os.path.join(out, f"tab-{name}{suffix}.png")
            render(fn, color).save(p)
            print("wrote", p, os.path.getsize(p), "bytes")


if __name__ == "__main__":
    main()
