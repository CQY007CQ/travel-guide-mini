#!/usr/bin/env python3
"""生成行程封面用的分类图标（6 枚，32x32 单色线条）。

为什么需要：v1.20.25 把界面 emoji 换成了自绘图标，但漏了 `utils/travel.js` 里给
「没有真实照片的景点」生成封面时用的 COVER_GLYPH —— 那是一组 emoji（🏯🏛🏘🏞🧸🎡…），
会真的渲染进行程页封面。字形跨平台不一致（安卓可能变方块），且和旁边的单色线条图标打架。

画法沿用 `_gen-tab-icons.py` 的约定：24 单位网格 + 4x 超采样 + LANCZOS，
白色线条（封面底色是按城市哈希出来的彩色渐变，深色线条看不清）。

用法：python3 tools/dev/_gen-cover-icons.py
产物：images/icons/{pagoda,museum,temple,town,mountain,ferris}.png
"""
import os
from PIL import Image, ImageDraw

SIZE = 32
SS = 4
BIG = SIZE * SS
f = BIG / 24.0
WHITE = (255, 255, 255, 255)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "images", "icons")


def P(x, y):
    return (x * f, y * f)


def sw(u):
    return max(1, int(round(u * f)))


def canvas():
    img = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def save(img, name):
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    p = os.path.join(OUT, name + ".png")
    img.save(p)
    print("  ✓ %s (%d B)" % (os.path.basename(p), os.path.getsize(p)))


W = 1.55  # 线宽（24 网格单位）


def pagoda():
    """历史古迹：两层檐的塔（第一版底部画成两个方块像柜台，改成上下两层塔身）"""
    img, d = canvas()
    w = sw(W)
    d.line([P(12, 1.8), P(12, 3.6)], fill=WHITE, width=w)                       # 塔刹
    d.line([P(4, 6.6), P(20, 6.6)], fill=WHITE, width=w)                        # 上檐
    d.line([P(6.5, 6.6), P(12, 3.6), P(17.5, 6.6)], fill=WHITE, width=w, joint="curve")
    d.line([P(8.5, 7.4), P(8.5, 12)], fill=WHITE, width=w)                      # 上层塔身
    d.line([P(15.5, 7.4), P(15.5, 12)], fill=WHITE, width=w)
    d.line([P(5, 12), P(19, 12)], fill=WHITE, width=w)                          # 下檐
    d.line([P(7, 12.8), P(7, 17)], fill=WHITE, width=w)                         # 下层塔身
    d.line([P(17, 12.8), P(17, 17)], fill=WHITE, width=w)
    d.rectangle([P(3.5, 17), P(20.5, 21.2)], outline=WHITE, width=w)            # 台基
    d.line([P(10, 21.2), P(10, 19.2), P(12, 18.2), P(14, 19.2), P(14, 21.2)],
           fill=WHITE, width=w, joint="curve")                                  # 拱门
    return img


def museum():
    """博物馆：三角楣 + 三根柱 + 台阶"""
    img, d = canvas()
    w = sw(W)
    d.line([P(2.5, 9), P(21.5, 9)], fill=WHITE, width=w)
    d.line([P(3.5, 9), P(12, 2.5), P(20.5, 9)], fill=WHITE, width=w, joint="curve")
    for x in (6.5, 12, 17.5):
        d.line([P(x, 10.5), P(x, 18.5)], fill=WHITE, width=w)
    d.line([P(4, 19.5), P(20, 19.5)], fill=WHITE, width=w)
    d.line([P(2.5, 21.5), P(21.5, 21.5)], fill=WHITE, width=w)
    return img


def temple():
    """宗教：鸟居式牌坊（两柱 + 双横梁）"""
    img, d = canvas()
    w = sw(W)
    d.line([P(2.5, 5.5), P(21.5, 4.2)], fill=WHITE, width=w)      # 上梁略斜，像真实鸟居
    d.line([P(4.5, 10), P(19.5, 10)], fill=WHITE, width=w)
    d.line([P(6.5, 6.6), P(6.5, 21)], fill=WHITE, width=w)
    d.line([P(17.5, 6.2), P(17.5, 21)], fill=WHITE, width=w)
    d.line([P(12, 4.6), P(12, 1.8)], fill=WHITE, width=w)          # 顶部小尖
    return img


def town():
    """古镇：两栋坡顶房"""
    img, d = canvas()
    w = sw(W)
    d.line([P(1.5, 19.5), P(22.5, 19.5)], fill=WHITE, width=w)
    d.line([P(2.5, 12), P(11.5, 12)], fill=WHITE, width=w)
    d.line([P(2.5, 12), P(7, 5.5), P(11.5, 12)], fill=WHITE, width=w, joint="curve")
    d.line([P(4, 12.6), P(4, 19.2)], fill=WHITE, width=w)
    d.line([P(10, 12.6), P(10, 19.2)], fill=WHITE, width=w)
    d.line([P(12.5, 13.5), P(21.5, 13.5)], fill=WHITE, width=w)
    d.line([P(12.5, 13.5), P(17, 7.5), P(21.5, 13.5)], fill=WHITE, width=w, joint="curve")
    d.line([P(14, 14), P(14, 19.2)], fill=WHITE, width=w)
    d.line([P(20, 14), P(20, 19.2)], fill=WHITE, width=w)
    return img


def mountain():
    """自然风光：双峰（第一版加了雪线，深色底上糊在峰线里，去掉更干净）"""
    img, d = canvas()
    w = sw(W)
    d.line([P(1.5, 20), P(22.5, 20)], fill=WHITE, width=w)
    d.line([P(2.5, 19.5), P(8.5, 6.5), P(14.5, 19.5)], fill=WHITE, width=w, joint="curve")
    d.line([P(12, 19.5), P(17, 9.5), P(22, 19.5)], fill=WHITE, width=w, joint="curve")
    return img


def ferris():
    """乐园：摩天轮"""
    img, d = canvas()
    w = sw(W)
    cx, cy, r = 12, 10, 6.2
    d.ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], outline=WHITE, width=w)
    import math
    for i in range(6):
        a = math.pi / 3 * i
        d.line([P(cx, cy), P(cx + r * math.cos(a), cy + r * math.sin(a))], fill=WHITE, width=sw(1.0))
    d.ellipse([P(cx - 1, cy - 1), P(cx + 1, cy + 1)], fill=WHITE)
    d.line([P(cx, cy), P(cx - 4.5, 21)], fill=WHITE, width=w)
    d.line([P(cx, cy), P(cx + 4.5, 21)], fill=WHITE, width=w)
    d.line([P(4.5, 21), P(19.5, 21)], fill=WHITE, width=w)
    return img


def gear():
    """设置：齿轮（网页版 AI 面板的「设置」按钮用；emoji ⚙ 同样有跨平台字形问题）。

    第一版用 12 边形想省事，画出来是个六边形不像齿轮 —— 改成「圆盘 + 8 颗独立方齿」。"""
    import math
    img, d = canvas()
    w = sw(W)
    cx, cy = 12, 12
    r_disc = 7.0
    d.ellipse([P(cx - r_disc, cy - r_disc), P(cx + r_disc, cy + r_disc)], outline=WHITE, width=w)
    for i in range(8):
        a = math.pi / 4 * i
        ca, sa = math.cos(a), math.sin(a)
        # 齿：沿半径方向由 r_disc-0.6 伸到 r_disc+2.4，宽度 3.0
        half = 1.5
        ux, uy = -sa, ca                      # 切向单位向量
        p1 = P(cx + (r_disc - 0.8) * ca + half * ux, cy + (r_disc - 0.8) * sa + half * uy)
        p2 = P(cx + (r_disc + 2.4) * ca + half * ux, cy + (r_disc + 2.4) * sa + half * uy)
        p3 = P(cx + (r_disc + 2.4) * ca - half * ux, cy + (r_disc + 2.4) * sa - half * uy)
        p4 = P(cx + (r_disc - 0.8) * ca - half * ux, cy + (r_disc - 0.8) * sa - half * uy)
        d.polygon([p1, p2, p3, p4], fill=WHITE)
    d.ellipse([P(cx - 2.6, cy - 2.6), P(cx + 2.6, cy + 2.6)], outline=WHITE, width=w)
    return img


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print("生成封面分类图标：")
    for fn in (pagoda, museum, temple, town, mountain, ferris, gear):
        save(fn(), fn.__name__)
