# -*- coding: utf-8 -*-
"""补 app.js：这个文件是 CRLF 换行，锚点必须带 \\r\\n。"""
import io, sys

P = r'C:\Users\H2165\WorkBuddy AI\2026-11-11-00-02-04\deploy\app.js'

OLD = ("    var scale = Math.min(vw / ms.w, vh / ms.h);\r\n"
       "    var w = ms.w * scale, h = ms.h * scale;\r\n")
NEW = ("    // 必须和 CSS 的 object-fit:cover 用同一套算法（铺满后居中裁切），\r\n"
       "    // 否则视频按 cover 显示、骨架线按 contain 画，两者的点会差出一大截。\r\n"
       "    var scale = Math.max(vw / ms.w, vh / ms.h);\r\n"
       "    var w = ms.w * scale, h = ms.h * scale;\r\n")

with io.open(P, 'r', encoding='utf-8', newline='') as f:
    s = f.read()

if s.count(OLD) != 1:
    print('FAIL: 锚点出现 %d 次' % s.count(OLD))
    sys.exit(1)

n = s.replace(OLD, NEW)
with io.open(P, 'w', encoding='utf-8', newline='') as f:
    f.write(n)
print('OK app.js: %d -> %d B' % (len(s.encode('utf-8')), len(n.encode('utf-8'))))
