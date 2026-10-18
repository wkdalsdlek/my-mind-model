# 상황 기반 성찰·결과 화면·인트로 검증

기준: `feat/glass-nebula-aurora`, HEAD `208020247e0893f3d68c0f674ad1a0caeabc539e`.
이 문서는 로컬 구현과 검증 기록이다. 초기 검증은 미커밋 상태에서 수행했고 커밋·푸시·배포·환경 변수 변경·운영 DB 조회/쓰기·실제 OpenAI 호출을 하지 않았다. 이후 승인된 Beta Preview 체크포인트 준비 검사는 마지막 절에 구분한다.

## 화면과 입력 흐름

- 서버 로그인 경계 아래, 질문 step과 독립된 intro/entering/questions 단계를 둔다. 사전 상황이 유효해야 명시적 시작 버튼으로 진입한다. 입력란/배경 클릭은 진행시키지 않는다.
- 사전 상황은 원문 그대로 보존한다. 공백만 있는 문자열, 200 Unicode 코드포인트 초과, 잘못된 surrogate·제어 문자·숨겨진 방향 제어 문자를 거부한다. UTF-8 최대 800바이트도 검사한다. 예시 선택 후 수정, 한국어 IME, 줄바꿈을 지원한다.
- 한 문장 3초 fade-in, 질문으로 1.5초 전환. OS Reduced Motion에서는 약 100ms 전환 및 정적 인트로를 사용한다. 전환 중 Q1은 inert이며 시작 잠금으로 중복 진행을 막는다.
- 질문·실패·재시도·결과에서 상황을 유지한다. “지금의 이야기 수정”을 저장하면 진행 중 해석을 취소하고 완성된 해석만 무효화한다. 실제 질문 선택과 Q10 승인·fingerprint는 보존한다. 상황 편집으로 Q10 요청을 재생성하지 않는다.
- 상단에는 정확한 Q10 승인 원문만 손글씨로 표시한다. `auroraName`은 호환용 데이터로 유지하되 표시하지 않는다.
- 왼쪽 위 접이식 감상 설정, 왼쪽 아래 다시 성찰하기, 가운데 아래 나의 오로라 읽기. 상시 리본 행 대신 “리본 탐색” disclosure를 제공한다. 목록의 키보드 방향키/Enter, 실제 ID·이름·색, WebGL 미지원 시 텍스트 해석 경로를 유지한다. 선택하면 목록을 접어 매크로를 가리지 않고, 복귀 시 실제 선택 경로로 포커스를 되돌린다. 비콘으로 선택했다면 목록을 강제로 펼치지 않는다.
- 사용자 움직임 감소 체크박스는 제거하고 OS 설정과 renderer 연결은 유지한다. 기존 하나의 Canvas, GPU picking·비콘·카메라·품질 프리셋·셰이더·개인화 계산은 변경하지 않는다.

## 엄격한 해석 v2

기존 v1 API 계약도 검증을 유지한다. 새 UI는 상황이 필수인 `aurora-interpretation-request-v2`만 보낸다. v2 응답은 `aurora-interpretation-v2`여야 한다. v1으로 조용히 축소하거나 누락된 분석을 서버가 만들어 채우지 않는다.

상황 원문을 실제 Q1~Q10·승인 문장·품질·flowMode·카탈로그와 함께 SHA-256 연결값에 포함한다. 서버는 기존 엔진으로 모든 사실을 재계산한다. 브라우저는 연결값·원문·모든 사실·생성 필드를 다시 검사한다. 다른 상황/답변/리본의 응답이나 늦은 취소 응답을 결과로 게시하지 않는다. digest는 인증 서명이 아니며 기존 서버 세션과 접근 검사를 대체하지 않는다.

- 전체 `overall`: 최대 3,200자. 모든 답변 있는 문항과 `approved:q10`의 실제 근거를 참조한다.
- 각 활성 리본: `psychological`(선택·반복·가치), `currentMind`(현재/바람 구분), `philosophical`(잠정적 인물 묘사와 성찰), `reportSummary`(전체 글용 별도 연결 문단), `reflectionQuestion`.
- 세 심층 문단은 각 최대 1,400자, reportSummary 1,200자, 열린 질문 180자. 근거 없는 리본의 핵심 해석/요약은 기존 중립 fallback을 결정적으로 적용한다. 감정 맥락도 없으면 현재 마음을 추정하지 않는다.
- 전체 읽기는 8부분이다. ① overall ② 모든 실제 활성 리본 ③ interplay ④ present ⑤ direction ⑥ relationships ⑦ selfCare ⑧ letter. 추가 6개 섹션은 모두 필수이며 일반 섹션 최대 1,800자, 편지는 2,400자다. 권장 생성 분량은 이 상한보다 짧게 설정했다.
- v2 문단은 실제 선택 `evidenceRefs`와 상황 `contextRefs=["situation:intro"]`를 분리한다. 핵심 리본 문단은 해당 색상 쌍에 기여한 핵심 선택만 인용할 수 있다. currentMind만 그 근거와 Q3·Q7·Q8·Q9의 실제 맥락을 참조할 수 있다. present는 제공된 각 맥락 문항, 편지는 Q10을 참조해야 한다.
- 전체 마지막에만 기존 검증 카탈로그의 철학 문장·철학자·출처/번역·실제 Q10 연속 부분 문자열을 포함한 선정 이유를 표시한다. 후보 부족의 기존 422/fallback·수동 재시도 경로도 유지한다.
- 상황은 비신뢰 사용자 데이터다. 명령으로 실행하거나 렌더링/성격/감정 원인으로 사용하지 않는다. 직업·관계만으로 심리 상태를 단정하지 않도록 지시한다. 출처 없는 관계·주변 반응·진단·미래 성공 단정을 금한다. 인용한 키워드는 실제 선택 또는 실제 상황 원문의 일부인지 검사한다.
- 모든 object에 additionalProperties=false/required, 실제 ribbonId 고정 키, refs enum을 사용한다. `$defs/$ref`로 반복 schema를 줄였다. 공유 ID enum으로 최대 선택 300개에서도 provider의 enum 1,000개 제한을 지키고, 문단별 더 좁은 허용 범위는 서버가 그대로 강제한다. 런타임에서 길이·중복·누락·기준·출처를 별도로 검증한다. [공식 Structured Outputs 문서](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)를 확인했다.

문장에 유효한 근거 참조가 있다고 해서 자연어의 모든 주장을 기계적으로 입증한 것은 아니다. 실제 모델의 문체·개인화 깊이·환각 억제 효과는 이번 모의 테스트로 입증하지 않았다.

## 실제 시각 근거

`aurora-visual-reading.ts`는 실제 renderer endpoint RGB에서 HSL 계열 이름을 결정한다. 같은 endpoint를 swatch에 사용하며 사용자에게 hex를 표시하지 않는다. paletteOrigins의 answer/neutral-visual/unknown과 실제 composition을 구분한다.

공통 움직임 speed/amplitude는 기존 전체 coreShares 혼합 결과다. 개별 width/height/curve/depth, 꼬임, energy seed/세 채널, 안개층과 alpha는 기존 조형 설정이다. 기준 상태 대비 선택별 변화량이 없으므로 특정 선택이 더 꼬이게 했다는 인과를 생성하지 않는다. 의미 비중은 픽셀 면적이 아니고 사전 상황은 색·움직임에 영향을 주지 않는다. Q3·Q7·Q8·Q9 별도 효과의 기존 미적용 한계도 알린다. 품질 변경 시 실제 현행 layer 데이터를 ID로 대조해 안개층 수를 설명하며, 원래 해석·binding을 변조하거나 AI를 재호출하지 않는다.

## 오디오

최종 재검증 시 `public/audio/intro-bgm.mp3`가 제공되어 있었다. 원본은 변경하지 않았다. 2,377,394바이트, ID3v2.4 / MPEG-1 Layer III / 192kbps / 44.1kHz / stereo다. 3,792개 프레임이 파일 끝까지 파싱되며 인코딩 분량은 약 99.06초, Chromium의 실제 재생 duration은 99초다.

JourneySound의 단일 audio element가 질문·대기·결과 전환 내내 같은 위치에 유지된다. preload=none이며 초기 src/autoplay가 없다. 명시적 사용자 제스처에서만 재생을 시도한다. 2초간 .005→.12 음량 fade, pause/resume·재생 실패 안내·unmount 정리·늦은 play promise 무효화를 지원한다. 오디오는 WebGL 프레임과 독립적이다. 기존 로그아웃 버튼과 겹치지 않도록 배치했다.

최종 Chromium 검사에서는 HTML media API를 모킹하지 않았다. 아래 최종 재검증 절의 시작·fade·연속 재생·터치 pause/resume·loop 검사를 통과했다. Headless 환경이므로 스피커로 들은 음악 품질, 청각적으로 끊김 없는 루프 접합, iOS/Safari 실기기의 음량 제어·자동재생 정책은 미검증이다. 음원 편집은 하지 않았다.

## 비용과 시간

- Q10 GPT-4o mini/180 output/1회/기존 입력 120,000바이트를 그대로 유지한다. 상황을 Q10 input에 전달하지 않는다.
- 해석 GPT-6.1 Sol Medium/25,000 output/최대 2회, 70초 1회·진입부터 85초 모델 작업·95초 응답 목표·100초 Function·105초 브라우저를 유지한다.
- 가격표·예산·사용량 예약·정산·취소 정책과 서버 인증 코드를 이번 작업에서 수정하지 않았다. 입력은 기존 `Buffer.byteLength(JSON.stringify(params), "utf8") + 4096` 검사 및 동일 유효 상한/예약/실제 토큰 검증을 그대로 통과해야 한다.
- 대표적인 10문항/활성 리본 5개/상황 200자 fixture의 모델 요청은 overhead 포함 **42,161바이트**, 모의 응답은 **8,476자**였다. 모든 가능한 긴 답변이 120,000바이트 안에 든다는 보장은 아니다. 초과 시 기존 정책대로 모델 호출 전에 거부한다.
- 참고 단가(input $2, output $10/1M)에서 해석 최악 예약은 1회 $0.49, 2회 $0.98, Q10까지 $0.998108다. 실제 Secret 단가·실제 청구액을 조회하거나 변경하지 않았다. 이번 출력 목표 확대로 평균 출력/지연은 늘 수 있으나 상한과 최대 예약은 동일하다.
- 모의 SDK·기존 지연/취소 회귀는 검사한다. 더 깊어진 실제 응답이 reasoning을 포함한 25,000토큰 또는 70/85초 내 완료될지는 미검증이다. 제한 초과 시 새 요청을 무제한 추가하지 않고 답변·상황·승인을 보존한다.

## 자동 검사와 통합 검증

- TypeScript와 ESLint 통과. 최종 ESLint는 오류 0개, JourneySound의 effect cleanup에서 revision ref를 읽는 exhaustive-deps 경고 1개다. 정리 함수의 현재 revision 증가를 의도적으로 유지했으며 제품 소스를 경고 억제 목적으로 변경하지 않았다.
- 비DB 671/671 + 독립 임시 PostgreSQL 55/55 = **726/726**, 실패·skip 0. 기존 미커밋 인증 진단 테스트 16개도 포함했다.
- 신규 22개: 입력/Unicode/원문·상황별 binding·Q10/5-A 불변·v2 누락/변조·근거 범위·중립 fallback·실제 색상·품질 변경 시 실제 안개층 설명·301개 근거에서도 provider enum 한도 준수·strict schema/크기/시간·단일 제한 재시도·취소 이후 응답·상황 인용·모의 상황별 강조·인트로/편집기/음악 제스처와 실패/fade/cleanup/리포트 배치.
- 이전 기본 `npm run build`(Turbopack)는 compile 단계 360초 후 종료했다. 당시 별도 `/tmp` 복사본의 Webpack 프로덕션 빌드는 통과했다. 이번 최종 재검증에서는 원래 next.config.ts와 기본 Turbopack 빌드도 **38.11초에 성공**했다. 과거 정체는 재현되지 않았으며 당시 리소스 부족 또는 캐시/환경 문제 중 무엇이 원인이었는지 확정하지 못했다. 자세한 격리 조건과 관측은 아래에 기록한다.
- 첫 브라우저 시도는 root build가 `.next` 아래 테스트 소스를 정리한 검증 도구 충돌로 실패했다. 테스트 소스는 독립 `/tmp`로, 결과는 ignored 캐시로 이동했다. node_modules 아래 소스는 SWC TypeScript 변환 제외 문제도 있어 사용하지 않는다. 이 두 환경 문제를 앱의 사용자 흐름 성공으로 보고하지 않는다.
- 1차 실제 Next.js + 독립 PostgreSQL + Chromium 검증은 OpenAI upstream과 브라우저 audio API를 모의했다. 최종 재검증은 실제 MP3/media 재생을 사용하며 OpenAI upstream만 모의한다. 실제 음악 청취 품질/실제 AI 글의 품질/하드웨어 GPU 성능과 구분한다.

### 재현과 산출물

비DB: 각 `tests/*.test.mjs`를 `node --test-reporter=tap <file>`로 실행한다. DB 보안: 외부 서비스와 분리된 폐기 가능한 PostgreSQL에서 `tests/private-beta.test.mts`를 실행한다.

신규 실제 Next 검증 도구: `tests/helpers/verify-journey-reading.mts`. 기존 `verify-private-beta.mts`도 새 인트로와 v2 mock에 맞췄다. 도구는 `/mmm_security_test`인 loopback 테스트 DB만 허용하며 DATABASE_URL과 PRIVATE_BETA_TEST_DATABASE_URL이 일치해야 한다. production 환경에서는 실행할 수 없다. 실제 DB URL이나 계정 비밀번호를 명령·문서·로그에 출력하지 않는다.

실행에 필요한 값은 임시 DB wrapper에서 메모리로 생성한다. `node --import tsx tests/helpers/verify-journey-reading.mts`를 사용한다. 로컬 OpenAI HTTP stub + 별도 Next 서버 + 소프트웨어 WebGL Chromium으로 테스트하고 외부 provider 접근은 차단한다. `.env.local`을 테스트 소스에 복사하지 않는다.

검사 로그: `node_modules/.cache/universe-reading/` (ignored). 화면/보고서: `node_modules/.cache/journey-reading-verification/` (ignored). Git에 산출물을 강제로 추가하지 않는다.

## 보존 및 변경 범위

기존 미커밋 auth.ts/database.ts/page-access.ts, .vercelignore, 인증 진단 소스·테스트·문서, ZIP의 시작 시점 SHA-256을 기록했고 그대로 보존했다. 환경 파일·마스터·백업 브랜치·원격·클라우드·운영 DB를 변경하지 않았다.

아래는 기존 구현 24개 파일이며 기존 미커밋 인증 변경은 포함하지 않는다. 최종 검증 시 제공된 `public/audio/intro-bgm.mp3`를 더하면 관련 소스·문서·자산은 25개다. 이번 재검증에서 편집한 것은 이 문서와 `tests/helpers/verify-journey-reading.mts`뿐이며, 음원과 제품 소스는 변경하지 않았다.

```text
app/api/aurora-interpretation/route.ts
components/MindJourney.tsx
components/journey/JourneyIntro.module.css
components/journey/JourneyIntro.tsx
components/journey/JourneySound.tsx
components/result/AuroraReading.tsx
components/result/AuroraResultScreen.module.css
components/result/AuroraResultScreen.tsx
docs/immersive-reflection-verification.md
lib/aurora-interpretation-types.ts
lib/aurora-interpretation-validation.ts
lib/aurora-interpretation.ts
lib/aurora-universe.ts
lib/aurora-visual-reading.ts
lib/journey-context.ts
lib/server/aurora-interpretation-service.ts
tests/aurora-deep-reading.test.mjs
tests/aurora-result.test.mjs
tests/aurora-universe-ui.test.mjs
tests/helpers/aurora-universe-fixture.mjs
tests/helpers/load-reading-ui.mjs
tests/helpers/verify-journey-reading.mts
tests/helpers/verify-private-beta.mts
tests/journey-ui.test.mjs
```

## 1차 실제 Next.js / Chromium 결과 (오디오 모의)

`node_modules/.cache/journey-reading-verification/report.json`의 최종 stage는 `complete`, 실제 OpenAI 호출은 0, runtimeErrors는 빈 배열이다.

실제 프런트엔드·Next.js 라우트·Better Auth·독립 PostgreSQL을 사용했다. **외부 OpenAI 응답과 HTML media 재생 API는 모의**했다. upstream 모의 호출은 closing 1회/interpretation 1회, 별도 Owner 레거시 계약 검사 1회다. 사용자 탐색으로 새 AI 요청은 발생하지 않았다.

확인한 흐름:

- 로그인 → 인트로에서 공백 차단·입력란 클릭 시 미진행·IME composition 중 제출 방어 → 명시적 시작 → Q1~Q9 실제 키보드 캡슐 선택 → Q10 모델 요청·승인 → 실제 해석 API 200/v2 → 정확한 승인 원문 결과 진입.
- 활성 비콘 수와 실제 ID 수 일치, 비콘으로 해당 이름의 리본 선택, 전체 복귀 후 불필요한 목록 미노출.
- OS 움직임 감소 해제 후 자동 공전 → 비콘 포커스 → 전체 복귀 시 auto 복원. 자유 회전 드래그가 리본 선택으로 오인되지 않음. 정면 및 OS Reduced Motion 복원.
- 접이식 목록의 키보드 선택, 선택 시 목록 접힘, 확대와 복귀. viewport 변경 후에도 선택 유지.
- 390×844에서 실제 브라우저 Touch API로 보조 루프 비콘을 선택하고 이름/매크로/전체 복귀 확인. 모바일 전체 화면 및 읽기 패널 확인.
- 읽기 8부분의 필수 구조·검증된 인용문 한 개·실제 상황 원문 연결, 읽기 화면에서 이야기 수정 버튼이 닫기 버튼을 가리지 않음.
- 상황 수정 후 해석만 무효화, Q10 승인 및 생성 버튼 유지, 인트로 재노출 없음, 추가 모델 호출 없음.
- audio element 1개 유지 및 재생 시도 1회, 실패한 play promise에도 Q1 진입, 로그아웃 후 보호된 화면/API 차단.
- 직접 이미지 열기로 한글 본문·손글씨·접힌 목록·중앙 작품·리본 줄기 확대·모바일 읽기/개별 해석을 확인했다.

브라우저는 **SwiftShader 소프트웨어 WebGL2**이며, 하드웨어 GPU FPS·발열·장시간 메모리·휴대폰 실기기 키보드/오디오 검증을 뜻하지 않는다. 기기별 품질 강등은 추가하지 않았고, 자동 검증은 사용자가 선택하는 low로 소프트웨어 렌더링 비용을 줄여 수행했다. 실제 high 품질의 새 화면·장시간 자원 변화는 미검증이다. 캡처의 좌하단 N 아이콘은 Next 개발 서버 배지이며 앱/운영 결과 UI가 아니다.

초기 브라우저 오류는 누락된 공유 라이브러리/한글 글꼴과 테스트 캐시 경로 문제로 구분했다. 공개 Ubuntu 라이브러리/글꼴을 ignored 캐시에만 추출하고 테스트 프로세스에만 LD_LIBRARY_PATH/FONTCONFIG_FILE 등을 지정했다. OS 설치·프로젝트 환경 파일·클라우드 환경 변수는 변경하지 않았다. 인트로의 inert 전환 완료를 기다리지 않는 강제 클릭 및 열린 메뉴 뒤를 누르는 강제 탭도 테스트 도구에서 수정했다. 실제 화면에서 발견된 목록의 매크로 가림·복귀 시 불필요한 펼침·모바일 닫기 버튼 겹침은 제품 UI에서 최소 수정 후 검증했다.

### 확인한 이미지 (모두 존재, ignored)

기준 디렉터리: `/workspaces/my-mind-model/node_modules/.cache/journey-reading-verification/`

| 파일 | 내용 |
|---|---|
| desktop-intro.png | 입력을 채운 데스크톱 인트로 |
| authenticated-universe.png | 승인 문장 중심 전체 화면, 접힌 리본 목록 |
| desktop-reading.png | 상황 기반 전체 읽기 패널 |
| authenticated-macro.png | 데스크톱 리본 줄기 확대 + 개별 해석 |
| mobile-intro.png | 일반 모션 설정의 모바일 인트로 |
| mobile-universe.png | 모바일 전체 구도 |
| mobile-macro.png | 화면 크기 변경 후 매크로 |
| mobile-touch-macro.png | 보조 루프 비콘을 실제 터치 이벤트로 선택한 매크로 |
| mobile-reading.png | 모바일 전체 읽기 |

이후 실제 음원 검증은 아래에 추가했다. 실제 모델 품질·완료 시간·실제 GPU 검토는 여전히 남아 있다. 커밋·푸시·Preview 배포는 수행하지 않았다.

## 최종 재검증 — 실제 MP3와 전체 흐름

`PRIVATE_BETA_REAL_AUDIO=1 node --import tsx tests/helpers/verify-journey-reading.mts`를 앞서 설명한 독립 임시 PostgreSQL 설정으로 실행한다. 정상/오류 경로 모두 실제 Next.js와 서버 세션을 사용하고, OpenAI HTTP 응답만 로컬 합성 응답으로 대체한다. 음원 재생은 원래 play/pause에 카운터만 감싼다. 재생 실패 안내 경로만 마지막에 의도적으로 play 거절을 주입한다.

- `node_modules/.cache/journey-real-audio-verification/report.json`: stage `complete`, 실제 OpenAI 0회, runtimeErrors 빈 배열. 모의 closing/interpretation/별도 Owner legacy 각각 1회다.
- 자동재생 부정 검사는 로그인 전 CDP `Runtime.evaluate(userGesture:false)`로 수행해 실제 `NotAllowedError`를 확인했다. Playwright 일반 evaluate는 자체적으로 userGesture=true를 전달하므로 초기 두 부정 검사에서는 부적절하게 ALLOWED가 나왔다. 이를 앱 실패로 취급하지 않고 CDP로 수정했다. 사용자 동작 이전 JourneySound의 play 호출은 0회다.
- 실제 시작 버튼으로 재생: 시작 약 0.30초에서 volume 0.02664, 약 2.63초에서 0.12. 소스의 2초 .005→.12 fade와 일치한다. readyState=4, media error=null이다.
- Q1~Q9, Q10 생성·승인, 실제 해석 대기, 결과 진입에서 DOM 표식으로 같은 audio element 1개와 play 호출 1회를 확인했다. 재생 시간은 약 2.72초→31.44초→대기 37.49초→결과 39.49초로 이어졌다. 탐색 중에도 재생됐고 이후 자연 루프가 발생했다.
- 모바일 크기에서 실제 touch로 음악 끄기: 500ms 동안 일시정지 시간을 유지한다. 음악 재생: 기존 재생 위치에서 재개하고 다시 0.12까지 fade한다. 별도 audio/중복 재생을 만들지 않는다. 끄기는 muted 속성 변경이 아닌 pause다.
- 원본 끝 0.35초 전으로 이동한 뒤 추가 play 호출 없이 currentTime 약 0.023초로 순환하고 재생을 유지했다. 반복 동작을 확인했지만 청취상 무음 구간·클릭음 유무까지 입증한 것은 아니다.
- 사전 질문→Q1~Q10→문장 승인→해석 API 200/v2→전체 우주→비콘→리본별 해석/매크로→전체 복귀→전체 읽기를 재확인했다. 자동 공전 복원·자유 회전 드래그·키보드 목록·모바일 보조 루프 터치·화면 크기 변경·상황 수정 시 승인 보존·로그아웃 후 접근 거부도 통과했다. 탐색으로 AI를 재호출하지 않았다.
- 같은 디렉터리에 기존 표와 같은 이름의 새 스크린샷 9개가 존재한다. 새 데스크톱 전체 우주, 모바일 전체 읽기, 모바일 터치 매크로 이미지를 직접 열어 확인했다. SwiftShader 소프트웨어 WebGL2이며 실제 GPU·휴대폰 실기기 검증은 아니다.

검사 로그와 음원 메타데이터는 `node_modules/.cache/final-audio-verification/`에 보존한다. 기존 검증 자료를 지우거나 강제 스테이징하지 않았다. 기존 미커밋 인증 작업 8개 항목과 ZIP은 이전 SHA-256과 대조해 별도로 보존한다.

### 최종 빌드와 배포 준비 상태

- TypeScript 재실행 통과, ESLint 오류 0/기존 ref cleanup 경고 1, 비DB 671 + 독립 PostgreSQL 55 = 726/726 통과, 실패/skip 0. 최종 diff 공백 검사도 통과했다.
- 환경 파일을 제외한 `/tmp` 소스 복사본에서 실제 next.config.ts와 package-lock을 유지했다. Turbopack의 프로젝트 밖 의존성 symlink 영향을 피하도록 의존성도 독립 복사했다. 실제 Secret 대신 무효 loopback DB 주소·테스트 인증 설정·빈 OpenAI 키만 사용했다. 제품 설정을 바꾸지 않고 `npm run build`를 실행했다. 로컬 테스트 프로세스에서만 Node heap 2GiB/UV·Rayon worker 2개와 Turbopack trace를 지정했다.
- 종료 코드 0, 총 38.11초, compile 23.0초, TypeScript 11.2초, static page 6/6 생성. 모든 기존 API·로그인·동적 결과·Owner lab 경로가 빌드됐다. DB나 AI에 접속하지 않았다.
- 10초 간격 관측에서 빌드 프로세스군의 합산 RSS 최대는 약 1,146MiB였다. 순간 최대 메모리의 정확한 측정값은 아니다. 관측 cgroup OOM/oom_kill은 시작과 종료 모두 0이었다. 현재 소스의 재현 가능한 컴파일 오류나 이번 실행의 OOM 근거는 없다. 이전 360초 중단 당시 충분한 자원 기록이 없어 그 원인을 리소스 부족으로 단정하지 않는다.
- 로그: `node_modules/.cache/final-audio-verification/build-turbopack.log`, 자원/종료 기록: `build-turbopack-summary.json`. 루트 `.next`와 기존 자료는 정리하거나 덮어쓰지 않았다.
- 로컬 기준으로 후속 Preview 검토/배포 준비가 가능하다. 실제 OpenAI의 v2 글 품질·25,000토큰 및 70/85/95초 내 완료, 실제 Preview 환경의 인증/예산 설정, 하드웨어 GPU의 high 품질·장시간 FPS/발열, 휴대폰 실기기 오디오/청취는 미검증이다. 실제 서비스 성공까지 보증하는 결과는 아니다.
- 커밋·푸시·배포·운영 DB·환경 파일·Secret 변경은 하지 않았다. 기존 구현 24개 파일과 제공된 MP3 자산 1개를 인증 진단 8개 항목과 분리했다. 이 재검증에서 수정한 파일은 검증 도구와 이 문서 2개뿐이다.

## 승인 후 Beta Preview 체크포인트 준비

- JourneySound cleanup의 현재 revision 무효화·fade 정리·캡처한 audio pause를 안정적인 stopPlayback 콜백으로 옮겼다. 오디오 동작을 바꾸거나 lint 규칙을 억제하지 않고 ref 경고를 해결했다. 정리 후 늦은 play promise가 상태/fade를 다시 시작하지 못하는 회귀 테스트 1개를 추가했다.
- TypeScript·ESLint 재검사: 오류/경고 0. 작업 트리 비DB 672개와 독립 임시 PostgreSQL 55개, 합계 **727개 통과**. 실제 OpenAI 호출은 없다.
- HEAD 아카이브와 승인된 25개 파일만 합친 독립 소스로 별도 검사했다. 기존 미커밋 인증 진단 16개 테스트는 이 배포 소스에 없으므로 비DB 656 + DB 55 = **711개 통과**다. 배포 소스의 TypeScript·ESLint도 통과했고 기본 Turbopack 프로덕션 빌드는 116.29초에 완료했다(compile 79초, TypeScript 28.5초). OOM 기록 변화는 없다. 이 수치는 초기 검증과 동시에 여러 검사를 수행한 별도 실행의 결과다.
- 이번 커밋 범위는 위 24개 파일과 `public/audio/intro-bgm.mp3`의 총 25개다. 인증 진단 8개 항목·ZIP·환경 파일·빌드/브라우저 산출물은 포함하지 않는다. MP3 원본 SHA-256을 유지한다.
- 기존 Vercel CLI 연결의 프로젝트/팀 식별자가 `wkdalsdleks-projects/my-mind-model-beta`와 일치함을 확인했다. Git 자동 연결은 없으며 수동 Preview 배포를 사용한다. 환경변수는 값이 아닌 이름·범위·식별자·갱신 시각만 보존 비교하고 변경하지 않는다.
- Preview DATABASE_URL의 실제 Neon 프로젝트/브랜치/DB 연결 대상은 **미확인**이다. Production DB와 같을 가능성을 배제하지 않는다. 이번 검사는 실제 DB에 접근하지 않는다. 실제 사용자 AI 호출 전에 운영자가 Vercel/Neon 설정 화면에서 프로젝트·브랜치·endpoint 매핑을 비공개로 대조해야 한다. pooler 유무만 다른 endpoint도 같은 DB일 수 있으므로 호스트 차이만으로 격리를 판단하지 않는다. 공유하거나 불확실하면 AI 테스트를 보류하고 별도 승인으로 Preview 전용 DB를 준비해야 한다.
- 이 절은 커밋 전 검사 결과를 기록한다. 실제 배포 URL·READY·alias·환경 메타데이터 보존 결과는 후속 완료 보고로 전달한다.
