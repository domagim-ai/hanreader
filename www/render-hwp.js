// HWP(구형 이진 형식): hwp.js로 쪽 모양대로 그린 뒤 화면 폭에 맞춰 축소한다.
// hwp.js가 그리지 못하는 문서는 글자만 뽑아서 보여 준다.
(function () {
  // hwp.js 뷰어는 데스크톱 화면을 전제로 자체 머리띠·여백·스크롤을 만든다. 휴대폰에 맞게 걷어 낸다.
  function adapt(viewerEl) {
    viewerEl.style.overflow = 'visible';
    viewerEl.style.height = 'auto';
    viewerEl.style.backgroundColor = 'transparent';
    var content = null;
    for (var c = viewerEl.firstElementChild; c; c = c.nextElementSibling) {
      if (c.querySelector('[data-page-number]')) content = c;
      else c.style.display = 'none'; // 머리띠, 정보 창
    }
    if (content) {
      content.style.padding = '0';
      content.style.overflow = 'visible';
      content.style.height = 'auto';
    }
    return content;
  }

  function collectText(paragraphs, out, depth) {
    if (!paragraphs || depth > 8) return;
    for (var i = 0; i < paragraphs.length; i++) {
      var p = paragraphs[i], line = '';
      var chars = (p && p.content) || [];
      for (var j = 0; j < chars.length; j++) {
        var v = chars[j].value;
        if (typeof v === 'string') line += v;
        else if (v === 10 || v === 13) line += '\n';
        else if (v === 9) line += '\t';
      }
      out.push(line);
      var controls = (p && p.controls) || [];
      for (var k = 0; k < controls.length; k++) {
        var lists = (controls[k] && controls[k].content) || [];
        for (var m = 0; m < lists.length; m++) {
          var list = lists[m];
          if (Array.isArray(list)) {
            for (var q = 0; q < list.length; q++) collectText(list[q] && list[q].items, out, depth + 1);
          } else if (list && list.items) {
            collectText(list.items, out, depth + 1);
          }
        }
      }
    }
  }

  function renderTextOnly(container, bytes) {
    var doc = HWP.parse(bytes, { type: 'array' });
    var out = [];
    (doc.sections || []).forEach(function (s) { collectText(s.content, out, 0); });
    var text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw new Error('문서에서 글자를 찾지 못했습니다.');
    var root = document.createElement('div');
    root.className = 'doc-hwp';
    var note = document.createElement('p');
    note.className = 'muted';
    note.style.padding = '12px 16px 0';
    note.textContent = '이 문서는 서식을 그릴 수 없어 글자만 표시합니다.';
    var body = document.createElement('div');
    body.className = 'hwp-text';
    body.textContent = text;
    root.appendChild(note);
    root.appendChild(body);
    container.appendChild(root);
    return { zoomable: false };
  }

  function renderHwp(container, bytes) {
    var root = document.createElement('div');
    root.className = 'doc-hwp';
    var scaleBox = document.createElement('div');
    scaleBox.className = 'hwp-scale';
    root.appendChild(scaleBox);
    container.appendChild(root);

    var viewer;
    try {
      viewer = new HWP.Viewer(scaleBox, bytes, { type: 'array' });
    } catch (e) {
      root.remove();
      try {
        return renderTextOnly(container, bytes);
      } catch (e2) {
        var msg = String((e && e.message) || e);
        if (/password|암호|encrypt/i.test(msg)) throw new Error('암호가 걸린 HWP 문서는 열 수 없습니다.');
        throw new Error('이 HWP 문서는 열 수 없습니다. (' + msg + ')');
      }
    }

    var content = adapt(scaleBox.firstElementChild);
    var zoom = 1;

    function pageWidth() {
      var w = 0;
      var pages = scaleBox.querySelectorAll('[data-page-number]');
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].classList.contains('hwpjs-observer')) continue;
        w = Math.max(w, pages[i].offsetWidth);
      }
      return w;
    }

    var natural = 0;
    function fit() {
      scaleBox.style.zoom = '1';
      natural = pageWidth() || natural;
      if (!natural) return;
      var avail = Math.max(200, root.clientWidth);
      scaleBox.style.zoom = String((avail / natural) * zoom);
    }
    fit();

    var timer = null;
    function onResize() { clearTimeout(timer); timer = setTimeout(fit, 200); }
    window.addEventListener('resize', onResize);

    return {
      zoomable: true,
      setZoom: function (z) { zoom = z; fit(); },
      dispose: function () {
        window.removeEventListener('resize', onResize);
        try { viewer.distory(); } catch (e) {}
      }
    };
  }

  window.HanHwp = { render: renderHwp };
})();
