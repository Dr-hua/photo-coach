(function () {
  'use strict';

  var TFJS_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
  var PD_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js';
  // MoveNet 的 17 个点 → 原来 33 点里的位置（这样规矩代码一行都不用改）
  var MOVENET_MAP = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  var HAND_LIB = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/hand-pose-detection@2.0.1/dist/hand-pose-detection.min.js';
  // 场景分类：MobileNet v1 0.25（最轻的一档，约 1.9MB），认 ImageNet 1000 类再映射成我们要的几类
  var SCENE_LIB = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';
  var SCENE_MODEL = 'https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v1_025_224/classification/1/default/1/model.json?tfjs-format=file';
  var CFG_KEY = 'photo_helper_config_v1';
  var LOG_KEY = 'photo_helper_feedback_v1';

  var $ = function (id) { return document.getElementById(id); };
  var view = $('view'), video = $('video'), photo = $('photo');
  var canvas = $('overlay'), ctx = canvas.getContext('2d');
  var empty = $('empty'), hintbox = $('hintbox'), statusEl = $('status');

  var state = {
    mode: 'idle', running: false, demoMode: false,
    shot: 'flat', gridOn: false,
    points: null, stats: {}, degrade: 0,
    lastRuleAt: 0, lastStatsAt: 0, frameTimes: [],
    pose: null, landmarker: null, detector: null, frameSeq: 0, modelReady: false, busy: false, pendingCb: null,
    config: null, feedback: [], findings: [], stream: null,
    expanded: {}, votes: {},
    facing: 'user', gotLandmarks: false, recogWarned: false,
    modelRan: false, noPerson: false, busyAt: 0, shotPhoto: null,
    levelOn: false, levelDenied: false, gx: null, gy: null, levelDeg: null,
    sceneModel: null, sceneReady: false, sceneTried: false, sceneBusy: false,
    scene: null, lastSceneAt: 0,
    handDetector: null, handReady: false, handTried: false,
    handPoints: [], handBusy: false, lastHandAt: 0, handShown: [], handTick: 0,
    starting: false, camGen: 0, switching: false
  };

  function loadJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v || fallback; }
    catch (e) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  var SHORT = {
    '本地运行 · 实时提醒': '实时',
    '摄像头已开 · 识别模块没加载上': '识别未就绪',
    '摄像头已开 · 识别未就绪': '识别未就绪',
    '本地运行 · 这张的结论': '本地',
    '两层同意已记下 · 云端功能还没接上': '已同意 · 未接入',
    '本地记录已清空 · 全程本地': '已清空',
    '不同意 · 全程本地': '本地',
    '先点一个入口开始': '未开始',
    '摄像头没响应 · 可先看演示': '无响应',
    '1/2 正在打开摄像头…': '开摄像头',
    '2/2 画面已出 · 正在准备识别': '加载识别',
    '正在识别这张照片…': '识别中',
    '省电模式 · 实时已暂停，按快门给结论': '省电 · 按快门',
    '省电模式 · 提醒变慢了': '省电 · 慢速'
  };
  // 画面上只放一句短话，完整说法点「为什么」再看
  var TIP_SHORT = {
    '头顶快贴边了，退后半步，或者把镜头往上抬一点': '头顶快贴边，退后半步',
    '人往下挪一点（或镜头往上抬），让眼睛落在上三分之一线': '人往下挪一点',
    '人往上挪一点（或镜头往下压），让眼睛落在上三分之一线': '人往上挪一点',
    '人太靠边了，往画面中间挪半步': '往中间挪半步',
    '侧脸时，视线朝向那一侧要留白，别把人放正中': '侧脸，视线那侧留白',
    '太近了，退后半步让人上半身进画面': '太近了，退后半步',
    '太近了，容易切到手和头顶，退后半步': '太近了，退后半步',
    '太远了，人在画面里太小，往前走两步': '太远了，往前两步',
    '相机可能没端平，肩膀和胯线看起来歪了': '画面歪了，抬一抬',
    '肩膀看着是歪的，站正一点': '肩膀歪了，站正',
    '手腕离开身体一点，别贴太死': '手腕离开身体',
    '背景那条横线正穿过脖子，蹲低一点，或者把机位抬高': '横线穿过脖子，蹲低或抬高机位',
    '背景那条横线正穿过腰，蹲低一点，或者把机位抬高': '横线穿过腰，蹲低或抬高机位',
    '有根竖线正从头上长出来，往旁边挪半步': '竖线从头顶长出，挪半步',
    '逆光了，侧身一点让光勾轮廓，或者换个方向；别硬往亮处站': '逆光，侧身让光勾轮廓',
    '背景有点乱，往旁边挪一步找面干净的墙': '背景乱，挪一步找净墙',
    '光偏冷，脸会发青，往暖光那边靠一点': '光偏冷，靠暖光',
    '光偏黄，脸会发橙，换个角度或靠近窗光': '光偏黄，换角度',
    '室内就靠窗站，把顶灯关掉，光会好看很多': '室内靠窗，关顶灯',
    '餐厅背景人多，往角落或靠窗坐，别让招牌压在头上': '往角落坐，避招牌',
    '货架招牌密，尽量顺墙站，避开反光玻璃': '顺墙站，避反光',
    '屏幕和线缆会乱，往白墙那边挪一步': '往白墙那边挪',
    '地平线别放正中，放下三分之一更稳': '地平线放下三分之一',
    '仰拍容易把下巴拍宽，收一点下巴，也别站太近': '仰拍，收下巴',
    '俯拍时平视的构图规矩不适用，已自动放宽；注意别切到头顶和脚': '俯拍，规矩已放宽'
  };
  function setStatus(text, kind) {
    statusEl.textContent = SHORT[text] || text;
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var done = false;
      s.src = src;
      s.onload = function () { if (!done) { done = true; resolve(); } };
      s.onerror = function () { if (!done) { done = true; reject(new Error('load failed')); } };
      document.head.appendChild(s);
      setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, 12000);
    });
  }

  function initModel() {
    if (state.modelReady) return Promise.resolve(true);
    hintbox.hidden = false;
    hintbox.className = 'hintbox';
    hintbox.textContent = '正在加载识别（约 2MB，稍等）';
    return loadScript(TFJS_URL).then(function () {
      if (!window.tf) return null;
      // 优先用显卡后端；CPU 后端会卡住主线程，实时会掉成幻灯片
      return window.tf.ready()
        .then(function () { return window.tf.setBackend('webgl'); })
        .catch(function () { return null; })
        .then(function () { return window.tf.ready(); });
    }).then(function () {
      return loadScript(PD_URL);
    }).then(function () {
      var pd = window.poseDetection;
      if (!pd || !pd.createDetector) throw new Error('识别库没加载出来');
      return pd.createDetector(pd.SupportedModels.MoveNet, {
        modelType: pd.movenet.modelType.SINGLEPOSE_LIGHTNING,
        enableSmoothing: true
      });
    }).then(function (det) {
      state.detector = det;
      state.modelReady = true;
      // 预热一次，把第一次编译的开销吃掉
      var warm = document.createElement('canvas');
      warm.width = 192; warm.height = 192;
      return det.estimatePoses(warm).then(function () { return true; }).catch(function () { return true; });
    }).catch(function (e) {
      console.warn('识别模块没加载上：', e);
      state.lastError = (e && (e.message || e.name)) || String(e);
      return false;
    });
  }

  var frameCanvas = document.createElement('canvas');
  var frameCtx = frameCanvas.getContext('2d');

  function detect(source, cb) {
    if (!state.modelReady || !state.detector) { if (cb) cb(); return; }
    if (state.busy) {
      if (Date.now() - state.busyAt > 12000) state.busy = false;
      else { if (cb) cb(); return; }
    }
    var w, h;
    if (source === video) { w = video.videoWidth; h = video.videoHeight; }
    else { w = source.naturalWidth || source.width; h = source.naturalHeight || source.height; }
    if (!w || !h) { if (cb) cb(); return; }
    // 缩小到长边 320 再送进去，手机才跑得动
    var scale = Math.min(1, 192 / Math.max(w, h));
    var dw = Math.max(1, Math.round(w * scale)), dh = Math.max(1, Math.round(h * scale));
    if (frameCanvas.width !== dw || frameCanvas.height !== dh) {
      frameCanvas.width = dw; frameCanvas.height = dh;
    }
    state.busy = true; state.busyAt = Date.now();
    function done() { state.busy = false; if (cb) cb(); }
    try {
      frameCtx.drawImage(source, 0, 0, dw, dh);
      state.detector.estimatePoses(frameCanvas, { maxPoses: 1, flipHorizontal: false })
        .then(function (poses) {
          state.modelRan = true;
          var pts = null;
          if (poses && poses.length && poses[0].keypoints) {
            var arr = [];
            for (var i = 0; i < 33; i++) arr.push({ x: 0, y: 0, z: 0, visibility: 0 });
            var good = 0;
            poses[0].keypoints.forEach(function (kp, i) {
              var t = MOVENET_MAP[i];
              if (t === undefined) return;
              var sc = kp.score === undefined ? 1 : kp.score;
              if (sc >= 0.3) good++;
              arr[t] = { x: kp.x / dw, y: kp.y / dh, z: 0, visibility: sc };
            });
            // 关键：MoveNet 没看到人时也会返回 17 个点，分数接近 0。
            // 只判「有点」就成了假成功——状态说实时，画面上一条线都没有。
            if (good >= 5) pts = arr;
          }
          if (pts) {
            state.noPerson = false;
            state.points = pts;
            if (!state.gotLandmarks) {
              state.gotLandmarks = true;
              state.recogWarned = false;
              if (state.mode === 'camera' && state.degrade === 0) setStatus('实时');
            }
          } else {
            state.points = null;
            state.gotLandmarks = false;
            if (!state.noPerson) {
              state.noPerson = true;
              state.findings = [];
              if (state.mode === 'camera') {
                setStatus('找人中', 'warn');
                hintbox.hidden = false;
                hintbox.className = 'hintbox mid';
                hintbox.textContent = '没看到人，退后半步让上半身进画面';
                renderTips([]);
              }
            }
          }
          done();
        })
        .catch(function (e) {
          state.lastError = (e && (e.message || e.name)) || String(e);
          if (state.mode === 'camera' && !state.modelRan) {
            hintbox.hidden = false;
            hintbox.className = 'hintbox high';
            hintbox.textContent = '识别出错：' + String(state.lastError).slice(0, 48);
          }
          done();
        });
    } catch (e) {
      state.lastError = (e && (e.message || e.name)) || String(e);
      done();
    }
  }

  // 手部：单独的小模型，懒加载，低频跑，不影响身体识别
  var handCanvas = document.createElement('canvas');
  var handCtx = handCanvas.getContext('2d');

  function initHands() {
    if (state.handReady || state.handTried) return;
    state.handTried = true;
    loadScript(HAND_LIB).then(function () {
      var hpd = window.handPoseDetection;
      if (!hpd) throw new Error('no handPoseDetection');
      return hpd.createDetector(hpd.SupportedModels.MediaPipeHands, {
        runtime: 'tfjs', modelType: 'lite', maxHands: 2
      });
    }).then(function (hd) {
      state.handDetector = hd;
      state.handReady = true;
    }).catch(function (e) {
      console.warn('手部模型没加载上：', e);
    });
  }

  function detectHands() {
    if (!state.handReady || !state.handDetector || state.handBusy) return;
    if (state.mode !== 'camera' && state.mode !== 'photo') return;
    var src = (state.mode === 'camera') ? video : photo;
    var w, h;
    if (src === video) { w = video.videoWidth; h = video.videoHeight; }
    else { w = src.naturalWidth || src.width; h = src.naturalHeight || src.height; }
    if (!w || !h) return;
    // 大部分时候只认手腕附近那一小块（身体识别已经告诉我们手腕在哪）；
    // 每第 8 次扫一次整幅，防止漏掉不在手腕附近的手
    state.handTick = (state.handTick || 0) + 1;
    var box = (state.handTick % 8 === 0) ? { x: 0, y: 0, w: w, h: h } : handBox(w, h);
    var dw = 224, dh = 224;
    if (handCanvas.width !== dw || handCanvas.height !== dh) {
      handCanvas.width = dw; handCanvas.height = dh;
    }
    state.handBusy = true;
    try {
      handCtx.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, dw, dh);
      state.handDetector.estimateHands(handCanvas, { flipHorizontal: false }).then(function (hands) {
        state.handPoints = (hands || []).map(function (hd) {
          return (hd.keypoints || []).map(function (kp) {
            // 先把裁切图里的坐标换回整幅画面的比例
            return {
              x: (box.x + (kp.x / dw) * box.w) / w,
              y: (box.y + (kp.y / dh) * box.h) / h,
              score: kp.score === undefined ? 1 : kp.score
            };
          });
        });
        state.handBusy = false;
      }).catch(function () { state.handBusy = false; state.handPoints = []; });
    } catch (e) { state.handBusy = false; }
  }

  // 以两只手腕为中心裁一块方的，手通常比手腕高一点，所以往上偏
  function handBox(w, h) {
    var pts = state.points, xs = [], ys = [];
    if (pts) {
      [15, 16].forEach(function (i) {
        var q = pts[i];
        if (q && (q.visibility === undefined || q.visibility > 0.3)) { xs.push(q.x * w); ys.push(q.y * h); }
      });
    }
    if (!xs.length) return { x: 0, y: 0, w: w, h: h };
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var side = Math.max(maxX - minX, maxY - minY) * 2.4;
    side = Math.max(side, Math.min(w, h) * 0.40);
    // 两手离得太远时裁出来几乎就是整幅，裁了也没意义，直接整幅
    if (side > Math.min(w, h) * 0.80) return { x: 0, y: 0, w: w, h: h };
    side = Math.min(side, Math.min(w, h) * 0.92);
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2 - side * 0.18;
    var x = Math.max(0, Math.min(w - side, cx - side / 2));
    var y = Math.max(0, Math.min(h - side, cy - side / 2));
    return { x: x, y: y, w: side, h: side };
  }

  // 两次识别之间做插值，手在动时线不会一跳一跳
  function smoothHands() {
    var target = state.handPoints || [];
    var cur = state.handShown || [];
    if (!target.length) { if (cur.length) state.handShown = []; return; }
    if (!cur.length || cur.length !== target.length || cur[0].length !== target[0].length) {
      state.handShown = target.map(function (hand) {
        return hand.map(function (p) { return { x: p.x, y: p.y, score: p.score }; });
      });
      return;
    }
    var k = 0.38;
    for (var i = 0; i < target.length; i++) {
      for (var j = 0; j < target[i].length; j++) {
        cur[i][j].x += (target[i][j].x - cur[i][j].x) * k;
        cur[i][j].y += (target[i][j].y - cur[i][j].y) * k;
        cur[i][j].score = target[i][j].score;
      }
    }
  }

  function viewHandPoints() {
    var list = state.handShown || [];
    if (!isMirrored()) return list;
    return list.map(function (hand) {
      return hand.map(function (p) { return { x: 1 - p.x, y: p.y, score: p.score }; });
    });
  }

  // 场景分类：模型认的是 ImageNet 英文类名，靠关键词映射成我们要的几类。
  // 认不出、或把握不大，就当没认出来——宁可不说，也不给错建议。
  var SCENE_MAP = [
    { id: 'dining', label: '餐厅 / 咖啡厅', k: ['restaurant', 'bakery', 'confectionery', 'coffee', 'espresso', 'dining table', 'tray', 'menu', 'plate', 'wine bottle', 'beer bottle', 'pub', 'deli', 'pizza', 'hot pot', 'cup'] },
    { id: 'home', label: '家里 / 卧室 / 宿舍', k: ['bed', 'quilt', 'pillow', 'studio couch', 'couch', 'wardrobe', 'chest', 'dresser', 'table lamp', 'sleeping bag', 'home theater', 'shower curtain', 'tub', 'bath towel', 'crib', 'cradle', 'mattress', 'blanket', 'window shade', 'wall clock', 'teddy'] },
    { id: 'shop', label: '商场 / 店铺', k: ['grocery store', 'shoe shop', 'toyshop', 'tobacco shop', 'butcher shop', 'bookshop', 'bookstore', 'shopping basket', 'shopping cart', 'supermarket', 'market', 'stall', 'necklace', 'jewelry', 'perfume', 'lipstick', 'handbag', 'purse', 'wallet'] },
    { id: 'office', label: '办公室', k: ['desk', 'notebook', 'laptop', 'computer', 'keyboard', 'monitor', 'screen', 'photocopier', 'printer', 'filing cabinet', 'binder', 'ballpoint', 'stapler', 'modem', 'hard disc', 'typewriter', 'office'] },
    { id: 'street', label: '街道 / 马路', k: ['street sign', 'traffic light', 'cab', 'police van', 'minibus', 'convertible', 'sports car', 'limousine', 'jeep', 'pickup', 'moving van', 'fire engine', 'ambulance', 'bicycle', 'motor scooter', 'moped', 'manhole cover', 'crash helmet', 'parking meter', 'mailbox'] },
    { id: 'park', label: '公园 / 绿地', good: true, k: ['park bench', 'lakeside', 'patio', 'greenhouse', 'daisy', 'dandelion', 'yellow lady', 'tree', 'forest', 'woodland', 'meadow', 'lawn', 'flower', 'birdhouse', 'fountain', 'gazebo', 'barn'] },
    { id: 'water', label: '海边 / 水边', good: true, k: ['seashore', 'sandbar', 'coral reef', 'pier', 'breakwater', 'canoe', 'speedboat', 'lifeboat', 'yawl', 'beach', 'ocean', 'lake', 'waterfall', 'dock', 'geyser'] },
    { id: 'building', label: '建筑 / 墙面', good: true, k: ['palace', 'monastery', 'church', 'mosque', 'dome', 'castle', 'prison', 'tile roof', 'thatched roof', 'bannister', 'balustrade', 'stone wall', 'brick', 'arch', 'triumphal', 'obelisk', 'lighthouse', 'clock tower'] }
  ];

  // 只认整词或词首（后面必须跟空格），否则 'bed' 会匹配到 'bedlington terrier' 这种狗
  function matchScene(name) {
    if (!name) return null;
    var toks = String(name).toLowerCase().split(',');
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i].trim();
      for (var j = 0; j < SCENE_MAP.length; j++) {
        var k = SCENE_MAP[j].k;
        for (var m = 0; m < k.length; m++) {
          if (t === k[m] || t.indexOf(k[m] + ' ') === 0) return SCENE_MAP[j];
        }
      }
    }
    return null;
  }

  function initScene() {
    if (state.sceneReady || state.sceneTried) return;
    state.sceneTried = true;
    // 这个库要求页面上已经有 tfjs；身体识别没起来时它可能不在，先补上
    var pre = window.tf ? Promise.resolve() : loadScript(TFJS_URL);
    pre.then(function () {
      return loadScript(SCENE_LIB);
    }).then(function () {
      if (!window.mobilenet) throw new Error('no mobilenet');
      return window.mobilenet.load({ version: 1, alpha: 0.25, modelUrl: SCENE_MODEL });
    }).then(function (m) {
      state.sceneModel = m;
      state.sceneReady = true;
    }).catch(function (e) {
      console.warn('场景模型没加载上：', e);
    });
  }

  function classifyScene() {
    if (!state.sceneReady || !state.sceneModel || state.sceneBusy) return;
    if (state.mode !== 'camera' || video.readyState < 2) return;
    state.sceneBusy = true;
    Promise.resolve(state.sceneModel.classify(video, 3)).then(function (preds) {
      state.sceneBusy = false;
      var best = null;
      (preds || []).forEach(function (p) {
        if (best) return;
        var cat = matchScene(p.className);
        if (cat) best = { id: cat.id, label: cat.label, conf: p.probability, good: !!cat.good };
      });
      // 把握不大就当没认出来
      state.scene = (best && best.conf >= 0.45) ? best : null;
    }).catch(function () { state.sceneBusy = false; });
  }

  function mediaSize(source) {
    if (source === video) return { w: video.videoWidth, h: video.videoHeight };
    return { w: photo.naturalWidth, h: photo.naturalHeight };
  }

  function fitRect() {
    var vw = view.clientWidth, vh = view.clientHeight;
    if (state.demoMode || state.mode === 'demo') return { x: 0, y: 0, w: vw, h: vh };
    var ms = mediaSize(state.mode === 'camera' ? video : photo);
    if (!ms.w || !ms.h) return { x: 0, y: 0, w: vw, h: vh };
    var scale = Math.min(vw / ms.w, vh / ms.h);
    var w = ms.w * scale, h = ms.h * scale;
    return { x: (vw - w) / 2, y: (vh - h) / 2, w: w, h: h };
  }

  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(view.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(view.clientHeight * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function isMirrored() { return state.mode === 'camera' && state.facing === 'user'; }

  // 直接写内联样式，不依赖 CSS 是否加载成功
  function applyMirror() {
    var on = state.facing === 'user';
    video.style.transform = on ? 'scaleX(-1)' : 'none';
    video.classList.toggle('mirror', on);
  }

  // 前置像苹果自带相机那样镜像：画面镜像、骨架线和判断也跟着镜像，提示方向才不会反
  function viewPoints() {
    var pts = state.points;
    if (!pts || !isMirrored()) return pts;
    return pts.map(function (p) {
      if (!p) return p;
      return { x: 1 - p.x, y: p.y, z: p.z, visibility: p.visibility };
    });
  }

  function viewStats() {
    var s = state.stats;
    if (!s) return s;
    var c = {};
    for (var k in s) c[k] = s[k];
    c.levelDeg = state.levelDeg;      // 陀螺仪测的真实侧倾；没有就是 null
    c.scene = state.scene;            // 认出来的场景；没认出来就是 null
    if (!isMirrored()) return c;
    if (c.verticalX != null) c.verticalX = 1 - c.verticalX;
    return c;
  }

  // 水平仪：用手机内置陀螺仪读侧倾（roll）。和仰拍俯拍无关，只测左右歪。
  // 注意：iOS 13+ 必须在用户点击里申请权限，所以放在「摄像头」按钮里调。
  function initLevel() {
    state.levelDenied = false;
    if (!window.DeviceMotionEvent) return Promise.resolve(false);   // 电脑没有，退回按肩膀估算
    if (typeof window.DeviceMotionEvent.requestPermission === 'function') {
      var p;
      try { p = window.DeviceMotionEvent.requestPermission(); }
      catch (e) { state.levelDenied = true; return Promise.resolve(false); }
      return Promise.resolve(p).then(function (r) {
        if (r === 'granted') { startLevel(); return true; }
        state.levelDenied = true;
        return false;
      }).catch(function () { state.levelDenied = true; return false; });
    }
    startLevel();
    return Promise.resolve(true);
  }

  function startLevel() {
    if (state.levelOn) return;
    state.levelOn = true;
    window.addEventListener('devicemotion', onMotion, { passive: true });
  }

  function onMotion(e) {
    var g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    // 横屏时手机的 x/y 轴跟着转了，读数会错，宁可不给，也不给错
    var ang = (window.screen && screen.orientation && screen.orientation.angle) || window.orientation || 0;
    if (ang === 90 || ang === -90 || ang === 270) { state.levelDeg = null; return; }
    // 低通滤波：手会抖，原始值跳得厉害
    state.gx = state.gx === null ? g.x : state.gx * 0.82 + g.x * 0.18;
    state.gy = state.gy === null ? g.y : state.gy * 0.82 + g.y * 0.18;
    // 手机几乎平放时 x/y 都接近 0，算出来全是噪声，跳过
    if (Math.abs(state.gy) < 1.2) { state.levelDeg = null; return; }
    // 正值 = 右边低（重力往 +x 拉）
    var deg = Math.atan2(state.gx, -state.gy) * 180 / Math.PI;
    state.levelDeg = (ang === 180) ? -deg : deg;
  }

  function drawLevel(r) {
    var d = state.levelDeg;
    if (d === null || d === undefined || state.mode !== 'camera') return;
    var ok = Math.abs(d) <= 1.5;
    var y = r.y + r.h * 0.62;
    var cx = r.x + r.w / 2;
    var half = Math.min(r.w * 0.22, 110);
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ok ? 'rgba(93,202,165,0.95)' : 'rgba(239,159,39,0.95)';
    ctx.beginPath();
    ctx.moveTo(cx - half, y); ctx.lineTo(cx + half, y);
    ctx.moveTo(cx - half, y - 6); ctx.lineTo(cx - half, y + 6);
    ctx.moveTo(cx + half, y - 6); ctx.lineTo(cx + half, y + 6);
    ctx.stroke();
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = ok ? 'rgba(93,202,165,0.95)' : 'rgba(239,159,39,0.95)';
    ctx.fillText(ok ? '水平' : ('歪 ' + Math.abs(d).toFixed(0) + '°'), cx, y - 12);
    ctx.restore();
  }

  function drawSkeleton() {
    resizeCanvas();
    ctx.clearRect(0, 0, view.clientWidth, view.clientHeight);
    var r = fitRect();
    drawLevel(r);
    var pts = viewPoints();
    if (!pts) return;
    var stats = viewStats();

    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,130,130,0.9)';
    if (stats.hasLongLine && stats.lineY != null) {
      var ly = r.y + stats.lineY * r.h;
      ctx.beginPath(); ctx.moveTo(r.x, ly); ctx.lineTo(r.x + r.w, ly); ctx.stroke();
    }
    if (stats.hasVerticalLine && stats.verticalX != null) {
      var vx = r.x + stats.verticalX * r.w;
      ctx.beginPath(); ctx.moveTo(vx, r.y); ctx.lineTo(vx, r.y + r.h); ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#5dcaa5';
    ctx.beginPath();
    Rules.CONNECTIONS.forEach(function (pair) {
      // 脸上的点不连：头部已经用一个圆圈表示了，再连就成了乱线
      if (pair[0] <= 10 && pair[1] <= 10) return;
      var a = pts[pair[0]], b = pts[pair[1]];
      if (!a || !b) return;
      if ((a.visibility !== undefined && a.visibility < 0.35) ||
          (b.visibility !== undefined && b.visibility < 0.35)) return;
      ctx.moveTo(r.x + a.x * r.w, r.y + a.y * r.h);
      ctx.lineTo(r.x + b.x * r.w, r.y + b.y * r.h);
    });
    ctx.stroke();

    pts.forEach(function (q, idx) {
      if (idx <= 10) return;
      if (!q || (q.visibility !== undefined && q.visibility < 0.35)) return;
      var x = r.x + q.x * r.w, y = r.y + q.y * r.h;
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#9fe1cb'; ctx.stroke();
    });
    ctx.restore();

    // 头部画成一个圆圈（用鼻、眼、耳估半径）：比一堆连线更像人
    ctx.save();
    var nose = pts[0];
    var shown = function (q) { return q && (q.visibility === undefined || q.visibility > 0.2); };
    if (shown(nose)) {
      var rr = 0;
      [7, 8, 2, 5].forEach(function (i) {
        var q = pts[i];
        if (!shown(q)) return;
        rr = Math.max(rr, Math.abs(q.x - nose.x), Math.abs(q.y - nose.y) * (r.h / Math.max(1, r.w)));
      });
      if (rr > 0.02) {
        ctx.beginPath();
        ctx.arc(r.x + nose.x * r.w, r.y + nose.y * r.h, rr * r.w, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,209,102,0.16)';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#ffd166';
        ctx.stroke();
      }
    }
    ctx.restore();

    // 手部：亮青色，每根手指一条线
    var hands = viewHandPoints();
    if (hands && hands.length) {
      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#7fd8ff';
      ctx.beginPath();
      hands.forEach(function (hand) {
        Rules.HAND_CONNECTIONS.forEach(function (pair) {
          var a = hand[pair[0]], b = hand[pair[1]];
          if (!a || !b) return;
          if ((a.score !== undefined && a.score < 0.3) || (b.score !== undefined && b.score < 0.3)) return;
          ctx.moveTo(r.x + a.x * r.w, r.y + a.y * r.h);
          ctx.lineTo(r.x + b.x * r.w, r.y + b.y * r.h);
        });
      });
      ctx.stroke();
      hands.forEach(function (hand) {
        hand.forEach(function (p) {
          if (p.score !== undefined && p.score < 0.3) return;
          ctx.beginPath();
          ctx.arc(r.x + p.x * r.w, r.y + p.y * r.h, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = '#7fd8ff'; ctx.fill();
        });
      });
      ctx.restore();
    }

    if (state.demoMode || state.mode === 'demo') {
      ctx.save();
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(226,236,244,0.72)';
      ctx.fillText('演示数据', view.clientWidth - 14, view.clientHeight - 20);
      ctx.restore();
    }
  }

  // 把画面缩到 64x64 算亮度、横线、竖线；只出结论，不存画面
  function analyzeImage(source) {
    var N = 64;
    var tmp = document.createElement('canvas');
    tmp.width = N; tmp.height = N;
    var c = tmp.getContext('2d', { willReadFrequently: true });
    try { c.drawImage(source, 0, 0, N, N); }
    catch (e) { return {}; }
    var d;
    try { d = c.getImageData(0, 0, N, N).data; }
    catch (e) { return {}; }

    var g = new Float32Array(N * N);
    for (var i = 0; i < N * N; i++) {
      g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    }
    function region(x0, y0, x1, y1) {
      var s = 0, n = 0;
      for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { s += g[y * N + x]; n++; }
      return n ? s / n : 0;
    }
    var faceLuma = region(22, 10, 42, 26);
    var bgLuma = (region(0, 0, 12, 12) + region(52, 0, 64, 12) +
                  region(0, 52, 12, 64) + region(52, 52, 64, 64)) / 4;

    var rowGrad = [], maxRow = 0, maxRowY = 0, rowSum = 0;
    for (var y = 1; y < N - 1; y++) {
      var s = 0;
      for (var x = 1; x < N - 1; x++) s += Math.abs(g[y * N + x] - g[y * N + x - 1]);
      rowGrad[y] = s; rowSum += s;
      if (s > maxRow) { maxRow = s; maxRowY = y; }
    }
    var rowAvg = rowSum / (N - 2);
    var hasLongLine = maxRow > rowAvg * 2.6 && maxRowY > 6 && maxRowY < N - 7;

    var colGrad = [], maxCol = 0, maxColX = 0, colSum = 0;
    for (var cx = 1; cx < N - 1; cx++) {
      var sc = 0;
      for (var cy = 1; cy < N - 1; cy++) sc += Math.abs(g[cy * N + cx] - g[(cy - 1) * N + cx]);
      colGrad[cx] = sc; colSum += sc;
      if (sc > maxCol) { maxCol = sc; maxColX = cx; }
    }
    var colAvg = colSum / (N - 2);
    var hasVerticalLine = maxCol > colAvg * 2.6 && maxColX > 6 && maxColX < N - 7;

    // 背景区域：避开中间的人，只取两侧和顶部一圈
    function isBg(x, y) { return x < 18 || x > 46 || y < 10; }
    var bgN = 0, edge = 0, bSum = 0, bSum2 = 0;
    for (var yy = 0; yy < N; yy++) {
      for (var xx = 0; xx < N; xx++) {
        if (!isBg(xx, yy)) continue;
        var idx = yy * N + xx, v = g[idx];
        bgN++; bSum += v; bSum2 += v * v;
        if (xx < N - 1 && yy < N - 1) {
          // 和右邻、下邻差得多就算一条边；边缘越密 = 背景越碎
          if (Math.abs(v - g[idx + 1]) > 12 || Math.abs(v - g[idx + N]) > 12) edge++;
        }
      }
    }
    var bgMean = bgN ? bSum / bgN : 0;
    var bgStd = bgN ? Math.sqrt(Math.max(0, bSum2 / bgN - bgMean * bgMean)) : 0;
    var busy = bgN ? edge / bgN : 0;

    // 脸区的红蓝差：判断光偏冷还是偏黄（只取脸，因为要看的正是肤色）
    var fr = 0, fb = 0, fn = 0;
    for (var fy = 10; fy < 26; fy++) {
      for (var fx = 22; fx < 42; fx++) {
        var fi = (fy * N + fx) * 4;
        fr += d[fi]; fb += d[fi + 2]; fn++;
      }
    }
    var warmth = fn ? ((fr - fb) / fn) / 255 : 0;

    return {
      faceLuma: faceLuma, bgLuma: bgLuma,
      backlit: bgLuma > 25 && faceLuma < bgLuma * 0.72,
      hasLongLine: hasLongLine, lineY: hasLongLine ? maxRowY / N : null,
      hasVerticalLine: hasVerticalLine, verticalX: hasVerticalLine ? maxColX / N : null,
      busy: busy, bgStd: bgStd, warmth: warmth
    };
  }

  function runRules() {
    var pts = viewPoints();
    if (!pts) {
      if (state.mode === 'camera' && state.modelRan) {
        hintbox.hidden = false;
        hintbox.className = 'hintbox mid';
        hintbox.textContent = '没看到人，退后半步让上半身进画面';
      }
      return;
    }
    var frame = Rules.derive(pts, viewStats(), state.shot);
    state.findings = Rules.evaluate(frame, state.config);
    renderTips(state.findings);
    var top = state.findings[0];
    hintbox.hidden = false;
    hintbox.className = 'hintbox' + (top ? ' ' + top.severity : '');
    hintbox.textContent = top ? (TIP_SHORT[top.text] || top.text) : '没发现明显问题';
  }

  function renderAll() { drawSkeleton(); runRules(); }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  var lastTipKey = '';

  function showFrozen() {
    var box = $('panel-tips');
    if (box.querySelector('.frozen')) return;
    var bar = document.createElement('div');
    bar.className = 'frozen';
    bar.textContent = '已暂停更新，收起后继续';
    box.insertBefore(bar, box.firstChild);
  }

  function renderTips(findings) {
    var box = $('panel-tips');
    var list = (findings || []).slice(0, 6);
    // 有人正在看「为什么」：整块先别重画，否则内容一动就跑掉了
    var opened = false;
    for (var e in state.expanded) { if (state.expanded[e]) { opened = true; break; } }
    if (opened) { showFrozen(); return; }
    var fz = box.querySelector('.frozen');
    if (fz) { fz.remove(); lastTipKey = ''; }
    if (!list.length) {
      if (lastTipKey !== '__empty__') {
        box.innerHTML = '<div class="none">暂无提醒</div>';
        lastTipKey = '__empty__';
      }
      return;
    }
    // 内容没变就别重画，否则刚点开的「为什么」会被冲掉
    var key = list.map(function (f) { return f.ruleId + '|' + f.text; }).join('~');
    if (key === lastTipKey && box.querySelector('.tip')) return;
    lastTipKey = key;
    var more = findings.length > 6 ? '<div class="meta">还有 ' + (findings.length - 6) + ' 条</div>' : '';
    box.innerHTML = more + list.map(function (f) {
      var open = state.expanded[f.ruleId] ? ' show' : '';
      var vote = state.votes[f.ruleId];
      return '<div class="tip ' + f.severity + '" data-rule="' + f.ruleId + '">' +
        '<div class="t">' + esc(TIP_SHORT[f.text] || f.text) + '</div>' +
        '<div class="why' + open + '">' + esc(f.text) + '<br>' + esc(f.why) +
          '<br><span class="meta">' + esc(f.tags.join(' · ')) + '</span></div>' +
        '<div class="btns">' +
          '<button data-act="why" data-rule="' + f.ruleId + '">' + (open ? '收起' : '为什么') + '</button>' +
          '<button data-act="good" data-rule="' + f.ruleId + '" class="' + (vote === true ? 'picked' : '') + '">有用</button>' +
          '<button data-act="bad" data-rule="' + f.ruleId + '" class="' + (vote === false ? 'picked' : '') + '">没用</button>' +
        '</div></div>';
    }).join('');
  }

  function renderRules() {
    var box = $('rulesList');
    box.innerHTML = Rules.list().map(function (r) {
      var c = state.config[r.id] || { enabled: true, level: 2 };
      // 「任何时候」这种说明是噪音，只在有条件时才显示
      var when = (r.when && r.when !== '任何时候') ? '<div class="rw">' + esc(r.when) + '</div>' : '';
      return '<div class="rule" data-id="' + r.id + '">' +
        '<div class="rh"><span class="rn">' + esc(r.name) + '</span>' +
        '<button class="switch ' + (c.enabled ? 'on' : 'off') + '" data-act="toggle" aria-label="开关">' +
        (c.enabled ? '开' : '关') + '</button></div>' +
        when +
        '<div class="levels">' +
          [1, 2, 3].map(function (n) {
            return '<button data-act="level" data-n="' + n + '" class="' + (c.level === n ? 'on' : '') + '">' +
              ['松', '中', '紧'][n - 1] + '</button>';
          }).join('') +
        '</div></div>';
    }).join('');
  }

  function renderLog() {
    var box = $('logList');
    if (!state.feedback.length) { box.innerHTML = '<div class="none">暂无记录</div>'; return; }
    box.innerHTML = state.feedback.slice().reverse().slice(0, 50).map(function (it) {
      return '<div class="logitem"><div>' + esc(it.name) + ' · ' +
        (it.useful === true ? '有用' : (it.useful === false ? '没用' : '快门')) + '</div>' +
        '<div class="lt">' + new Date(it.t).toLocaleString('zh-CN') + ' · ' + esc((it.tags || []).join(' / ')) + '</div></div>';
    }).join('');
  }

  function addFeedback(finding, useful) {
    state.feedback.push({
      t: Date.now(), ruleId: finding.ruleId, name: finding.name,
      tags: finding.tags, useful: useful
    });
    saveJSON(LOG_KEY, state.feedback);
    renderLog();
  }

  function switchTab(name) {
    ['tips', 'rules', 'log', 'privacy'].forEach(function (n) {
      $('panel-' + n).hidden = (n !== name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === name);
    });
  }

  function normalStatus() {
    setStatus(state.modelReady ? '本地运行 · 实时提醒' : '摄像头已开 · 识别模块没加载上',
      state.modelReady ? '' : 'warn');
  }

  function setDegrade(level) {
    state.degrade = level;
    state.frameTimes = []; state.lowSince = 0; state.highSince = 0;
    var btn = $('btnResume');
    if (btn) btn.hidden = (level === 0);
    if (level === 2) setStatus('省电模式 · 实时已暂停，按快门给结论', 'warn');
    else if (level === 1) setStatus('省电模式 · 提醒变慢了', 'warn');
    else normalStatus();
  }

  function resumeRealtime(auto) {
    setDegrade(0);
    state.lastRuleAt = 0; state.lastStatsAt = 0;
    hintbox.hidden = false;
    hintbox.textContent = '已恢复实时';
  }

  function updateDegrade(ts) {
    if (state.mode !== 'camera') return;
    // 切到别的标签、锁屏、最小化时浏览器会暂停画面刷新，这种停顿不算「卡」
    if (document.hidden) { state.frameTimes = []; state.lowSince = 0; state.highSince = 0; return; }
    var t = state.frameTimes;
    if (t.length && ts - t[t.length - 1] > 1000) {
      state.frameTimes = []; state.lowSince = 0; state.highSince = 0; return;
    }
    t.push(ts);
    if (t.length > 45) t.shift();
    if (t.length < 30) return;
    var span = ts - t[0];
    if (span < 500) return;
    var fps = (t.length - 1) * 1000 / Math.max(1, span);

    if (state.degrade === 2) {
      if (fps > 26) {
        if (!state.highSince) state.highSince = ts;
        if (ts - state.highSince > 3000) resumeRealtime(true);
      } else state.highSince = 0;
      return;
    }
    if (fps < 6) {
      if (!state.lowSince) state.lowSince = ts;
      if (ts - state.lowSince > 1500) setDegrade(2);
    } else if (fps < 10) {
      if (!state.lowSince) state.lowSince = ts;
      if (ts - state.lowSince > 2000 && state.degrade < 1) setDegrade(1);
    } else {
      state.lowSince = 0;
      if (state.degrade === 1) setDegrade(0);
    }
  }

  function loop(ts) {
    if (!state.running) return;
    requestAnimationFrame(loop);
    if (state.mode !== 'camera' || video.readyState < 2) return;
    smoothHands();
    drawSkeleton();
    if (state.degrade < 2) detect(video);
    if (state.handReady && !state.handBusy && ts - state.lastHandAt > (state.degrade ? 400 : 150)) {
      state.lastHandAt = ts;
      detectHands();
    }
    // 场景变得慢，2.5 秒看一次就够，省电
    if (state.sceneReady && !state.sceneBusy && ts - state.lastSceneAt > 2500) {
      state.lastSceneAt = ts;
      classifyScene();
    }
    if (ts - state.lastStatsAt > (state.degrade ? 3000 : 1500)) {
      state.stats = analyzeImage(video);
      state.lastStatsAt = ts;
    }
    if (ts - state.lastRuleAt > (state.degrade === 1 ? 1000 : 500)) {
      runRules();
      state.lastRuleAt = ts;
    }
    updateDegrade(ts);
  }

  function updateShutter() {
    var b = $('btnShoot');
    if (!b) return;
    var label = b.querySelector('.sh-label');
    var t = state.starting ? '启动中…'
      : (state.mode === 'camera' ? '拍照' : (state.mode === 'photo' ? '重拍' : '开摄像头'));
    if (label) label.textContent = t;
    b.classList.toggle('ready', state.mode === 'camera' && !state.starting);
    b.disabled = !!state.starting;   // 启动中不让连点，否则会把刚建好的流掐掉
  }

  function showSource(which) {
    lastTipKey = '';
    state.expanded = {};      // 换了画面来源，之前展开的说明不再对应
    updateShutter();
    if (state.mode !== 'camera') {
      state.degrade = 0; state.frameTimes = [];
      state.handPoints = []; state.handShown = []; state.handTick = 0;
      var resumeBtn = $('btnResume');
      if (resumeBtn) resumeBtn.hidden = true;
    }
    video.classList.toggle('on', which === 'video');
    photo.classList.toggle('on', which === 'photo');
    empty.classList.add('gone');
  }

  function showError(msg) {
    var el = $('err');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }
  function clearError() { var el = $('err'); if (el) el.hidden = true; }
  function cameraError(e) {
    var n = (e && e.name) || '';
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError')
      return '摄像头被挡：点地址栏小锁 → 允许。预览小窗口请用 Chrome / Edge 打开 localhost:8000。';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError')
      return '没找到摄像头，检查是否插上或被占用。';
    if (n === 'NotReadableError' || n === 'TrackStartError')
      return '摄像头被别的程序占用，关掉它再试。';
    return '摄像头打不开（' + (n || '原因不明') + '），请用 localhost:8000 打开。';
  }

  function watchRecognition() {
    setTimeout(function () {
      if (state.mode !== 'camera') return;
      // 模型已经在跑就不管了：有没有人由 detect 自己判断并提示
      if (state.modelRan) return;
      state.recogWarned = true;
      setStatus('识别未就绪', 'warn');
      hintbox.className = 'hintbox high';
      hintbox.textContent = '这台设备没跑起识别，可点「演示」';
    }, 12000);
  }

  function ruleEnabled(id) {
    var c = state.config && state.config[id];
    return !c || c.enabled !== false;
  }

  // 拿摄像头：先用 exact 强制指定前后置（不然浏览器可能随便给一个），
  // 设备不支持再退回软约束，最后再退到默认摄像头
  function getCamStream(facing) {
    var md = navigator.mediaDevices;
    return md.getUserMedia({ video: { facingMode: { exact: facing } }, audio: false })
      .catch(function () {
        return md.getUserMedia({ video: { facingMode: facing }, audio: false });
      })
      .catch(function () {
        return md.getUserMedia({ video: true, audio: false });
      });
  }

  function updateFlipLabel() {
    var b = $('btnFlip');
    if (b) b.textContent = state.facing === 'user' ? '切后置' : '切前置';
  }

  // 以摄像头自己报的为准，避免"按钮写着后置、实际是前置"
  function syncFacing(stream) {
    try {
      var tr = stream.getVideoTracks()[0];
      var s = tr && tr.getSettings ? tr.getSettings() : null;
      if (s && (s.facingMode === 'user' || s.facingMode === 'environment')) state.facing = s.facingMode;
    } catch (e) {}
    updateFlipLabel();
  }

  function startCamera() {
    // 启动要 1~3 秒，这期间再点一次会把刚建好的流掐掉重来，永远开不成
    if (state.starting || state.mode === 'camera') return;
    state.starting = true;
    var gen = ++state.camGen;
    updateShutter();
    clearError();
    stopStream();
    // 先要方向权限，再要摄像头。iOS 上两个权限框同时弹会互相打架，导致摄像头永远起不来
    var perm = initLevel();
    setStatus('启动中');
    hintbox.hidden = false;
    hintbox.textContent = '会弹权限，都点「允许」';
    setTimeout(function () {
      if (gen !== state.camGen) return;
      if (state.mode === 'idle' && state.starting) {
        state.starting = false;
        updateShutter();
        showError('摄像头一直没响应。检查两件事：用自己的 Chrome / Edge 打开；弹出的权限点「允许」。');
        setStatus('无响应', 'warn');
      }
    }, 15000);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      state.starting = false; updateShutter();
      showError('此页面不能用摄像头，请用 localhost:8000 或 start.bat 打开。');
      startDemo('页面不支持摄像头');
      return;
    }
    // 权限框最多等 3 秒，别因为用户没点而卡死
    Promise.race([Promise.resolve(perm), new Promise(function (r) { setTimeout(function () { r(false); }, 3000); })])
      .then(function () {
        if (gen !== state.camGen) return null;
        return getCamStream(state.facing);   // 用当前选的镜头，别再固定前置
      })
      .then(function (stream) {
        if (gen !== state.camGen || !stream) {
          if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
          return null;
        }
        state.stream = stream;
        video.srcObject = stream;
        syncFacing(stream);
        return video.play();
      })
      .then(function () {
        if (gen !== state.camGen) return;
        state.starting = false;
        clearError();
        state.mode = 'camera'; state.running = true; state.demoMode = false;
        state.points = null; setDegrade(0);
        state.gotLandmarks = false; state.recogWarned = false;
        state.modelRan = false; state.noPerson = false; state.busy = false;
        state.scene = null; state.lastSceneAt = 0;
        state.lastRuleAt = 0; state.lastStatsAt = 0;
        showSource('video');
        applyMirror();
        setStatus('加载识别');
        hintbox.hidden = false;
        hintbox.textContent = '正在加载识别';
        requestAnimationFrame(loop);
        return initModel();
      })
      .then(function (ok) {
        if (gen !== state.camGen) return;
        if (state.mode !== 'camera') return;
        if (ok) {
          setStatus('找人中', 'warn');
          hintbox.hidden = false;
          hintbox.className = 'hintbox mid';
          hintbox.textContent = '识别已就绪，找人中…退后半步让上半身进画面';
          initHands();
          if (ruleEnabled('scene')) initScene();
          watchRecognition();
        } else {
          setStatus('识别未就绪', 'warn');
          hintbox.textContent = '识别没起来，可点「演示」';
        }
      })
      .catch(function (e) {
        console.warn(e);
        if (gen !== state.camGen) return;
        state.starting = false;
        updateShutter();
        showError(cameraError(e));
        if (state.mode !== 'camera') startDemo('摄像头没打开');
        else setStatus('识别未就绪', 'warn');
      });
  }

  function stopStream() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { t.stop(); });
      state.stream = null;
    }
  }

  function switchCamera() {
    var next = state.facing === 'user' ? 'environment' : 'user';
    // 拍完照（photo 模式）点这个，应该用另一个镜头重新开，而不是弹一句没用的话
    if (state.mode !== 'camera') {
      state.facing = next;
      updateFlipLabel();
      startCamera();
      return;
    }
    if (state.switching) return;
    state.switching = true;
    stopStream();
    getCamStream(next)
      .then(function (stream) {
        state.stream = stream;
        state.facing = next;
        video.srcObject = stream;
        syncFacing(stream);
        return video.play();
      })
      .then(function () {
        state.switching = false;
        applyMirror();
        state.points = null; state.gotLandmarks = false;
        state.modelRan = false; state.noPerson = false; state.busy = false;
        state.scene = null; state.lastSceneAt = 0;
        setStatus('找人中', 'warn');
        hintbox.hidden = false;
        hintbox.className = 'hintbox mid';
        hintbox.textContent = '已切到' + (state.facing === 'user' ? '前置（镜像）' : '后置') + '，找人中…';
        watchRecognition();
      })
      .catch(function (e) {
        state.switching = false;
        showError('切不了摄像头：' + ((e && e.name) || '原因不明'));
      });
  }

  function startPhoto(file) {
    state.camGen++; state.starting = false;   // 取消可能还在启动的摄像头
    var reader = new FileReader();
    reader.onload = function (ev) {
      photo.onload = function () {
        state.mode = 'photo'; state.running = false; state.demoMode = false;
        state.shotPhoto = null;
        $('btnSave').hidden = true;
        showSource('photo');
        state.stats = analyzeImage(photo);
        setStatus('识别中');
        initModel().then(function (ok) {
          if (!ok) {
            state.points = Rules.DEMO_POINTS;
            state.demoMode = true;
            setStatus('演示', 'demo');
            renderAll();
            hintbox.hidden = false;
            hintbox.textContent = '识别模块没加载上';
            return;
          }
          state.points = null;
          detect(photo, function () {
            if (!state.points) {
              state.points = Rules.DEMO_POINTS; state.demoMode = true;
              setStatus('演示', 'demo');
            } else {
              state.demoMode = false; setStatus('本地');
            }
            renderAll();
          });
        });
      };
      photo.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function startDemo(reason) {
    state.camGen++; state.starting = false;   // 取消可能还在启动的摄像头
    state.mode = 'demo'; state.running = false; state.demoMode = true;
    state.shotPhoto = null;
    $('btnSave').hidden = true;
    state.points = Rules.DEMO_POINTS;
    state.stats = {
      faceLuma: 62, bgLuma: 168, backlit: true,
      hasLongLine: true, lineY: 0.31,
      hasVerticalLine: true, verticalX: 0.69
    };
    showSource('none');
    setStatus('演示', 'demo');
    renderAll();
    if (reason) { hintbox.hidden = false; hintbox.textContent = reason; }
  }

  function shoot() {
    // 实时画面：真的抓一张下来（成片不镜像，和苹果自带相机一致）
    if (state.mode === 'camera' && video.readyState >= 2 && video.videoWidth) {
      var w = video.videoWidth, h = video.videoHeight;
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(video, 0, 0, w, h);
      state.shotPhoto = c.toDataURL('image/jpeg', 0.92);
      state.running = false;
      state.mode = 'photo';
      state.demoMode = false;
      state.points = null;
      $('btnSave').hidden = true;
      setStatus('已拍');
      hintbox.hidden = false;
      hintbox.className = 'hintbox';
      hintbox.textContent = '正在看这张…';
      photo.onload = function () {
        state.stats = analyzeImage(photo);
        detect(photo, function () {
          if (!state.points) { state.points = Rules.DEMO_POINTS; state.demoMode = true; }
          renderAll();
          $('btnSave').hidden = false;
          hintbox.textContent = '拍好了 · 可保存或重拍';
        });
      };
      photo.src = state.shotPhoto;
      showSource('photo');
      return;
    }
    if (!state.points) { hintbox.hidden = false; hintbox.textContent = '先点「摄像头」或「演示」'; return; }
    renderAll();
    $('btnSave').hidden = !state.shotPhoto;
    setStatus('本地');
  }

  // 网页不能直接写相册：先试系统分享（可存图像），不行就下载
  function savePhoto() {
    var url = state.shotPhoto;
    if (!url) { hintbox.hidden = false; hintbox.textContent = '先拍一张'; return; }
    var name = 'photo-' + Date.now() + '.jpg';
    function download() {
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      hintbox.textContent = '已存到「文件」，可在相册里导入';
    }
    try {
      fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
        var file = new File([blob], name, { type: 'image/jpeg' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).then(function () {
            hintbox.textContent = '已处理完 · 再拍一张就点圆按钮';
          }).catch(function () {});
        } else download();
      }).catch(download);
    } catch (e) { download(); }
  }

  function bind() {
    $('btnHelp').onclick = function () { $('help').hidden = false; };
    $('helpClose').onclick = function () { $('help').hidden = true; };
    $('btnPhoto').onclick = function () { $('file').click(); };
    $('file').onchange = function (e) { if (e.target.files[0]) startPhoto(e.target.files[0]); };
    $('btnDemo').onclick = function () { clearError(); startDemo(); };
    // 一个快门管三件事：没画面就开摄像头，有画面就拍，拍完了就重拍
    $('btnShoot').onclick = function () {
      if (state.mode === 'camera') shoot();
      else startCamera();
    };
    $('btnSave').onclick = savePhoto;
    $('btnResume').onclick = function () { resumeRealtime(false); };
    $('btnFlip').onclick = switchCamera;
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { state.frameTimes = []; state.lowSince = 0; state.highSince = 0; }
    });

    $('btnGrid').onclick = function () {
      state.gridOn = !state.gridOn;
      $('grid').hidden = !state.gridOn;
      this.textContent = state.gridOn ? '网格 开' : '网格';
      this.classList.toggle('on', state.gridOn);
    };

    // 拍法：点一下换一种，平拍 → 仰拍 → 俯拍
    var SHOTS = ['flat', 'low', 'high'], SHOT_NAME = { flat: '平拍', low: '仰拍', high: '俯拍' };
    $('btnShot').onclick = function () {
      var i = SHOTS.indexOf(state.shot);
      state.shot = SHOTS[(i + 1) % 3];
      this.textContent = SHOT_NAME[state.shot];
      this.classList.toggle('on', state.shot !== 'flat');
      if (state.points) runRules();
    };

    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.onclick = function () { switchTab(b.getAttribute('data-tab')); };
    });

    $('panel-tips').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var rid = b.getAttribute('data-rule');
      var act = b.getAttribute('data-act');
      var tip = b.closest('.tip');
      var f = null;
      for (var k = 0; k < state.findings.length; k++) {
        if (state.findings[k].ruleId === rid) { f = state.findings[k]; break; }
      }
      if (!f || !tip) return;
      if (act === 'why') {
        state.expanded[rid] = !state.expanded[rid];
        var why = tip.querySelector('.why');
        if (why) why.classList.toggle('show', state.expanded[rid]);
        b.textContent = state.expanded[rid] ? '收起' : '为什么';
        if (state.expanded[rid]) {
          showFrozen();
          try { tip.scrollIntoView({ block: 'nearest' }); } catch (err) {}
        } else {
          lastTipKey = '';
          renderTips(state.findings);
        }
      } else {
        state.votes[rid] = (act === 'good');
        addFeedback(f, act === 'good');
        Array.prototype.forEach.call(tip.querySelectorAll('button[data-act="good"],button[data-act="bad"]'), function (x) {
          x.classList.remove('picked');
        });
        b.classList.add('picked');
      }
    });

    $('rulesList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var id = b.closest('.rule').getAttribute('data-id');
      var c = state.config[id];
      if (b.getAttribute('data-act') === 'toggle') c.enabled = !c.enabled;
      else c.level = parseInt(b.getAttribute('data-n'), 10);
      saveJSON(CFG_KEY, state.config);
      renderRules();
      if (state.points) runRules();
    });

    $('btnResetRules').onclick = function () {
      state.config = Rules.defaultConfig();
      saveJSON(CFG_KEY, state.config);
      renderRules();
      if (state.points) runRules();
    };

    $('btnExport').onclick = function () {
      var blob = new Blob([JSON.stringify(state.feedback, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '拍照提醒记录.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    $('btnClearLog').onclick = function () {
      state.feedback = []; saveJSON(LOG_KEY, state.feedback); renderLog();
    };
    $('btnClearAll').onclick = function () {
      state.feedback = []; state.config = Rules.defaultConfig();
      saveJSON(LOG_KEY, state.feedback); saveJSON(CFG_KEY, state.config);
      renderRules(); renderLog();
      setStatus('本地记录已清空 · 全程本地');
    };

    $('btnConsent').onclick = function () {
      $('consent').hidden = false;
      $('agreeSelf').setAttribute('aria-pressed', 'false');
      $('agreeOther').setAttribute('aria-pressed', 'false');
      $('consentYes').disabled = true;
    };
    function toggleAgree(btn) {
      btn.onclick = function () {
        var on = btn.getAttribute('aria-pressed') === 'true';
        btn.setAttribute('aria-pressed', on ? 'false' : 'true');
        $('consentYes').disabled = !(
          $('agreeSelf').getAttribute('aria-pressed') === 'true' &&
          $('agreeOther').getAttribute('aria-pressed') === 'true'
        );
      };
    }
    toggleAgree($('agreeSelf')); toggleAgree($('agreeOther'));
    $('consentNo').onclick = function () { $('consent').hidden = true; setStatus('不同意 · 全程本地'); };
    $('consentYes').onclick = function () {
      $('consent').hidden = true;
      setStatus('两层同意已记下 · 云端功能还没接上', 'demo');
    };

    window.addEventListener('resize', function () { if (state.points) drawSkeleton(); });
  }

  function init() {
    var defaults = Rules.defaultConfig();
    var saved = loadJSON(CFG_KEY, {}) || {};
    state.config = {};
    Object.keys(defaults).forEach(function (k) {
      state.config[k] = {
        enabled: saved[k] && typeof saved[k].enabled === 'boolean' ? saved[k].enabled : defaults[k].enabled,
        level: saved[k] && [1, 2, 3].indexOf(saved[k].level) >= 0 ? saved[k].level : defaults[k].level
      };
    });
    state.feedback = loadJSON(LOG_KEY, []);
    renderRules();
    renderLog();
    renderTips([]);
    switchTab('tips');
    bind();
    resizeCanvas();
    if (location.search.indexOf('demo') >= 0) startDemo();
    else if (location.search.indexOf('auto') >= 0) startCamera();
  }

  init();
})();
