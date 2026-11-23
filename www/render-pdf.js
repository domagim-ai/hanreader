// PDF: PDF.js로 쪽마다 그린다. 화면에 가까워진 쪽만 그리고 멀어진 쪽은 비워서 메모리를 아낀다.
(function () {
  var pdfjsPromise = null;
  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('./libs/pdf.min.js').then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
        return lib;
      });
    }
    return pdfjsPromise;
  }

  var MAX_CANVAS_PIXELS = 16 * 1024 * 1024; // 기기 캔버스 한계를 넘지 않게 한다

  async function renderPdf(container, bytes, ctx) {
    var pdfjsLib = await loadPdfjs();
    var task = pdfjsLib.getDocument({
      data: bytes,
      cMapUrl: 'libs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'libs/standard_fonts/',
      isEvalSupported: false
    });
    var pdf;
    try {
      pdf = await task.promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error('암호가 걸린 PDF는 아직 열 수 없습니다.');
      throw e;
    }

    var root = document.createElement('div');
    root.className = 'doc-pdf';
    var pagesEl = document.createElement('div');
    pagesEl.className = 'pages';
    root.appendChild(pagesEl);
    container.appendChild(root);

    var zoom = 1;
    var slots = []; // { el, page, ratio, canvas, renderTask, token }
    var disposed = false;

    function baseWidth() { return Math.max(200, root.clientWidth - 8); }

    // 쪽 크기를 미리 알아야 스크롤 길이가 맞는다. 첫 쪽 비율로 자리를 잡고, 그릴 때 실제 비율로 고친다.
    var first = await pdf.getPage(1);
    var fv = first.getViewport({ scale: 1 });
    var firstRatio = fv.height / fv.width;

    for (var i = 1; i <= pdf.numPages; i++) {
      var el = document.createElement('div');
      el.className = 'page';
      el.dataset.page = String(i);
      var num = document.createElement('span');
      num.className = 'num';
      num.textContent = i + ' / ' + pdf.numPages;
      el.appendChild(num);
      pagesEl.appendChild(el);
      slots.push({ el: el, index: i, page: i === 1 ? first : null, ratio: firstRatio, canvas: null, renderTask: null, token: 0 });
    }

    function layout() {
      var w = Math.round(baseWidth() * zoom);
      pagesEl.style.width = w + 'px';
      for (var k = 0; k < slots.length; k++) {
        slots[k].el.style.width = w + 'px';
        slots[k].el.style.height = Math.round(w * slots[k].ratio) + 'px';
      }
    }

    function clearSlot(slot) {
      slot.token++;
      if (slot.renderTask) { try { slot.renderTask.cancel(); } catch (e) {} slot.renderTask = null; }
      if (slot.canvas) { slot.canvas.width = 0; slot.canvas.height = 0; slot.canvas.remove(); slot.canvas = null; }
    }

    async function drawSlot(slot) {
      if (disposed || slot.canvas) return;
      var token = ++slot.token;
      if (!slot.page) slot.page = await pdf.getPage(slot.index);
      if (disposed || token !== slot.token) return;
      var page = slot.page;
      var v1 = page.getViewport({ scale: 1 });
      var ratio = v1.height / v1.width;
      if (Math.abs(ratio - slot.ratio) > 0.001) { slot.ratio = ratio; layout(); }

      var cssW = baseWidth() * zoom;
      var dpr = Math.min(window.devicePixelRatio || 1, 3);
      var scale = (cssW * dpr) / v1.width;
      var px = (v1.width * scale) * (v1.height * scale);
      if (px > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / px);
      var vp = page.getViewport({ scale: scale });

      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      slot.canvas = canvas;
      slot.el.insertBefore(canvas, slot.el.firstChild);
      slot.renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
      try {
        await slot.renderTask.promise;
      } catch (e) {
        // 취소된 경우는 무시한다
      }
      if (token === slot.token) slot.renderTask = null;
    }

    var bySlot = new Map();
    slots.forEach(function (s) { bySlot.set(s.el, s); });

    // 화면 위아래 한 화면 반 정도까지 미리 그린다.
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var slot = bySlot.get(en.target);
        if (!slot) return;
        if (en.isIntersecting) drawSlot(slot);
        else clearSlot(slot);
      });
    }, { rootMargin: '150% 0px 150% 0px' });

    layout();
    slots.forEach(function (s) { io.observe(s.el); });

    var resizeTimer = null;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(redraw, 200);
    }
    function redraw() {
      if (disposed) return;
      layout();
      slots.forEach(function (s) {
        if (s.canvas) { clearSlot(s); drawSlot(s); }
      });
    }
    window.addEventListener('resize', onResize);

    return {
      zoomable: true,
      pageCount: pdf.numPages,
      setZoom: function (z) { zoom = z; redraw(); },
      dispose: function () {
        disposed = true;
        window.removeEventListener('resize', onResize);
        io.disconnect();
        slots.forEach(clearSlot);
        try { task.destroy(); } catch (e) {}
      }
    };
  }

  window.HanPdf = { render: renderPdf };
})();
