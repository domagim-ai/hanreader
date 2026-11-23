// 외부 라이브러리를 node_modules에서 www/libs로 옮긴다(앱 안에 넣어 인터넷 없이도 동작하게 한다).
// www/libs는 저장소에 올리지 않고, 빌드할 때마다 이 스크립트로 만든다.
import { cpSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'www', 'libs');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// JSZip
copyFileSync(join(nm, 'jszip', 'dist', 'jszip.min.js'), join(out, 'jszip.min.js'));

// PDF.js — 안드로이드 웹뷰가 .mjs의 MIME 형식을 모를 수 있어 .js 이름으로 둔다.
const pdf = join(nm, 'pdfjs-dist');
copyFileSync(join(pdf, 'legacy', 'build', 'pdf.min.mjs'), join(out, 'pdf.min.js'));
copyFileSync(join(pdf, 'legacy', 'build', 'pdf.worker.min.mjs'), join(out, 'pdf.worker.min.js'));
// 글꼴이 들어 있지 않은 한글 PDF를 그리려면 CMap이 필요하다.
cpSync(join(pdf, 'cmaps'), join(out, 'cmaps'), { recursive: true });
cpSync(join(pdf, 'standard_fonts'), join(out, 'standard_fonts'), { recursive: true });

// hwp.js — 브라우저용 묶음이 없어 직접 하나로 묶는다. 내부의 'fs' 참조는 빈 모듈로 바꾼다.
const stub = join(out, '_empty.js');
writeFileSync(stub, 'export default {};\n');
await build({
  entryPoints: [join(nm, 'hwp.js', 'build', 'esm.js')],
  bundle: true,
  format: 'iife',
  globalName: 'HWP',
  platform: 'browser',
  minify: true,
  legalComments: 'inline',
  alias: { fs: stub },
  outfile: join(out, 'hwp.js'),
  logLevel: 'warning'
});
rmSync(stub);

// 라이선스 전문도 함께 넣는다.
copyFileSync(join(pdf, 'LICENSE'), join(out, 'LICENSE-pdfjs.txt'));
copyFileSync(join(nm, 'hwp.js', 'LICENSE'), join(out, 'LICENSE-hwpjs.txt'));
copyFileSync(join(nm, 'jszip', 'LICENSE.markdown'), join(out, 'LICENSE-jszip.txt'));

console.log('www/libs 준비 완료');
