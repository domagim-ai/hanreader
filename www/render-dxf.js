// DXF 도면 보기(보기 전용): dxf-parser로 읽어 캔버스에 나타내고, 손가락으로 확대·이동한다.
// 지원: LINE, LWPOLYLINE/POLYLINE(볼록값 포함), CIRCLE, ARC, ELLIPSE, SPLINE, POINT, SOLID, 3DFACE,
//       TEXT, MTEXT, INSERT(블록), DIMENSION(치수 블록). 해치·지시선 등은 표시하지 않는다.
(function () {
  var MAX_DEPTH = 12;        // 블록 안의 블록을 따라 들어가는 한도
  var MAX_POINTS = 4000000;  // 폰 메모리를 지키기 위한 점 개수 한도
  var UNSUPPORTED = ['HATCH', 'LEADER', 'MULTILEADER', 'MLEADER', 'MLINE', 'IMAGE', 'WIPEOUT', 'ACAD_TABLE',
    'REGION', '3DSOLID', 'TRACE', 'RAY', 'XLINE', 'HELIX', 'TOLERANCE', 'SHAPE', 'MESH', 'OLE2FRAME'];

  // ----- 2차원 변환 행렬 [a,b,c,d,e,f]: x' = a·x + c·y + e, y' = b·x + d·y + f -----
  var IDENT = [1, 0, 0, 1, 0, 0];
  function mul(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
            m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
            m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  }
  function trs(tx, ty, rot, sx, sy) {
    var c = Math.cos(rot), s = Math.sin(rot);
    return [c * sx, s * sx, -s * sy, c * sy, tx, ty];
  }

  // ----- 글자 정리 -----
  function decodeEscapes(s) {
    return String(s)
      .replace(/\\U\+([0-9A-Fa-f]{4})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[cC]/g, '⌀')
      .replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%');
  }
  // MTEXT의 서식 코드(글꼴·높이·색 등)를 걷어내고 줄 나눔만 남긴다.
  function mtextPlain(s) {
    s = decodeEscapes(s)
      .replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003')
      .replace(/\\P/g, '\n').replace(/\\~/g, ' ')
      .replace(/\\S([^;]*);/g, function (m, a) { return a.replace(/[\^#]/g, '/'); })
      .replace(/\\[ACcFfHhQqTtWwp][^;\n]*;/g, '')
      .replace(/\\[LlOoKkNX]/g, '')
      .replace(/[{}]/g, '')
      .replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');
    return s.split('\n');
  }

  // ----- 도면을 그릴 재료(선 묶음·글자 목록)로 바꾼다 -----
  function build(dxf) {
    var layers = (dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) || {};
    var blocks = dxf.blocks || {};
    var buckets = {}, order = [], texts = [], points = 0, truncated = false;
    var box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    var origin = firstPoint(dxf.entities || []);
    var ox = origin[0], oy = origin[1];

    function firstPoint(list) {
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        var p = (e.vertices && e.vertices[0]) || e.center || e.startPoint || e.position;
        if (p && isFinite(p.x) && isFinite(p.y)) return [p.x, p.y];
      }
      return [0, 0];
    }
    function layerColor(name) {
      var l = layers[name];
      return (l && typeof l.color === 'number') ? l.color : 0xFFFFFF;
    }
    function resolve(e, ctx) {
      var layer = (e.layer === undefined || e.layer === '0') && ctx.layer !== null ? ctx.layer : (e.layer || '0');
      var color;
      if (e.colorIndex === 0) color = ctx.color !== null ? ctx.color : layerColor(layer);
      else if (typeof e.color === 'number' && e.colorIndex !== 256) color = e.color;
      else color = layerColor(layer);
      return { layer: layer, color: color };
    }
    function bucket(st) {
      var key = st.layer + '\u0000' + st.color;
      var b = buckets[key];
      if (!b) { b = buckets[key] = { layer: st.layer, color: st.color, path: new Path2D(), fill: null, dots: [] }; order.push(b); }
      return b;
    }
    function grow(x, y) {
      if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y;
    }
    // pts: [x0,y0,x1,y1,...] (도면 좌표). 변환 후 기준점을 빼서 넣는다(큰 좌표에서 떨림 방지).
    function addPath(path, pts, closed, m) {
      var n = pts.length / 2;
      if (n < 2) return;
      points += n;
      for (var i = 0; i < n; i++) {
        var x = pts[2 * i], y = pts[2 * i + 1];
        var X = m[0] * x + m[2] * y + m[4] - ox, Y = m[1] * x + m[3] * y + m[5] - oy;
        if (!isFinite(X) || !isFinite(Y)) continue;
        if (i === 0) path.moveTo(X, Y); else path.lineTo(X, Y);
        grow(X, Y);
      }
      if (closed) path.closePath();
    }
    function arcPoints(out, cx, cy, r, a0, sweep) {
      var n = Math.max(6, Math.ceil(Math.abs(sweep) / (2 * Math.PI) * 96));
      for (var i = 0; i <= n; i++) {
        var a = a0 + sweep * i / n;
        out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
    }
    function polyPoints(vs, closed) {
      var out = [], n = vs.length;
      for (var i = 0; i < n; i++) {
        var p = vs[i], q = vs[(i + 1) % n], b = p.bulge;
        out.push(p.x, p.y);
        if (b && (i < n - 1 || closed)) {
          var dx = q.x - p.x, dy = q.y - p.y;
          if (dx === 0 && dy === 0) continue;
          var k = (1 - b * b) / (4 * b);
          var cx = (p.x + q.x) / 2 - dy * k, cy = (p.y + q.y) / 2 + dx * k;
          var seg = [];
          arcPoints(seg, cx, cy, Math.hypot(p.x - cx, p.y - cy), Math.atan2(p.y - cy, p.x - cx), 4 * Math.atan(b));
          for (var j = 2; j < seg.length - 2; j++) out.push(seg[j]);
        }
      }
      return out;
    }
    function splinePoints(e) {
      var cps = e.controlPoints || [], deg = e.degreeOfSplineCurve || 3, kn = e.knotValues || [], n = cps.length, out = [], i;
      if (n < 2 || deg < 1 || kn.length < n + deg + 1) {
        var src = (e.fitPoints && e.fitPoints.length > 1) ? e.fitPoints : cps;
        for (i = 0; i < src.length; i++) out.push(src[i].x, src[i].y);
        return out;
      }
      var t0 = kn[deg], t1 = kn[n], segs = Math.min(2000, Math.max(16, n * 8)), k = deg;
      for (i = 0; i <= segs; i++) {
        var t = i === segs ? t1 - (t1 - t0) * 1e-9 : t0 + (t1 - t0) * i / segs;
        while (k < n - 1 && t >= kn[k + 1]) k++;
        var dxs = [], dys = [], j, r;
        for (j = 0; j <= deg; j++) { dxs.push(cps[j + k - deg].x); dys.push(cps[j + k - deg].y); }
        for (r = 1; r <= deg; r++) {
          for (j = deg; j >= r; j--) {
            var den = kn[j + 1 + k - r] - kn[j + k - deg];
            var al = den ? (t - kn[j + k - deg]) / den : 0;
            dxs[j] = (1 - al) * dxs[j - 1] + al * dxs[j];
            dys[j] = (1 - al) * dys[j - 1] + al * dys[j];
          }
        }
        out.push(dxs[deg], dys[deg]);
      }
      return out;
    }
    function addText(st, m, x, y, h, rotDeg, lines, ha, va, spacing) {
      if (!h || !lines.length || !lines.join('').trim()) return;
      var X = m[0] * x + m[2] * y + m[4] - ox, Y = m[1] * x + m[3] * y + m[5] - oy;
      if (!isFinite(X) || !isFinite(Y)) return;
      var sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      texts.push({ layer: st.layer, color: st.color, x: X, y: Y, h: h * sc,
        rot: (rotDeg || 0) * Math.PI / 180 + Math.atan2(m[1], m[0]), lines: lines, ha: ha, va: va, sp: spacing || 1.6 });
      grow(X, Y);
    }
    function flipped(e) {
      var z = e.extrusionDirectionZ !== undefined ? e.extrusionDirectionZ : (e.extrusionDirection ? e.extrusionDirection.z : 1);
      return z < 0;
    }

    function walk(list, m, ctx, depth) {
      for (var i = 0; i < list.length; i++) {
        if (points > MAX_POINTS) { truncated = true; return; }
        var e = list[i];
        if (!e || e.inPaperSpace || e.visible === false) continue;
        var st = resolve(e, ctx), mm = flipped(e) ? mul(m, [-1, 0, 0, 1, 0, 0]) : m, pts, b, p;
        switch (e.type) {
          case 'LINE':
            if (e.vertices && e.vertices.length >= 2) addPath(bucket(st).path, [e.vertices[0].x, e.vertices[0].y, e.vertices[1].x, e.vertices[1].y], false, m);
            break;
          case 'LWPOLYLINE':
          case 'POLYLINE':
            if (e.isPolyfaceMesh || e.is3dPolygonMesh || !e.vertices || !e.vertices.length) break;
            addPath(bucket(st).path, polyPoints(e.vertices, !!e.shape), !!e.shape, e.is3dPolyline ? m : mm);
            break;
          case 'CIRCLE':
            pts = []; arcPoints(pts, e.center.x, e.center.y, e.radius, 0, 2 * Math.PI);
            addPath(bucket(st).path, pts, true, mm);
            break;
          case 'ARC':
            var sw = e.endAngle - e.startAngle;
            while (sw <= 0) sw += 2 * Math.PI;
            pts = []; arcPoints(pts, e.center.x, e.center.y, e.radius, e.startAngle, sw);
            addPath(bucket(st).path, pts, false, mm);
            break;
          case 'ELLIPSE':
            var ax = e.majorAxisEndPoint.x, ay = e.majorAxisEndPoint.y, ratio = e.axisRatio || 1;
            var s0 = e.startAngle || 0, s1 = e.endAngle === undefined ? 2 * Math.PI : e.endAngle;
            while (s1 <= s0) s1 += 2 * Math.PI;
            pts = [];
            for (var k = 0, n = 96; k <= n; k++) {
              var t = s0 + (s1 - s0) * k / n;
              pts.push(e.center.x + Math.cos(t) * ax - Math.sin(t) * ratio * ay, e.center.y + Math.cos(t) * ay + Math.sin(t) * ratio * ax);
            }
            addPath(bucket(st).path, pts, false, m);
            break;
          case 'SPLINE':
            addPath(bucket(st).path, splinePoints(e), !!e.closed, m);
            break;
          case 'POINT':
            p = e.position;
            if (p) {
              var px = m[0] * p.x + m[2] * p.y + m[4] - ox, py = m[1] * p.x + m[3] * p.y + m[5] - oy;
              if (isFinite(px) && isFinite(py)) { bucket(st).dots.push(px, py); grow(px, py); points++; }
            }
            break;
          case 'SOLID':
            p = e.points;
            if (p && p.length >= 3) {
              b = bucket(st);
              if (!b.fill) b.fill = new Path2D();
              pts = p.length >= 4 ? [p[0].x, p[0].y, p[1].x, p[1].y, p[3].x, p[3].y, p[2].x, p[2].y] : [p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y];
              addPath(b.fill, pts, true, mm);
            }
            break;
          case '3DFACE':
            p = e.vertices;
            if (p && p.length >= 3) { pts = []; p.forEach(function (v) { pts.push(v.x, v.y); }); addPath(bucket(st).path, pts, true, m); }
            break;
          case 'TEXT':
            var ha = e.halign || 0, va = e.valign || 0;
            var anchor = ((ha || va) && ha !== 3 && ha !== 5 && e.endPoint) ? e.endPoint : e.startPoint;
            if (!anchor) break;
            if (ha === 4) { ha = 1; va = 2; }
            if (ha === 3 || ha === 5) ha = 0;
            addText(st, mm, anchor.x, anchor.y, e.textHeight, e.rotation, [decodeEscapes(e.text || '')], ha, va);
            break;
          case 'MTEXT':
            if (!e.position) break;
            var ap = e.attachmentPoint || 1, rot = e.rotation;
            if (rot === undefined && e.directionVector) rot = Math.atan2(e.directionVector.y, e.directionVector.x) * 180 / Math.PI;
            addText(st, m, e.position.x, e.position.y, e.height, rot, mtextPlain(e.text || ''), (ap - 1) % 3, 3 - Math.floor((ap - 1) / 3));
            break;
          case 'DIMENSION':
            if (e.block && blocks[e.block] && blocks[e.block].entities && depth < MAX_DEPTH) {
              walk(blocks[e.block].entities, m, { layer: st.layer, color: st.color }, depth + 1);
            }
            break;
          case 'INSERT':
            var blk = blocks[e.name];
            if (!blk || !blk.entities || !blk.entities.length || depth >= MAX_DEPTH || !e.position) break;
            var bx = (blk.position && blk.position.x) || 0, by = (blk.position && blk.position.y) || 0;
            var sx = e.xScale === undefined ? 1 : e.xScale, sy = e.yScale === undefined ? 1 : e.yScale;
            var cols = Math.min(e.columnCount || 1, 200), rows = Math.min(e.rowCount || 1, 200);
            var rr = (e.rotation || 0) * Math.PI / 180;
            for (var ci = 0; ci < cols; ci++) for (var ri = 0; ri < rows; ri++) {
              var offx = ci * (e.columnSpacing || 0), offy = ri * (e.rowSpacing || 0);
              var local = mul(trs(e.position.x, e.position.y, rr, 1, 1), mul([1, 0, 0, 1, offx, offy], mul([sx, 0, 0, sy, 0, 0], [1, 0, 0, 1, -bx, -by])));
              walk(blk.entities, mul(mm, local), { layer: st.layer, color: st.color }, depth + 1);
            }
            break;
        }
      }
    }
    walk(dxf.entities || [], IDENT, { layer: null, color: null }, 0);

    // 레이어 목록: 표에 있는 것 + 도형에만 나온 것
    var names = {};
    Object.keys(layers).forEach(function (n) { names[n] = true; });
    order.forEach(function (b) { names[b.layer] = true; });
    texts.forEach(function (t) { names[t.layer] = true; });
    var used = {};
    order.forEach(function (b) { used[b.layer] = true; });
    texts.forEach(function (t) { used[t.layer] = true; });
    var layerList = Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).map(function (n) {
      var l = layers[n] || {};
      return { name: n, color: layerColor(n), on: l.visible !== false && !l.frozen, used: !!used[n] };
    });
    return { buckets: order, texts: texts, box: box, layers: layerList, truncated: truncated };
  }

  // ----- 색: 화면 바탕(밝음/어두움)에 맞춰 잘 보이게 바꾼다 -----
  function cssColor(c, dark) {
    var r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    var lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (dark) {
      if (Math.max(r, g, b) < 60) { r = g = b = 235; }
      else if (lum < 90) { r = Math.round(r + (255 - r) * 0.4); g = Math.round(g + (255 - g) * 0.4); b = Math.round(b + (255 - b) * 0.4); }
    } else {
      if (lum > 235) { r = g = b = 20; }
      else if (lum > 140) { var k = 140 / lum; r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k); }
    }
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function countUnsupported(text) {
    var found = [];
    UNSUPPORTED.forEach(function (name) {
      var re = new RegExp('\\n[ \\t]*0\\r?\\n' + name + '\\r?\\n', 'g'), n = 0;
      while (re.exec(text)) n++;
      if (n) found.push(name + ' ' + n);
    });
    return found;
  }

  function pause() { return new Promise(function (r) { setTimeout(r, 30); }); }

  async function render(container, bytes, ctx) {
    ctx.status('도면 읽는 중…');
    await pause();
    var text = HanTxt.decodeText(bytes);
    var lib = window.DxfParser, Parser = lib && (lib.DxfParser || lib.default || lib);
    var dxf;
    try { dxf = new Parser().parseSync(text); }
    catch (e) { throw new Error('DXF 도면을 읽지 못했습니다. (' + String((e && e.message) || e) + ')'); }
    if (ctx.cancelled()) return null;
    if (!dxf) throw new Error('DXF 도면을 읽지 못했습니다.');

    ctx.status('도면 그리는 중…');
    await pause();
    var model = build(dxf);
    var skipped = countUnsupported(text);
    text = null; dxf = null;
    if (ctx.cancelled()) return null;
    if (!isFinite(model.box.x0)) throw new Error('표시할 수 있는 도형이 없습니다.' + (skipped.length ? ' (지원하지 않는 도형: ' + skipped.join(', ') + ')' : ''));
    return mount(container, model, skipped);
  }

  // ----- 화면 -----
  function mount(container, model, skipped) {
    var root = document.createElement('div'); root.className = 'doc-dxf';
    var canvas = document.createElement('canvas');
    var tools = document.createElement('div'); tools.className = 'dxf-tools';
    root.appendChild(canvas); root.appendChild(tools);
    container.appendChild(root);
    var g = canvas.getContext('2d');

    var visible = {};
    model.layers.forEach(function (l) { visible[l.name] = l.on; });

    var W = 1, H = 1, dpr = 1;
    var view = { s: 1, cx: 0, cy: 0 }, fitScale = 1;
    var drawn = null, lastMs = 0, raf = 0, settle = 0, disposed = false;

    function fit() {
      var b = model.box, w = Math.max(b.x1 - b.x0, 1e-9), h = Math.max(b.y1 - b.y0, 1e-9);
      fitScale = Math.min(W / w, H / h) * 0.92;
      if (!isFinite(fitScale) || fitScale <= 0) fitScale = 1;
      view.s = fitScale; view.cx = (b.x0 + b.x1) / 2; view.cy = (b.y0 + b.y1) / 2;
    }
    function resize() {
      var r = root.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      W = r.width; H = r.height; dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      return true;
    }

    function draw() {
      raf = 0;
      if (disposed) return;
      var t0 = performance.now();
      var dark = document.documentElement.classList.contains('dark');
      var s = view.s;
      canvas.style.transform = '';
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = dark ? '#16181b' : '#ffffff';
      g.fillRect(0, 0, canvas.width, canvas.height);

      g.setTransform(dpr * s, 0, 0, -dpr * s, dpr * (W / 2 - view.cx * s), dpr * (H / 2 + view.cy * s));
      g.lineWidth = 1.2 / s; g.lineJoin = 'round'; g.lineCap = 'round';
      var i, b, col;
      for (i = 0; i < model.buckets.length; i++) {
        b = model.buckets[i];
        if (visible[b.layer] === false) continue;
        col = cssColor(b.color, dark);
        g.strokeStyle = col; g.fillStyle = col;
        if (b.fill) g.fill(b.fill);
        g.stroke(b.path);
      }
      // 점과 글자는 화면 좌표로 그린다.
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (i = 0; i < model.buckets.length; i++) {
        b = model.buckets[i];
        if (!b.dots.length || visible[b.layer] === false) continue;
        g.fillStyle = cssColor(b.color, dark);
        for (var k = 0; k < b.dots.length; k += 2) {
          var dx = (b.dots[k] - view.cx) * s + W / 2, dy = H / 2 - (b.dots[k + 1] - view.cy) * s;
          if (dx > -2 && dy > -2 && dx < W + 2 && dy < H + 2) g.fillRect(dx - 1.5, dy - 1.5, 3, 3);
        }
      }
      var aligns = ['left', 'center', 'right'], bases = ['alphabetic', 'bottom', 'middle', 'top'];
      for (i = 0; i < model.texts.length; i++) {
        var t = model.texts[i];
        if (visible[t.layer] === false) continue;
        var px = t.h * s * 1.15;
        if (px < 3) continue;
        var x = (t.x - view.cx) * s + W / 2, y = H / 2 - (t.y - view.cy) * s;
        var reach = px * (t.lines.length * t.sp + 40);
        if (x < -reach || y < -reach || x > W + reach || y > H + reach) continue;
        g.save();
        g.translate(x, y);
        if (t.rot) g.rotate(-t.rot);
        g.font = px + 'px system-ui, "Noto Sans KR", "Malgun Gothic", sans-serif';
        g.fillStyle = cssColor(t.color, dark);
        g.textAlign = aligns[t.ha] || 'left';
        g.textBaseline = bases[t.va] || 'alphabetic';
        var lh = t.h * s * t.sp, n = t.lines.length;
        var y0 = t.va === 3 ? 0 : t.va === 2 ? -lh * (n - 1) / 2 : -lh * (n - 1);
        for (var li = 0; li < n; li++) if (t.lines[li]) g.fillText(t.lines[li], 0, y0 + li * lh);
        g.restore();
      }
      drawn = { s: view.s, cx: view.cx, cy: view.cy };
      lastMs = performance.now() - t0;
    }
    function requestDraw() { if (!raf && !disposed) raf = requestAnimationFrame(draw); }
    // 손가락을 움직이는 동안: 가벼운 도면은 바로 다시 그리고, 무거운 도면은 그려 둔 그림을 늘이고 옮겼다가 멈추면 다시 그린다.
    function moved() {
      if (lastMs < 28 || !drawn) { requestDraw(); return; }
      var k = view.s / drawn.s;
      var tx = W / 2 - k * W / 2 + (drawn.cx - view.cx) * view.s;
      var ty = H / 2 - k * H / 2 - (drawn.cy - view.cy) * view.s;
      canvas.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + k + ')';
      clearTimeout(settle);
      settle = setTimeout(requestDraw, 160);
    }
    function zoomAt(px, py, k) {
      var s2 = Math.max(fitScale / 50, Math.min(fitScale * 20000, view.s * k));
      var wx = view.cx + (px - W / 2) / view.s, wy = view.cy - (py - H / 2) / view.s;
      view.s = s2;
      view.cx = wx - (px - W / 2) / s2; view.cy = wy + (py - H / 2) / s2;
    }

    // 손가락·마우스
    var ptrs = {}, lastTap = 0, lastTapX = 0, lastTapY = 0, downAt = 0, travelled = 0;
    function local(ev) { var r = canvas.parentNode.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
    function ids() { return Object.keys(ptrs); }
    canvas.addEventListener('pointerdown', function (ev) {
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      ptrs[ev.pointerId] = local(ev);
      if (ids().length === 1) { downAt = Date.now(); travelled = 0; }
    });
    canvas.addEventListener('pointermove', function (ev) {
      var prev = ptrs[ev.pointerId];
      if (!prev) return;
      var cur = local(ev), list = ids();
      if (list.length === 1) {
        view.cx -= (cur.x - prev.x) / view.s; view.cy += (cur.y - prev.y) / view.s;
        travelled += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
        ptrs[ev.pointerId] = cur;
        moved();
      } else if (list.length >= 2) {
        var otherId = list[0] === String(ev.pointerId) ? list[1] : list[0], o = ptrs[otherId];
        var d0 = Math.hypot(prev.x - o.x, prev.y - o.y), d1 = Math.hypot(cur.x - o.x, cur.y - o.y);
        var m0x = (prev.x + o.x) / 2, m0y = (prev.y + o.y) / 2, m1x = (cur.x + o.x) / 2, m1y = (cur.y + o.y) / 2;
        view.cx -= (m1x - m0x) / view.s; view.cy += (m1y - m0y) / view.s;
        if (d0 > 0 && d1 > 0) zoomAt(m1x, m1y, d1 / d0);
        travelled += 100;
        ptrs[ev.pointerId] = cur;
        moved();
      }
    });
    function up(ev) {
      var p = ptrs[ev.pointerId];
      delete ptrs[ev.pointerId];
      if (!p) return;
      if (!ids().length) {
        // 두 번 톡톡: 그 자리를 2배로 확대
        var now = Date.now();
        if (travelled < 12 && now - downAt < 300) {
          if (now - lastTap < 350 && Math.hypot(p.x - lastTapX, p.y - lastTapY) < 40) { zoomAt(p.x, p.y, 2); lastTap = 0; }
          else { lastTap = now; lastTapX = p.x; lastTapY = p.y; }
        }
        clearTimeout(settle);
        requestDraw();
      }
    }
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var p = local(ev);
      zoomAt(p.x, p.y, Math.exp(-ev.deltaY * 0.0015));
      moved();
    }, { passive: false });

    // 단추: 전체 보기, 레이어
    function tool(label, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.addEventListener('click', fn);
      tools.appendChild(b);
      return b;
    }
    tool('전체 보기', function () { fit(); requestDraw(); });

    var dlg = document.createElement('dialog'); dlg.className = 'dxf-layers';
    var title = document.createElement('h2'); title.textContent = '레이어 (' + model.layers.length + ')';
    var bar = document.createElement('div'); bar.className = 'row';
    var list = document.createElement('div'); list.className = 'list';
    var boxes = [];
    function setAll(on) { model.layers.forEach(function (l, i) { visible[l.name] = on; boxes[i].checked = on; }); requestDraw(); }
    [['모두 켜기', function () { setAll(true); }], ['모두 끄기', function () { setAll(false); }], ['닫기', function () { dlg.close(); }]].forEach(function (d) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = d[0]; b.addEventListener('click', d[1]); bar.appendChild(b);
    });
    model.layers.forEach(function (l) {
      var row = document.createElement('label');
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = l.on;
      cb.addEventListener('change', function () { visible[l.name] = cb.checked; requestDraw(); });
      var sw = document.createElement('span'); sw.className = 'sw';
      sw.style.background = cssColor(l.color, true);
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = l.name;
      if (!l.used) row.className = 'unused';
      row.appendChild(cb); row.appendChild(sw); row.appendChild(nm);
      list.appendChild(row); boxes.push(cb);
    });
    dlg.appendChild(title); dlg.appendChild(bar); dlg.appendChild(list);
    root.appendChild(dlg);
    tool('레이어', function () { dlg.showModal(); });

    var notes = [];
    if (skipped.length) notes.push('표시하지 않은 도형: ' + skipped.join(', '));
    if (model.truncated) notes.push('도면이 너무 커서 일부만 표시했습니다.');
    if (notes.length) {
      var note = document.createElement('div'); note.className = 'dxf-note';
      note.textContent = notes.join(' · ');
      note.addEventListener('click', function () { note.remove(); });
      root.appendChild(note);
    }

    // 화면 크기·밝기 변화에 맞춰 다시 그린다.
    var ro = new ResizeObserver(function () { if (resize()) requestDraw(); });
    ro.observe(root);
    var mo = new MutationObserver(requestDraw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    resize(); fit(); draw();

    return {
      zoomable: false,
      zoomBy: function (k) { zoomAt(W / 2, H / 2, k); requestDraw(); },
      dispose: function () {
        disposed = true;
        ro.disconnect(); mo.disconnect();
        clearTimeout(settle); cancelAnimationFrame(raf);
        canvas.width = canvas.height = 0;
      }
    };
  }

  window.HanDxf = { render: render };
})();
