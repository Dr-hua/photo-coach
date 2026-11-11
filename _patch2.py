# -*- coding: utf-8 -*-
"""把 sw.js 加进 sync-push.ps1 的同步清单，保持 UTF-8 with BOM。"""
import io, sys

P = r"D:\photo-coach-pages\sync-push.ps1"

raw = open(P, 'rb').read()
has_bom = raw.startswith(b'\xef\xbb\xbf')
text = raw.decode('utf-8-sig')

old = "$Files  = @('index.html', 'app.js', 'rules.js', 'style.css')"
new = "$Files  = @('index.html', 'app.js', 'rules.js', 'style.css', 'sw.js')"

if old not in text:
    print("FAIL 锚点未找到")
    sys.exit(1)
if text.count(old) != 1:
    print("FAIL 锚点不唯一")
    sys.exit(1)

text = text.replace(old, new, 1)
out = text.encode('utf-8')
if has_bom:
    out = b'\xef\xbb\xbf' + out
open(P, 'wb').write(out)

print("OK  原 BOM=%s  新大小 %d B" % (has_bom, len(out)))
