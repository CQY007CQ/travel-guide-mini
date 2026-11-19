#!/usr/bin/env python3
"""生成景点封面用的分类图标（images/covers/，96x96 单色线条）。

为什么单独一套（与 images/icons/ 的 32x32 并存）：
  v1.20.34 真机实测 —— 行程页封面 96rpx、图标 48rpx，在 pixelRatio=3.5 的设备上
  图标要占 **80 物理像素**，而源图只有 32x32，等于被拉伸 2.5 倍：线条发虚、边缘糊。
  搜索页 132rpx 封面里的 60rpx 图标同样要 100 物理像素。
  这些小图标本来是给列表行内 32rpx 场景画的，**规格与封面这个用法不匹配**。
  故把封面单独拆出一套 96x96（覆盖 56rpx→96 物理像素，留余量也支持后续再放大），
  images/icons/ 保持原样给其他 UI 用。

画法沿用 _gen-cover-icons.py / _gen-tab-icons.py 的约定：
  24 单位网格 + 4x 超采样 + LANCZOS，白色线条（封面底色是按类别+城市哈希出来的彩色渐变，
  深色线条看不清）。

类别覆盖：v1.20.33 的 30 类 → 本版 51 类。新增的都是「语料里大量存在、但原先被迫落到
泛化类别或 pin」的：湖泊 / 江河 / 梯田 / 冰川 / 湿地 / 火山 / 森林 / 造像 / 遗址 / 土楼 /
大坝 / 公路 / 现代塔 / 校园 / 市集 / 水族馆 / 滑雪 / 露营 / 观景 / 徒步 / 美食 / 住宿 / 交通。
判据见 utils/travel.js 的 COVER_ICON_RULES（有序表）与 _test-cover.mjs。

用法：python3 tools/dev/_gen-covers.py
产物：images/covers/{name}.png（96x96 RGBA）
"""
import math
import os

from PIL import Image, ImageDraw

SIZE = 96
SS = 4                       # 超采样倍数（384x384 画完再 LANCZOS 缩到 96）
BIG = SIZE * SS
f = BIG / 24.0               # 24 单位网格 → 像素
WHITE = (255, 255, 255, 255)
W = 1.55                     # 线宽（24 网格单位）—— 与 icons/ 那套一致，缩放后视觉比例相同

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "images", "covers")


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
    # optimize + 调色板量化：单色线条 + 透明底，PNG8 视觉无损，体积约为 RGBA 的 1/3
    q = img.quantize(colors=32, method=Image.FASTOCTREE)
    q.save(p, optimize=True)
    return os.path.getsize(p)


def wave(d, y, x0, x1, amp=0.6, n=9):
    """一道水波纹（sin 曲线），y 为中心线"""
    pts = []
    for i in range(n + 1):
        t = i / float(n)
        pts.append(P(x0 + t * (x1 - x0), y + amp * math.sin(t * math.pi * 2)))
    d.line(pts, fill=WHITE, width=sw(W * 0.8), joint="curve")


# ─────────────────────────── 自然 / 地貌 ───────────────────────────

def mountain():
    """山：双峰 + 地平线"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 20), P(22.5, 20)], fill=WHITE, width=w)
    d.line([P(2.5, 19.5), P(8.5, 6.5), P(14.5, 19.5)], fill=WHITE, width=w, joint="curve")
    d.line([P(12, 19.5), P(17, 9.5), P(22, 19.5)], fill=WHITE, width=w, joint="curve")
    return img


def lake():
    """湖泊：扁椭圆水面 + 两道波纹（与 river 区分：湖是封闭水面）"""
    img, d = canvas(); w = sw(W)
    d.ellipse([P(2.2, 8.5), P(21.8, 19.5)], outline=WHITE, width=w)
    d.line([P(7, 13.2), P(11, 13.2)], fill=WHITE, width=sw(W * 0.8))
    d.line([P(13.5, 13.2), P(17.5, 13.2)], fill=WHITE, width=sw(W * 0.8))
    d.line([P(9, 16.4), P(15, 16.4)], fill=WHITE, width=sw(W * 0.8))
    return img


def river():
    """江河：两条 S 形岸线 + 中间水流短线"""
    img, d = canvas(); w = sw(W)
    d.line([P(7.5, 21.5), P(9.6, 16.5), P(6.6, 11.5), P(9.2, 6.5), P(8.4, 2.5)],
           fill=WHITE, width=w, joint="curve")
    d.line([P(16.5, 21.5), P(14.4, 16.5), P(17.4, 11.5), P(14.8, 6.5), P(15.6, 2.5)],
           fill=WHITE, width=w, joint="curve")
    d.line([P(11, 18), P(13, 18)], fill=WHITE, width=sw(W * 0.7))
    d.line([P(11, 13.5), P(13, 13.5)], fill=WHITE, width=sw(W * 0.7))
    d.line([P(11, 9), P(13, 9)], fill=WHITE, width=sw(W * 0.7))
    return img


def water():
    """江湖湖泊：三层水波（第一版只画一条，32px 下看着像一条删除线）"""
    img, d = canvas()
    for i, y in enumerate((10.5, 14.5, 18.5)):
        amp = 0.9 if i < 2 else 0.7
        wave(d, y, 2.5, 21.5, amp=amp)
    return img


def waterfall():
    """瀑布：上崖横线 + 两股下垂水帘 + 底部水潭波纹"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 5.5), P(22.5, 5.5)], fill=WHITE, width=w)
    d.line([P(8.6, 5.5), P(8.6, 17.5)], fill=WHITE, width=w)
    d.line([P(15.4, 5.5), P(15.4, 17.5)], fill=WHITE, width=w)
    d.line([P(11, 8.5), P(11, 15)], fill=WHITE, width=sw(W * 0.7))
    d.line([P(13, 8.5), P(13, 15)], fill=WHITE, width=sw(W * 0.7))
    wave(d, 19.5, 5, 19, amp=0.7)
    return img


def canyon():
    """峡谷：两侧崖壁 + V 形谷底 + 谷底水系
    （第一版画成两片立墙 + 顶盖，96px 下看像字母 H。改成剖面视角：崖壁在两侧、
      谷底收成 V，底部一道水线 —— 这才是峡谷的典型形态）"""
    img, d = canvas(); w = sw(W)
    d.line([P(2, 20.5), P(3.4, 4.5), P(7.4, 4.5)], fill=WHITE, width=w, joint="curve")
    d.line([P(22, 20.5), P(20.6, 4.5), P(16.6, 4.5)], fill=WHITE, width=w, joint="curve")
    d.line([P(7.4, 4.5), P(9.8, 14.5), P(12, 20.5), P(14.2, 14.5), P(16.6, 4.5)],
           fill=WHITE, width=w, joint="curve")
    d.line([P(9.6, 20.5), P(14.4, 20.5)], fill=WHITE, width=sw(W * 0.8))
    return img


def cave():
    """洞穴：山体轮廓 + 洞门 + 洞内两道进深线（只有门框时像房子，加进深才读成「洞」）"""
    img, d = canvas(); w = sw(W)
    d.line([P(2, 21), P(2.6, 12), P(7, 5.5), P(12, 2.5), P(17, 5.5), P(21.4, 12), P(22, 21)],
           fill=WHITE, width=w, joint="curve")
    d.line([P(7.6, 21), P(7.6, 15.5), P(12, 12.2), P(16.4, 15.5), P(16.4, 21)],
           fill=WHITE, width=w, joint="curve")
    d.line([P(9.4, 21), P(9.4, 17), P(12, 14.8), P(14.6, 17), P(14.6, 21)],
           fill=WHITE, width=sw(W * 0.6), joint="curve")
    return img


def desert():
    """沙漠：沙丘起伏 + 太阳（32px 下两条弧线能看出是沙丘）"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=w)
    d.line([P(1.5, 18), P(5, 12.5), P(9, 16), P(13, 11), P(18, 16.5), P(22.5, 13)],
           fill=WHITE, width=w, joint="curve")
    d.arc([P(15.6, 2), P(21.6, 8)], 0, 360, fill=WHITE, width=sw(W * 0.8))
    return img


def grass():
    """草原：起伏地平线 + 三丛草"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=w)
    d.line([P(1.5, 17), P(6, 13.5), P(12, 16.5), P(18, 13), P(22.5, 16.5)],
           fill=WHITE, width=w, joint="curve")
    for x in (6.5, 12, 17.5):
        d.line([P(x, 19.4), P(x, 15.4)], fill=WHITE, width=sw(W * 0.75))
        d.line([P(x, 17.6), P(x - 1.4, 16.2)], fill=WHITE, width=sw(W * 0.6))
        d.line([P(x, 18.2), P(x + 1.4, 16.8)], fill=WHITE, width=sw(W * 0.6))
    return img


def terrace():
    """梯田：四层台地 + 两端田埂短竖线
    （第一版只有四道弧线，与 water 的三道波纹几乎同形 —— 96px 下会认错。
      补上每层两端的短竖线当作「田埂断面」，阶梯感立刻出来）"""
    img, d = canvas(); w = sw(W)
    bands = [(3.5, 6.5, 20.5, 9.8), (2.6, 10.4, 21.4, 13.7),
             (1.8, 14.3, 22.2, 17.6), (1.2, 18.2, 22.8, 21.5)]
    for x0, y0, x1, y1 in bands:
        pts = []
        for i in range(9):
            t = i / 8.0
            pts.append(P(x0 + t * (x1 - x0), (y0 + y1) / 2 + math.sin(t * math.pi) * 1.0))
        d.line(pts, fill=WHITE, width=w, joint="curve")
        # 田埂：每层左端一道短竖线，右端一道短竖线（把「层」画出来）
        d.line([P(x0 + 0.7, (y0 + y1) / 2), P(x0 + 0.7, y1)], fill=WHITE, width=sw(W * 0.75))
        d.line([P(x1 - 0.7, (y0 + y1) / 2), P(x1 - 0.7, y1)], fill=WHITE, width=sw(W * 0.75))
    return img


def glacier():
    """冰川：冰峰轮廓 + 竖向冰裂隙 + 底部冰面与浮冰
    （第一版下方画成三个 ×，96px 下像「打叉」。裂隙改为竖向折线，不再是交叉）"""
    img, d = canvas(); w = sw(W)
    d.line([P(2.5, 12.5), P(7.5, 3), P(12, 8.5), P(16, 4), P(21.5, 12.5)],
           fill=WHITE, width=w, joint="curve")
    d.line([P(2.5, 12.5), P(21.5, 12.5)], fill=WHITE, width=w)
    d.line([P(6.4, 12.5), P(7.6, 16.5), P(6.8, 20.5)], fill=WHITE, width=sw(W * 0.8), joint="curve")
    d.line([P(11.4, 12.5), P(12.4, 17), P(11.6, 20.5)], fill=WHITE, width=sw(W * 0.8), joint="curve")
    d.line([P(16.4, 12.5), P(15.4, 16.5), P(16.2, 20.5)], fill=WHITE, width=sw(W * 0.8), joint="curve")
    d.line([P(2.5, 20.5), P(21.5, 20.5)], fill=WHITE, width=w)
    d.line([P(3.4, 17.4), P(6, 17.4)], fill=WHITE, width=sw(W * 0.6))
    d.line([P(18.4, 18.4), P(21, 18.4)], fill=WHITE, width=sw(W * 0.6))
    return img


def snowmtn():
    """雪山：峰顶实心雪帽 + 山体
    （雪帽必须填充：短折线在 96px 下和 mountain 分不清。v1.20.34 把雪帽从 10 拉到 12.4，
      原先只盖住峰尖一小块，缩到 56rpx 显示时几乎看不见）"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 20.5), P(22.5, 20.5)], fill=WHITE, width=w)
    d.line([P(2.5, 20), P(11.5, 3.5), P(20.5, 20)], fill=WHITE, width=w, joint="curve")
    d.polygon([P(11.5, 3.5), P(11.5, 12.4), P(5.2, 12.4), P(8.4, 7.4)], fill=WHITE)
    d.polygon([P(11.5, 3.5), P(17.8, 12.4), P(11.5, 12.4)], fill=WHITE)
    return img


def volcano():
    """火山：截顶锥 + 顶部两缕烟"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 20.5), P(22.5, 20.5)], fill=WHITE, width=w)
    d.line([P(9, 8), P(3.5, 20), P(20.5, 20), P(15, 8)], fill=WHITE, width=w, joint="curve")
    d.line([P(9, 8), P(15, 8)], fill=WHITE, width=w)
    for dx in (0, 2.4):
        pts = []
        for i in range(6):
            t = i / 5.0
            pts.append(P(10.6 + dx + 1.9 * math.sin(t * math.pi * 1.6), 6.4 - t * 5.2))
        d.line(pts, fill=WHITE, width=sw(W * 0.75), joint="curve")
    return img


def wetland():
    """湿地：水面 + 三丛芦苇"""
    img, d = canvas(); w = sw(W)
    wave(d, 19.5, 1.8, 22.2, amp=0.7)
    wave(d, 15.8, 4, 20, amp=0.5)
    for x, h in ((6, 7.5), (10.5, 10), (15, 6)):
        d.line([P(x, 14), P(x, 14 - h)], fill=WHITE, width=sw(W * 0.8))
        d.line([P(x, 14 - h + 1.2), P(x - 1.2, 14 - h - 0.6)], fill=WHITE, width=sw(W * 0.55))
        d.line([P(x, 14 - h + 2.6), P(x + 1.2, 14 - h + 0.8)], fill=WHITE, width=sw(W * 0.55))
    return img


def forest():
    """森林：三棵针叶树（高低错落）+ 地平线"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=w)
    for cx, top, base in ((5.5, 6.5, 17), (12, 3, 19), (18.5, 7.5, 17)):
        d.line([P(cx, top), P(cx - 3.2, top + 5.4), P(cx + 3.2, top + 5.4), P(cx, top)],
               fill=WHITE, width=w, joint="curve")
        d.line([P(cx, top + 3.2), P(cx - 4.2, top + 9.6), P(cx + 4.2, top + 9.6), P(cx, top + 3.2)],
               fill=WHITE, width=w, joint="curve")
        d.line([P(cx, top + 9.6), P(cx, base)], fill=WHITE, width=sw(W * 0.85))
    return img


def island():
    """海岛：压扁的地平线 + 岛体 + 棕榈（树干太短会像伞，故拉长）"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 17.5), P(22.5, 17.5)], fill=WHITE, width=w)
    d.line([P(3.5, 20.5), P(8, 17.2), P(16, 17.2), P(20.5, 20.5)], fill=WHITE, width=w, joint="curve")
    d.line([P(11.6, 17), P(12.4, 12.4)], fill=WHITE, width=w)
    for a in (-2.95, -2.0, -1.15, -0.2):
        x2 = 12.4 + 4.4 * math.cos(a)
        y2 = 12.4 + 4.4 * math.sin(a) - 1.4
        d.line([P(12.4, 12.4), P(x2, max(5.6, y2))], fill=WHITE, width=sw(W * 0.8))
    return img


def umbrella():
    """海滩：遮阳伞 + 沙滩线"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 20), P(22.5, 20)], fill=WHITE, width=w)
    d.arc([P(3.2, 6), P(20.8, 17)], 180, 360, fill=WHITE, width=w)
    d.line([P(3.2, 11.5), P(20.8, 11.5)], fill=WHITE, width=w)
    d.line([P(12, 11.5), P(12, 20)], fill=WHITE, width=sw(W * 0.9))
    d.line([P(7.4, 7.6), P(9.6, 11.5)], fill=WHITE, width=sw(W * 0.7))
    d.line([P(16.6, 7.6), P(14.4, 11.5)], fill=WHITE, width=sw(W * 0.7))
    wave(d, 22, 15, 22, amp=0.4, n=6)
    return img


def hotspring():
    """温泉：池沿 + 三缕蒸汽"""
    img, d = canvas(); w = sw(W)
    d.line([P(2.5, 14.5), P(6, 20.5), P(18, 20.5), P(21.5, 14.5)], fill=WHITE, width=w, joint="curve")
    d.line([P(2.5, 14.5), P(21.5, 14.5)], fill=WHITE, width=w)
    d.line([P(9.5, 20), P(14.5, 20)], fill=WHITE, width=sw(W * 0.7))
    for dx in (0, 4.6, 9.2):
        pts = []
        for i in range(6):
            t = i / 5.0
            pts.append(P(7 + dx + 1.5 * math.sin(t * math.pi * 1.7), 12.4 - t * 8.4))
        d.line(pts, fill=WHITE, width=sw(W * 0.75), joint="curve")
    return img


def flower():
    """花海：三朵小花 + 地平线"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=w)
    for cx, cy, r in ((6.5, 12, 2.2), (12.5, 8, 2.6), (18, 13, 2.0)):
        for k in range(5):
            a = math.pi * 2 / 5 * k - math.pi / 2
            d.ellipse([P(cx + r * math.cos(a) - 1.3, cy + r * math.sin(a) - 1.3),
                       P(cx + r * math.cos(a) + 1.3, cy + r * math.sin(a) + 1.3)],
                      outline=WHITE, width=sw(W * 0.6))
        d.line([P(cx, cy + r + 0.8), P(cx, 20.6)], fill=WHITE, width=sw(W * 0.7))
        if cy > 10:
            d.line([P(cx, cy + r + 3.2), P(cx + 1.8, cy + r + 1.8)], fill=WHITE, width=sw(W * 0.55))
    return img


def garden():
    """园林：月亮门 + 两侧围墙 + 竹子"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=w)
    d.line([P(2, 21), P(2, 8.5), P(7.5, 8.5)], fill=WHITE, width=w, joint="curve")
    d.line([P(22, 21), P(22, 8.5), P(16.5, 8.5)], fill=WHITE, width=w, joint="curve")
    d.arc([P(7.5, 8.5), P(16.5, 17.5)], 180, 360, fill=WHITE, width=w)
    d.line([P(7.5, 13), P(7.5, 21)], fill=WHITE, width=w)
    d.line([P(16.5, 13), P(16.5, 21)], fill=WHITE, width=w)
    return img


# ─────────────────────────── 人文 / 建筑 ───────────────────────────

def palace():
    """宫殿：重檐屋顶 + 三间门洞 + 台基"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 9.4), P(22.5, 9.4)], fill=WHITE, width=w)
    d.line([P(4, 9.4), P(12, 4), P(20, 9.4)], fill=WHITE, width=w, joint="curve")
    d.line([P(4.6, 5.4), P(12, 1.4), P(19.4, 5.4)], fill=WHITE, width=sw(W * 0.85), joint="curve")
    d.line([P(3, 13.4), P(21, 13.4)], fill=WHITE, width=w)
    for x in (6.2, 12, 17.8):
        d.line([P(x, 13.8), P(x, 19.5)], fill=WHITE, width=w)
    d.line([P(2, 20.5), P(22, 20.5)], fill=WHITE, width=w)
    return img


def temple():
    """宗教：带檐的庙门 / 牌坊（小屋顶 + 通长横枋 + 双柱 + 居中宝顶）

    v1.20.38 真机报障「这个标为什么是歪着的」—— 旧写法有三处不对称，
    单看每处都像「透视」，缩到 56rpx 显示时全被读成**手抖画歪**：
      ① 主梁 P(2.5,5.5)→P(21.5,4.2)：左低右高，斜率 -1.3/19 ≈ **-3.9°**（主因）
      ② 两柱顶起点不等高：左 6.6 / 右 6.2（柱长不一致）
      ③ 宝顶落在斜梁上，视觉重心偏右
    顺带一个更根上的问题：纯平视的鸟居 = 一根通长横 + 两根竖，在 56rpx 上读起来
    就是汉字「开/亓」，不像建筑。故改画**带檐的庙门**：屋顶给出「上面是房子」的暗示，
    与 palace（重檐 + 三开间 + 台基）、pagoda（两层檐 + 塔刹）在轮廓上都能分开。

    全程以 x=12 为轴镜像对称；实测 40px 缩略仍可辨（加第二道横枋会糊成一团，已放弃）。
    护栏 _test-cover.mjs「庙门左右镜像对称 + 主梁水平」直接读像素，改歪立刻判红。
    """
    img, d = canvas(); w = sw(W)
    d.line([P(3.6, 7.6), P(12, 3.6), P(20.4, 7.6)], fill=WHITE, width=w, joint="curve")  # 屋面：宽度接近横枋，才像「有顶的门」而不是一张桌子
    d.line([P(2.2, 8.8), P(21.8, 8.8)], fill=WHITE, width=w)   # 通长横枋（水平，两端出挑 3.2）
    d.line([P(5.4, 8.8), P(5.4, 21)], fill=WHITE, width=w)     # 左柱
    d.line([P(18.6, 8.8), P(18.6, 21)], fill=WHITE, width=w)   # 右柱（与左柱等高）
    d.line([P(12, 3.6), P(12, 1.4)], fill=WHITE, width=w)      # 宝顶：居中
    return img


def pagoda():
    """历史古迹：两层檐的塔"""
    img, d = canvas(); w = sw(W)
    d.line([P(12, 1.8), P(12, 3.6)], fill=WHITE, width=w)
    d.line([P(4, 6.6), P(20, 6.6)], fill=WHITE, width=w)
    d.line([P(6.5, 6.6), P(12, 3.6), P(17.5, 6.6)], fill=WHITE, width=w, joint="curve")
    d.line([P(8.5, 7.4), P(8.5, 12)], fill=WHITE, width=w)
    d.line([P(15.5, 7.4), P(15.5, 12)], fill=WHITE, width=w)
    d.line([P(5, 12), P(19, 12)], fill=WHITE, width=w)
    d.line([P(7, 12.8), P(7, 17)], fill=WHITE, width=w)
    d.line([P(17, 12.8), P(17, 17)], fill=WHITE, width=w)
    d.rectangle([P(3.5, 17), P(20.5, 21.2)], outline=WHITE, width=w)
    d.line([P(10, 21.2), P(10, 19.2), P(12, 18.2), P(14, 19.2), P(14, 21.2)],
           fill=WHITE, width=w, joint="curve")
    return img


def wall():
    """城墙：垛口 + 墙体 + 拱门"""
    img, d = canvas(); w = sw(W)
    d.line([P(2, 21), P(2, 9), P(22, 9), P(22, 21)], fill=WHITE, width=w, joint="curve")
    for x in (3.4, 7.6, 11.8, 16, 20.2):
        d.line([P(x, 9), P(x, 5.5), P(x + 2.4, 5.5), P(x + 2.4, 9)], fill=WHITE, width=sw(W * 0.85), joint="curve")
    d.line([P(8.4, 21), P(8.4, 15.2), P(12, 12.6), P(15.6, 15.2), P(15.6, 21)],
           fill=WHITE, width=w, joint="curve")
    return img


def bridge():
    """桥：半圆拱 + 桥面 + 栏杆（拱太扁会像碗，故用高半圆拱）"""
    img, d = canvas(); w = sw(W)
    d.arc([P(2.5, 6.5), P(21.5, 20)], 180, 360, fill=WHITE, width=w)
    d.line([P(2.5, 13.2), P(21.5, 13.2)], fill=WHITE, width=w)
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=sw(W * 0.85))
    d.line([P(3.4, 9.6), P(20.6, 9.6)], fill=WHITE, width=sw(W * 0.7))
    for x in (5.6, 9.2, 12.8, 16.4, 20):
        d.line([P(x, 9.6), P(x, 13.2)], fill=WHITE, width=sw(W * 0.85))
    return img


def museum():
    """博物馆：三角楣 + 三根柱 + 台阶"""
    img, d = canvas(); w = sw(W)
    d.line([P(2.5, 9), P(21.5, 9)], fill=WHITE, width=w)
    d.line([P(3.5, 9), P(12, 2.5), P(20.5, 9)], fill=WHITE, width=w, joint="curve")
    for x in (6.5, 12, 17.5):
        d.line([P(x, 10.5), P(x, 18.5)], fill=WHITE, width=w)
    d.line([P(4, 19.5), P(20, 19.5)], fill=WHITE, width=w)
    d.line([P(2.5, 21.5), P(21.5, 21.5)], fill=WHITE, width=w)
    return img


def town():
    """古镇：两栋坡顶房"""
    img, d = canvas(); w = sw(W)
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


def street():
    """街巷：两侧排屋 + 中间透视线"""
    img, d = canvas(); w = sw(W)
    d.line([P(11.5, 21.5), P(11.5, 8.5)], fill=WHITE, width=sw(W * 0.7))
    d.line([P(2, 21), P(2, 8), P(8.5, 5), P(8.5, 21)], fill=WHITE, width=w, joint="curve")
    d.line([P(22, 21), P(22, 8), P(15.5, 5), P(15.5, 21)], fill=WHITE, width=w, joint="curve")
    d.line([P(2, 12.5), P(8.5, 12.5)], fill=WHITE, width=sw(W * 0.15))
    d.line([P(15.5, 12.5), P(22, 12.5)], fill=WHITE, width=sw(W * 0.15))
    return img


def city():
    """城市：三栋高低楼 + 窗格 + 地平线"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=w)
    d.rectangle([P(2.5, 10), P(8.5, 20.5)], outline=WHITE, width=w)
    d.rectangle([P(9.5, 3.5), P(15.5, 20.5)], outline=WHITE, width=w)
    d.rectangle([P(16.5, 12.5), P(21.5, 20.5)], outline=WHITE, width=w)
    for y in (6.5, 9.5, 12.5, 15.5):
        d.line([P(11, y), P(14, y)], fill=WHITE, width=sw(W * 0.55))
    d.line([P(12.5, 3.5), P(12.5, 1.5)], fill=WHITE, width=sw(W * 0.7))
    return img


def tower():
    """现代塔：细高塔身 + 球体观景层 + 天线"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=w)
    d.line([P(10.6, 21), P(11.4, 12)], fill=WHITE, width=w)
    d.line([P(13.4, 21), P(12.6, 12)], fill=WHITE, width=w)
    d.ellipse([P(8.6, 6.6), P(15.4, 12.4)], outline=WHITE, width=w)
    d.line([P(12, 6.6), P(12, 2)], fill=WHITE, width=w)
    d.line([P(12, 9.6), P(8.6, 9.6)], fill=WHITE, width=sw(W * 0.5))
    d.line([P(12, 9.6), P(15.4, 9.6)], fill=WHITE, width=sw(W * 0.5))
    return img


def statue():
    """造像 / 大佛：坐像轮廓（头 + 肩 + 莲座）"""
    img, d = canvas(); w = sw(W)
    d.line([P(2, 21), P(22, 21)], fill=WHITE, width=w)
    d.ellipse([P(9.6, 2.4), P(14.4, 7.2)], outline=WHITE, width=w)
    d.line([P(12, 7.2), P(12, 9)], fill=WHITE, width=w)
    d.line([P(6.6, 16), P(8.2, 10.4), P(12, 9), P(15.8, 10.4), P(17.4, 16)],
           fill=WHITE, width=w, joint="curve")
    d.line([P(4.6, 16), P(19.4, 16)], fill=WHITE, width=w)
    d.line([P(3.6, 19), P(20.4, 19)], fill=WHITE, width=w)
    d.line([P(4.6, 16), P(3.6, 19)], fill=WHITE, width=w)
    d.line([P(19.4, 16), P(20.4, 19)], fill=WHITE, width=w)
    return img


def ruins():
    """遗址：断柱三根（高低不一）+ 台基 + 散落石块"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=w)
    d.line([P(3, 18), P(21, 18)], fill=WHITE, width=w)
    d.line([P(4.6, 18), P(4.6, 6.5), P(7.8, 6.5), P(7.8, 18)], fill=WHITE, width=w, joint="curve")
    d.line([P(10.6, 18), P(10.6, 10.5), P(13.6, 10.5), P(13.6, 18)], fill=WHITE, width=w, joint="curve")
    d.line([P(16.4, 18), P(16.4, 4), P(19, 4)], fill=WHITE, width=w, joint="curve")
    return img


def fort():
    """土楼 / 碉堡：圆形墙体 + 顶部垛口 + 门洞"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 20.5), P(22.5, 20.5)], fill=WHITE, width=w)
    d.line([P(4, 20.5), P(4, 11), P(20, 11), P(20, 20.5)], fill=WHITE, width=w, joint="curve")
    d.arc([P(4, 5.6), P(20, 15)], 180, 360, fill=WHITE, width=w)
    for x in (6.4, 10.2, 14, 17.6):
        d.line([P(x, 5.9), P(x, 4.2)], fill=WHITE, width=sw(W * 0.7))
    d.line([P(9.4, 20.5), P(9.4, 16.4), P(12, 14.6), P(14.6, 16.4), P(14.6, 20.5)],
           fill=WHITE, width=sw(W * 0.85), joint="curve")
    return img


def show():
    """演出：舞台 + 幕布 + 聚光"""
    img, d = canvas(); w = sw(W)
    d.line([P(2, 6.5), P(2, 19.5), P(22, 19.5), P(22, 6.5)], fill=WHITE, width=w, joint="curve")
    d.line([P(2, 6.5), P(22, 6.5)], fill=WHITE, width=w)
    d.line([P(6.5, 6.5), P(4.6, 19.5)], fill=WHITE, width=sw(W * 0.8))
    d.line([P(17.5, 6.5), P(19.4, 19.5)], fill=WHITE, width=sw(W * 0.8))
    d.ellipse([P(10, 11), P(14, 15)], outline=WHITE, width=sw(W * 0.7))
    return img


def flag():
    """红色景点 / 纪念碑：旗杆 + 波浪旗面 + 基座"""
    img, d = canvas(); w = sw(W)
    d.line([P(6, 21), P(6, 2.5)], fill=WHITE, width=w)
    pts = []
    for i in range(9):
        t = i / 8.0
        pts.append(P(6 + t * 13.5, 5 + 0.9 * math.sin(t * math.pi * 2)))
    for i in range(9):
        t = 1 - i / 8.0
        pts.append(P(6 + t * 13.5, 13 + 0.9 * math.sin(t * math.pi * 2)))
    d.line(pts, fill=WHITE, width=w, joint="curve")
    d.line([P(3.6, 21), P(8.4, 21)], fill=WHITE, width=sw(W * 0.9))
    return img


def school():
    """校园：拱形校门 + 双柱 + 台阶"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=w)
    d.line([P(3.5, 20.5), P(3.5, 9), P(20.5, 9), P(20.5, 20.5)], fill=WHITE, width=w, joint="curve")
    d.arc([P(9, 9), P(15, 17)], 180, 360, fill=WHITE, width=w)
    d.line([P(9, 13), P(9, 20.5)], fill=WHITE, width=w)
    d.line([P(15, 13), P(15, 20.5)], fill=WHITE, width=w)
    d.line([P(6, 12), P(6, 16)], fill=WHITE, width=sw(W * 0.6))
    d.line([P(18, 12), P(18, 16)], fill=WHITE, width=sw(W * 0.6))
    return img


def market():
    """市集：条纹顶棚 + 台面 + 货物"""
    img, d = canvas(); w = sw(W)
    d.line([P(2, 21), P(22, 21)], fill=WHITE, width=w)
    d.line([P(2.6, 11), P(21.4, 11)], fill=WHITE, width=w)
    d.line([P(2.6, 11), P(5, 4.5), P(19, 4.5), P(21.4, 11)], fill=WHITE, width=w, joint="curve")
    for x in (6.4, 10.2, 14, 17.8):
        d.line([P(x, 4.5), P(x - 0.6, 11)], fill=WHITE, width=sw(W * 0.6))
    d.line([P(4.4, 11), P(4.4, 16), P(19.6, 16), P(19.6, 11)], fill=WHITE, width=sw(W * 0.85), joint="curve")
    d.ellipse([P(8, 17.6), P(11.4, 20)], outline=WHITE, width=sw(W * 0.6))
    d.ellipse([P(13, 17.6), P(16.4, 20)], outline=WHITE, width=sw(W * 0.6))
    return img


def dam():
    """大坝：上游水面 + 梯形坝体 + 坝面分格 + 下游水花
    （第一版只有梯形套横线，96px 下像个筛子。补上左上游波浪与右下游水花，剖面关系才明确）"""
    img, d = canvas(); w = sw(W)
    wave(d, 7.4, 1.2, 8.4, amp=0.7, n=6)
    d.line([P(8, 7), P(16, 7)], fill=WHITE, width=w)
    d.line([P(8, 7), P(11.2, 20.5)], fill=WHITE, width=w)
    d.line([P(16, 7), P(12.8, 20.5)], fill=WHITE, width=w)
    for y in (11.4, 15.4):
        t = (y - 7) / 13.5
        d.line([P(8 + 3.2 * t, y), P(16 - 3.2 * t, y)], fill=WHITE, width=sw(W * 0.55))
    d.line([P(1.5, 20.5), P(22.5, 20.5)], fill=WHITE, width=w)
    wave(d, 20.5, 13.2, 22.4, amp=0.5, n=5)
    d.line([P(1.5, 12.4), P(5.4, 12.4)], fill=WHITE, width=sw(W * 0.55))
    return img


def road():
    """公路：透视双线 + 中心虚线 + 远山"""
    img, d = canvas(); w = sw(W)
    d.line([P(3.5, 21), P(10.4, 8)], fill=WHITE, width=w)
    d.line([P(20.5, 21), P(13.6, 8)], fill=WHITE, width=w)
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=w)
    for y0, y1 in ((19, 17.4), (15.4, 14.2), (12.6, 11.7)):
        t0 = (21 - y0) / 13.0
        t1 = (21 - y1) / 13.0
        d.line([P(12 + 0 * t0, y0), P(12 + 0 * t1, y1)], fill=WHITE, width=sw(W * 0.5 + t0 * 1.2))
    return img


# ─────────────────────────── 玩乐 / 设施 ───────────────────────────

def paw():
    """动物园：掌垫 + 四趾"""
    img, d = canvas(); w = sw(W)
    d.ellipse([P(7.2, 12), P(16.8, 20.5)], outline=WHITE, width=w)
    for cx, cy, r in ((5.6, 8.4, 1.9), (10, 6.6, 2.0), (14.5, 6.6, 2.0), (18.8, 8.6, 1.8)):
        d.ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], outline=WHITE, width=w)
    return img


def ferris():
    """乐园：摩天轮"""
    img, d = canvas(); w = sw(W)
    cx, cy, r = 12, 10, 6.2
    d.ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], outline=WHITE, width=w)
    for i in range(6):
        a = math.pi / 3 * i
        d.line([P(cx, cy), P(cx + r * math.cos(a), cy + r * math.sin(a))], fill=WHITE, width=sw(1.0))
    d.ellipse([P(cx - 1, cy - 1), P(cx + 1, cy + 1)], fill=WHITE)
    d.line([P(cx, cy), P(cx - 4.5, 21)], fill=WHITE, width=w)
    d.line([P(cx, cy), P(cx + 4.5, 21)], fill=WHITE, width=w)
    d.line([P(4.5, 21), P(19.5, 21)], fill=WHITE, width=w)
    return img


def aquarium():
    """水族馆：鱼身 + 尾鳍 + 气泡 + 水波"""
    img, d = canvas(); w = sw(W)
    d.ellipse([P(3.5, 8.5), P(17.5, 17.5)], outline=WHITE, width=w)
    d.line([P(17.2, 13), P(21.8, 9.2), P(21.8, 16.8), P(17.2, 13)], fill=WHITE, width=w, joint="curve")
    d.ellipse([P(6.4, 11.4), P(8, 13)], fill=WHITE)
    wave(d, 21, 3, 21, amp=0.6)
    d.ellipse([P(9, 4.2), P(11, 6.2)], outline=WHITE, width=sw(W * 0.55))
    d.ellipse([P(13, 2.4), P(14.4, 3.8)], outline=WHITE, width=sw(W * 0.55))
    return img


def ski():
    """滑雪：雪坡 + 双板 + 俯冲人形 + 雪杖
    （第一版只有斜坡和几根散线，96px 下完全看不出滑雪。改为「人 + 板」的剪影构图）"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 21), P(22.5, 9.5)], fill=WHITE, width=w)
    # 双板（平行粗斜线）
    d.line([P(9, 15.4), P(16, 19.4)], fill=WHITE, width=sw(W * 1.15))
    d.line([P(10.4, 13.6), P(17.4, 17.6)], fill=WHITE, width=sw(W * 1.15))
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=sw(W * 0.7))
    # 人形：头 + 身体前倾 + 腿
    d.ellipse([P(11.4, 4.4), P(14, 7)], outline=WHITE, width=w)
    d.line([P(12.7, 7), P(12.2, 11.4)], fill=WHITE, width=w)
    d.line([P(12.2, 11.4), P(14.4, 15.2)], fill=WHITE, width=w)
    d.line([P(12.2, 8.6), P(15.2, 10.4)], fill=WHITE, width=sw(W * 0.85))
    # 雪杖
    d.line([P(16.6, 8.6), P(18.6, 15)], fill=WHITE, width=sw(W * 0.7))
    return img


def camp():
    """露营：三角帐篷 + 中缝 + 地钉线"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 20.5), P(22.5, 20.5)], fill=WHITE, width=w)
    d.line([P(2.6, 20), P(12, 4.8), P(21.4, 20)], fill=WHITE, width=w, joint="curve")
    d.line([P(12, 4.8), P(12, 20)], fill=WHITE, width=sw(W * 0.8))
    d.line([P(9.2, 20), P(12, 14), P(14.8, 20)], fill=WHITE, width=sw(W * 0.7), joint="curve")
    return img


def camera():
    """观景台 / 摄影机位：机身 + 镜头 + 取景器 + 支架"""
    img, d = canvas(); w = sw(W)
    d.rectangle([P(2.2, 7.4), P(21.8, 18.6)], outline=WHITE, width=w)
    d.line([P(7.6, 7.4), P(8.8, 4.6), P(15.2, 4.6), P(16.4, 7.4)], fill=WHITE, width=sw(W * 0.85), joint="curve")
    d.ellipse([P(8.4, 9.6), P(15.6, 16.8)], outline=WHITE, width=w)
    d.ellipse([P(10.8, 12), P(13.2, 14.4)], fill=WHITE)
    d.line([P(19, 9.6), P(20.6, 9.6)], fill=WHITE, width=sw(W * 0.7))
    return img


def foot():
    """徒步：一条 S 形步道 + 起点圆点 + 终点小旗"""
    img, d = canvas(); w = sw(W)
    d.line([P(4, 21), P(8.6, 16.6), P(6.4, 12.2), P(12, 8), P(18.4, 6.2)],
           fill=WHITE, width=w, joint="curve")
    d.ellipse([P(2.4, 19.4), P(5.6, 22.2)], outline=WHITE, width=sw(W * 0.8))
    d.line([P(18.4, 6.2), P(18.4, 1.8)], fill=WHITE, width=sw(W * 0.85))
    d.line([P(18.4, 1.8), P(22.4, 3), P(18.4, 4.6)], fill=WHITE, width=sw(W * 0.75), joint="curve")
    return img


def food():
    """美食：碗 + 筷子 + 热气"""
    img, d = canvas(); w = sw(W)
    d.line([P(2.6, 12.6), P(21.4, 12.6)], fill=WHITE, width=w)
    d.arc([P(2.6, 5), P(21.4, 20)], 0, 180, fill=WHITE, width=w)
    d.line([P(7.4, 20.6), P(16.6, 20.6)], fill=WHITE, width=sw(W * 0.8))
    d.line([P(15.6, 3), P(11.6, 11.4)], fill=WHITE, width=sw(W * 0.7))
    d.line([P(18.2, 3.4), P(13.4, 11.4)], fill=WHITE, width=sw(W * 0.7))
    return img


def home():
    """住宿：坡屋顶 + 屋身 + 门 + 窗"""
    img, d = canvas(); w = sw(W)
    d.line([P(1.5, 21), P(22.5, 21)], fill=WHITE, width=w)
    d.line([P(3, 12.6), P(12, 4.4), P(21, 12.6)], fill=WHITE, width=w, joint="curve")
    d.line([P(5, 12), P(5, 20.5)], fill=WHITE, width=w)
    d.line([P(19, 12), P(19, 20.5)], fill=WHITE, width=w)
    d.line([P(5, 20.5), P(19, 20.5)], fill=WHITE, width=w)
    d.line([P(9.8, 20.5), P(9.8, 15.6), P(14.2, 15.6), P(14.2, 20.5)],
           fill=WHITE, width=sw(W * 0.8), joint="curve")
    d.rectangle([P(7.2, 9.4), P(9.8, 12)], outline=WHITE, width=sw(W * 0.55))
    return img


def bus():
    """交通：车身 + 车窗 + 两轮"""
    img, d = canvas(); w = sw(W)
    d.rectangle([P(2.4, 5.6), P(21.6, 16.4)], outline=WHITE, width=w)
    d.line([P(2.4, 10.6), P(21.6, 10.6)], fill=WHITE, width=sw(W * 0.6))
    for x in (6, 10.4, 14.8, 19):
        d.line([P(x, 7.1), P(x, 9.4)], fill=WHITE, width=sw(W * 0.45))
    for cx in (7.2, 16.8):
        d.ellipse([P(cx - 2, 15), P(cx + 2, 19)], fill=(0, 0, 0, 0), outline=WHITE, width=w)
    d.line([P(1.6, 19), P(22.4, 19)], fill=WHITE, width=sw(W * 0.5))
    return img


def pin():
    """兜底：地图针（语义中性 —— 宁可给「地点」，也不给语义错误的「山」）"""
    img, d = canvas(); w = sw(W)
    pts = [P(12, 21.6), P(4.6, 12.6)]
    d.line([P(12, 21.6), P(4.6, 12.2)], fill=WHITE, width=w)
    d.line([P(12, 21.6), P(19.4, 12.2)], fill=WHITE, width=w)
    d.arc([P(4.6, 2.4), P(19.4, 17.2)], 150, 390, fill=WHITE, width=w)
    d.ellipse([P(9.4, 7.2), P(14.6, 12.4)], outline=WHITE, width=sw(W * 0.85))
    return img


ORDER = [
    # 自然 / 地貌
    mountain, lake, river, water, waterfall, canyon, cave, desert, grass, terrace,
    glacier, snowmtn, volcano, wetland, forest, island, umbrella, hotspring, flower, garden,
    # 人文 / 建筑
    palace, temple, pagoda, wall, bridge, museum, town, street, city, tower,
    statue, ruins, fort, show, flag, school, market, dam, road,
    # 玩乐 / 设施
    paw, ferris, aquarium, ski, camp, camera, foot, food, home, bus, pin,
]


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print("生成封面分类图标（%dx%d → images/covers/）：" % (SIZE, SIZE))
    total = 0
    for fn in ORDER:
        n = fn.__name__
        sz = save(fn(), n)
        total += sz
        print("  %-10s %6d B" % (n, sz))
    print("共 %d 枚，合计 %.1f KB" % (len(ORDER), total / 1024.0))
