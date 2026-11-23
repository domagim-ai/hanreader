// `npx cap add android`가 만든 안드로이드 프로젝트를 한리더에 맞게 고친다.
//  1) AndroidManifest.xml: 다른 앱(카카오톡·내 파일·메일)의 '연결 프로그램' 목록에 뜨도록 인텐트 필터 추가
//  2) app/build.gradle: 버전 이름·번호를 package.json과 빌드 번호(VERSION_CODE)에서 가져옴
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePath = join(root, 'android', 'app', 'build.gradle');
const MARK = 'hanreader:intent-filters';

const mimeTypes = [
  'text/plain',
  'application/pdf',
  'application/x-hwp',
  'application/haansofthwp',
  'application/vnd.hancom.hwp',
  'application/vnd.hancom.hwpx',
  'application/hwp+zip',
  'application/x-hwpx',
  'application/octet-stream'
];

// 형식을 모르는 채(*/*)로 넘기는 파일 관리자를 위해 확장자로도 받는다.
// 안드로이드의 pathPattern은 '.'이 여러 개인 경로를 한 번에 못 맞춰 단계별로 적는다.
const exts = ['hwp', 'hwpx', 'HWP', 'HWPX'];
const dots = ['.*\\\\.', '.*\\\\..*\\\\.', '.*\\\\..*\\\\..*\\\\.', '.*\\\\..*\\\\..*\\\\..*\\\\.'];
const pathPatterns = exts.flatMap((e) => dots.map((d) => d + e));

const indent = '            ';
const filters = `
${indent}<!-- ${MARK} (scripts/patch-manifest.mjs가 넣음) -->
${indent}<intent-filter>
${indent}    <action android:name="android.intent.action.VIEW" />
${indent}    <category android:name="android.intent.category.DEFAULT" />
${indent}    <category android:name="android.intent.category.BROWSABLE" />
${indent}    <data android:scheme="content" />
${indent}    <data android:scheme="file" />
${mimeTypes.map((m) => `${indent}    <data android:mimeType="${m}" />`).join('\n')}
${indent}</intent-filter>
${indent}<intent-filter>
${indent}    <action android:name="android.intent.action.VIEW" />
${indent}    <category android:name="android.intent.category.DEFAULT" />
${indent}    <category android:name="android.intent.category.BROWSABLE" />
${indent}    <data android:scheme="content" />
${indent}    <data android:scheme="file" />
${indent}    <data android:host="*" />
${indent}    <data android:mimeType="*/*" />
${pathPatterns.map((p) => `${indent}    <data android:pathPattern="${p}" />`).join('\n')}
${indent}</intent-filter>
`;

let manifest = readFileSync(manifestPath, 'utf8');
if (manifest.includes(MARK)) {
  console.log('AndroidManifest.xml: 이미 적용됨');
} else {
  const at = manifest.indexOf('</activity>');
  if (at < 0) throw new Error('AndroidManifest.xml에서 </activity>를 찾지 못했습니다.');
  manifest = manifest.slice(0, at).trimEnd() + '\n' + filters + '\n        ' + manifest.slice(at);
  writeFileSync(manifestPath, manifest);
  console.log('AndroidManifest.xml: 인텐트 필터 추가');
}

// 버전
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const code = parseInt(process.env.VERSION_CODE || '1', 10);
const name = process.env.VERSION_NAME || pkg.version;
let gradle = readFileSync(gradlePath, 'utf8');
gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${code}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${name}"`);
writeFileSync(gradlePath, gradle);
console.log(`build.gradle: 버전 ${name} (${code})`);

// 서명: KEYSTORE_FILE이 주어지면 릴리스 빌드를 그 키로 서명한다(키와 비밀번호는 GitHub Secrets에서 온다).
if (process.env.KEYSTORE_FILE) {
  let g = readFileSync(gradlePath, 'utf8');
  if (!g.includes('signingConfigs')) {
    const signing = `    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_FILE"))
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias "hanreader"
            keyPassword System.getenv("KEYSTORE_PASSWORD")
            storeType "pkcs12"
        }
    }
`;
    const at = g.indexOf('    buildTypes {');
    if (at < 0) throw new Error('build.gradle에서 buildTypes를 찾지 못했습니다.');
    g = g.slice(0, at) + signing + g.slice(at);
    g = g.replace(/(buildTypes\s*\{\s*release\s*\{)/, '$1\n            signingConfig signingConfigs.release');
    writeFileSync(gradlePath, g);
  }
  console.log('build.gradle: 릴리스 서명 설정');
}
