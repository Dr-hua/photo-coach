# -*- coding: utf-8 -*-
"""对 deploy/app.js 做三处改动，保持 CRLF 不变。"""
import io, sys, os

P = r"C:\Users\H2165\WorkBuddy AI\2026-11-11-00-02-04\deploy\app.js"

with io.open(P, 'r', encoding='utf-8', newline='') as f:
    src = f.read()

orig_len = len(src)
changes = []


def sub(old, new, tag):
    global src
    if old not in src:
        print("FAIL 锚点未找到: " + tag)
        sys.exit(1)
    if src.count(old) != 1:
        print("FAIL 锚点不唯一(%d): %s" % (src.count(old), tag))
        sys.exit(1)
    src = src.replace(old, new, 1)
    changes.append(tag)


# ---- 1. CDN 常量：改成多源候选 ----
old1 = (
    "  var TFJS_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';\r\n"
    "  var PD_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js';\r\n"
)
new1 = (
    "  // jsdelivr 在国内实测只有 143KB/s（1.47MB 要 10 秒），unpkg 同一文件 1.9 秒。\r\n"
    "  // 所以按 unpkg → jsdelivr → npmmirror 顺序试，第一个成功就用。\r\n"
    "  // 包路径写法 '@scope/name@1.2.3/dist/x.js'；npmmirror 的 URL 规则不同，单独转。\r\n"
    "  function npmMirror(p) {\r\n"
    "    var at = p.indexOf('@', 1);\r\n"
    "    if (at < 0) return null;\r\n"
    "    var name = p.slice(0, at), rest = p.slice(at + 1);\r\n"
    "    var slash = rest.indexOf('/');\r\n"
    "    if (slash < 0) return null;\r\n"
    "    var ver = rest.slice(0, slash), path = rest.slice(slash + 1);\r\n"
    "    return 'https://registry.npmmirror.com/' + name + '/' + ver + '/files/' + path;\r\n"
    "  }\r\n"
    "  var CDNS = [\r\n"
    "    function (p) { return 'https://unpkg.com/' + p; },\r\n"
    "    function (p) { return 'https://cdn.jsdelivr.net/npm/' + p; },\r\n"
    "    npmMirror\r\n"
    "  ];\r\n"
    "  var TFJS_PKG = '@tensorflow/tfjs@4.22.0/dist/tf.min.js';\r\n"
    "  var PD_PKG = '@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js';\r\n"
)
sub(old1, new1, "CDN 常量块")

# ---- 2. 其余三个 URL 也改成包路径 ----
old2 = (
    "  var HAND_LIB = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/hand-pose-detection@2.0.1/dist/hand-pose-detection.min.js';\r\n"
)
new2 = (
    "  var HAND_PKG = '@tensorflow-models/hand-pose-detection@2.0.1/dist/hand-pose-detection.min.js';\r\n"
)
sub(old2, new2, "HAND_LIB → HAND_PKG")

old3 = (
    "  var SCENE_LIB = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';\r\n"
)
new3 = (
    "  var SCENE_PKG = '@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';\r\n"
)
sub(old3, new3, "SCENE_LIB → SCENE_PKG")

# ---- 3. loadScript：超时 30 秒 + 多源回退 ----
old4 = (
    "  function loadScript(src) {\r\n"
    "    return new Promise(function (resolve, reject) {\r\n"
    "      var s = document.createElement('script');\r\n"
    "      var done = false;\r\n"
    "      s.src = src;\r\n"
    "      s.onload = function () { if (!done) { done = true; resolve(); } };\r\n"
    "      s.onerror = function () { if (!done) { done = true; reject(new Error('load failed')); } };\r\n"
    "      document.head.appendChild(s);\r\n"
    "      setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, 12000);\r\n"
    "    });\r\n"
    "  }\r\n"
)
new4 = (
    "  // 单源 30 秒；失败（网络错或超时）就换下一个源，全部失败才 reject\r\n"
    "  function loadOne(src, timeout) {\r\n"
    "    return new Promise(function (resolve, reject) {\r\n"
    "      var s = document.createElement('script');\r\n"
    "      var done = false;\r\n"
    "      function fin(ok, err) {\r\n"
    "        if (done) return;\r\n"
    "        done = true;\r\n"
    "        clearTimeout(timer);\r\n"
    "        if (ok) resolve(); else { if (s.parentNode) s.parentNode.removeChild(s); reject(err); }\r\n"
    "      }\r\n"
    "      s.src = src;\r\n"
    "      s.async = true;\r\n"
    "      s.onload = function () { fin(true); };\r\n"
    "      s.onerror = function () { fin(false, new Error('load failed')); };\r\n"
    "      document.head.appendChild(s);\r\n"
    "      var timer = setTimeout(function () { fin(false, new Error('timeout')); }, timeout || 30000);\r\n"
    "    });\r\n"
    "  }\r\n"
    "\r\n"
    "  // 按 CDNS 顺序逐个试，第一个加载成功即返回\r\n"
    "  function loadScript(pkg) {\r\n"
    "    var i = 0;\r\n"
    "    function next(lastErr) {\r\n"
    "      if (i >= CDNS.length) return Promise.reject(lastErr || new Error('all cdn failed'));\r\n"
    "      var url = CDNS[i++](pkg);\r\n"
    "      return loadOne(url, 30000).catch(function (e) { return next(e); });\r\n"
    "    }\r\n"
    "    return next(null);\r\n"
    "  }\r\n"
)
sub(old4, new4, "loadScript 多源回退")

# ---- 4. 三处调用点改成传包路径 ----
for old, new, tag in [
    ("loadScript(TFJS_URL)", "loadScript(TFJS_PKG)", "调用点 TFJS"),
    ("loadScript(PD_URL)", "loadScript(PD_PKG)", "调用点 PD"),
    ("loadScript(HAND_LIB)", "loadScript(HAND_PKG)", "调用点 HAND"),
    ("loadScript(SCENE_LIB)", "loadScript(SCENE_PKG)", "调用点 SCENE"),
]:
    n = src.count(old)
    if n == 0:
        print("FAIL 调用点未找到: " + tag)
        sys.exit(1)
    src = src.replace(old, new)
    changes.append("%s ×%d" % (tag, n))

# ---- 5. analyzeImage 复用 canvas ----
old5 = (
    "  function analyzeImage(source) {\r\n"
    "    var N = 64;\r\n"
    "    var tmp = document.createElement('canvas');\r\n"
    "    tmp.width = N; tmp.height = N;\r\n"
    "    var c = tmp.getContext('2d', { willReadFrequently: true });\r\n"
    "    try { c.drawImage(source, 0, 0, N, N); }\r\n"
)
new5 = (
    "  // 复用一个 64×64 画布：原来每 1.5 秒 new 一个 canvas + 一个 willReadFrequently\r\n"
    "  // 上下文，用完就扔，纯粹是给 GC 添麻烦\r\n"
    "  var statCanvas = document.createElement('canvas');\r\n"
    "  statCanvas.width = 64; statCanvas.height = 64;\r\n"
    "  var statCtx = statCanvas.getContext('2d', { willReadFrequently: true });\r\n"
    "\r\n"
    "  function analyzeImage(source) {\r\n"
    "    var N = 64;\r\n"
    "    var c = statCtx;\r\n"
    "    try { c.drawImage(source, 0, 0, N, N); }\r\n"
)
sub(old5, new5, "analyzeImage 复用 canvas")

with io.open(P, 'w', encoding='utf-8', newline='') as f:
    f.write(src)

print("改动 %d 处：" % len(changes))
for c in changes:
    print("  - " + c)
print("大小 %d → %d B" % (orig_len, len(src)))
