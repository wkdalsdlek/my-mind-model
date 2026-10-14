# 5-B-1 · 실제 결과 화면과 개인화 오로라 연결

작업일: 2026-10-15(한국 시간). 브랜치: `feat/glass-nebula-aurora`.
기준 체크포인트: Aurora Prototype V1 `294632b9722ee0906f3ed74207bedf80bf1aa6bb`, 5-A `b483255457359c7f0c84614f3cc1103fe9d95226`.

## 후속 진단 · HTTP 성공 응답의 분석 개수 부족

사용자 보고처럼 HTTP 200 JSON에 `comments`가 5개인 응답을 결정적 모의 fetch로 재현했습니다. 수정 전 테스트에서 개인화 appearance는 유효하고 승인도 현재 상태와 일치했으나, `readAuroraAnalysisComments()`의 **정확히 10개 코멘트 요구**에서 null을 반환했습니다. 요청 컨트롤러가 이 검증 실패를 일반 `ANALYSIS_FAILED`로 전달하여 원인이 드러나지 않는 경고가 나왔습니다. 성공 콜백은 호출되지 않았으므로 해당 경고는 오로라 화면/React 전환 전에 발생합니다.

이번에는 검증을 완화하지 않고 진단·오류 전달만 보완했습니다. 수정 범위는 `app/page.tsx`, `lib/aurora-result.ts`, `tests/aurora-result.test.mjs`, 이 문서입니다. 결과 컴포넌트/스타일·5-A 엔진·질문/Q10·API·실험실은 이번 후속 작업에서 변경하지 않았습니다.

| 구분 | 단계 | 오류 코드 |
|---|---|---|
| 서버 HTTP 오류 | request | ANALYSIS_FAILED / AI_NOT_CONFIGURED |
| fetch 연결 실패 | request | CONNECTION_FAILED |
| HTTP 성공이지만 코멘트 개수 불일치 | response-validation | ANALYSIS_COMMENTS_COUNT_MISMATCH |
| JSON 파싱/형식/코멘트 내용 불량 | response-validation | ANALYSIS_RESPONSE_INVALID |
| 개인화 준비 예외/유효하지 않은 appearance | snapshot | PERSONALIZATION_FAILED |
| 시작/성공 콜백의 동기 전환 예외 | result-transition | RESULT_TRANSITION_FAILED |

`validateAuroraAnalysisResponse()`는 실패 원인과 개수/문항 번호를 반환하고 기존 `readAuroraAnalysisComments()`의 배열 또는 null 계약은 유지합니다. `prepareAuroraResult()`는 준비 실패를 타입 있는 snapshot 오류로 전달합니다. 해당 오류는 준비 단계에서 처리하므로 API를 호출하지 않습니다. 동기 콜백 예외 분류는 비동기 React 렌더링 예외를 잡는 Error Boundary와는 다릅니다. 기존 렌더러의 WebGL 실패/정적 대체는 별도 정책이며 이번에 변경하지 않았습니다.

5개 응답의 사용자 안내는 ‘10개 분석 항목이 필요하지만 5개가 도착했다’, ‘답변과 승인한 문장은 그대로 유지된다’, ‘오로라 만나기를 다시 누르라’는 내용입니다. **부족한 분석을 생성하거나 빈 항목으로 채우지 않습니다.** 불완전 응답은 결과로 진입하지 않고 finally에서 잠금을 해제합니다. 같은 질문·승인·개인화 스냅샷으로 사용자가 재시도할 수 있습니다. 자동 유료 재시도는 추가하지 않았습니다. 이전 세션/취소된 요청의 오류는 안내·로그도 내보내지 않습니다.

개발 모드에서만 `[aurora-analysis]` 경고를 남깁니다. 코드는 허용된 단계/오류 코드·숫자 메타데이터·고정된 reason만 복사합니다. 5개 응답이면 `{ stage: "response-validation", code: "ANALYSIS_COMMENTS_COUNT_MISMATCH", httpStatus: 200, expectedCount: 10, receivedCount: 5, reason: "comments-count-mismatch" }`입니다. 사용자 답변·승인 문장·API 키·비밀번호·입력 fingerprint·서버 응답 본문·오류 객체/message/stack은 로그에 포함하지 않습니다. 운영 환경에서는 이 로그를 출력하지 않습니다.

`파일 시스템을 추가할 수 없음: <illegal path>` 메시지 없이도 같은 실패가 재현되었습니다. 그 메시지가 다른 문제와 연관되는지는 확인하지 못했지만 이번 실패 지점은 응답 개수 검증으로 확인했습니다.

### AI의 불완전 응답에 대한 남은 조사

현재 서버는 모델 응답을 JSON.parse한 후 반환하고 코멘트 개수는 검사하지 않습니다. 따라서 JSON이 존재하고 HTTP 200이어도 10개 분석이 완성됐다는 뜻은 아닙니다. 프롬프트의 10개 요구와 런타임 출력 검증은 서로 다른 단계입니다. 서버에서 모델 종료 이유/사용량을 반환하거나 기록하지 않아, 실제 모델이 왜 5개로 끝냈는지 또는 출력 제한의 영향인지는 제공된 정보만으로 확정할 수 없습니다.

다음 서버 개선 후보는 (1) 동일한 출력 완전성 검증과 명시적 불완전 응답 코드, (2) 종료 이유·항목 수·토큰 사용량만 안전하게 관찰, (3) 관찰 근거에 따른 출력 제약 검토, (4) 필요하면 비용 상한과 동의를 정한 전체 재생성입니다. 개수만으로 어느 질문이 빠졌는지는 알 수 없으므로 5개를 임의로 질문에 재배정하거나 나머지를 추측해 보충하지 않아야 합니다. 이번에는 API 프롬프트·모델·temperature·서버 코드를 변경하거나 실제 OpenAI 호출을 하지 않았습니다.

### 후속 검증

- 재현 테스트: 수정 전 일반 오류로 차단됨을 확인한 뒤 전용 코드·HTTP 200·기대 10/실제 5로 회귀 검사를 갱신했습니다.
- 결과 연결 테스트 28개: 개수 0/5/9/11, JSON 파싱 실패, 내용 누락, 스냅샷 예외/잘못된 appearance, 동기 전환 예외, 운영 로그 미출력, 민감한 추가 필드 제외, 승인/스냅샷 보존과 수동 재시도를 검사합니다.
- TypeScript·ESLint·`git diff --check` 및 신규 파일 공백 검사: 통과. 기존 테스트 184개와 결과 연결 28개, **총 212개** 통과했습니다.
- 기존 로컬 서버의 실제 Chromium에서도 HTTP 200 + 코멘트 5개 → 명시적 검증 안내 → 승인/입력 보존 → 코멘트 10개 수동 재시도 → 동일 승인 제목의 결과 진입을 확인했습니다. 모킹 API 2회이며 실제 OpenAI 호출은 0회입니다. React 런타임 오류는 없었고 개발 콘솔 메타데이터도 기대값과 일치했습니다. 이 확인은 이번 실패/재시도 경로를 대상으로 하며 GPU 성능을 다시 측정한 것은 아닙니다.
- 임시 재현 스크립트/결과: `/tmp/verify-aurora-incomplete-response.mjs`, `/tmp/aurora-incomplete-browser.log`. 개인적인 로그인 값은 출력하지 않았습니다. 전체 카메라/품질 검증 도구는 변경하지 않았습니다.

아래는 최초 5-B-1 통합 당시의 기록입니다.

## 연결 구조

`app/page.tsx`의 기존 질문/Q10 흐름은 유지하고, 승인·응답 완료 후 요청하는 `/api/analyze`가 성공했을 때만 새 결과 화면으로 들어갑니다. 질문 화면과 캡슐 레이아웃/물리·추천·문장 생성/수정/승인·로그인은 변경하지 않았습니다. `/aurora-lab`의 코드·프리셋·카메라·셰이더·지오메트리도 변경하지 않았습니다.

`prepareAuroraResult(questionnaire)`는 먼저 `getApprovedClosingMessage()`와 `firstIncompleteQuestion()`을 확인합니다. 미승인·오래된 승인은 Q10으로, 다른 미완료 문항은 해당 질문으로 돌려보냅니다. 최신 상태에서 **기존 5-A 진입점 `personalizeAuroraFromQuestionnaire()`**를 호출하고 `personalization`, 기존 직렬화 답변, 입력 fingerprint를 스냅샷으로 만듭니다. 입력 fingerprint는 일관성 확인용 메모리에만 남고 UI·로그·분석 요청에는 추가하지 않습니다.

`AuroraAnalysisRequestController`는 기존 `{ answers, questions }` 요청 계약만 사용합니다. 성공 시 요청 당시의 승인/개인화 스냅샷과 실제 분석 코멘트를 같은 결과 객체로 저장합니다. `AuroraResultScreen`은 `snapshot.personalization.appearance`를 기존 `GlassNebulaAurora`에 전달합니다. 실험실 프리셋을 사용자 결과에 고정 적용하지 않습니다. Q1·Q2·Q4·Q5·Q6의 팔레트·기본 움직임·독립 리본 수가 그대로 반영되고, 5-A 수학은 변경하지 않았습니다.

결과 객체는 한 번 성공할 때만 생성합니다. 분석 패널·품질·카메라 상태는 결과 컴포넌트의 로컬 상태이며 질문 reducer에 영향을 주지 않습니다. 패널을 열고 닫아도 appearance 객체와 Canvas의 컴포넌트 위치/key를 유지합니다. 품질 전환 시 필요한 버퍼/광학 변경만 기존 렌더러에 맡깁니다. Context loss·셰이더 실패·정적 대체·자원 정리도 기존 렌더러 정책을 사용합니다.

## 승인 제목과 AI 분석의 분리

메인 h1에는 `personalization.approvedTitle.text`만 React 텍스트로 표시합니다. AI `title`, `날씨:`, `colors`, `speed`, `distort`, `scale`, 조명/재질 설정은 결과 UI/렌더러에 전달하지 않습니다. 승인된 줄바꿈·문장을 추가로 가공하지 않습니다. 제목은 렌더러 밖에 있고 `white-space: pre-wrap`, `overflow-wrap: anywhere`, 반응형 크기와 일반 문서 흐름을 사용합니다. 긴 제목 아래에 감상 영역을 배치하여 겹침을 피합니다.

5-A의 중립 대체 팔레트는 변경하지 않습니다. 전체 중립 기본이면 ‘색을 정하기 어려워 중립적인 빛으로 보여준다’, 보조색이면 ‘빛의 조화를 위한 중립적인 보조색을 더했다’고 표시합니다. 중립 슬롯을 사용자 성격이나 실제 선택 계열로 설명하지 않습니다.

AI 응답에서 결과에 저장하는 것은 `analysis`·`detailedAnalysis`뿐입니다. 기존 요약/심층 분석과 질문·답변 표시를 유지하고 `comment.effect`는 숨깁니다. 레거시 시각 설명이 5-A 오로라의 실제 인과적 근거라고 주장하지 않습니다. 요약이 비어 있으면 상세, 상세가 비어 있으면 요약으로 표시합니다.

API 프롬프트·모델·서버 응답 계약은 그대로입니다. 클라이언트는 계약에 명시된 10개 코멘트와 각 문항의 실제 분석 텍스트가 있는지 확인하며, 빈 객체·누락·잘못된 JSON을 정상 분석으로 표시하지 않습니다. AI 분석 실패·설정 미완료·연결 실패는 기존 취지의 오류를 알리고 결과로 진입하지 않습니다. 질문 선택·원문·승인을 초기화하지 않아 재시도할 수 있습니다. 모의 성공이나 분석 대체 문구는 제품 코드에 추가하지 않았습니다.

## 요청과 세션 안전성

- React loading 업데이트 전에도 작동하는 동기 잠금으로 중복 클릭을 막습니다.
- AbortController와 요청 토큰 identity로 취소/리셋/언마운트를 처리합니다. 이전 요청의 finally가 새 요청의 잠금을 해제하지 못합니다.
- 응답 도착과 JSON 파싱 후 모두 최신 승인 fingerprint와 응답 완료 상태를 확인합니다. 입력이 바뀌면 이전 응답을 버립니다.
- 입력 fingerprint가 바뀐 진행 중 요청은 취소합니다. 결과 렌더링도 현재 승인 fingerprint와 결과 스냅샷이 같을 때만 허용합니다.
- reset은 확인 후 진행 중 요청 취소, 질문 reducer/키워드 풀 초기화, 완료 결과 제거를 수행합니다. 결과 컴포넌트가 언마운트되면서 패널·카메라·품질 상태도 초기화됩니다.
- 기본 fetch는 `globalThis.fetch(...)` 래퍼를 사용하여 네이티브 fetch의 호출 문맥을 유지합니다. 주입 가능한 모의 fetch도 지원합니다.
- API 키·비밀번호·답변·원문·raw 서버 오류 로그는 추가하지 않습니다.

## 결과 UI·접근성·품질

브랜딩 → 승인 제목 → 감상 영역 → 간결한 카메라/품질/움직임 조작 → 다시 성찰하기·요약·심층 분석을 제공합니다. 정면 감상이 기본이며 자유 탐색·느린 자동 공전·정면 복귀는 기존 `AuroraCameraController`를 재사용합니다. 직접 조작 시 자동 공전 중단도 유지합니다. 시스템/사용자 움직임 감소에서는 자동 공전을 비활성화하고 기존 정적 렌더링 정책을 사용합니다.

데스크톱 분석은 오로라 옆에, 좁은 화면에서는 오로라 아래에 배치합니다. 모바일에서 긴 제목·답변은 줄바꿈하며 가로 넘침을 피합니다. 명시적 label, 버튼 이름, 초점 표시, 결과/분석 제목의 초점 이동, 패널 닫기 시 opener로 초점 복귀, Escape 닫기를 제공합니다. 패널은 비모달 aside로 오로라와 조작을 함께 사용할 수 있습니다.

기본 품질은 모든 기기에서 동일한 balanced입니다. 사용자는 low/balanced/high를 고를 수 있고, 기기 종류나 화면 폭으로 강등하지 않습니다. 품질은 의미 비중과 분리하며 핵심 리본·안개를 모바일이라는 이유로 제거하지 않습니다. 별도 자동 GPU 최적화는 구현하지 않았습니다.

## 수정/추가 파일

- `app/page.tsx`: 레거시 구체·와이어프레임·전용 조명 제거, 스냅샷/요청/결과 연결. 기존 로그인/질문 핸들러·Q10 props 유지.
- `lib/aurora-result.ts`: 승인/완료 준비, 분석 텍스트 경계, 요청 잠금·취소·최신 상태 검사.
- `components/result/AuroraResultScreen.tsx`: 제목·오로라·카메라/품질·분석 패널·작업 버튼.
- `components/result/AuroraResultScreen.module.css`: 반응형 감상 영역·긴 텍스트·분석 레이아웃·키보드 초점.
- `tests/aurora-result.test.mjs`: 결과 스냅샷, 승인/역할/AI 분리, 실패/재시도/취소/지연 응답, 실제 JSX 데이터 전달.
- `tests/helpers/verify-aurora-result.mjs`: 선택적 실제 브라우저 검증. 앱 API 전부 모킹/차단. 로그인 값은 로컬 소스에서 메모리로 읽어 사용하며 기록하지 않음.
- `docs/aurora-result-integration-verification.md`: 이번 기록.

## 자동 검사

- `npx tsc --noEmit --incremental false`: 통과.
- `npm run lint`: 통과.
- 기존 **184개**와 신규 결과 연결 **21개**, 총 **205개** Node 테스트 통과. 실제 OpenAI 호출 없음.
- 신규 검사는 실제 결과 JSX를 실행하여 오로라 props/승인 제목/중립 안내/긴 문장 escaping을 확인합니다. 이 Node JSX 검사에서는 WebGL과 브라우저 신호만 대체하므로 실제 렌더링 검증과 구분합니다.
- `git diff --check`와 신규 6개 파일의 `git diff --no-index --check /dev/null <파일>`: 통과.

프로젝트에는 npm test 스크립트가 없으므로 다음으로 전체 테스트를 재현합니다.

```sh
for test_file in tests/*.test.mjs; do
  node "$test_file" || exit 1
done
```

## 브라우저 검사

기존 `127.0.0.1:3000` 개발 서버를 재사용했습니다. Chromium 156 + ANGLE SwiftShader **소프트웨어 WebGL 2**에서 별도 검증 스크립트를 실행했습니다. Playwright는 `/tmp`에, 누락된 공유 라이브러리는 `/tmp`에 다운로드·압축 해제했고 시스템 패키지를 설치하지 않았습니다. Chromium은 테스트용 브라우저 캐시에 준비했습니다. 프로젝트 의존성·환경변수 파일·폰트·기존 서버/잠금은 변경하지 않았습니다.

`/api/analyze` 요청 **3회 모두 모킹**했습니다. 첫 요청은 의도적인 503 설정 미완료, 두 번째는 데스크톱 성공, 세 번째는 reset 후 다른 답변/모바일 성공입니다. 그 밖의 앱 API와 외부 요청은 차단했으며 실제 OpenAI API 호출은 없었습니다.

- 최초 승인 전 결과 버튼 비활성화, 실제 로딩 표시, 실패 후 입력·승인 보존 및 재시도 성공을 확인했습니다.
- 승인 문장의 줄바꿈/내용이 제목과 정확히 같고 AI의 레거시 title·effect는 화면에 없음을 확인했습니다.
- 요약/심층 분석과 답변 표시, 패널 닫기, 패널/품질 변경 전후 동일 Canvas DOM 유지가 통과했습니다.
- 데스크톱 **low/balanced/high 3장**, 모바일 **low/balanced/high 3장**을 캡처하고 오로라 렌더링을 직접 확인했습니다. 추진 선택의 따뜻한 색과 표현 선택의 라벤더/청록 계열이 다르게 나타나며 실제 GPU uniform 색상 값도 달랐습니다. 모바일 기본 품질도 balanced로 유지됩니다.
- 자유 탐색 드래그의 실제 카메라 각도 변화, 정면 복귀, 자동 공전 각도 변화, 직접 조작 시 자동 공전 중단, 시스템 움직임 감소에서 자동 공전 비활성화를 확인했습니다.
- reset 후 이전 결과/선택 제거, 긴 직접 문장의 재승인, 원문 변경 시 승인 무효화, 긴 제목의 정확한 텍스트 표시가 통과했습니다. 390×844에서 가로 넘침이 없고 제목이 Canvas 위에, 분석이 감상 영역 아래에 위치함을 확인했습니다.
- `/aurora-lab` 독립 페이지의 기본 Serenity 프리셋과 balanced 품질 UI도 확인했습니다.
- 관찰한 WebGL 오류 **0개**. 의도적으로 발생시킨 모킹 503 외의 page/console/crash 오류는 없었습니다.

캡처/결과는 `/tmp/aurora-result-visual/`의 `desktop-{low,balanced,high}.png`, `mobile-{low,balanced,high}.png`, `mobile-long-title.png`, `report.json`에 있습니다. 임시 Chromium 환경에 한글 시스템 글꼴이 없어 캡처의 한글 glyph가 네모로 보입니다. 실제 한글 텍스트와 제목 보존은 DOM으로 확인했고 프로젝트 글꼴은 변경하지 않았습니다. 실제 기기의 한글 글꼴/행간/최종 가독성은 추가 확인이 필요합니다. 초기 검증 도구가 hydration 전에 입력하던 문제는 도구에서 초기 로딩과 React 입력 연결을 기다리도록 보정했습니다.

이 검증은 UI 연결과 소프트웨어 WebGL 실행의 근거이며 실제 하드웨어의 장시간 FPS·발열·메모리 측정이 아닙니다.

재현:

```sh
AURORA_PLAYWRIGHT_MODULE=/path/to/playwright \
AURORA_RESULT_URL=http://127.0.0.1:3000/ \
AURORA_RESULT_OUTPUT=/tmp/aurora-result-visual \
node tests/helpers/verify-aurora-result.mjs
```

## 다음 단계와 남은 위험

Q3 atmosphere·Q7 innerPulse·Q8 releaseFragments·Q9 outerExpansion은 스냅샷에만 보존하며 셰이더·지오메트리·motion에 전달하지 않았습니다. 5-B-2에서 각 역할별 타입을 소비하는 별도 연결이 필요합니다.

기존 분석 API의 근거 없는 단정적 심리 문구와 레거시 분석 구조는 **추후 분석 재설계 과제**로 남깁니다. 이번 단계의 코멘트 UI 유지가 해당 문구의 심리적 정확성을 검증한 것은 아닙니다. 응답 계약에 맞지 않는 부분 분석은 결과 진입을 막으므로 실제 서버에서도 10개 코멘트 생성 성공 여부를 별도 확인해야 합니다.

위쪽 시점의 형태/겹침, 투명 자기 교차·곡면 어색함은 V1에서 그대로 남습니다. 실제 GPU 장시간 FPS·발열·메모리, 기기별 색/셰이더 차이, 컨텍스트 손실 후 실기기 복구는 별도 검증이 필요합니다. 완전한 자동 GPU 최적화와 파괴/형성 전환 시네마틱은 구현하지 않았습니다.

커밋·푸시·배포·브랜치 전환은 하지 않습니다. ZIP·환경 파일·master·백업 브랜치와 두 체크포인트를 보존합니다.
