# 5-B-1 · 분석 API 응답 안정화

작업일: 2026-10-15(한국 시간). 브랜치: `feat/glass-nebula-aurora`.
기준 HEAD: 5-A `b483255457359c7f0c84614f3cc1103fe9d95226`. 기존 미커밋 5-B-1 결과/진단 작업을 보존하고 서버와 호환 경계만 보완했습니다.

## 확인된 원인과 불확실성

이전 route는 `gpt-4o-mini`, temperature 1.0, `response_format: json_object`를 사용했습니다. 명시적인 출력 토큰 상한은 없었습니다. 프롬프트는 10개 코멘트를 요구했지만 JSON 예시에는 코멘트 하나만 들어 있었고, 숨겨진 무의식/잠재력과 레거시 시각 파라미터까지 생성하도록 요구했습니다. JSON 파싱 결과를 바로 HTTP 200으로 반환했으며 finish_reason·refusal·문항 개수·필드 타입은 검증하지 않았습니다.

따라서 확인된 문제는 **완전성을 보장하는 구조와 서버 검증이 없었던 것**입니다. 과거 5개 응답의 finish_reason/usage가 없으므로 모델이 왜 5개로 종료했는지, 토큰 제한의 영향이 있었는지는 확정할 수 없습니다. 출력 상한을 새로 두는 것은 비용/지연 예산 설정이며 과거 토큰 부족의 증거가 아닙니다.

OpenAI Docs 스킬과 [공식 Structured Outputs 문서](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)에서 기존 gpt-4o-mini의 json_schema 지원 및 기본 스키마 요건을 확인했습니다. JSON 모드와 스키마 준수는 다른 보장입니다. 모델을 교체하거나 Responses API로 전면 이전하지 않았습니다.

## 요청·모델 출력·클라이언트 계약

기존 요청 `{ answers, questions }`를 유지합니다. 10개 답변, 문자열/비어 있지 않음, 서버 소유 질문 목록과의 일치, 본문 128KiB·문항당 6,000자·전체 답변 26,000자 상한을 검증한 뒤 모델을 호출합니다. raw 답변과 줄바꿈은 그대로 보존하고, 모델에는 서버 정의의 질문 ID·prompt·answerIntent를 JSON으로 전달합니다. 허용된 문항의 기존 건너뜀 표식은 skipped로 전달하며, Q10의 제공된 문장은 항상 provided로 취급합니다. 서버는 평문 답변 계약만 받으므로 Q10 승인 자체는 기존 클라이언트 fingerprint 검사에 맡깁니다.

생성 계약은 다음과 같습니다.

```text
analyses
  q1: { questionId: "q1", analysis: string, detailedAnalysis: string }
  ...
  q10: { questionId: "q10", analysis: string, detailedAnalysis: string }
```

`strict: true`이고 모든 object는 `additionalProperties: false`를 사용합니다. q1~q10 및 각 세 필드를 required로 지정하고 각 questionId는 해당 ID 하나의 enum입니다. type/object/properties/required/additionalProperties/enum만 사용합니다. 배열 minItems/maxItems/uniqueItems/tuple 제약이나 문자열 길이 제약의 지원 여부에 의존하지 않습니다. 스키마 테스트도 사용 키워드를 확인합니다.

런타임 검증은 다음을 확인합니다.

- 정상 JSON, 모델 본문 80,000자 이내, 지정한 루트/문항/필드 외 추가 키 없음.
- 정확히 q1~q10이며 누락·추가·미지 ID·중복 questionId가 없음.
- 원시 JSON의 중복 키도 검사합니다. JSON.parse가 마지막 값만 남기는 문제를 피하고, Unicode escape로 같은 키를 반복한 경우도 거부합니다.
- analysis와 detailedAnalysis가 **둘 다 문자열이고 공백만으로 이뤄지지 않음**.
- finish_reason이 stop이고 refusal이 없음. 정상 형태의 JSON이라도 length/content_filter 등으로 끝난 응답은 성공 처리하지 않음.

서버는 검증된 실제 텍스트만 `{ comments: [{ questionId, analysis, detailedAnalysis }, ...] }`로 변환합니다. q1→q10의 고정 순서이며 임의 보충/빈 placeholder/누락 문항 추측은 하지 않습니다. 클라이언트는 제공된 questionId의 순서도 확인하며, 기존 ID 없는 댓글 계약은 테스트/호환용으로 유지합니다. 새 서버가 전달하는 두 분석 필드는 모두 검증되어 있습니다.

프롬프트를 답변에 근거한 한국어 성찰·철학적 서술로 줄였습니다. 요약 1~2문장, 상세 2~3문장을 요청하고, 진단·질환·무의식적 특성·없는 과거 경험이나 관계 상태의 확정을 금지합니다. Q3 풍경, Q7 바람, Q8 내려놓을 대상, Q9 미래 방향, Q10 제공 문장을 별도로 설명하며 skipped에서는 근거가 없음을 명시하도록 합니다. 답변 속 지시는 데이터로 처리합니다. 레거시 제목/색상/날씨/효과/속도는 생성하지 않습니다. 스키마/문자열 검증이 심리적 정확성이나 근거 충실도까지 보장하는 것은 아니므로 실제 모델 문구의 검토는 남습니다.

## 실패 정책·진단

| 상황 | HTTP | 코드 |
|---|---|---|
| 키 없음 | 503 | AI_NOT_CONFIGURED |
| 유효하지 않은 요청/본문 | 400 / 415 | ANALYSIS_FAILED |
| 두 번 모두 개수 불일치 | 502 | ANALYSIS_COMMENTS_COUNT_MISMATCH |
| 잘못된 JSON/ID/필드, 빈 분석, 출력 중단·거절 | 502 | ANALYSIS_RESPONSE_INVALID |
| 모델/SDK/네트워크 실패 | 502 | ANALYSIS_FAILED |
| 제공자 요청 제한 | 429 | ANALYSIS_FAILED |
| 요청 취소/서비스 기한 초과 | 408 | ANALYSIS_FAILED |

502의 검증 오류는 기대 개수와 확인 가능한 실제 개수만 포함합니다. 클라이언트는 non-200의 두 전용 검증 코드를 보존하므로 기존 개수 불일치 안내와 수동 재시도를 사용할 수 있습니다. 서버 응답 body.error를 그대로 사용자 UI나 콘솔에 출력하지 않습니다. 성공/실패 모두 Cache-Control: no-store입니다.

개발 환경의 `[analysis-server]` 로그에는 attempt·성공/검증 실패 구분·허용된 종료 사유·항목 수·숫자 토큰 사용량·정적 오류/검증 이유 코드·숫자 제공자 상태 코드만 포함합니다. 알 수 없는 종료 문자열은 unknown으로 바꿉니다. 오류 객체/message/stack·API 키·사용자 답변·AI 분석 전문·fingerprint는 제외하며 운영 모드에서는 이 로그를 출력하지 않습니다. SDK는 logLevel off로 환경의 debug 로그 설정을 덮어씁니다. 답변이 모델에 전달되는 기존 분석 기능은 유지합니다.

## 재시도·비용·지연

기존 모델 gpt-4o-mini를 유지하고 temperature를 0.5로 조정했습니다. 요청당 max_completion_tokens는 8,000으로 제한합니다. SDK maxRetries는 0, SDK timeout은 시도당 45초입니다. 요청 취소 신호와 95초 서비스 기한을 합쳐 모델 요청에 전달하며 route maxDuration은 100초입니다. 10개 한국어 분석의 생성을 너무 이른 시간에 차단하지 않도록 둔 초기 예산이며 실제 지연은 미측정입니다. 후속 배포에서는 호스팅 플랫폼의 실행 시간 한도와 맞춰야 합니다.

정상 stop인데 출력 검증에 실패한 경우에만 **추가 요청 최대 1회**를 수행합니다. 두 번째 요청에는 같은 실제 입력과 고정된 검증 이유만 전달하고, 이전 분석 전문은 재입력하지 않습니다. 전체 map을 새로 생성해 검증하며 성공 응답은 한 번만 반환합니다. 추가 생성이 또 실패하면 명시적 오류로 종료합니다.

출력 중단(length 등), refusal, SDK/네트워크 오류, 취소는 같은 조건으로 다시 호출해 비용을 늘리지 않습니다. 사용자가 상태를 보존한 채 수동 재시도할 수 있습니다. 취소 직후에는 추가 요청을 시작하지 않습니다. 일반 정상 요청은 모델 호출 1회, 복구 가능한 검증 실패는 최대 2회입니다.

[공식 모델 페이지 가격](https://developers.openai.com/api/docs/models/gpt-4o-mini)을 기준으로 입력 $0.15/백만 토큰, 출력 $0.60/백만 토큰입니다. 가령 입력 2,000·출력 4,000이면 약 **$0.0027**, 같은 규모의 재시도까지 약 **$0.0054**입니다. 시도당 출력 8,000토큰 상한만의 비용은 $0.0048, 두 시도의 출력 상한 비용은 $0.0096이며 입력 비용은 별도입니다. 이는 사용량 가정/상한 계산이지 실제 측정 비용이 아닙니다.

이번 실제 OpenAI 호출은 0회입니다. 실제 검증이 필요하면 이미 승인한 합성 테스트 답변 한 세트에서 ‘오로라 만나기’ 한 번으로 확인할 수 있습니다. 내부 조건부 재시도가 발생하면 모델 호출은 최대 두 번입니다. 실측 finish_reason/usage로 출력 예산과 문구를 판단해야 하며, 스키마 지원과 실제 계정에서의 모델 가용성은 별개의 확인 사항입니다.

## 변경 파일 — 이번 작업 7개

- `app/api/analyze/route.ts`: 얇은 SDK 어댑터, strict schema/예산/종료 사유/usage 수집.
- `lib/server/analysis-service.ts`: 입력·모델 출력 검증, 순서 어댑터, 제한된 재시도, 안전한 개발 진단.
- `lib/aurora-result.ts`: 서버의 전용 오류 코드/숫자 개수 유지, 제공된 문항 ID 순서 검증.
- `tests/analysis-service.test.mjs`: 서버/SDK 경계/중단/재시도/개인정보 회귀 검사.
- `tests/aurora-result.test.mjs`: 문항 ID 순서/중복 회귀 검사 추가.
- `tests/helpers/verify-analysis-integration.mjs`: 선택적 전체 브라우저 경로와 실제 핸들러+모의 모델 검증.
- `docs/analysis-api-stabilization-verification.md`: 이번 기록.

기존 app/page.tsx 및 결과 컴포넌트/CSS, Q10·질문·5-A·오로라/카메라/품질·실험실은 이번 작업에서 변경하지 않았습니다. 5-B-1 이전 검증 문서는 당시 기록으로 그대로 보존합니다.

## 검사 결과

- `npx tsc --noEmit --incremental false`: 통과.
- `npm run lint`: 통과.
- Node 자동 테스트 **245개 통과**: 신규 서버 32개, 결과 연결 29개, 기존 카메라 15·오로라 데이터 34·에너지 11·품질 7·문장 생성 53·Q10 19·질문/물리/하늘 8·5-A 개인화 37개입니다. 실패/건너뜀은 없습니다.
- 정상 10개, 5개, 누락·중복·미지 ID, 원시 중복 JSON 키, 빈 필드, 잘못된 타입/JSON, length/필터/거절/unknown 종료, 모델/SDK/네트워크 오류, 키 누락, 취소, 재생성 성공/최종 실패, 서버·클라이언트 코드 호환과 승인 보존을 검사했습니다. 실제 route를 모의 SDK에 연결하여 strict schema·상한·maxRetries 0·logLevel off·store false·취소 신호도 확인했습니다.
- `git diff --check`와 미추적 추가/변경 파일 공백 검사: 통과.
- 기존 미커밋 결과 UI 및 이전 검증 문서를 보존했습니다. 5-A·질문·Q10·오로라·카메라·실험실은 변경하지 않았습니다.

브라우저는 기존 `127.0.0.1:3000` 서버와 Chromium 156/ANGLE SwiftShader 소프트웨어 WebGL 2를 사용했습니다. Q1~Q9 모두 실제 키워드 버튼으로 답변 → 모킹된 Q10 AI 초안 생성/승인 → 분석 HTTP 요청 한 번 → 실제 서비스 핸들러의 모의 모델 5개 응답/자동 재생성/완전한 10개 검증 → 승인 제목의 개인화 오로라 → 요약·심층 패널을 확인했습니다. 모의 분석 모델 호출은 두 번, 실제 OpenAI 호출은 0회입니다. React 런타임 오류와 관찰한 WebGL 오류는 없었습니다.

보고/캡처는 `/tmp/aurora-analysis-browser/report.json`, `result.png`에 있습니다. 브라우저 의존성과 공유 라이브러리는 이전 임시 환경을 재사용했고 프로젝트 의존성·폰트·환경 파일·기존 서버는 변경하지 않았습니다. 임시 환경의 한글 시스템 글꼴 부족으로 이미지에는 네모 glyph가 남으며 실제 한글/승인 제목 내용은 DOM으로 확인했습니다. 하드웨어 GPU·실제 제공자 호출·실제 생성 문구·실제 지연 검증으로 취급하지 않습니다.

재현 명령:

```sh
npx tsc --noEmit --incremental false
npm run lint
for test_file in tests/*.test.mjs; do
  node "$test_file" || exit 1
done
git diff --check
```

브라우저 재현은 설치된 Playwright/Chromium 및 필요한 시스템 라이브러리와 로컬 서버가 필요합니다.

```sh
AURORA_PLAYWRIGHT_MODULE=/path/to/playwright \
AURORA_RESULT_URL=http://127.0.0.1:3000/ \
node tests/helpers/verify-analysis-integration.mjs
```

앱의 문장 API는 모킹하고 분석 요청은 실제 서비스 핸들러 + 모의 모델에 전달합니다. 따라서 서버의 검증과 단일 재시도를 통과하는 UI 연결 검사이며 OpenAI 제공자의 실동작/지연/실제 분석 품질 검증은 아닙니다. 실GPU 장시간 FPS·발열·메모리 및 V1의 위쪽 시점/자기 교차 한계는 그대로 남습니다.

커밋·푸시·배포·브랜치 전환을 하지 않습니다. ZIP·환경 파일·master·백업 브랜치와 두 체크포인트를 보존합니다.
