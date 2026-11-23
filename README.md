# 한리더 (HanReader)

안드로이드 휴대폰에서 **TXT · PDF · HWPX · HWP** 문서를 여는 가벼운 무료 뷰어입니다.

- **문서는 기기 밖으로 나가지 않습니다.** 모든 처리는 휴대폰 안에서 이루어지고, 인터넷이 없어도 동작합니다.
- 카카오톡·내 파일·메일에서 문서를 누르면 **연결 프로그램** 목록에 나타납니다.
- 확장자가 없는 파일도 파일 앞부분(매직 넘버)을 보고 형식을 알아냅니다.
- 코드는 누구나 보고, 고치고, 다시 배포할 수 있습니다(MIT 라이선스).

## 설치

[Releases](https://github.com/domagim-ai/hanreader/releases/latest)에서 `.apk` 파일을 내려받아 설치합니다. GitHub 로그인은 필요 없습니다.

> 지금은 시험판(디버그 서명)입니다. 새 판을 설치할 때 "앱이 설치되지 않았습니다"가 나오면 이전 판을 지우고 다시 설치해 주세요.

## 지원 형식

| 형식 | 방식 | 상태 |
| --- | --- | --- |
| TXT | UTF-8로 읽고, 실패하면 EUC-KR(CP949)로 다시 읽음 | 지원 |
| PDF | PDF.js로 쪽마다 그림. 화면 가까이 온 쪽만 그려 메모리를 아낌 | 지원 (암호 걸린 PDF 제외) |
| HWPX | 압축을 풀어 `Contents/section*.xml`을 읽고, 화면 폭에 맞게 문단·표·그림을 다시 배치 | 지원 (원본 쪽 모양 그대로는 아님) |
| HWP | hwp.js로 쪽 모양대로 그리고 화면 폭에 맞춰 축소. 그릴 수 없으면 글자만 표시 | 기본 지원 (복잡한 표·서식은 깨질 수 있음) |

## 화면

- `파일 열기` — 기기에서 문서를 고릅니다.
- `A-` / `A+` — 글 문서(TXT·HWPX)는 글자 크기, 쪽 문서(PDF·HWP)는 배율을 바꿉니다.
- `◐` — 다크 모드.
- 두 손가락으로 확대·축소할 수 있습니다.

## 직접 빌드하기

Node.js 22 이상이 필요합니다. APK까지 만들려면 JDK 21과 Android SDK도 필요합니다.

```sh
npm ci
npm run libs          # 외부 라이브러리를 www/libs로 묶음
npm run serve         # http://localhost:5173 에서 브라우저로 확인

npx cap add android
npm run android:patch # 인텐트 필터·버전 적용
npx cap sync android
cd android && ./gradlew assembleDebug
```

저장소에 코드를 올리면 GitHub Actions가 같은 순서로 APK를 만들어 Releases에 올립니다(`.github/workflows/build.yml`).

## 구조

```
www/
  index.html, style.css
  app.js          앱 본체 (파일 받기, 외부 앱에서 열기, 글자 크기·다크 모드)
  detect.js       매직 넘버로 형식 판별
  render-txt.js   TXT
  render-pdf.js   PDF
  render-hwpx.js  HWPX
  render-hwp.js   HWP
scripts/
  copy-libs.mjs       라이브러리를 www/libs로 복사·묶음
  patch-manifest.mjs  AndroidManifest.xml 인텐트 필터, 버전
  serve.mjs           개발용 서버
```

## 고지

본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

사용한 오픈소스: [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0), [hwp.js](https://github.com/hahnlee/hwp.js) (Apache-2.0), [JSZip](https://github.com/Stuk/jszip) (MIT), [Capacitor](https://github.com/ionic-team/capacitor) (MIT).

## 라이선스

[MIT](LICENSE)
