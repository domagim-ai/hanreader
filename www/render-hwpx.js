// HWPX: ZIP 안의 Contents/section*.xml을 읽어 화면 폭에 맞게 문단·표를 다시 배치한다.
// 원본 쪽 모양을 재현하는 것이 아니라, 휴대폰에서 읽기 좋게 내용을 흘려 넣는 방식이다.
(function () {
  var BATCH = 300; // 한 번에 그릴 문단 수(긴 문서에서 화면이 멈추지 않게 나눠 그린다)

  function kids(el, name) {
    var out = [];
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === name) out.push(c);
    }
    return out;
  }
  function kid(el, name) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === name) return c;
    }
    return null;
  }

  // header.xml에서 글자 모양(크기·굵기)과 문단 정렬만 가져온다.
  function readStyles(headerDoc) {
    var chars = {}, paras = {};
    if (!headerDoc) return { chars: chars, paras: paras };
    var all = headerDoc.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.localName === 'charPr') {
        chars[el.getAttribute('id')] = {
          size: parseInt(el.getAttribute('height'), 10) || 1000,
          bold: !!kid(el, 'bold'),
          italic: !!kid(el, 'italic'),
          underline: (function (u) { return !!u && u.getAttribute('type') !== 'NONE'; })(kid(el, 'underline'))
        };
      } else if (el.localName === 'paraPr') {
        var al = kid(el, 'align');
        paras[el.getAttribute('id')] = { align: al ? al.getAttribute('horizontal') : null };
      }
    }
    return { chars: chars, paras: paras };
  }

  function mimeOf(name) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' }[ext] || null;
  }

  function Renderer(zip, styles, images, urls) {
    this.zip = zip; this.styles = styles; this.images = images; this.urls = urls;
    this.pendingImages = [];
  }

  // hp:t 안의 글자와 줄바꿈·탭을 옮긴다.
  Renderer.prototype.appendText = function (target, t) {
    for (var n = t.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        target.appendChild(document.createTextNode(n.nodeValue));
      } else if (n.nodeType === 1) {
        if (n.localName === 'lineBreak') target.appendChild(document.createElement('br'));
        else if (n.localName === 'tab') target.appendChild(document.createTextNode('\t'));
        else if (n.localName === 'fwSpace' || n.localName === 'nbSpace') target.appendChild(document.createTextNode(' '));
        else if (n.localName === 'hyphen') target.appendChild(document.createTextNode('-'));
        else if (n.textContent) target.appendChild(document.createTextNode(n.textContent));
      }
    }
  };

  Renderer.prototype.renderTable = function (tbl) {
    var wrap = document.createElement('div');
    wrap.className = 'tbl-wrap';
    var table = document.createElement('table');
    var rows = kids(tbl, 'tr');
    for (var r = 0; r < rows.length; r++) {
      var tr = document.createElement('tr');
      var cells = kids(rows[r], 'tc');
      for (var c = 0; c < cells.length; c++) {
        var td = document.createElement('td');
        var span = kid(cells[c], 'cellSpan');
        if (span) {
          var cs = parseInt(span.getAttribute('colSpan'), 10) || 1;
          var rs = parseInt(span.getAttribute('rowSpan'), 10) || 1;
          if (cs > 1) td.colSpan = cs;
          if (rs > 1) td.rowSpan = rs;
        }
        var sub = kid(cells[c], 'subList');
        if (sub) {
          var ps = kids(sub, 'p');
          for (var i = 0; i < ps.length; i++) this.renderParagraph(td, ps[i]);
        }
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    wrap.appendChild(table);
    return wrap;
  };

  Renderer.prototype.renderPicture = function (pic) {
    var imgEl = null, all = pic.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) if (all[i].localName === 'img') { imgEl = all[i]; break; }
    if (!imgEl) return null;
    var ref = imgEl.getAttribute('binaryItemIDRef');
    var path = this.images[ref];
    if (!path) return null;
    var img = document.createElement('img');
    img.alt = '';
    this.pendingImages.push({ img: img, path: path });
    return img;
  };

  // 글상자·도형 안의 글도 읽을 수 있게 본문으로 풀어 넣는다.
  Renderer.prototype.renderDrawText = function (parent, shape) {
    var all = shape.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].localName === 'subList') {
        var ps = kids(all[i], 'p');
        for (var j = 0; j < ps.length; j++) this.renderParagraph(parent, ps[j]);
        return;
      }
    }
  };

  Renderer.prototype.renderParagraph = function (parent, p) {
    var el = document.createElement('p');
    var pp = this.styles.paras[p.getAttribute('paraPrIDRef')];
    if (pp && pp.align === 'CENTER') el.style.textAlign = 'center';
    else if (pp && pp.align === 'RIGHT') el.style.textAlign = 'right';
    parent.appendChild(el);

    var blocks = []; // 문단 뒤에 붙일 표·그림
    var runs = kids(p, 'run');
    for (var r = 0; r < runs.length; r++) {
      var run = runs[r];
      var cp = this.styles.chars[run.getAttribute('charPrIDRef')];
      var span = null;
      for (var c = run.firstElementChild; c; c = c.nextElementSibling) {
        var name = c.localName;
        if (name === 't') {
          if (!span) {
            span = document.createElement('span');
            if (cp) {
              if (cp.bold) span.style.fontWeight = '700';
              if (cp.italic) span.style.fontStyle = 'italic';
              if (cp.underline) span.style.textDecoration = 'underline';
              var ratio = Math.max(0.8, Math.min(1.8, cp.size / 1000));
              if (Math.abs(ratio - 1) > 0.05) span.style.fontSize = ratio.toFixed(2) + 'em';
            }
            el.appendChild(span);
          }
          this.appendText(span, c);
        } else if (name === 'tbl') {
          blocks.push(this.renderTable(c));
        } else if (name === 'pic') {
          var img = this.renderPicture(c);
          if (img) el.appendChild(img);
        } else if (name === 'equation') {
          var sc = kid(c, 'script');
          if (sc && sc.textContent) el.appendChild(document.createTextNode(' [수식: ' + sc.textContent + '] '));
        } else if (name === 'rect' || name === 'ellipse' || name === 'polygon' || name === 'container' || name === 'textart') {
          var box = document.createElement('div');
          this.renderDrawText(box, c);
          if (box.childNodes.length) blocks.push(box);
        }
      }
    }
    for (var b = 0; b < blocks.length; b++) parent.appendChild(blocks[b]);
  };

  Renderer.prototype.loadImages = async function () {
    for (var i = 0; i < this.pendingImages.length; i++) {
      var it = this.pendingImages[i];
      var f = this.zip.file(it.path), type = mimeOf(it.path);
      if (!f || !type) continue;
      try {
        var buf = await f.async('arraybuffer');
        var url = URL.createObjectURL(new Blob([buf], { type: type }));
        this.urls.push(url);
        it.img.src = url;
      } catch (e) { /* 그림 하나가 깨져도 본문은 계속 보여 준다 */ }
    }
    this.pendingImages = [];
  };

  function tick() { return new Promise(function (res) { setTimeout(res, 0); }); }

  async function renderHwpx(container, zip, ctx) {
    var parser = new DOMParser();
    async function xml(path) {
      var f = zip.file(path);
      if (!f) return null;
      return parser.parseFromString(await f.async('string'), 'application/xml');
    }

    var styles = readStyles(await xml('Contents/header.xml'));

    // content.hpf의 목록에서 그림 id → 파일 경로를 얻는다.
    var images = {};
    var hpf = await xml('Contents/content.hpf');
    if (hpf) {
      var items = hpf.getElementsByTagName('*');
      for (var i = 0; i < items.length; i++) {
        if (items[i].localName === 'item') {
          var href = items[i].getAttribute('href');
          if (href && /^BinData\//i.test(href)) images[items[i].getAttribute('id')] = href;
        }
      }
    }

    var names = Object.keys(zip.files)
      .filter(function (n) { return /^Contents\/section\d+\.xml$/i.test(n); })
      .sort(function (a, b) { return parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10); });

    var root = document.createElement('div');
    root.className = 'doc-hwpx';
    container.appendChild(root);

    var urls = [];
    var rd = new Renderer(zip, styles, images, urls);

    for (var s = 0; s < names.length; s++) {
      if (ctx.cancelled()) break;
      var doc = await xml(names[s]);
      if (!doc || doc.getElementsByTagName('parsererror').length) continue;
      if (s > 0) { var hr = document.createElement('hr'); hr.className = 'section-break'; root.appendChild(hr); }
      var ps = kids(doc.documentElement, 'p');
      for (var k = 0; k < ps.length; k += BATCH) {
        if (ctx.cancelled()) break;
        var frag = document.createDocumentFragment();
        for (var j = k; j < Math.min(k + BATCH, ps.length); j++) rd.renderParagraph(frag, ps[j]);
        root.appendChild(frag);
        await rd.loadImages();
        if (ps.length > BATCH) {
          ctx.status('불러오는 중… ' + (s + 1) + '/' + names.length + ' 구역 ' + Math.round(Math.min(k + BATCH, ps.length) / ps.length * 100) + '%');
          await tick();
        }
      }
    }
    ctx.status(null);

    return {
      zoomable: false,
      dispose: function () { urls.forEach(function (u) { URL.revokeObjectURL(u); }); }
    };
  }

  window.HanHwpx = { render: renderHwpx };
})();
