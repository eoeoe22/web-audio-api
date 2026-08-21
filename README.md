# Web Audio API 기능 — audio.vialinks.xyz

브라우저에서 소리를 만들고, 공간에 배치하고, 되받아 측정하는 세 가지 Web Audio API 실험을
하나의 사이트로 합친 것. 랜딩 페이지 + 3개의 하위 페이지 구조이며, 전부 클라이언트에서만 동작한다.

| 경로 | 페이지 | 내용 |
| --- | --- | --- |
| `/` | Web Audio API 기능 | 랜딩 — 카드로 구성된 하위 페이지 링크 |
| `/spatial/` | 공간 음향 실험실 | `PannerNode`(HRTF) + three.js 3D 씬, 음원·청취자 드래그 |
| `/response/` | 주파수 응답 측정 | 톤 제너레이터, 마이크 RTA, 사인 스윕 측정 (구 `rew.html`) |
| `/r2r/` | R2R 래더 DAC | 4·8·16비트 저항 사다리 + 오실로스코프 (구 `r2r.html`) |

## 스택

- **Astro 5** (정적 빌드, `output: 'static'`) + **TypeScript** (strict)
- **Bootstrap 5** CSS + **Bootstrap Icons** (npm 번들, CDN 미사용)
- **three.js** (공간 음향 페이지 전용 청크)
- **Cloudflare Workers** 순수 정적 Assets 바인딩 (`wrangler.jsonc`)

원본 페이지가 쓰던 Tailwind CDN · SweetAlert2 · three.js CDN 은 모두 제거하고,
아래 디자인 시스템과 자체 토스트/다이얼로그로 대체했다.

## 디자인 — VIA 뉴모피즘 스킨

`src/styles/via.css` 한 곳에 디자인 토큰과 Bootstrap 컴포넌트 스킨이 모여 있다.

- 페이지와 표면이 **같은 회청색(`#ecf0f3`)**, 이중 그림자(밝은 하이라이트 + 어두운 그림자)로 돌출 표현
- 눌린 상태·입력 필드·슬라이더 트랙·캔버스 영역은 반대로 `inset`(오목)
- 팔레트: primary `#3457cf`(청취자·신호), warm `#d1541c`(음원·측정 결과), 나머지는 모노크롬
- 서체: Montserrat + Noto Sans KR(본문), IBM Plex Mono(계측 수치·라벨)
- **다크 모드는 제공하지 않는다** (라이트 전용 양식)

새 UI 를 붙일 때는 색·그림자·라운드를 직접 쓰지 말고 `--via-*` 토큰을 사용한다.

## 개발

```bash
npm install
npm run dev      # http://localhost:4321
npm run check    # astro check (타입 검사)
npm run build    # dist/ 정적 산출물
npm run preview  # wrangler dev 로 dist/ 서빙
```

## 배포

```bash
npm run deploy   # astro build && wrangler deploy
```

Worker 이름은 `web-audio-api`, 커스텀 도메인은 `audio.vialinks.xyz`.
`wrangler.jsonc` 는 Worker 스크립트 없이 `dist/` 를 정적 Assets 로만 서빙한다
(`html_handling: auto-trailing-slash`, `not_found_handling: 404-page`).

### Workers Builds(Git 연동)

- `.node-version` 으로 Node 22.23.2 고정 (빌드 이미지에 미리 설치되어 있는 버전).
- Workers Builds 는 wrangler 설정의 `[build]` 커스텀 빌드를 **무시**하므로, 대시보드의
  빌드 명령이 비어 있으면 `dist/` 없이 배포가 실행되어 실패한다. 이를 막기 위해
  `postinstall` 에서 `astro build` 를 돌려 의존성 설치만으로도 `dist/` 가 만들어지게 했다.
- 대시보드 권장 설정 — **Build command** `npm run build`, **Deploy command** `npx wrangler deploy`.
  (빌드 명령이 확실히 설정되어 있다면 `postinstall` 은 빼도 된다.)

## 구조

```
src/
├─ layouts/Base.astro      셸(네비·푸터·토스트 호스트), fullscreen 변형
├─ components/Nav.astro    상단 네비게이션
├─ pages/                  index · spatial · response · r2r · 404
├─ scripts/                페이지별 TypeScript (ui.ts 는 공용 토스트/DOM 헬퍼)
└─ styles/via.css          VIA 뉴모피즘 디자인 시스템
```
