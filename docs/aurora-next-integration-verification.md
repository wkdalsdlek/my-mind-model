# Phase 5-C-3B — 실제 Next.js 통합 검증

기준 브랜치 `feat/glass-nebula-aurora`, HEAD `297333184d1b72798cb7ba52b3cb37a03aef6b61`.
실제 사용자 데이터 대신 합성 답변을 사용한다. 유료 OpenAI 호출·커밋·푸시·배포는 하지 않는다.

## 파일 수와 보존 범위

시작 시 기존 5-C-3B 파일은 **16개**였다(기존 tracked 수정 6 + 신규 10).
코드·테스트 도구 13개에 아래 비코드 3개를 합하면 16개다. IDE 미리보기의 필터 자체는 조사할 수 없지만 실제 구현 파일의 누락은 없었다.

- `public/fonts/nanum-pen-script/NanumPenScript-Regular.ttf` — 3,201,664 bytes.
- `public/fonts/nanum-pen-script/OFL.txt`.
- `docs/aurora-universe-verification.md`.

이번 후속 작업은 검증 도구와 이 문서만 추가하고 기존 검증 문서에 후속 기록을 연결한다. 질문·Q10·API 구현·5-A·5-C-1·3D·셰이더·`/aurora-lab`의 제품 코드를 수정하지 않는다.

## 기존 서버의 응답 문제 진단

- 기존 PID 2528의 Next 16.1.6 서버가 3000 포트에서 계속 실행 중이었다. 종료하거나 재시작하지 않았다.
- 호스트 접근에서는 `/`가 HTTP 200(약 0.33초), 신규 API의 GET이 HTTP 405(콜드 컴파일 포함 약 6.57초)를 반환했다. POST 전용 API의 GET 405는 정상이다.
- 같은 127.0.0.1:3000 TCP 접속이 일반 도구 샌드박스에서는 `PermissionError`, errno 1로 거부되고 호스트 접근에서는 성공했다.
- 따라서 현재 재현된 접근 실패 원인은 **도구 네트워크 샌드박스의 로컬 소켓 접근 제한**이다. 이전 시점의 모든 타임아웃을 이 원인 하나로 소급 확정하지는 않는다. 현재 기존 서버가 멈췄다는 증거나 앱 컴파일 예외는 확인되지 않았다.
- 기존 로그에는 Ready와 초기 Compiling 기록이 있었으며, 개발 요청의 콜드 컴파일 시간도 따로 고려해야 한다.
- 최종 정리 시점에는 기존 PID 2528/2455가 보이지 않고 3000 포트가 `ConnectionRefusedError`, errno 111을 반환했다. 초기 정상 응답 이후 종료된 원인은 확인되지 않았다. 검증 도구나 수동 명령으로 이 기존 프로세스를 종료/재시작하지 않았다. 초기 소켓 권한 오류와 최종 프로세스 부재를 같은 원인으로 단정하지 않는다. 실제 통합 검증은 별도 3001 서버에서 완료했으며 그 검증 서버는 정리했다.

## 실제 Next 검증 구성

도구: `tests/helpers/verify-next-universe.mjs`.

1. `.next/aurora-next-integration/project`에 현재 app/components/lib/public 및 package.json/postcss 설정의 동일 복사본을 만든다. **81개 소스·자산 파일의 바이트 일치**를 확인했다. 기존 서버의 빌드·타입·환경 파일과 격리한다. `.env` 파일은 복사하지 않는다.
2. 별도 127.0.0.1:3001에서 실제 Next 개발 런타임·SSR·라우터·정적 자산을 실행한다. [Next 공식 custom server 방식](https://nextjs.org/docs/app/guides/custom-server)을 사용하며 제품 서버 설정을 바꾸지 않는다.
3. 브라우저는 HTML·JS·폰트·CSS 및 **모든 `/api/*` 요청을 실제 Next 서버로 전송**한다. 프런트 API를 fulfill하거나 서비스 함수를 직접 실행해서 응답을 대신하지 않는다.
4. 서버의 실제 OpenAI SDK가 호출하는 상위 모델 서버만 loopback HTTP stub으로 바꾼다. 설치된 SDK의 `OPENAI_BASE_URL` 지원을 확인했다. [OpenAI SDK 문서](https://developers.openai.com/api/reference/typescript)의 사용자 지정 전송 설정과 함께 검토했다.
5. 테스트 프로세스에만 비과금 자격 값과 로컬 목적지를 설정하고, 실제 OpenAI 주소로 나가는 fetch도 차단한다. 실키를 읽거나 출력하지 않는다. SDK의 요청 직렬화·응답 역직렬화와 실제 서버 파서·HTTP 오류 처리까지 실행한다.
6. mock은 실제 서버가 구성한 모델 입력/strict schema로 합성 출력을 만든다. GPT-6.1 Sol Medium·strict·store:false 및 모든 활성 리본 키를 확인한다. 사용량 숫자도 합성값이며 실제 과금 기록이 아니다.

검증용 Webpack 컴파일만 메모리/스레드 사용을 제한했다. 이 설정은 ignored 테스트 프로젝트 안에만 있으며 오로라 품질 프리셋을 변경하지 않는다. 디렉터리 심볼릭 링크만 사용한 초기 시도는 Next의 라우트 탐색에서 제외돼 동일 복사본 방식으로 바꿨다.

개발 API의 콜드 컴파일은 Q10 요청 제한 시간에 영향을 줄 수 있어, POST 실행 전에 GET 405로 세 API를 미리 컴파일한다. 한 실행에서 Q10 라우트 약 29.6초, 신규 해석 약 1.95초, 레거시 분석 약 1.57초가 관찰됐다. 이후 실제 POST는 수백 ms 안에 처리됐다(모델이 로컬 mock이므로 실제 AI 지연을 의미하지 않는다).

## 확인한 연결과 데이터

- 실제 질문 9개 선택 → 실제 `/api/closing-message` → 생성 문장 승인 → 실제 `/api/aurora-interpretation` → 결과 화면.
- 의도한 provider 503을 실제 API 502로 처리한 뒤 답변/승인 보존과 명시적 재시도.
- 로컬 재계산 context와 응답의 digest·facts·승인 문장·활성 ID를 공유 검증기로 비교.
- 카탈로그 인용·원문 출처·Q10 anchor·선정 이유·오로라 이름.
- 종합 해석 dialog 1개, Esc/포커스 복원, 이전 요약/심층 버튼 제거.
- 실제 리본별 ID와 psychological/philosophical/reflectionQuestion의 일치, 비콘→매크로→전체 복귀, 동일 Canvas 유지.
- 품질 전환 후 ID와 분석 유지, 탐색 중 브라우저 API 및 상위 모델 요청 증가 없음.
- `quoteId:none`이 서버의 HTTP 422/`QUOTE_CANDIDATES_INSUFFICIENT`로 이어지고, 화면은 승인 문장과 실제 오로라만 표시.
- 무쿠키 HTTP 호출, 잘못된 cross-site 요청, 서버 단일 재시도, 레거시 10 comments 계약.

## 인증과 배포 위험 — 이번에 인증 구현은 하지 않음

실제 기존 3000 서버에서 로그인 없이 받은 JavaScript 23개를 값 출력 없이 점검했고, **클라이언트 로그인 상수 포함 여부가 true**였다. 결과는 `client-auth-audit.json`에 불리언만 남겼다.

- 현재 로그인은 브라우저 state 비교다. 다운로드한 JavaScript의 값을 비밀로 취급할 수 없고, UI 진입 여부가 서버 인증 상태를 만들지 않는다.
- `/api/aurora-interpretation`은 입력/승인 일관성과 `sec-fetch-site: cross-site`만 검사한다. 사용자 신원이나 서버 세션을 검사하지 않는다.
- `/api/analyze`는 입력 구조를 검사하지만 사용자 인증·사용자별 호출 예산 검사가 없다.
- `/api/closing-message`의 출처 검사와 `closing-session` 쿠키는 인증이 아니다. 쿠키 없이 호출하면 새 ID가 생긴다. 프로세스 로컬 제한으로 배포 전체의 사용자별 과금 예산을 보장할 수 없다.
- 승인 fingerprint/digest는 입력 연결 검증이다. 서버 서명이나 사용자 신원 증명이 아니며 비인증 클라이언트도 유효한 입력을 구성할 수 있다.
- 원문 키를 서버 환경에서 참조하더라도 유료 API 자체가 인증 없이 실행되면 외부 호출로 비용이 발생할 수 있다. CORS/Origin/Fetch Metadata만으로 서버 간 호출을 막을 수 없다.
- Codespaces의 외부 포트 공개 범위나 배포 플랫폼의 별도 접근 제어는 미검증이다. 외부 게이트가 있다고 가정하지 않는다.

**공개 배포 전 서버 세션·API 인증/권한·사용자별 요청 예산과 동시 실행 제한이 필요하다.** 이번에는 위험을 기록하고 인증 시스템이나 API 접근 정책을 변경하지 않았다.

## 실행과 검증 자료

현재 설치된 Playwright/Chromium 및 임시 Linux 라이브러리 경로를 사용한 예:

```sh
env AURORA_NEXT_CASE=desktop LD_LIBRARY_PATH=/tmp/aurora-universe-libs/root/usr/lib/x86_64-linux-gnu FONTCONFIG_FILE=/tmp/aurora-universe-fonts/fonts.conf node tests/helpers/verify-next-universe.mjs
env AURORA_NEXT_CASE=mobile LD_LIBRARY_PATH=/tmp/aurora-universe-libs/root/usr/lib/x86_64-linux-gnu FONTCONFIG_FILE=/tmp/aurora-universe-fonts/fonts.conf node tests/helpers/verify-next-universe.mjs
```

`AURORA_PLAYWRIGHT_MODULE`로 Playwright 모듈 위치, `AURORA_NEXT_PORT`로 별도 포트를 지정한다. 기본 실행은 mobile이다. 실행 후 자신의 검증 서버·브라우저·모형 서버만 정리하며 기존 3000 서버는 유지한다.

브라우저를 실행하지 않고 실제 Next HTTP/API 경로만 확인하려면 `AURORA_NEXT_CASE=api`를 사용한다. 브라우저가 반복 종료된 환경에서 이 모드로 나머지 API 점검을 완료했다.

초기 단일 브라우저 실행에서 데스크톱/모든 리본/품질/자동 복귀를 확인한 뒤 모바일 크기로 바꾸어 촬영할 때 Chromium이 종료됐다. 당시 Next 프로세스는 살아 있었고 React 런타임 오류는 없었다. 원인을 앱 버그나 GPU 메모리 문제로 확정하지 않는다. `initial-desktop-and-browser-limit.json`에 남기고, 이후 데스크톱/모바일 브라우저 실행을 분리한다. 실제 GPU에서의 장시간 전환은 여전히 확인해야 한다.

산출물은 `.next/aurora-next-integration/`에 보관한다. 원문 JS 번들·환경 값은 공유 자료로 복사하지 않으며 `.next`를 강제 스테이징하지 않는다.

## 최종 결과

검증은 여러 실행에서 얻은 근거를 합쳐 기록한다. 모든 브라우저 스트레스 시나리오가 한 번에 통과했다고 표시하지 않는다.

| 범위 | 실제 결과와 근거 |
| --- | --- |
| Q1~Q9 → Q10 AI 생성/승인 → 해석 → 결과 진입 | 실제 Next HTTP로 통과. Q10 POST 200, 의도한 provider 실패의 해석 POST 502, 명시적 재시도 POST 200. `initial-desktop-and-browser-limit.json`, `initial-mobile-audit-fixture-error.json` |
| 데이터 검증 | 브라우저가 보낸 payload로 context를 재계산해 응답 전체 검증 통과. 카탈로그 문구·선정 이유의 Q10 anchor·이름·전체 해석 dialog 1개·리본별 텍스트 일치 확인 |
| 데스크톱 | 기본 활성 리본 5개 모두 선택/복귀, low/balanced/high에서 ID/해석 유지, 자동 공전 복귀, 에너지 시간 증가 확인. 첫 실행은 이후 모바일 크기 전환에서 종료 |
| 모바일 | 별도 390×844 브라우저에서 실제 입력/요청/결과/전체 읽기/비콘/매크로/리본 해석/440×844 리사이즈/복귀 확인 |
| 후보 부족 | 실제 Next API가 422와 명시적 코드를 반환. 인용 없이 승인 문장·실제 오로라 표시, 전체 읽기 비활성화 확인 |
| 탐색 비용 | 기본 결과 흐름의 레거시 API 호출 0. 리본/품질/카메라/해석 읽기에서 신규 API·모형 모델 요청 증가 없음 |
| 모바일 WebGL | `gl.getError()=0`, 셰이더 오류 0, 앱 런타임 오류 0, 자체 호스팅 필기체 실제 로드 확인 |
| 비인증 API | 세 API 모두 쿠키 없이 실제 HTTP 200. 레거시 응답은 comments 10개. `report-api.json` |
| 잘못된 출처·승인 | cross-site HTTP 403, 잘못된 승인 fingerprint HTTP 409, 상위 모델 추가 호출 0 |
| 제한 재시도 | 첫 잘못된 출력 → 모델 추가 1회 → HTTP 200. 두 번 모두 잘못된 출력 → 정확히 2회에서 종료하고 HTTP 502/명시적 검증 오류 |

API 전용 실행은 최종 `stage: complete`, exit 0이었다. 상위 로컬 모형은 해석 5회 + Q10 1회 + 레거시 1회 호출됐으며 **실제 OpenAI 호출은 0회**다. 정상 결과 생성의 브라우저 해석 POST는 1회다. 실패/명시적 재시도/후보 부족은 구분된 추가 테스트 요청이다.

모바일 UI 실행 뒤 레거시 audit fixture에 `questions`를 빠뜨려 HTTP 400을 받은 테스트 도구 오류를 수정했다. 제품 API를 바꾸지 않았으며, 올바른 계약의 실제 Next API 전용 실행으로 HTTP 200/10 comments를 확인했다. 원래 실패 기록도 보존한다.

데스크톱 재실행에서도 리본 탐색 중 `browser-page-crash`가 발생했다(`report-desktop.json`). 당시 Next 서버는 살아 있었고 JavaScript 예외/console 오류는 없었다. 더 이상의 데스크톱 반복은 중단했다. 앱/GPU/환경 중 어느 원인인지 확정하지 않았으며, 연속 탐색 안정성 최종 승인은 남아 있다.

직접 열어 배치를 확인한 실제 Next 화면 경로:

```text
.next/aurora-next-integration/desktop-universe.png
.next/aurora-next-integration/desktop-reading.png
.next/aurora-next-integration/desktop-macro.png
.next/aurora-next-integration/desktop-ribbon-analysis.png
.next/aurora-next-integration/mobile-universe.png
.next/aurora-next-integration/mobile-reading.png
.next/aurora-next-integration/mobile-macro.png
.next/aurora-next-integration/mobile-ribbon-analysis.png
.next/aurora-next-integration/mobile-quote-unavailable.png
```

전체 화면의 제목·인용·선정 이유와 비콘에 눈에 띄는 겹침은 없었다. 모바일 종합 읽기 패널은 중앙 오로라를 상당 부분 덮으며, Next 개발 배지가 하단 목록 일부와 겹친다. 이 시각 제약은 기록하고 제품 디자인을 추가 수정하지 않았다.

추가 기록: `client-auth-audit.json`(상수 노출 불리언), `source-audit.json`(81개 파일 일치), `report-api.json`(완료), `initial-desktop-and-browser-limit.json`, `initial-mobile-audit-fixture-error.json`, `report-desktop.json`. 초기 실패를 없던 일로 처리하거나 모바일/데스크톱 전체 자동 통과로 집계하지 않는다.

## 자동 검사와 한계

- `npx tsc --noEmit --incremental false`: 통과.
- `npm run lint`: 통과. 최종 TypeScript/ESLint 및 검증 도구의 개별 ESLint 재검사도 통과했다.
- 전체 자동 테스트: **438/438 통과**, 삭제/축소 없음. 추가 통합 도구의 assertion은 이 개수와 별도로 기록한다.
- `git diff --check`: 통과.
- 실제 모델 접근 권한·생성 품질·지연·출력 토큰·과금은 검증하지 않았다. 모델 응답은 전부 합성이다.
- Chromium은 ANGLE SwiftShader다. 실제 하드웨어 GPU FPS·발열·장기 메모리·실제 터치 기기는 미검증이다.
- 폰트 렌더링은 임시 Noto Sans KR가 설치된 이 Linux 환경과 자체 호스팅 Nanum Pen Script에서 확인한다. 다른 OS의 fallback을 모두 확인한 것은 아니다.
- 기존 상단 시점의 자기 교차와 곡면, 초근접 미스트 특성은 재설계하지 않았다.
- Next 개발 배지가 하단 컨트롤 일부와 겹칠 수 있다. 제품 디자인을 변경하거나 배포 화면 검증으로 오해하지 않는다.

## 변경 파일

기존 16개는 `aurora-universe-verification.md`의 전체 목록을 유지한다. 이번 신규 파일은 다음 2개이므로 최종 작업 범위는 **18개**다.

- `tests/helpers/verify-next-universe.mjs`
- `docs/aurora-next-integration-verification.md`

기존 검증 문서에는 이 후속 확인을 연결한다. Git index는 비워 두며 ZIP·환경 파일·master·백업 브랜치를 변경하지 않는다.

```text
app/page.tsx
app/page.module.css
app/api/aurora-interpretation/route.ts
components/result/AuroraResultScreen.tsx
components/result/AuroraResultScreen.module.css
lib/aurora-universe.ts
lib/aurora-interpretation-validation.ts
lib/server/aurora-interpretation-service.ts
tests/aurora-result.test.mjs
tests/aurora-universe.test.mjs
tests/aurora-universe-ui.test.mjs
tests/helpers/aurora-universe-fixture.mjs
tests/helpers/verify-universe-ui.mjs
tests/helpers/verify-next-universe.mjs
public/fonts/nanum-pen-script/NanumPenScript-Regular.ttf
public/fonts/nanum-pen-script/OFL.txt
docs/aurora-universe-verification.md
docs/aurora-next-integration-verification.md
```

확인 범위와 미해결 사항을 포함한 통합 체크포인트로 저장할 자료는 준비됐다. 공개 배포 전 서버 인증과 브라우저 연속 동작 안정성 검증이 남아 있다. 이번에는 Git 저장 작업을 하지 않는다.
