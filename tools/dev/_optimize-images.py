#!/usr/bin/env python3
"""对随包图片做**无损**重压缩（PNG optimize）。

为什么需要：v1.20.34 新增封面图标后，`check-pkgsize` 的「图片/音频合计」从 184KB 涨到
222KB，越过 200KB 代码质量线。但体积大的根源不是新图标（37.8KB），而是历史图标从来没
做过压缩 —— 89 张 32x32 的 icons/*.png 平均 1.4KB（同类单色线条图正常应在 300~600B），
12 张 tabBar 图合计 55.7KB。

做法与边界：
  · 只做 **PNG optimize 重存**，不量化、不缩放、不改色 —— 解码后像素必须与原件
    逐像素完全一致（脚本自己校验，不一致就跳过该文件），所以视觉风险为零。
  · 只有「更小且像素一致」才落盘，重复执行不会反复改写文件。
  · 想进一步压体积就得接受画质取舍（调色板量化），那属于设计决策，不在本脚本内自动做。

用法：python3 tools/dev/_optimize-images.py [--dry]
产物：原地覆盖 images/ 下的 PNG；打印每个文件节省量。
"""
import io
import os
import sys

from PIL import Image, ImageChops

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
IMG = os.path.join(ROOT, "images")
DRY = "--dry" in sys.argv


def walk_png():
    out = []
    for dirpath, _dirs, files in os.walk(IMG):
        for f in sorted(files):
            if f.lower().endswith(".png"):
                out.append(os.path.join(dirpath, f))
    return out


def main():
    paths = walk_png()
    before = after = 0
    changed = 0
    skipped = 0
    for p in paths:
        old = os.path.getsize(p)
        before += old
        try:
            im = Image.open(p)
            buf = io.BytesIO()
            im.save(buf, "PNG", optimize=True)
            data = buf.getvalue()
        except Exception as e:                                    # noqa: BLE001
            print("  ! %s 读取失败：%s" % (os.path.relpath(p, ROOT), e))
            after += old
            skipped += 1
            continue
        if len(data) >= old:
            after += old
            continue
        # 无损校验：解码后必须逐像素一致，否则宁可不收这份收益
        a = Image.open(p).convert("RGBA")
        b = Image.open(io.BytesIO(data)).convert("RGBA")
        if a.size != b.size or ImageChops.difference(a, b).getbbox() is not None:
            print("  ! %s 重压后有像素差异，跳过" % os.path.relpath(p, ROOT))
            after += old
            skipped += 1
            continue
        if not DRY:
            with open(p, "wb") as fh:
                fh.write(data)
        after += len(data)
        changed += 1
        print("  ✓ %-42s %5d → %4d B  (-%d)" % (os.path.relpath(p, ROOT), old, len(data), old - len(data)))
    print("\n%s：%d 张，%d 张已优化，%d 张跳过；合计 %.1f KB → %.1f KB（省 %.1f KB）"
          % ("试运行（未写盘）" if DRY else "已完成", len(paths), changed, skipped, before / 1024, after / 1024, (before - after) / 1024))


if __name__ == "__main__":
    main()
