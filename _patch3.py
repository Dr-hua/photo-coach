# -*- coding: utf-8 -*-
"""修两个比例问题：
1) 宽屏下取景区被 @media(min-height:720px) 改成 height:54vh + aspect-ratio:auto，
   变成超宽横幅（1280x432，2.9:1），竖构图人像被压扁。
   -> 去掉那条媒体查询，改成按高度反算宽度上限，保持 3/4 竖构图并居中。
2) 视频用 CSS object-fit:cover（铺满+裁切），骨架线用 fitRect() 的 contain 算法
   （完整画面+黑边），两者不一致，骨架线和人对不上。
   -> fitRect 改成 cover 算法（Math.max + 可能为负的居中偏移），与 CSS 对齐。
"""
import io, os, sys

BASE = r'C:\Users\H2165\WorkBuddy AI\2026-11-11-00-02-04\deploy'

def patch(path, olds_news, name):
    with io.open(path, 'r', encoding='utf-8', newline='') as f:
        s = f.read()
    orig = s
    for old, new in olds_news:
        if s.count(old) != 1:
            print('FAIL %s: 锚点出现 %d 次\n%s' % (name, s.count(old), old[:120]))
            return False
        s = s.replace(old, new)
    with io.open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(s)
    print('OK %s: %d -> %d B' % (name, len(orig.encode('utf-8')), len(s.encode('utf-8'))))
    return True

# ---------- style.css ----------
CSS_OLD = """.view{position:relative;width:100%;aspect-ratio:3/4;background:#0B0F13;border-radius:var(--r);overflow:hidden;box-shadow:0 2px 10px rgba(22,27,32,.10)}
@media(min-height:720px){.view{aspect-ratio:auto;height:54vh}}"""
CSS_NEW = """/* 取景区固定 3/4 竖构图（这是手机竖屏拍摄，不是宽屏视频）。
   宽度用 max-width 按视口高度反算，避免宽屏/横屏下被拉成超宽横幅把人压扁。
   280px 兜底防止窗口极矮时缩成一条。 */
.view{position:relative;width:100%;max-width:max(280px,calc((100vh - 250px) * 0.75));aspect-ratio:3/4;margin:0 auto;background:#0B0F13;border-radius:var(--r);overflow:hidden;box-shadow:0 2px 10px rgba(22,27,32,.10)}"""

# ---------- app.js ----------
JS_OLD = """    var scale = Math.min(vw / ms.w, vh / ms.h);
    var w = ms.w * scale, h = ms.h * scale;
    return { x: (vw - w) / 2, y: (vh - h) / 2, w: w, h: h };"""
JS_NEW = """    // 必须和 CSS 的 object-fit:cover 用同一套算法（铺满后居中裁切），
    // 否则视频按 cover 显示、骨架线按 contain 画，两者的点会差出一大截。
    var scale = Math.max(vw / ms.w, vh / ms.h);
    var w = ms.w * scale, h = ms.h * scale;
    return { x: (vw - w) / 2, y: (vh - h) / 2, w: w, h: h };"""

ok = True
ok &= patch(os.path.join(BASE, 'style.css'), [(CSS_OLD, CSS_NEW)], 'style.css')
ok &= patch(os.path.join(BASE, 'app.js'), [(JS_OLD, JS_NEW)], 'app.js')

# 版本号 v30 -> v31，并让 SW 缓存名跟着升，避免旧缓存继续发旧 CSS
idx = os.path.join(BASE, 'index.html')
ok &= patch(idx, [('style.css?v=30', 'style.css?v=31'), ('app.js?v=30', 'app.js?v=31')], 'index.html')

sw = os.path.join(BASE, 'sw.js')
ok &= patch(sw, [('photo-coach-v30', 'photo-coach-v31')], 'sw.js')

sys.exit(0 if ok else 1)
