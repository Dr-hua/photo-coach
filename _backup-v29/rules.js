(function (global) {
  'use strict';

  var CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
    [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
    [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
    [11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],
    [27,29],[27,31],[29,31],[28,30],[28,32],[30,32]
  ];

  // 脸上的 11 个点（鼻 / 眼 / 耳 / 嘴）单独连，画得亮一点才看得见
  var FACE_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,7],
    [0,4],[4,5],[5,6],[6,8],
    [9,10],[0,9],[0,10],[2,5]
  ];

  // 手上 21 个点（每根手指的关节 + 指尖）
  var HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],
    [0,17]
  ];

  var DEMO_POINTS = [
    [0.66,0.20],[0.645,0.19],[0.655,0.19],[0.665,0.19],[0.675,0.19],[0.685,0.19],[0.695,0.19],
    [0.63,0.20],[0.71,0.20],[0.65,0.23],[0.69,0.23],
    [0.58,0.30],[0.76,0.315],[0.55,0.42],[0.79,0.43],[0.60,0.52],[0.74,0.53],
    [0.60,0.55],[0.74,0.56],[0.61,0.56],[0.75,0.57],[0.59,0.55],[0.73,0.56],
    [0.61,0.53],[0.72,0.54],[0.60,0.72],[0.73,0.73],[0.59,0.90],[0.74,0.91],
    [0.58,0.92],[0.75,0.93],[0.57,0.93],[0.76,0.94]
  ].map(function (p) { return { x: p[0], y: p[1], z: 0, visibility: 1 }; });

  function p(points, i) { return points && points[i] ? points[i] : null; }
  function avg(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : 0; }
  function visible(points, i) { var q = p(points, i); return q && (q.visibility === undefined || q.visibility > 0.35); }
  function xy(points, i, key) { var q = p(points, i); return q ? q[key] : null; }
  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
  function pct(v) { return Math.round(v * 100) + '%'; }

  function angleOf(a, b) {
    var d = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    if (d > 90) d -= 180;
    if (d < -90) d += 180;
    return d;
  }

  function gridLabel(cx, cy) {
    var col = cx < 1 / 3 ? '左' : (cx < 2 / 3 ? '中' : '右');
    var row = cy < 1 / 3 ? '上' : (cy < 2 / 3 ? '中' : '下');
    return row + col + '格';
  }

  // 把骨架点和画面统计整理成一份「当时的情况」，规矩只看这份情况
  function derive(points, stats, shot) {
    stats = stats || {};
    shot = shot || 'flat';
    var eyeY = avg([xy(points,2,'y'), xy(points,5,'y')].filter(function (v) { return v !== null; }));
    if (!isFinite(eyeY)) eyeY = xy(points,0,'y') || 0.3;

    var ys = [], xs = [];
    for (var i = 0; i < points.length; i++) {
      if (visible(points, i)) { ys.push(points[i].y); xs.push(points[i].x); }
    }
    var minY = ys.length ? Math.min.apply(null, ys) : 0;
    var maxY = ys.length ? Math.max.apply(null, ys) : 1;
    var bodyH = Math.max(0, maxY - minY);

    var torso = [11,12,23,24].filter(function (k) { return visible(points,k); });
    var centerX = avg(torso.map(function (k) { return points[k].x; }));
    var centerY = avg(torso.map(function (k) { return points[k].y; }));
    if (!torso.length) { centerX = 0.5; centerY = 0.5; }

    var shoulderW = Math.abs((xy(points,11,'x') || 0) - (xy(points,12,'x') || 0));
    var facing = shoulderW < 0.09 ? 'side' : 'front';

    // 画面里露到哪：脚 / 胯 / 只有头肩。
    // 关键：bodyH 是「可见点的最高到最低」。贴太近时腿脚出画，这个值反而变小，
    // 会被误判成「离得远」，给出完全相反的建议。所以先看露到哪，再谈远近。
    var feetVisible = visible(points, 27) || visible(points, 28);
    var hipsVisible = visible(points, 23) || visible(points, 24);
    var crop = feetVisible ? 'full' : (hipsVisible ? 'half' : 'head');

    var tiltParts = [];
    if (visible(points,11) && visible(points,12)) tiltParts.push(angleOf(points[11], points[12]));
    if (visible(points,23) && visible(points,24)) tiltParts.push(angleOf(points[23], points[24]));
    var tiltDeg = tiltParts.length ? avg(tiltParts) : 0;

    var wristHip = 1;
    [[15,23],[16,24]].forEach(function (pair) {
      if (visible(points,pair[0]) && visible(points,pair[1])) {
        wristHip = Math.min(wristHip, dist(points[pair[0]], points[pair[1]]));
      }
    });

    var neckY = avg([xy(points,11,'y'), xy(points,12,'y')].filter(function (v) { return v !== null; })) + 0.01;
    // 胯在画面外时不能当 0 处理，否则「横线穿腰」会乱报
    var waistY = hipsVisible ? avg([xy(points,23,'y'), xy(points,24,'y')].filter(function (v) { return v !== null; })) : null;
    var headX = xy(points,0,'x') || centerX;

    var backlit = !!stats.backlit;
    var hasLongLine = !!stats.hasLongLine;
    var hasVerticalLine = !!stats.hasVerticalLine;
    // 陀螺仪测到的真实侧倾（度）；没有陀螺仪就是 null
    var levelDeg = (stats.levelDeg === null || stats.levelDeg === undefined) ? null : Number(stats.levelDeg);
    // 背景与光色（像素统计，都是估算）
    var busy = (typeof stats.busy === 'number') ? stats.busy : null;
    var warmth = (typeof stats.warmth === 'number') ? stats.warmth : null;
    var bgStd = (typeof stats.bgStd === 'number') ? stats.bgStd : null;
    // 认出场景才有；没认出来就是 null
    var scene = (stats.scene && stats.scene.id) ? stats.scene : null;

    var tags = [];
    tags.push(backlit ? '逆光' : '正常光线');
    if (busy !== null) tags.push((busy > 0.22 && (bgStd === null || bgStd >= 20)) ? '背景乱' : '背景干净');
    if (warmth !== null) tags.push(warmth < -0.10 ? '冷光' : (warmth > 0.28 ? '暖光' : '白光'));
    if (scene) tags.push(scene.label);
    tags.push(hasLongLine ? '有横线' : '无横线');
    tags.push(hasVerticalLine ? '有竖线' : '无竖线');
    tags.push(shot === 'low' ? '仰拍' : (shot === 'high' ? '俯拍' : '平拍'));
    tags.push(facing === 'side' ? '侧面' : '正面');
    tags.push(gridLabel(centerX, centerY));

    return {
      eyeY: eyeY, bodyH: bodyH, centerX: centerX, centerY: centerY,
      crop: crop, shoulderW: shoulderW,
      grid: gridLabel(centerX, centerY), facing: facing, tiltDeg: tiltDeg, levelDeg: levelDeg,
      wristHip: wristHip, neckY: neckY, waistY: waistY, headX: headX,
      lineY: stats.lineY, verticalX: stats.verticalX,
      busy: busy, warmth: warmth, bgStd: bgStd, scene: scene,
      faceLuma: stats.faceLuma, bgLuma: stats.bgLuma,
      hasLongLine: hasLongLine, hasVerticalLine: hasVerticalLine,
      backlit: backlit, shot: shot, tags: tags
    };
  }

  // 1 松 = 不容易触发，3 紧 = 容易触发
  function over(base, level) { return base * (level === 1 ? 1.4 : (level === 3 ? 0.72 : 1)); }
  function under(base, level) { return base * (level === 1 ? 0.7 : (level === 3 ? 1.4 : 1)); }

  var RULES = [
    {
      id: 'eye_too_high', name: '头顶别贴边', when: '任何时候', level: 2, enabled: true,
      check: function (f, c) {
        if (f.crop === 'head') return null; // 贴太近时由「远近」那条统一提醒，别重复
        var limit = under(f.shot === 'high' ? 0.14 : 0.10, c.level);
        if (f.eyeY >= limit) return null;
        return { text: '头顶快贴边了，退后半步，或者把镜头往上抬一点', severity: 'high',
          why: '按脸部位置估算，眼睛在画面 ' + pct(f.eyeY) + ' 高度（越靠上数字越小），低于你设的 ' + pct(limit) + '。' + (f.shot === 'high' ? '俯拍时这条放宽到 14%。' : '') };
      }
    },
    {
      id: 'eye_third', name: '眼睛落在上三分之一', when: '平拍 / 仰拍；俯拍时自动停用', level: 2, enabled: true,
      check: function (f, c) {
        if (f.shot === 'high') return null;
        if (f.crop === 'head') return null; // 特写构图不套「上三分之一」
        var band = over(0.10, c.level);
        var goal = 0.34;
        if (Math.abs(f.eyeY - goal) <= band) return null;
        // 注意：eyeY 越小 = 在画面里越靠上。眼睛在目标上方时，要让人往下挪，别写反。
        var tooHigh = f.eyeY < goal;
        return { text: tooHigh ? '人往下挪一点（或镜头往上抬），让眼睛落在上三分之一线'
                               : '人往上挪一点（或镜头往下压），让眼睛落在上三分之一线', severity: 'mid',
          why: '眼睛现在在 ' + pct(f.eyeY) + '（越小越靠上），平视时建议约 ' + pct(goal) + '，差 ' + pct(Math.abs(f.eyeY - goal)) + '。' };
      }
    },
    {
      id: 'grid_edge', name: '别太靠边', when: '任何时候', level: 2, enabled: true,
      check: function (f, c) {
        var edge = under(0.20, c.level);
        var okX = f.centerX > edge && f.centerX < 1 - edge;
        // 贴太近时肩膀会跑到画面下方，纵向不算「靠边」，否则会误报
        var okY = f.crop === 'head' ? true : f.centerY < 0.82;
        if (okX && okY) return null;
        return { text: '人太靠边了，往画面中间挪半步', severity: 'high',
          why: '身体中心在横向 ' + pct(f.centerX) + '，落在' + f.grid + '，离边太近。' };
      }
    },
    {
      id: 'grid_leave_room', name: '侧脸要留白', when: '只在侧脸且人放正中时', level: 2, enabled: true,
      check: function (f, c) {
        if (f.facing !== 'side' || Math.abs(f.centerX - 0.5) > over(0.12, c.level)) return null;
        return { text: '侧脸时，视线朝向那一侧要留白，别把人放正中', severity: 'low',
          why: '左右肩宽度判断是侧面（肩宽很窄），身体中心又在 ' + pct(f.centerX) + '，接近正中。' };
      }
    },
    {
      id: 'distance', name: '远近合适', when: '任何时候', level: 2, enabled: true,
      check: function (f, c) {
        // 只露头肩 = 贴太近（不是太远）。这条以前判反了。
        if (f.crop === 'head') {
          return { text: '太近了，退后半步让人上半身进画面', severity: 'mid',
            why: '画面里只看得到头和肩，胯和脚都在画面外——这是贴得太近，不是离得远。' };
        }
        // 半身构图是正常拍法，不判远近
        if (f.crop === 'half') return null;
        if (f.bodyH > over(0.9, c.level)) {
          return { text: '太近了，容易切到手和头顶，退后半步', severity: 'mid',
            why: '全身在画面里占了 ' + pct(f.bodyH) + ' 高度，超过你设的 ' + pct(over(0.9,c.level)) + '。' };
        }
        if (f.bodyH < under(0.35, c.level)) {
          return { text: '太远了，人在画面里太小，往前走两步', severity: 'low',
            why: '全身在画面里只占 ' + pct(f.bodyH) + ' 高度（脚已经露出来了，所以能判断全身大小）。' };
        }
        return null;
      }
    },
    {
      id: 'tilt', name: '画面别歪', when: '任何时候', level: 2, enabled: true,
      check: function (f, c) {
        // 有陀螺仪就用真读数：只测左右侧倾，跟仰拍俯拍无关，不会互相干扰
        if (f.levelDeg !== null) {
          var lim = over(2, c.level);
          if (Math.abs(f.levelDeg) <= lim) return null;
          var side = f.levelDeg > 0 ? '右' : '左';
          return { text: '画面歪了 ' + Math.abs(f.levelDeg).toFixed(0) + '°，' + side + '边低，把' + side + '边抬高一点', severity: 'low',
            why: '手机陀螺仪读数：侧倾 ' + f.levelDeg.toFixed(1) + '°（正=右边低）。这条只测左右歪，和你选平拍还是仰拍俯拍无关。' };
        }
        // 没有陀螺仪（电脑）或横屏：退回按肩膀线估算，而且只敢在平拍、正面时用
        if (f.shot !== 'flat' || f.facing === 'side') return null;
        if (Math.abs(f.tiltDeg) <= over(4, c.level)) return null;
        return { text: '肩膀看着是歪的，站正一点', severity: 'low',
          why: '这台设备拿不到陀螺仪，只能按左右肩、左右胯的连线估算约 ' + Math.abs(f.tiltDeg).toFixed(1) + '°。这是估算，侧身或故意斜肩时可能不准，所以只在平拍正面时提示。' };
      }
    },
    {
      id: 'wrist_hip', name: '手腕别贴身', when: '任何时候', level: 2, enabled: true,
      check: function (f, c) {
        var limit = under(0.07, c.level);
        if (f.wristHip >= limit) return null;
        return { text: '手腕离开身体一点，别贴太死', severity: 'mid',
          why: '手腕到胯的距离只有 ' + pct(f.wristHip) + ' 画面宽，低于你设的 ' + pct(limit) + '。' };
      }
    },
    {
      id: 'horizon_neck', name: '横线别穿脖子', when: '只在背景有长横线时', level: 2, enabled: true,
      check: function (f, c) {
        if (!f.hasLongLine || f.lineY === undefined || f.lineY === null) return null;
        var limit = over(0.06, c.level);
        var dNeck = Math.abs(f.lineY - f.neckY);
        var dWaist = (f.waistY === null || f.waistY === undefined) ? 9 : Math.abs(f.lineY - f.waistY);
        if (dNeck > limit && dWaist > limit) return null;
        var where = dNeck <= limit ? '脖子' : '腰';
        var at = dNeck <= limit ? pct(f.neckY) : pct(f.waistY);
        return { text: '背景那条横线正穿过' + where + '，蹲低一点，或者把机位抬高', severity: 'high',
          why: '检测到一条横贯画面的线在 ' + pct(f.lineY) + '，' + where + '约在 ' + at + '。' };
      }
    },
    {
      id: 'vertical_head', name: '竖线别从头顶长出', when: '只在背景有竖线时', level: 2, enabled: true,
      check: function (f, c) {
        if (!f.hasVerticalLine || f.verticalX === undefined || f.verticalX === null) return null;
        if (Math.abs(f.verticalX - f.headX) > over(0.07, c.level)) return null;
        return { text: '有根竖线正从头上长出来，往旁边挪半步', severity: 'mid',
          why: '检测到竖线在横向 ' + pct(f.verticalX) + '，头在 ' + pct(f.headX) + '，几乎重合。' };
      }
    },
    {
      id: 'backlit', name: '逆光怎么办', when: '只在逆光时', level: 2, enabled: true,
      check: function (f, c) {
        if (!f.backlit) return null;
        return { text: '逆光了，侧身一点让光勾轮廓，或者换个方向；别硬往亮处站', severity: 'mid',
          why: '人脸区域平均亮度 ' + Math.round(f.faceLuma || 0) + '，背景 ' + Math.round(f.bgLuma || 0) + '，脸比背景暗很多。' };
      }
    },
    {
      id: 'low_angle', name: '仰拍专项', when: '只在你选了仰拍时', level: 2, enabled: true,
      check: function (f, c) {
        if (f.shot !== 'low') return null;
        return { text: '仰拍容易把下巴拍宽，收一点下巴，也别站太近', severity: 'low',
          why: '你选了仰拍，这条规矩只在仰拍时出现。' };
      }
    },
    {
      id: 'high_angle', name: '俯拍专项', when: '只在你选了俯拍时', level: 2, enabled: true,
      check: function (f, c) {
        if (f.shot !== 'high') return null;
        return { text: '俯拍时平视的构图规矩不适用，已自动放宽；注意别切到头顶和脚', severity: 'low',
          why: '你选了俯拍，「眼睛落在上三分之一」这条已自动停用，避免给错建议。' };
      }
    },
    {
      id: 'bg_busy', name: '背景别太乱', when: '任何时候', level: 2, enabled: true,
      check: function (f, c) {
        if (f.busy === null || f.busy === undefined) return null;
        // 认出来是公园 / 海边 / 建筑这种天然好背景，就不说"乱"了
        if (f.scene && f.scene.good) return null;
        // 背景本身就没什么起伏（纯墙、纯天空）时，边缘再密也不是"乱"
        if (f.bgStd !== null && f.bgStd !== undefined && f.bgStd < 20) return null;
        var lim = over(0.22, c.level);
        if (f.busy < lim) return null;
        return { text: '背景有点乱，往旁边挪一步找面干净的墙', severity: 'mid',
          why: '背景区域的边缘密度 ' + Math.round(f.busy * 100) + '%，超过你设的 ' + Math.round(lim * 100) + '%。数字越高越碎（人影、招牌、货架都算）。这是像素统计，不是认得出场景。' };
      }
    },
    {
      id: 'light_cast', name: '光线别偏色', when: '任何时候', level: 2, enabled: true,
      check: function (f, c) {
        if (f.warmth === null || f.warmth === undefined) return null;
        var cool = -over(0.10, c.level), warm = over(0.28, c.level);
        if (f.warmth < cool) {
          return { text: '光偏冷，脸会发青，往暖光那边靠一点', severity: 'low',
            why: '脸区红蓝差 ' + f.warmth.toFixed(2) + '，低于 ' + cool.toFixed(2) + '。偏负=偏冷（阴天、日光灯、蓝调时刻）。' };
        }
        if (f.warmth > warm) {
          return { text: '光偏黄，脸会发橙，换个角度或靠近窗光', severity: 'low',
            why: '脸区红蓝差 ' + f.warmth.toFixed(2) + '，高于 ' + warm.toFixed(2) + '。偏高=偏黄（钨丝灯、暖光灯）。' };
        }
        return null;
      }
    },
    {
      id: 'scene', name: '按场景给建议', when: '认出场景后才有', level: 2, enabled: true,
      check: function (f, c) {
        if (!f.scene) return null;
        var id = f.scene.id;
        var why = '认出来是「' + f.scene.label + '」，把握 ' + Math.round(f.scene.conf * 100) + '%。';
        if (id === 'home') {
          return { text: '室内就靠窗站，把顶灯关掉，光会好看很多', severity: 'low',
            why: why + '顶灯从上方打下来，脸上会有阴影；窗边的自然光更匀。' };
        }
        if (id === 'dining') {
          return { text: '餐厅背景人多，往角落或靠窗坐，别让招牌压在头上', severity: 'mid',
            why: why + '餐厅常见的问题是背景人头和招牌压头顶。' };
        }
        if (id === 'shop') {
          return { text: '货架招牌密，尽量顺墙站，避开反光玻璃', severity: 'mid',
            why: why + '商场和店铺的货架、灯箱会让背景很碎，玻璃还会有反光。' };
        }
        if (id === 'office') {
          return { text: '屏幕和线缆会乱，往白墙那边挪一步', severity: 'low',
            why: why + '办公室背景常见显示器和线缆，容易抢人。' };
        }
        if (id === 'water') {
          return { text: '地平线别放正中，放下三分之一更稳', severity: 'low',
            why: why + '水边一定有地平线，放正中会把画面切成两半。' };
        }
        // 街道 / 公园 / 建筑：交给其它规矩，不重复念
        return null;
      }
    },
    {
      id: 'finger_cut', name: '指尖别出画', when: '接上手部识别后才有用', level: 2, enabled: false,
      check: function (f, c) { return null; }
    }
  ];

  function defaultConfig() {
    var cfg = {};
    RULES.forEach(function (r) { cfg[r.id] = { enabled: r.enabled, level: r.level }; });
    return cfg;
  }

  function list() {
    return RULES.map(function (r) { return { id: r.id, name: r.name, when: r.when }; });
  }

  function evaluate(frame, cfg) {
    cfg = cfg || defaultConfig();
    var order = { high: 0, mid: 1, low: 2 };
    var out = [];
    RULES.forEach(function (r) {
      var c = cfg[r.id] || { enabled: true, level: 2 };
      if (!c.enabled) return;
      var res = r.check(frame, c);
      if (res) out.push({ ruleId: r.id, name: r.name, text: res.text, why: res.why, severity: res.severity, tags: frame.tags.slice() });
    });
    out.sort(function (a, b) { return order[a.severity] - order[b.severity]; });
    return out;
  }

  global.Rules = {
    CONNECTIONS: CONNECTIONS, FACE_CONNECTIONS: FACE_CONNECTIONS, HAND_CONNECTIONS: HAND_CONNECTIONS, DEMO_POINTS: DEMO_POINTS,
    derive: derive, evaluate: evaluate, list: list,
    defaultConfig: defaultConfig, gridLabel: gridLabel
  };
})(window);
