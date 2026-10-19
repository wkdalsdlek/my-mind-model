# Q10 Low · 오로라/문항별 분석 High 모델 설정 검증

검토일: 2026-10-19 KST. 브랜치 `feat/glass-nebula-aurora`, 기준 HEAD `411d1ad456909ec909fc0a3ef5a6ff095501d210`.

로컬 구현 및 모킹/독립 DB/빌드 검증만 수행한다. 실제 OpenAI 호출, Vercel 접근/배포, 환경변수·Secret 수정, 운영 DB 조회/쓰기, Git stage/commit/push는 수행하지 않는다.

## 최종 요청 계약

| 기능 | 모델 | reasoning_effort | max_completion_tokens | 유료 시도 상한 |
| --- | --- | --- | ---: | ---: |
| Q10 나의 문장 만들기 | gpt-6.1-sol | low | 4,096 | 1 |
| 오로라 심층 해석 (v1/v2) | gpt-6.1-sol | high | 25,000 | 2 |
| 레거시 Q1~Q10 문항별 분석 | gpt-6.1-sol | high | 25,000 | 2 |

- `lib/server/ai-model-settings.ts`의 공통 계약을 closing/analysis 서비스와 security policy가 함께 참조한다. `featureModel()`의 model/output/attempts와 실제 route의 모델/완료 한도가 같은 값이다.
- 오로라는 기존처럼 analysis 상수를 가져오므로 High가 자동으로 반영된다. 압축 provider의 v2 strict schema/입력/복원 및 문단별 근거 검증 구현은 변경하지 않았다.
- 세 route 모두 Chat Completions와 strict 구조화 출력을 유지한다. Q10의 `temperature: 0.9`를 제거하고 `reasoning_effort: low`, `service_tier: default`를 명시한다. SDK maxRetries=0, store=false를 유지한다. tool 호출이나 Responses 마이그레이션은 없다.
- Q10의 20~45자 목표/최대 80자 문장 검증, 원문/입력 검증, 승인·편집·저장·결과 연결, 요청 1회 정책을 유지한다. 프롬프트나 JSON text schema를 변경하지 않았다.

공식 호환성 근거:

- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol): Low/High, 도구 없는 Chat Completions, structured outputs 지원.
- [Using GPT-6 migration](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6.1-sol): 추론 사용 시 temperature/top_p/top_logprobs/logprobs 제거.
- [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning?api-mode=chat): 완료 예산에 추론도 포함되며 visible output 전에 한도를 소진할 수 있음.

## Q10 4,096토큰 결정

180토큰은 추론과 최종 JSON이 공유하는 상한으로 너무 작아질 수 있다. Low + 짧은 문장 작업에 4,096으로 확대했다. 이는 **긴 문장 출력 허용이 아니라 내부 추론 여유**다. 기존 최대 80자 검증은 그대로다.

공식 일반 가이드는 초기 추론 실험에 25,000토큰 이상 여유를 권장한다. 이번 짧은 Low 작업에서는 1회 비용·기존 30초 호출 제한과의 균형을 고려해 더 작은 4,096을 선택했다. 실모델의 reasoning 사용량을 측정하지 않았으므로 이 한도가 항상 충분하다고 주장하지 않는다. 후속 승인된 최소 실호출에서 finish_reason/reasoning/completion 사용량을 확인해야 한다.

`finish_reason=length`, refusal, 빈 응답, 잘못된 JSON 또는 긴 문장은 기존 경로대로 실패 처리한다. 임의로 문장을 채우거나 자동으로 2번째 생성/토큰 증액을 하지 않는다. 답변과 승인 상태 보존 회귀를 유지한다.

## 가격·모델 허용 목록과 입력 한도

`AI_MODEL_PRICES_JSON`은 읽거나 수정하지 않았다. 기존 GPT-6.1 Sol 가격 항목을 그대로 사용한다. 현재 활성 모델은 Sol 하나이므로 Sol 가격이 없거나 부적합하면 `BUDGET_NOT_CONFIGURED`로 fail-closed한다. 더 이상 쓰지 않는 GPT-4o mini 가격은 필수 설정이 아니며 Secret에 남아 있어도 수정/삭제하지 않는다. 이전 mini 모델 또는 180토큰 params로 호출하면 여전히 `MODEL_BUDGET_MISMATCH`로 차단된다.

두 기능이 같은 모델 가격 키를 쓰더라도 `featureBudgetConfig()`는 request-local 복사본을 만든다.

- Preview `AI_CLOSING_MAX_INPUT_BYTES=120000`: Q10에만 적용.
- Preview `AI_INTERPRETATION_MAX_INPUT_BYTES=120000`: 오로라에만 적용.
- 한 기능의 한도가 다른 기능이나 원본 가격 JSON을 덮어쓰지 않는다. 레거시 분석은 Secret의 기본 입력 상한을 사용한다.
- 설정 누락은 기존 가격 항목의 기본 상한을 유지한다. 잘못된 Preview 값은 해당 기능을 차단하며 Production에는 Preview override를 적용하지 않는다.
- 입력 검사는 계속 `Buffer.byteLength(JSON.stringify(params), "utf8") + 4096`이다. 같은 유효 상한이 예약과 reported prompt_tokens 검증에도 적용된다.
- USD 예산·계정 monthlyBudget override 우선순위·일간 횟수·전역 요청/동시성·중복 차단·세션/Origin 정책은 변경하지 않았다.

## 예약액과 실제 사용량 정산

현재 공식 Standard 참조 단가: input $2/M, cached input $0.10/M, output $10/M. 실제 서비스는 기존 Secret에 설정된 단가를 사용한다. 아래 표는 참조 단가와 해당 입력 상한을 적용한 **현행 정책의 예약액**이며 실제 청구액이나 실제 토큰 수가 아니다.

| 기능 | 유효 입력 상한 예시 | 최대 출력 | 최대 시도 | 최대 예약액 |
| --- | ---: | ---: | ---: | ---: |
| Q10, 기본 상한 예시 | 16,000 | 4,096 | 1 | $0.07296 |
| Q10, Preview override | 120,000 | 4,096 | 1 | **$0.28096** |
| 오로라, 기본 상한 예시 | 16,000 | 25,000 | 2 | $0.564 |
| 오로라, Preview override | 120,000 | 25,000 | 2 | **$0.98** |
| 레거시 분석, 기본 상한 예시 | 16,000 | 25,000 | 2 | **$0.564** |

기본 16,000은 테스트/기존 보고의 예시다. 실제 Secret 값은 확인하지 않았으며 다른 기본값이면 예약액도 달라진다. Q10 이전 mini/180/120KB의 참조 예약액 $0.018108에서 신규 $0.28096으로 증가한다. 오로라/레거시는 출력·시도 상한이 같아 최대 예약액은 기존과 같지만 High로 실제 사용량이 늘 수 있다.

예약 공식: `ceil(cost(price, effectiveInputBound, maxCompletionTokens) * maxAttempts * 1e8) / 1e8`.

실제 사용량을 확인한 정산 공식: `((prompt-cached)*inputPrice + cached*cachedInputPrice + completion*outputPrice) / 1e6`. completion에 reasoning이 이미 포함되므로 reasoning을 다시 더하지 않는다.

합성 사용량 예시:

- Q10 prompt=5,000, completion=1,000(추론 포함), cached=0: **$0.020**. cached=1,000이면 $0.0181.
- 오로라/레거시 prompt=5,000, completion=10,000, cached=0: **$0.110/회**, 같은 사용량으로 2회면 $0.220.
- Q10 prompt=1,000, completion=4,096 중 reasoning=4,000: **$0.04296**, 추론을 이중 청구하지 않음을 회귀 검증한다.

이 예시는 모델의 실제 평균 소비량 예측이 아니다. 실제 호출을 하지 않아 이전/이후 실제 청구액은 없다. `Price`의 기존 계약은 input/cachedInput/output만 다루며 cache-write·지역별 추가 과금 등의 별도 청구 항목은 새로 구현하지 않았다. 서비스 tier는 Standard/default로 유지하고 cache 옵션을 추가하지 않았다. 실제 청구와 설정 기반 추정의 차이는 운영 가격 정책 검토 대상으로 남는다.

입력/완료/추론 토큰이 유효 상한을 넘거나 사용량을 받지 못하면 기존처럼 uncertain으로 남기고 **전체 예약액을 유지**한다. timeout/취소/사용량 누락을 0원으로 처리하거나 기존 비용 기록을 삭제하지 않는다. 실제 AI 호출 전 예약이 기존 사용자/전역 USD 한도에 걸리면 429로 차단한다. 계정의 DB monthlyBudget이 낮으면 환경 예산이 커도 차단될 수 있으며 계정/DB를 수정하지 않았다.

## 시간 제한과 단계별 생성 설계

변경하지 않은 제한:

- Q10: SDK 30초, 브라우저 35초, Vercel Function 40초.
- 오로라: 요청 진입부터 work 85초, 한 모델 시도 최대 70초, 전체 목표 95초, 정산 여유 10초, Vercel 100초, 브라우저 105초.
- 레거시 분석: 기존 SDK 45초/시도, 서비스의 최대 2회 및 기존 전체 기한, Vercel 100초.

직전 Preview에서 Medium조차 5개 리본의 첫 생성이 70초를 초과했다. High는 더 많은 추론·완료 토큰과 지연을 사용할 수 있어 **동일 제한에서 시간 초과/출력 한도 소진 위험이 더 커질 수 있다**. High의 품질 향상·완료 성공·속도는 모킹으로 증명할 수 없다. 시간 문제를 해결했다고 보고하지 않는다.

[기존 단계별 설계](./interpretation-reliability-verification.md)의 job/stage별 결과 바인딩, 근거 검증, 중복 호출 방지, 예약/uncertain 정산은 모델의 reasoning effort와 독립적이다. 후속 구현에서는 공통 High 설정을 stage에 적용하고 per-stage 토큰·시간·전체 job 비용 상한을 다시 실측해야 한다. 현재 설계 문서의 Medium 실패 기록은 역사적 진단으로 보존했다. 이번 작업에서 job 저장/Worker/DB schema/단계별 호출 수를 활성화하거나 늘리지 않았다.

## 변경 파일 (이번 모델 설정 작업만)

소스 5개:

- `lib/server/ai-model-settings.ts` (신규)
- `lib/server/closing-message-service.ts`
- `app/api/closing-message/route.ts`
- `lib/server/analysis-service.ts`
- `lib/server/security/policy.ts`

테스트·검증 도구 13개:

- `tests/ai-model-settings.test.mjs` (신규)
- `tests/ai-usage-policy.test.mjs`
- `tests/analysis-service.test.mjs`
- `tests/aurora-deep-reading.test.mjs`
- `tests/aurora-interpretation.test.mjs`
- `tests/closing-input-budget.test.mjs`
- `tests/closing-message.test.mjs`
- `tests/interpretation-input-budget.test.mjs`
- `tests/interpretation-reliability.test.mjs` (기존 미커밋 파일의 Medium→High assertion 한 곳만 변경)
- `tests/model-budget-diagnostics.test.mjs`
- `tests/private-beta.test.mts`
- `tests/helpers/beta-reserve-worker.mts`
- `tests/helpers/verify-next-universe.mjs`

문서 1개: `docs/ai-model-settings-verification.md` (신규). 총 19개.

## 최종 검증

- `npx tsc --noEmit --incremental false`: exit 0.
- `npm run lint`: exit 0, 경고/오류 없음.
- 비DB 전체 **712개 통과** + 독립 임시 Docker PostgreSQL 보안 통합 **55개 통과** = **767개 통과**, 실패/skip 0. 직전 744개에서 모델 설정 신규 17개 + Q10 비용/이전 계약 차단 신규 6개를 추가했다.
- `npm run build`: 비밀값을 제외한 별도 임시 소스/독립 node_modules에서 **Next.js 16.4.2 Turbopack exit 0**, **37.04초**. compile 22.9초 + 내장 TypeScript 10.9초. timeout/OOM 없음. 가짜 loopback DB/실제 OpenAI 키 없음으로 빌드했고 프로젝트의 환경 파일을 주입하지 않았다.
- `git diff --check`: 통과. stage된 파일 없음, HEAD/브랜치 유지.
- 기존 미커밋 18개 항목 중 **17개 byte-for-byte 동일**. 나머지 `tests/interpretation-reliability.test.mjs`는 실제 route의 reasoning 기대값 한 곳만 Medium→High로 변경했음을 초기 사본과 대조했다. 기존 압축 provider/route/service/검증/timeout 및 인증 진단/ZIP 구현은 그대로다.
- Q10/문항별 분석의 기존 프롬프트와 Q10 strict JSON schema를 기준 HEAD와 대조하여 동일함을 확인했다. UI·렌더러·개인화·승인·입력 검증·요청 장부 소스는 수정하지 않았다.
- 기존 Secret 항목 재사용, Sol 가격 누락/잘못된 단가 fail-closed, 같은 모델의 기능별 입력 override 독립성, 120KB 경계, 이전 mini/180 계약 차단, 신규 예약액 경계 429, reasoning 이중 집계 방지, uncertain 예약 유지, 실 route 모듈의 Low/High SDK params 및 승인→오로라 연결을 모킹으로 검증했다.
- 독립 PostgreSQL은 loopback-only 임시 컨테이너로 생성하고 테스트 후 해당 컨테이너만 제거했다. 운영/Preview DB 조회·쓰기는 없었다. 테스트 환경에 실제 OpenAI 키는 없었으며 paid API 호출도 없었다.

실제 Next.js 브라우저/실모델 품질·시간 검증은 이번에 수행하지 않았다. 따라서 4,096토큰의 충분성, High의 깊이/응답 완료율, 실제 가격표/청구액, 모델 접근 권한은 별도 승인된 최소 실호출 확인이 필요하다.

로컬 ignored 검증 기록: `node_modules/.cache/ai-model-settings-verification/` (초기 해시/검사 결과), `node_modules/.cache/universe-reading/{unit-summary.json,security-summary.json}`, `node_modules/.cache/final-audio-verification/{build-turbopack-summary.json,build-turbopack.log}`. 이번에 commit/push/배포/환경변수/비용 기록 변경을 하지 않았다.
