// TXT: UTF-8로 엄격하게 읽어 보고, 실패하면 EUC-KR(CP949)로 읽는다.
(function () {
  function decodeText(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(bytes);
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(bytes);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      // WHATWG의 'euc-kr'는 CP949(확장 완성형)를 포함한다.
      return new TextDecoder('euc-kr').decode(bytes);
    }
  }

  // 사람이 읽을 글이 아닌 이진 파일인지 대략 판단한다.
  function looksBinary(bytes) {
    var n = Math.min(bytes.length, 4096), bad = 0;
    for (var i = 0; i < n; i++) {
      var b = bytes[i];
      if (b === 0 || (b < 9) || (b > 13 && b < 32 && b !== 27)) bad++;
    }
    return n > 0 && bad / n > 0.1;
  }

  function renderTxt(container, bytes) {
    if (looksBinary(bytes) && !(bytes[0] === 0xFF && bytes[1] === 0xFE) && !(bytes[0] === 0xFE && bytes[1] === 0xFF)) {
      throw new Error('지원하지 않는 형식의 파일입니다.');
    }
    var pre = document.createElement('pre');
    pre.className = 'doc-txt';
    pre.textContent = decodeText(bytes);
    container.appendChild(pre);
    return { zoomable: false };
  }

  window.HanTxt = { render: renderTxt, decodeText: decodeText, looksBinary: looksBinary };
})();
