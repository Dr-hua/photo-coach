/* 拍照小助手 Service Worker
 *
 * 目的只有一个：把首次开摄像头要下的 1.47MB tfjs 存下来。
 * 实测 jsdelivr 在国内 143KB/s，那 1.47MB 要 10 秒；第二次走本地缓存就是 0 秒。
 *
 * 两种策略分开走：
 *   - 自己的文件（同源 html/js/css）：网络优先，失败才用缓存。
 *     这样每次部署新版本都能立刻拿到，不会被旧缓存卡住。
 *   - CDN 与模型文件（跨域，URL 里带版本号 / 内容不变）：缓存优先，永不重新下。
 */

var CACHE = 'photo-coach-v31';
var SHELL = ['./', './index.html', './app.js', './rules.js', './style.css'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 单个失败不影响整体安装
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isPinned(url) {
  // 跨域 + 带版本号的库，以及 tfhub 的模型：内容不会变，放心永久缓存
  var h = url.hostname;
  return h === 'unpkg.com' || h === 'cdn.jsdelivr.net' ||
         h === 'registry.npmmirror.com' || h === 'tfhub.dev' ||
         h === 'storage.googleapis.com';
}

/* 一条缓存能不能直接交出去？
 *
 * opaque 响应（type='opaque'、status=0）是 no-cors 请求的产物。
 * <script src> 加载跨域脚本时就是 no-cors，所以缓存里存下来的是 opaque。
 * 但页面上 fetch() / XHR 默认是 cors 模式，把 opaque 交给 cors 请求
 * 浏览器会直接抛 TypeError: Failed to fetch —— 不是网络问题，是模式不匹配。
 * 所以：opaque 只能回给 no-cors 请求，cors 请求必须重新联网拿。
 */
function servable(hit, req) {
  if (!hit) return false;
  if (hit.type === 'opaque') return req.mode === 'no-cors';
  return true;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  // 跨域大文件：缓存优先
  if (isPinned(url)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (servable(hit, req)) return hit;
        return fetch(req).then(function (res) {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
          }
          return res;
        }).catch(function (err) {
          // 网络断了：只有 no-cors 请求能拿 opaque 兜底，别的必须如实失败
          if (servable(hit, req)) return hit;
          throw err;
        });
      })
    );
    return;
  }

  // 同源页面资源：网络优先，断了才用缓存
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
  }
});
