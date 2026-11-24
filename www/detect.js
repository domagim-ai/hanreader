// 파일 앞부분(매직 넘버)으로 형식을 판별한다.
// 카카오톡 등은 확장자 없는 content:// 주소나 application/octet-stream으로 넘기므로 이름을 믿지 않는다.
(function () {
  function startsWith(bytes, sig) {
    if (bytes.length < sig.length) return false;
    for (var i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
    return true;
  }

  // 반환: { kind: 'pdf' | 'hwp' | 'hwpx' | 'xlsx'(XLS 포함) | 'txt' | 'unsupported', zip?, reason? }
  async function detectFormat(bytes) {
    // PDF는 앞에 약간의 쓰레기 바이트가 붙는 경우가 있어 처음 1KB 안에서 찾는다.
    var head = bytes.subarray(0, Math.min(bytes.length, 1024));
    for (var i = 0; i + 4 <= head.length; i++) {
      if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46) {
        return { kind: 'pdf', offset: i };
      }
    }
    if (startsWith(bytes, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])) {
      // HWP와 옛 엑셀(XLS)은 같은 그릇(OLE2 복합 파일)을 쓴다. 안에 든 스트림 이름으로 가른다.
      try {
        var names = XLSX.CFB.read(bytes, { type: 'array' }).FullPaths.map(function (p) {
          return p.replace(/\/$/, '').split('/').pop().toLowerCase();
        });
        var has = function (n) { return names.indexOf(n) >= 0; };
        if (has('fileheader')) return { kind: 'hwp' };
        if (has('workbook') || has('book')) return { kind: 'xlsx' };
        if (has('encryptedpackage')) return { kind: 'unsupported', reason: '암호가 걸린 오피스 문서는 열 수 없습니다.' };
        if (has('worddocument')) return { kind: 'unsupported', reason: '워드(DOC) 문서는 아직 지원하지 않습니다.' };
        if (has('powerpoint document')) return { kind: 'unsupported', reason: '파워포인트(PPT) 문서는 아직 지원하지 않습니다.' };
      } catch (e) { /* 그릇을 못 읽으면 HWP로 보고 시도한다 */ }
      return { kind: 'hwp' };
    }
    if (startsWith(bytes, [0x50, 0x4B, 0x03, 0x04])) {
      try {
        var zip = await JSZip.loadAsync(bytes);
        var hasSection = Object.keys(zip.files).some(function (n) {
          return /^Contents\/section\d+\.xml$/i.test(n);
        });
        if (hasSection) return { kind: 'hwpx', zip: zip };
        if (zip.files['xl/workbook.xml'] || zip.files['xl/workbook.bin']) return { kind: 'xlsx' };
        if (zip.files['word/document.xml']) return { kind: 'unsupported', reason: '워드(DOCX) 문서는 아직 지원하지 않습니다.' };
        if (zip.files['ppt/presentation.xml']) return { kind: 'unsupported', reason: '파워포인트(PPTX) 문서는 아직 지원하지 않습니다.' };
        return { kind: 'unsupported', reason: '지원하지 않는 압축 파일입니다.' };
      } catch (e) {
        return { kind: 'unsupported', reason: '압축 파일을 열 수 없습니다.' };
      }
    }
    // 구형 HWP 3.0 ("HWP Document File V3.00")
    if (startsWith(bytes, [0x48, 0x57, 0x50, 0x20, 0x44, 0x6F, 0x63])) {
      return { kind: 'unsupported', reason: 'HWP 3.0(1990년대 형식) 문서는 아직 지원하지 않습니다.' };
    }
    return { kind: 'txt' };
  }

  window.HanDetect = { detectFormat: detectFormat };
})();
