#!/usr/bin/env python3
"""生成 32x32 的单色线条图标（供 UI 行内使用）。

⚠️ v1.20.34 起，**景点封面不再用这套图**：封面图标已独立成 96x96 的一套，见
   `tools/dev/_gen-covers.py` → `images/covers/`。原因：封面要 104rpx、图标 60rpx，
   在 pixelRatio 3.5 的设备上要撑到 ~100 物理像素，32x32 被拉伸 2.5 倍会发虚
   （用户真机报障「示意图有点小、规格和图不匹配」）。
   本脚本仍保留 —— 它产出的 32x32 图标依然是 UI 行内图标的来源（如 ai-entry / 深度页）。

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


# ══════════════════════════════════════════════════════════════════════════
# v1.20.31：封面分类图标从 11 类扩到 30 类
#
# 起因（用户真机报障）：「黄河画廊」配的是一张山峦图 —— 但它是黄河边的崖壁水蚀浮雕。
# 根因不是这张图选错，而是**颗粒度只有 11 类**，且未命中一律兜底成 mountain：
#   COVER_ICON[cat] || 'mountain'  → 任何「没登记的类别」都被画成山。
# 于是「水景/峡谷/瀑布/洞穴/草原/沙漠/城墙/桥/宫殿/街巷/演出/温泉」全变成山。
# 改法见 travel.js 的 COVER_ICON_RULES（有序关键词表，先具体后笼统），
# 兜底从 mountain 改成 pin（中性地点标记）—— 宁可给「地点」，也不要给错的山。
#
# 以下 16 枚是新增的分类图标，都沿用同一约定：24 单位网格 + 4x 超采样 + 白色线条。
# ══════════════════════════════════════════════════════════════════════════


def water():
    """江湖湖泊：三层水波（第一版只画一条，32px 下看着像一条删除线）"""
    import math
    img, d = canvas()
    w = sw(W)
    for row, y in enumerate((8.5, 13.0, 17.5)):
        pts = []
        for i in range(25):
            x = 1.5 + i * 21.0 / 24.0
            pts.append(P(x, y + 1.1 * math.sin(i / 24.0 * math.pi * 3 + row * 0.7)))
        d.line(pts, fill=WHITE, width=w, joint="curve")
    return img


def waterfall():
    """瀑布：崖顶 + 两道**波状**水帘 + 底潭

    前两版都不对：第一版水柱短、底部大弧 → 像「U 形桶」；第二版两条笔直竖线 →
    像「H 形架子」。笔直的线没有「水在流」的意思，改成垂直正弦波 + 底潭弧。"""
    import math
    img, d = canvas()
    w = sw(W)
    d.line([P(2.5, 4.5), P(21.5, 4.5)], fill=WHITE, width=w)          # 崖顶
    for cx in (9.2, 14.8):
        pts = []
        for i in range(17):
            t = i / 16.0
            pts.append(P(cx + 1.0 * math.sin(t * math.pi * 4), 5.2 + t * 10.6))
        d.line(pts, fill=WHITE, width=w, joint="curve")                # 水帘
    d.arc([P(5.5, 13.5), P(18.5, 21.5)], 0, 180, fill=WHITE, width=w)  # 底潭
    return img


def canyon():
    """峡谷崖壁：两侧锯齿石壁夹出一线天（河边的崖壁画廊用这个）

    中间那条缝**故意留白**：第一版拿两条细竖线去「画」缝，32px 下看成了两片荆棘。"""
    img, d = canvas()
    w = sw(W)
    d.line([P(1.5, 21), P(3.8, 11), P(6.2, 15), P(7.8, 6.5), P(9.8, 21)],
           fill=WHITE, width=w, joint="curve")
    d.line([P(22.5, 21), P(20.2, 11), P(17.8, 15), P(16.2, 6.5), P(14.2, 21)],
           fill=WHITE, width=w, joint="curve")
    return img


def cave():
    """溶洞：山体轮廓 + 拱门

    第一版门洞只用一段半圆弧，弧顶被山脊压住，看着像山体上的「笑脸」。
    改成「半圆拱 + 两条竖边」的完整门框。"""
    img, d = canvas()
    w = sw(W)
    d.line([P(1.5, 21), P(6.5, 8), P(12, 13.5), P(17.5, 8), P(22.5, 21)],
           fill=WHITE, width=w, joint="curve")
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=w)
    d.arc([P(7.4, 13.2), P(16.6, 22)], 180, 360, fill=WHITE, width=w)   # 拱
    d.line([P(7.4, 17.6), P(7.4, 21)], fill=WHITE, width=w)             # 门框左
    d.line([P(16.6, 17.6), P(16.6, 21)], fill=WHITE, width=w)           # 门框右
    return img


def grass():
    """草原：地平线 + 三丛草叶"""
    img, d = canvas()
    w = sw(W)
    d.line([P(2, 19.5), P(22, 19.5)], fill=WHITE, width=w)
    for cx in (6.5, 12, 17.5):
        d.line([P(cx, 19.2), P(cx - 2.4, 13.5)], fill=WHITE, width=sw(1.2))
        d.line([P(cx, 19.2), P(cx, 11.5)], fill=WHITE, width=sw(1.2))
        d.line([P(cx, 19.2), P(cx + 2.4, 13.5)], fill=WHITE, width=sw(1.2))
    return img


def desert():
    """沙漠：两座沙丘 + 落日"""
    img, d = canvas()
    w = sw(W)
    d.line([P(2, 20.5), P(7.5, 13), P(13, 20.5)], fill=WHITE, width=w, joint="curve")
    d.line([P(10.5, 20.5), P(16.5, 14), P(22, 20.5)], fill=WHITE, width=w, joint="curve")
    d.line([P(2, 20.5), P(22, 20.5)], fill=WHITE, width=w)
    d.ellipse([P(15.0, 4.2), P(19.8, 9.0)], outline=WHITE, width=w)   # 太阳
    return img


def island():
    """海岛：扁平岛体 + 水面 + 棕榈

    第一版树干太短、叶子挤成一圈，32px 下像一把伞。改成：岛体压扁成地平线、
    树干拉长到 8 格、四片叶子向外斜出（一眼能认出是树 + 岛）。"""
    img, d = canvas()
    w = sw(W)
    d.arc([P(2.5, 9.5), P(21.5, 24)], 180, 360, fill=WHITE, width=w)   # 岛体（扁弧）
    d.line([P(1.5, 18), P(22.5, 18)], fill=WHITE, width=sw(1.0))       # 水面
    d.line([P(13, 17.4), P(11.6, 7.4)], fill=WHITE, width=w)           # 树干（略斜）
    for dx, dy in ((-6.4, -1.6), (-4.6, -4.6), (-1.6, -6.2),
                   (1.6, -6.2), (4.6, -4.6), (6.4, -1.6)):
        d.line([P(11.6, 7.4), P(11.6 + dx, 7.4 + dy)], fill=WHITE, width=sw(1.2))
    return img


def garden():
    """园林公园：三丛灌木 + 地面

    第一版画「椭圆树冠 + 树干 + 两条侧枝」，32px 下整体像一枚路牌/图钉。
    改成三团半圆灌木压在一条地平线上 —— 与 town（坡顶房）、mountain（双峰）
    在轮廓上互不混淆。"""
    img, d = canvas()
    w = sw(W)
    for cx, r in ((6.4, 3.4), (12, 4.4), (17.6, 3.4)):
        d.arc([P(cx - r, 12.2 - r * 0.2), P(cx + r, 18)], 180, 360, fill=WHITE, width=w)
        d.line([P(cx - r, 18), P(cx + r, 18)], fill=WHITE, width=w)
    d.line([P(2, 19.6), P(22, 19.6)], fill=WHITE, width=w)             # 地面
    return img


def flower():
    """赏花：五瓣花 + 花心"""
    import math
    img, d = canvas()
    w = sw(W)
    cx, cy, r = 12, 10.5, 3.6
    for i in range(5):
        a = math.pi * 2 / 5 * i - math.pi / 2
        px, py = cx + r * math.cos(a), cy + r * math.sin(a)
        d.ellipse([P(px - 2.9, py - 2.9), P(px + 2.9, py + 2.9)], outline=WHITE, width=sw(1.3))
    d.ellipse([P(cx - 1.5, cy - 1.5), P(cx + 1.5, cy + 1.5)], fill=WHITE)
    d.line([P(cx, 14), P(cx, 21)], fill=WHITE, width=w)                # 花茎
    return img


def wall():
    """城墙关隘：垛口 + 城门"""
    img, d = canvas()
    w = sw(W)
    # 垛口（上方锯齿）
    pts = [P(2.5, 10)]
    for i in range(6):
        x = 2.5 + i * 19.0 / 6
        pts.append(P(x, 5.5))
        pts.append(P(x + 19.0 / 12, 5.5))
        pts.append(P(x + 19.0 / 12, 10))
    d.line(pts, fill=WHITE, width=w)
    d.line([P(2.5, 10), P(2.5, 20)], fill=WHITE, width=w)
    d.line([P(21.5, 10), P(21.5, 20)], fill=WHITE, width=w)
    d.line([P(2.5, 20), P(21.5, 20)], fill=WHITE, width=w)
    d.arc([P(9, 14.6), P(15, 21.4)], 180, 360, fill=WHITE, width=w)     # 城门
    d.line([P(9, 18), P(9, 20)], fill=WHITE, width=w)
    d.line([P(15, 18), P(15, 20)], fill=WHITE, width=w)
    return img


def bridge():
    """桥：高拱 + 桥面 + 栏杆 + 水面

    第一版拱太扁、桥面紧贴拱顶，32px 下像一只碗。改成高半圆拱 + 上抬的栏杆。"""
    img, d = canvas()
    w = sw(W)
    d.arc([P(3.5, 8), P(20.5, 25)], 180, 360, fill=WHITE, width=w)     # 桥拱
    d.line([P(1.5, 13.5), P(22.5, 13.5)], fill=WHITE, width=w)         # 桥面
    d.line([P(4.5, 10), P(19.5, 10)], fill=WHITE, width=sw(1.1))       # 栏杆
    d.line([P(5.5, 13.5), P(5.5, 10)], fill=WHITE, width=sw(1.1))
    d.line([P(18.5, 13.5), P(18.5, 10)], fill=WHITE, width=sw(1.1))
    d.line([P(2, 21.5), P(22, 21.5)], fill=WHITE, width=sw(1.0))       # 水面
    return img


def palace():
    """宫殿府邸：大坡顶 + 檐口（两端上翘）+ 三柱 + 台基

    第一版的正脊是纯横线、屋面没画，32px 下像个「井架」。
    改成明确的大三角屋面 —— 与 pagoda（多层檐塔）区分得开。"""
    img, d = canvas()
    w = sw(W)
    d.line([P(1.6, 10.2), P(22.4, 10.2)], fill=WHITE, width=w)          # 檐口
    d.line([P(1.6, 10.2), P(4.4, 7.6)], fill=WHITE, width=w)            # 飞檐上翘
    d.line([P(22.4, 10.2), P(19.6, 7.6)], fill=WHITE, width=w)
    d.line([P(4.6, 10.2), P(12, 3.2), P(19.4, 10.2)],
           fill=WHITE, width=w, joint="curve")                          # 屋面
    for x in (6.6, 12, 17.4):
        d.line([P(x, 10.8), P(x, 17.2)], fill=WHITE, width=w)           # 柱
    d.line([P(3.2, 18), P(20.8, 18)], fill=WHITE, width=w)              # 台基
    d.line([P(2.2, 20.6), P(21.8, 20.6)], fill=WHITE, width=w)
    return img


def street():
    """街巷：两侧门面夹一条透视小路"""
    img, d = canvas()
    w = sw(W)
    d.rectangle([P(2, 7.5), P(8.5, 20)], outline=WHITE, width=w)       # 左门面
    d.rectangle([P(15.5, 7.5), P(22, 20)], outline=WHITE, width=w)     # 右门面
    d.line([P(2, 12), P(8.5, 12)], fill=WHITE, width=sw(1.0))          # 窗
    d.line([P(15.5, 12), P(22, 12)], fill=WHITE, width=sw(1.0))
    d.line([P(8.5, 20), P(10.6, 9.5)], fill=WHITE, width=w)            # 路面透视
    d.line([P(15.5, 20), P(13.4, 9.5)], fill=WHITE, width=w)
    d.line([P(10.6, 9.5), P(13.4, 9.5)], fill=WHITE, width=w)
    return img


def show():
    """演出剧场：横梁 + 两片垂幕 + 追光

    第一版幕布画成弧形、又把台面连起来，32px 下成一个「桶」。
    改成两片垂直落下的幕布 + 中间一颗追光点。"""
    img, d = canvas()
    w = sw(W)
    d.line([P(2, 4.2), P(22, 4.2)], fill=WHITE, width=w)               # 横梁
    d.line([P(4.8, 4.2), P(4.8, 18)], fill=WHITE, width=w)             # 左幕
    d.line([P(19.2, 4.2), P(19.2, 18)], fill=WHITE, width=w)           # 右幕
    d.line([P(4.8, 18), P(19.2, 18)], fill=WHITE, width=sw(1.0))       # 台面
    d.line([P(9, 4.2), P(9, 9.5)], fill=WHITE, width=sw(1.0))          # 幕褶
    d.line([P(15, 4.2), P(15, 9.5)], fill=WHITE, width=sw(1.0))
    d.ellipse([P(10.4, 11), P(13.6, 14.2)], fill=WHITE)                # 追光
    return img


def hotspring():
    """温泉：汤池 + 升起的热气"""
    img, d = canvas()
    w = sw(W)
    d.arc([P(3.5, 11), P(20.5, 24)], 0, 180, fill=WHITE, width=w)      # 池
    d.line([P(2.5, 18), P(21.5, 18)], fill=WHITE, width=w)             # 水面
    import math
    for cx, h in ((8, 6.4), (12, 8.0), (16, 6.4)):
        pts = []
        for i in range(15):
            t = i / 14.0
            pts.append(P(cx + 1.5 * math.sin(t * math.pi * 2), 16.5 - t * h))
        d.line(pts, fill=WHITE, width=sw(1.2), joint="curve")
    return img


def paw():
    """动物园：兽掌印"""
    img, d = canvas()
    w = sw(W)
    d.ellipse([P(7.6, 12.6), P(16.4, 21.2)], outline=WHITE, width=w)   # 掌
    for cx, cy, rx, ry in ((5.4, 8.6, 1.9, 2.4), (9.4, 5.4, 1.9, 2.5),
                           (14.6, 5.4, 1.9, 2.5), (18.6, 8.6, 1.9, 2.4)):
        d.ellipse([P(cx - rx, cy - ry), P(cx + rx, cy + ry)], outline=WHITE, width=w)
    return img


def snowmtn():
    """高原雪山：双峰 + **实心雪帽**

    雪帽必须用实心填充 —— 第一版用短折线勾雪线，32px 下与 mountain 几乎分辨不出。
    实心白三角在缩略图里是「山尖发白」，一眼能和普通山峦区分开。"""
    img, d = canvas()
    w = sw(W)
    d.line([P(1.5, 20.5), P(22.5, 20.5)], fill=WHITE, width=w)
    d.line([P(2.5, 20), P(8.5, 4.6), P(14.5, 20)], fill=WHITE, width=w, joint="curve")
    d.line([P(12, 20), P(17, 10.2), P(22, 20)], fill=WHITE, width=w, joint="curve")
    d.polygon([P(6.1, 11.2), P(8.5, 4.6), P(10.9, 11.2)], fill=WHITE)      # 主峰雪帽
    d.polygon([P(15.6, 14.0), P(17, 10.2), P(18.4, 14.0)], fill=WHITE)      # 副峰雪帽
    return img


def flag():
    """红色景点 / 纪念地：旗杆 + 飘扬旗面（沿用「旧址/会址/烈士」这类语义）"""
    import math
    img, d = canvas()
    w = sw(W)
    d.line([P(5.5, 3.5), P(5.5, 21)], fill=WHITE, width=w)             # 旗杆
    pts = [P(5.5, 5)]
    for i in range(9):                                                  # 旗面上缘（波浪）
        t = i / 8.0
        pts.append(P(5.5 + t * 13.5, 5 + 0.9 * math.sin(t * math.pi * 2)))
    for i in range(9):                                                  # 旗面下缘（反向）
        t = 1 - i / 8.0
        pts.append(P(5.5 + t * 13.5, 13 + 0.9 * math.sin(t * math.pi * 2)))
    d.line(pts, fill=WHITE, width=w, joint="curve")
    return img


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print("生成封面分类图标：")
    for fn in (pagoda, museum, temple, town, mountain, ferris, gear,
               water, waterfall, canyon, cave, grass, desert, island, garden,
               flower, wall, bridge, palace, street, show, hotspring, paw,
               snowmtn, flag):
        save(fn(), fn.__name__)
