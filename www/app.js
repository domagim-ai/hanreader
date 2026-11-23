// 한리더 본체: 파일을 받아 형식을 판별하고 알맞은 렌더러에 넘긴다.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var viewerEl = $('viewer'), nameEl = $('filename'), statusEl = $('status'), fileInput = $('file-input');

  var FONT_STEPS = [13, 15, 17, 19, 22, 25, 29, 34];
  var ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4];
  var state = {
    fontIndex: clampIndex(parseInt(localStorage.getItem('fontIndex'), 10), FONT_STEPS, 2),
    zoomIndex: 0,
    current: null,   // 현재 렌더러가 돌려준 핸들
    loadId: 0        // 새 문서를 열면 이전 작업을 무효로 만드는 번호
  };

  function clampIndex(i, arr, fallback) {
    return (Number.isInteger(i) && i >= 0 && i < arr.length) ? i : fallback;
  }

  // ----- 모양(글자 크기·다크 모드) -----
  function applyFont() {
    document.documentElement.style.setProperty('--font-size', FONT_STEPS[state.fontIndex] + 'px');
    localStorage.setItem('fontIndex', String(state.fontIndex));
  }
  function applyDark(on) {
    document.documentElement.classList.toggle('dark', on);
    localStorage.setItem('dark', on ? '1' : '0');
  }
  var savedDark = localStorage.getItem('dark');
  applyDark(savedDark === null ? window.matchMedia('(prefers-color-scheme: dark)').matches : savedDark === '1');
  applyFont();

  // A- / A+ : 글 문서(TXT·HWPX)는 글자 크기를, 쪽 문서(PDF·HWP)는 배율을 바꾼다.
  function step(delta) {
    var cur = state.current;
    if (cur && cur.zoomable) {
      var z = Math.max(0, Math.min(ZOOM_STEPS.length - 1, state.zoomIndex + delta));
      if (z !== state.zoomIndex) { state.zoomIndex = z; cur.setZoom(ZOOM_STEPS[z]); toast(Math.round(ZOOM_STEPS[z] * 100) + '%'); }
    } else {
      var f = Math.max(0, Math.min(FONT_STEPS.length - 1, state.fontIndex + delta));
      if (f !== state.fontIndex) { state.fontIndex = f; applyFont(); }
    }
  }

  // ----- 안내 문구 -----
  var toastTimer = null;
  function setStatus(text) {
    clearTimeout(toastTimer);
    if (text) { statusEl.textContent = text; statusEl.hidden = false; }
    else statusEl.hidden = true;
  }
  function toast(text) {
    setStatus(text);
    toastTimer = setTimeout(function () { statusEl.hidden = true; }, 1200);
  }

  function showError(title, detail) {
    viewerEl.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'error-box';
    var h = document.createElement('h2'); h.textContent = title;
    box.appendChild(h);
    if (detail) { var p = document.createElement('p'); p.textContent = detail; box.appendChild(p); }
    viewerEl.appendChild(box);
  }

  // ----- 문서 열기 -----
  async function openBytes(bytes, name) {
    var id = ++state.loadId;
    var ctx = {
      cancelled: function () { return id !== state.loadId; },
      status: function (t) { if (id === state.loadId) setStatus(t); }
    };

    if (state.current && state.current.dispose) { try { state.current.dispose(); } catch (e) {} }
    state.current = null;
    state.zoomIndex = 0;
    viewerEl.innerHTML = '';
    window.scrollTo(0, 0);
    nameEl.textContent = name || '문서';
    nameEl.title = name || '';
    setStatus('여는 중…');

    try {
      if (!bytes || !bytes.length) throw new Error('빈 파일입니다.');
      var fmt = await HanDetect.detectFormat(bytes);
      if (ctx.cancelled()) return;
      var handle;
      if (fmt.kind === 'pdf') handle = await HanPdf.render(viewerEl, fmt.offset ? bytes.subarray(fmt.offset) : bytes, ctx);
      else if (fmt.kind === 'hwpx') handle = await HanHwpx.render(viewerEl, fmt.zip, ctx);
      else if (fmt.kind === 'hwp') handle = HanHwp.render(viewerEl, bytes, ctx);
      else if (fmt.kind === 'txt') handle = HanTxt.render(viewerEl, bytes, ctx);
      else throw new Error(fmt.reason || '지원하지 않는 형식입니다.');

      if (ctx.cancelled()) { if (handle && handle.dispose) handle.dispose(); return; }
      state.current = handle;
      document.body.dataset.kind = fmt.kind;
      setStatus(null);
    } catch (e) {
      if (ctx.cancelled()) return;
      console.error(e);
      setStatus(null);
      showError('문서를 열 수 없습니다', String((e && e.message) || e));
    }
  }

  function base64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function nameFromUrl(url) {
    try {
      var last = decodeURIComponent(url.split('?')[0].split('#')[0]).split('/').pop() || '';
      last = last.split(':').pop();
      return /\.[A-Za-z0-9]{2,5}$/.test(last) ? last : '';
    } catch (e) { return ''; }
  }

  // ----- 안드로이드: 다른 앱이 넘겨 준 문서 열기 -----
  var cap = window.Capacitor;
  var isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  var lastUrl = null, lastUrlAt = 0;

  async function readNative(url) {
    // 1순위: 웹뷰 주소로 바꿔 직접 읽는다(큰 파일도 빠르다).
    try {
      var res = await fetch(cap.convertFileSrc(url));
      if (res.ok) {
        var buf = await res.arrayBuffer();
        if (buf.byteLength) return new Uint8Array(buf);
      }
    } catch (e) { /* 아래 방법으로 다시 시도 */ }
    // 2순위: Filesystem 플러그인(base64로 전달된다).
    var r = await cap.Plugins.Filesystem.readFile({ path: url });
    if (typeof r.data === 'string') return base64ToBytes(r.data);
    return new Uint8Array(await r.data.arrayBuffer());
  }

  async function openNativeUrl(url) {
    if (!url || !/^(content|file):/i.test(url)) return;
    // 콜드 스타트 때 getLaunchUrl과 appUrlOpen이 같은 주소를 연달아 주는 경우를 거른다.
    var now = Date.now();
    if (url === lastUrl && now - lastUrlAt < 3000) return;
    lastUrl = url; lastUrlAt = now;

    var name = nameFromUrl(url);
    try {
      var st = await cap.Plugins.Filesystem.stat({ path: url });
      if (st && st.name) name = st.name;
    } catch (e) { /* 이름을 못 얻어도 내용은 연다 */ }

    setStatus('여는 중…');
    try {
      var bytes = await readNative(url);
      await openBytes(bytes, name || '받은 문서');
    } catch (e) {
      console.error(e);
      setStatus(null);
      showError('문서를 읽을 수 없습니다', String((e && e.message) || e));
    }
  }

  if (isNative && cap.Plugins && cap.Plugins.App) {
    cap.Plugins.App.addListener('appUrlOpen', function (ev) { openNativeUrl(ev && ev.url); });
    cap.Plugins.App.getLaunchUrl().then(function (r) { if (r && r.url) openNativeUrl(r.url); }).catch(function () {});
  }

  // ----- 화면 단추 -----
  function pick() { fileInput.value = ''; fileInput.click(); }
  $('btn-open').addEventListener('click', pick);
  $('btn-open2').addEventListener('click', pick);
  fileInput.addEventListener('change', async function () {
    var f = fileInput.files && fileInput.files[0];
    if (!f) return;
    setStatus('여는 중…');
    try {
      await openBytes(new Uint8Array(await f.arrayBuffer()), f.name);
    } catch (e) {
      setStatus(null);
      showError('파일을 읽을 수 없습니다', String((e && e.message) || e));
    }
  });
  $('btn-smaller').addEventListener('click', function () { step(-1); });
  $('btn-bigger').addEventListener('click', function () { step(+1); });
  $('btn-dark').addEventListener('click', function () {
    applyDark(!document.documentElement.classList.contains('dark'));
  });
  $('btn-info').addEventListener('click', function () { $('info').showModal(); });

  // 개발용: 같은 서버의 문서를 주소로 열어 본다(예: ?src=/samples/a.hwpx). 앱에서는 쓰이지 않는다.
  if (!isNative) {
    var src = new URLSearchParams(location.search).get('src');
    if (src && src.charAt(0) === '/' && src.charAt(1) !== '/') {
      fetch(src).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(function (buf) {
        return openBytes(new Uint8Array(buf), decodeURIComponent(src.split('/').pop()));
      }).catch(function (e) { showError('문서를 불러올 수 없습니다', String(e.message || e)); });
    }
  }

  window.HanReader = { openBytes: openBytes };
})();
