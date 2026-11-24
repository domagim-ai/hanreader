// 엑셀(XLSX·XLS·CSV): SheetJS로 읽어 시트별 표로 보여 준다. 보기 전용이며 값·병합 셀·숨김 행/열만 반영한다.
(function () {
  var ROW_BATCH = 150;   // 한 번에 그리는 행 수(아래로 밀면 이어서 그린다)
  var MAX_COLS = 300;    // 서식만 걸린 빈 열이 끝없이 이어지는 파일을 막는다

  function colName(i) {
    var s = '';
    for (i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }

  function cellText(cell) {
    if (!cell || cell.t === 'z' || cell.v === undefined || cell.v === null) return '';
    if (cell.w !== undefined) return String(cell.w);
    if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
    try { return XLSX.utils.format_cell(cell); } catch (e) { return String(cell.v); }
  }

  // 시트 하나를 그릴 준비: 실제로 값이 있는 범위, 보이는 행/열, 병합 정보를 계산한다.
  function prepare(ws) {
    var data = (ws && ws['!data']) || [];
    var lastRow = -1, lastCol = -1;
    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      if (!row) continue;
      for (var c = row.length - 1; c >= 0; c--) {
        var cell = row[c];
        if (cell && cell.t !== 'z' && cell.v !== undefined && cell.v !== null && cell.v !== '') {
          if (c > lastCol) lastCol = c;
          lastRow = r;
          break;
        }
      }
    }
    var truncated = false;
    if (lastCol >= MAX_COLS) { lastCol = MAX_COLS - 1; truncated = true; }

    var rowsMeta = ws['!rows'] || [], colsMeta = ws['!cols'] || [];
    var rows = [], cols = [], rowPos = {}, colPos = {};
    for (var i = 0; i <= lastRow; i++) if (!(rowsMeta[i] && rowsMeta[i].hidden)) { rowPos[i] = rows.length; rows.push(i); }
    for (var j = 0; j <= lastCol; j++) if (!(colsMeta[j] && colsMeta[j].hidden)) { colPos[j] = cols.length; cols.push(j); }

    // 병합 셀: 보이는 첫 칸을 대표로 삼고 나머지 칸은 그리지 않는다.
    var anchors = {}, covered = {};
    (ws['!merges'] || []).forEach(function (m) {
      var vr = [], vc = [], a, b;
      for (a = m.s.r; a <= Math.min(m.e.r, lastRow); a++) if (rowPos[a] !== undefined) vr.push(a);
      for (b = m.s.c; b <= Math.min(m.e.c, lastCol); b++) if (colPos[b] !== undefined) vc.push(b);
      if (!vr.length || !vc.length) return;
      if (vr.length * vc.length > 200000) return; // 비정상적으로 큰 병합은 무시
      for (a = 0; a < vr.length; a++) for (b = 0; b < vc.length; b++) covered[vr[a] + ',' + vc[b]] = true;
      delete covered[vr[0] + ',' + vc[0]];
      anchors[vr[0] + ',' + vc[0]] = { rs: vr.length, cs: vc.length, r: m.s.r, c: m.s.c };
    });
    return { data: data, rows: rows, cols: cols, anchors: anchors, covered: covered, truncated: truncated };
  }

  function buildRow(p, r) {
    var tr = document.createElement('tr');
    var th = document.createElement('th');
    th.className = 'rn';
    th.textContent = String(r + 1);
    tr.appendChild(th);
    var row = p.data[r] || [];
    for (var k = 0; k < p.cols.length; k++) {
      var c = p.cols[k], key = r + ',' + c;
      if (p.covered[key]) continue;
      var td = document.createElement('td');
      var a = p.anchors[key];
      var cell = a ? (p.data[a.r] || [])[a.c] : row[c];
      var text = cellText(cell);
      if (a) {
        if (a.rs > 1) td.rowSpan = a.rs;
        if (a.cs > 1) td.colSpan = a.cs;
      }
      if (cell && (cell.t === 'n' || cell.t === 'd')) td.className = 'num';
      else if (a && a.cs > 1) td.className = 'span';
      if (text.length > 28 || text.indexOf('\n') >= 0) td.className += ' wrap';
      if (text) td.textContent = text;
      tr.appendChild(td);
    }
    return tr;
  }

  function showSheet(wrap, ws, state) {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    wrap.innerHTML = '';
    wrap.scrollTop = 0; wrap.scrollLeft = 0;
    var p = prepare(ws || {});
    if (!p.rows.length || !p.cols.length) {
      var empty = document.createElement('p');
      empty.className = 'sheet-empty';
      empty.textContent = '내용이 없는 시트입니다. (차트·그림은 표시되지 않습니다.)';
      wrap.appendChild(empty);
      return;
    }
    var table = document.createElement('table');
    var thead = document.createElement('thead'), hr = document.createElement('tr');
    var corner = document.createElement('th'); corner.className = 'rn corner'; hr.appendChild(corner);
    p.cols.forEach(function (c) { var th = document.createElement('th'); th.textContent = colName(c); hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = document.createElement('tbody'); table.appendChild(tbody);
    wrap.appendChild(table);

    var next = 0;
    var sentinel = document.createElement('div');
    sentinel.className = 'sheet-more';
    function more() {
      var frag = document.createDocumentFragment();
      var end = Math.min(p.rows.length, next + ROW_BATCH);
      for (; next < end; next++) frag.appendChild(buildRow(p, p.rows[next]));
      tbody.appendChild(frag);
      if (next >= p.rows.length) {
        if (state.observer) { state.observer.disconnect(); state.observer = null; }
        sentinel.textContent = p.truncated ? '열이 너무 많아 앞쪽 ' + MAX_COLS + '열만 표시했습니다.' : '';
      } else {
        sentinel.textContent = '… ' + next + ' / ' + p.rows.length + '행';
      }
    }
    more();
    wrap.appendChild(sentinel);
    if (next < p.rows.length) {
      state.observer = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) more();
      }, { root: wrap, rootMargin: '150% 0px' });
      state.observer.observe(sentinel);
    }
  }

  function renderWorkbook(container, wb) {
    var info = (wb.Workbook && wb.Workbook.Sheets) || [];
    var names = wb.SheetNames.filter(function (n, i) { return !(info[i] && info[i].Hidden); });
    if (!names.length) names = wb.SheetNames.slice();
    if (!names.length) throw new Error('시트가 없는 파일입니다.');

    var root = document.createElement('div'); root.className = 'doc-xlsx';
    var wrap = document.createElement('div'); wrap.className = 'sheet-wrap';
    var tabs = document.createElement('div'); tabs.className = 'sheet-tabs';
    root.appendChild(wrap); root.appendChild(tabs);
    container.appendChild(root);

    var state = { observer: null };
    var buttons = names.map(function (n) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = n;
      b.addEventListener('click', function () { select(n); });
      tabs.appendChild(b);
      return b;
    });
    function select(n) {
      buttons.forEach(function (b, i) {
        var on = names[i] === n;
        b.classList.toggle('on', on);
        if (on && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
      showSheet(wrap, wb.Sheets[n], state);
    }
    if (names.length < 2) tabs.hidden = true;
    select(names[0]);

    return {
      zoomable: false,
      dispose: function () { if (state.observer) state.observer.disconnect(); }
    };
  }

  function pause() { return new Promise(function (r) { setTimeout(r, 30); }); }

  function friendly(e) {
    var msg = String((e && e.message) || e);
    if (/password|encrypt/i.test(msg)) return new Error('암호가 걸린 엑셀 파일은 열 수 없습니다.');
    return new Error('엑셀 파일을 읽지 못했습니다. (' + msg + ')');
  }

  async function render(container, bytes, ctx) {
    ctx.status('엑셀 읽는 중…');
    await pause(); // 안내 문구가 먼저 보이도록 한 박자 쉰다
    var wb;
    try {
      wb = XLSX.read(bytes, { type: 'array', dense: true, cellStyles: true, cellFormula: false, cellHTML: false });
    } catch (e) { throw friendly(e); }
    if (ctx.cancelled()) return null;
    return renderWorkbook(container, wb);
  }

  async function renderCsv(container, text, ctx) {
    ctx.status('표 읽는 중…');
    await pause();
    var wb;
    try {
      // raw: 앞자리 0(전화번호·코드)이 사라지지 않게 글자 그대로 둔다.
      wb = XLSX.read(text, { type: 'string', dense: true, raw: true });
    } catch (e) { throw friendly(e); }
    if (ctx.cancelled()) return null;
    return renderWorkbook(container, wb);
  }

  window.HanXlsx = { render: render, renderCsv: renderCsv };
})();
