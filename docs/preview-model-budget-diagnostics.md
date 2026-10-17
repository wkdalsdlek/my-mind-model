# Preview MODEL_BUDGET_MISMATCH 진단

## 확인된 차단 조건

`lib/server/security/usage.ts`의 `ModelPermit.run`은 세 조건 중 하나라도
일치하지 않으면 `fault`를 설정하고 `MODEL_BUDGET_MISMATCH`를 던진다.
OpenAI 호출과 `ai_attempt` 생성 전의 검사다.

| 로그의 mismatchTypes | 차단 조건 |
| --- | --- |
| MODEL_NAME_MISMATCH | 요청 `model`이 `featureModel(feature).model`과 다름 |
| MAX_OUTPUT_TOKENS_MISMATCH | 요청 `max_completion_tokens`가 정책의 출력 한도와 다름. 누락/null도 불일치 |
| INPUT_BYTES_EXCEEDED | `Buffer.byteLength(JSON.stringify(params), "utf8") + 4096 > price.maxInputTokens` |

동시에 발생한 조건은 모두 기록한다. 입력 크기가 상한과 정확히 같으면 허용한다.
입력 크기는 사용자 답변만의 크기가 아니다. 시스템 프롬프트, 메시지, 인용문
카탈로그, 리본 근거 및 출력 JSON Schema 등 실제 SDK 요청 파라미터 전체를
직렬화한 UTF-8 바이트 수에 4,096을 더한다. 이는 기존 정책의 보수적인 입력
토큰 상한 추정 방식이며 실제 토크나이저의 토큰 수와는 다르다.

현재 소스의 해석 API는 `gpt-6.1-sol`, `max_completion_tokens: 25000`을 사용하며
예산 정책의 모델명 및 출력 한도와 일치한다. Q10은 `gpt-4o-mini`, 180으로
별도 설정을 사용하므로 Q10 성공만으로 해석 요청의 입력 상한 통과를 보장하지 않는다.
해석 요청의 문자 수 검사 역시 전체 SDK 요청의 UTF-8 바이트 검사와 다르다.

현재 증상만으로 Secret에 저장된 실제 `maxInputTokens`나 실패 유형을 확정할 수
없다. 입력 크기 초과는 유력한 후보이나 실제 Preview 로그가 필요하다.
잘못된/누락된 단가 JSON은 보통 앞선 `budgetConfig`에서
`BUDGET_NOT_CONFIGURED`로 거절되므로 이 오류와 구분한다.

## 안전한 서버 로그

`VERCEL_ENV === "preview"`이고 위 검사에서 거절된 경우에만
`[private-beta-model-budget]` 태그로 `console.error`를 호출한다.
NODE_ENV만으로 활성화되지 않는다. 성공 요청, 로컬 및 Production에는
이 진단 로그를 남기지 않는다. 공개 디버그 API나 브라우저 오류 상세는 추가하지 않는다.

로그 필드:

- `stage: model.permit.validate`, `code: MODEL_BUDGET_MISMATCH`
- `feature`: closing / interpretation / analyze
- `mismatchTypes`: 위 표의 고정 식별값만 포함
- `expectedModel`: 서버 정책이 정한 모델 식별값
- `inputBytesWithOverhead`, `inputOverheadBytes: 4096`, `maxInputTokens`
- `expectedMaxCompletionTokens`, `requestedMaxCompletionTokens`

숫자는 0 이상의 안전한 정수만 기록하며 그 외 값은 null로 치환한다.
요청된 모델 문자열은 기록하지 않는다. 로거에는 원본 요청이나 Error 객체를
전달하지 않으며 답변·승인 문장·프롬프트·사용자/요청 ID·쿠키·토큰·키·DB URL·
환경 변수 JSON·스택을 출력하지 않는다. 로그 저장 실패도 원래의 차단을 유지한다.

별도 승인을 받아 Preview 배포한 후 Runtime Logs에서 이 태그와
`feature: interpretation`을 찾고 `mismatchTypes`를 확인한다.
`INPUT_BYTES_EXCEEDED`이면 `inputBytesWithOverhead`와 `maxInputTokens`를 비교한다.
바이트 기반 추정치이므로 이를 실제 토큰 사용량 또는 청구액으로 해석하지 않는다.
이 문서의 작성 과정에서는 클라우드 조회·배포·실제 OpenAI 호출을 하지 않았다.
원인 확인과 예산 검토 없이 환경 변수를 변경하거나 상한을 늘리지 않는다.

## 보존 및 검증

인증 재검증, Origin 검사, 예산 예약, 호출 횟수/동시 실행 제한, 사용량 정산,
제한된 재시도 및 실패 시 차단 정책은 유지한다. 기존 `protectAI`는 서비스가
예외를 일반 오류로 처리해도 `permit.fault`를 확인하므로 클라이언트에는 기존의
HTTP 503, `MODEL_BUDGET_MISMATCH`, 일반적인 오류 문구가 전달된다.
상한 초과는 공급자 호출 전에 차단되며 추가 유료 재시도를 하지 않는다.

회귀 테스트는 다음을 확인한다:

- 세 원인의 개별/동시 발생, 세 요청 기능 구분
- 한글·이모지·Schema를 포함한 UTF-8 측정과 정확한 경계값
- 잘못된/누락된 출력 설정, 민감 문자열 및 임의 식별값 제외
- Preview 외 로그 비활성화, 로그 저장 실패 시에도 요청 차단
- 세션 재검증 선행, 성공 요청의 기존 사용량 기록
- 실제 보호 래퍼의 오류 응답 유지 및 실패 정산 호출
- 실제 해석 API 루트 + 합성 승인 데이터 + 모의 SDK로 입력 상한 실패 재현
- 해석 모델/출력 상수와 예산 정책의 일치

실행 명령:

```sh
node --test-reporter=tap tests/model-budget-diagnostics.test.mjs
npx tsc --noEmit --incremental false
npm run lint
git diff --check
```

이번 검증 결과: 신규 회귀 24개 및 기존 비DB 테스트 454개, 총 478개 통과.
TypeScript, ESLint, 공백 검사 통과. 모든 `tests/*.test.mjs`를 각각
`node --test-reporter=tap`으로 실행해 실제 테스트 개수와 실패 여부를 집계했다.
DB 변경을 수반하는 opt-in 통합 테스트는 실행하지 않았다.
실제 Preview 설정 및 장애 요청의 측정값은 미확인이다.
기존 인증 진단 미커밋 작업과 환경 파일을 보존했으며 UI/3D 코드는 변경하지 않았다.
