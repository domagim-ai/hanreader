// 개발용 정적 서버. www를 그대로 보여 준다.
// 첫 인자나 SAMPLES_DIR 환경 변수로 폴더를 주면 그 폴더를 /samples/ 아래로 함께 보여 준다(시험 문서용).
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { dirname, join, normalize, extname, sep, resolve as abs } from 'node:path';
import { fileURLToPath } from 'node:url';

const www = join(dirname(fileURLToPath(import.meta.url)), '..', 'www');
const samplesArg = process.argv[2] || process.env.SAMPLES_DIR || null;
const samples = samplesArg ? abs(samplesArg) : null;
const port = Number(process.env.PORT || 5173);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.txt': 'text/plain'
};

function resolve(base, rel) {
  const p = normalize(join(base, rel));
  return p === base || p.startsWith(base + sep) ? p : null;
}

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  if (samples && path.startsWith('/samples/')) file = resolve(samples, path.slice('/samples/'.length));
  else file = resolve(www, path === '/' ? 'index.html' : path.slice(1));
  try {
    if (!file || !statSync(file).isFile()) throw new Error('없음');
    res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));
