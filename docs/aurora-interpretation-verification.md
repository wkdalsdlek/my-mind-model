# Phase 5-C-3A · 철학적 오로라 해석 데이터 및 서버 생성

기준: `feat/glass-nebula-aurora` / `551ec44050012d23b8a6f4466b9a553fa9c2f928`.
새 데이터 계약·계산 어댑터·독립 서버 서비스를 추가합니다. 기존 결과 UI·렌더러·의미 엔진은 변경하지 않습니다. 실제 유료 호출·커밋·푸시·배포는 하지 않습니다.

## 1. 기존 구조와 마이그레이션

기존 `POST /api/analyze`는 `{questions, answers}`를 받고, strict 필수 객체 q1~q10의 각 `questionId`, `analysis`, `detailedAnalysis`를 검증해 정확히 10개 `comments`로 변환합니다. 모델은 `gpt-6.1-sol`, 추론은 medium, max_completion_tokens는 25,000입니다. 완성된 출력의 검증 실패에만 최대 1회 재시도합니다.

기존 결과 화면의 두 분석 패널·요청 컨트롤러와 `buildAuroraRibbonMeaningFromResult`는 이 계약을 사용합니다. **기존 API/프롬프트/소비 코드는 수정하지 않았습니다.** 새 `POST /api/aurora-interpretation`은 독립적인 `{interpretation}` 계약이며 현재 UI에서 호출하지 않습니다. 새 서비스는 문항별 AI 분석 없이 실제 선택만으로 종합·리본 해석을 한 번에 생성합니다.

5-C-3B에서는 최종 생성 요청을 새 서비스로 원자적으로 교체하고 이전 API는 기존 클라이언트용으로 유지할 수 있습니다. 기본적으로 두 API를 연달아 호출하면 비용·지연이 증가하므로 피해야 합니다. 기존 분석 버튼·패널을 제거하거나 새 UI를 구현하지 않았습니다.

## 2. 요청·승인과 결정적 사실

`buildAuroraInterpretationRequest(state, quality, flowMode)`는 기존 승인·완료 상태를 확인하고 기존 `ClosingMessageInput`, 승인 기록과 렌더링 옵션만 복제합니다. 클라이언트의 appearance/weights/프롬프트/모델/인용문은 받지 않습니다.

`prepareAuroraInterpretation(request)`는 다음 순서로 처리합니다.

1. 기존 Closing 입력 한도, 문항별 상태·역할·선택 ID를 검증합니다. preset ID·label·원문을 고정 목록과 대조하고 사용자 표현의 공백은 보존합니다.
2. 선택을 기존 캡슐 타입으로 복원하고 Q10 승인 fingerprint를 기존 방식으로 확인합니다. fingerprint는 일관성 검사이며 서버 서명·인증 또는 실제 승인 클릭의 증명이 아닙니다.
3. 변경하지 않은 `prepareAuroraResult`, 5-A 및 5-C-1 계산을 재사용합니다. 반복 선택·문항 가중치·미분류·중립 fallback 규칙을 유지합니다.
4. Q1·Q2·Q4·Q5·Q6만 핵심 리본 근거로 연결합니다. Q3 현재 분위기, Q7 바라는 감정, Q8 내려놓음, Q9 미래 방향, Q10 승인 문장은 별도 역할입니다. 사용자 정의 표현은 기존 정확 일치 규칙 이외에는 미분류로 남습니다.
5. 실제 활성 리본만 사용합니다. 메인 2~4개 + 모드별 루프 0~2개 = **2~6개**이며 미스트는 별도 의미 리본이 아닙니다.
6. 정확한 원문·승인 문장·옵션·버전을 SHA-256 `requestDigest`로 묶습니다. 원문을 포함하는 기존 lossless fingerprint는 모델/진단에 보내지 않습니다. digest도 로그에 남기지 않습니다.

`facts.origin = deterministic-engines`에는 문항별 실제 선택과 원문, 서버 발급 evidence ref, semanticWeights/coreContributions, coreShares·family trace·반복, 실제 리본 ID·이름·composition·팔레트 출처·layers/renderKey·geometry·identityProfile·에너지가 담깁니다. 입력과 계산 결과는 변형하지 않습니다.

## 3. 새로운 해석 계약

```text
version / binding(requestDigest, quality, flowMode, catalogVersion)
approvedClosing(text, source)       ← 기존 승인값
facts                              ← 서버의 결정적 사실
generated.origin = ai-interpretation
  auroraName                       ← Q10과 별도, 승인 문장을 덮어쓰지 않음
  philosophy(line, reason[], q10Anchor)
  overall(text, evidenceRefs, basis, origin)
  ribbons[]
    ribbonId
    psychological(text, evidenceRefs, basis, origin)
    philosophical(text, evidenceRefs, basis, origin)
    reflectionQuestion
```

AI는 해석·이름·질문과 quote ID/선정 이유만 생성합니다. 키워드·색·비중·시각 효과를 재구성하지 않습니다. 실제 문구·저자·출처·리본 사실은 서버가 결합합니다.

- 전체 해석은 Q10 및 실제 선택이 있는 각 문항을 참조합니다. 리본 해석은 해당 리본에 연결된 evidence ref만 허용합니다. 다른 리본의 실제 선택도 허용되지 않습니다.
- 복합 의미와 비중을 그대로 제공하고 비슷한 리본을 억지로 정반대 성격으로 만들지 않도록 지시합니다.
- 핵심 근거 없는 리본은 AI 심리 해석을 사용하지 않습니다. `deterministic-insufficient-evidence` 출처의 근거 부족 안내·열린 질문을 반환합니다. 존재하지 않는 분석을 채우는 것이 아닙니다.
- AI가 새 키워드/색/출처 필드를 추가하면 거부하며, 인용 형식의 키워드는 실제 label/원문과 대조합니다. **자연어의 모든 암묵적 주장·의미적 타당성을 증명하는 검증기는 아닙니다.** 출처 참조가 문장 전체의 진실성을 보장하지 않으므로 실제 출력 검토가 필요합니다.

## 4. 철학자 후보·번역·이용 범위

검토일 2026-10-15. 2명·3개의 작은 초기 후보군이며 다양한 철학 전통을 대표하지 않습니다.

| 안정 ID | 출처 | 관점 |
|---|---|---|
| seneca-letters-1-1-self | 세네카 도덕 서한 1.1 | 자신의 시간과 주체성 |
| seneca-letters-1-3-present | 세네카 도덕 서한 1.3 | 현재와 미루는 삶 |
| cicero-duties-1-22-together | 키케로 의무론 1.22 | 함께 삶과 상호 도움 |

[세네카 제1권 원문](https://www.thelatinlibrary.com/sen/seneca.ep1.shtml)과 [키케로 제1권 원문](https://www.thelatinlibrary.com/cicero/off1.shtml)에서 구절·장절·문맥을 확인했습니다. 키케로 문구는 **그가 플라톤을 인용하며 전하는 문맥**입니다. `source.attributionNote`를 유지하고 5-C-3B에서 표시해야 합니다. 플라톤 원전의 직접 인용을 별도로 검증한 것은 아닙니다.

[원문 사이트 설명](https://www.thelatinlibrary.com/about.html)은 public-domain 확인 노력과 판본·오류의 한계를 명시합니다. 고대 원저작의 짧은 구절과 프로젝트에서 작성한 한국어 번역만 사용했습니다. HTML·편집물·주석·현대 출판 번역문을 복제하지 않았으며 모든 국가·번역물에 대한 포괄적 이용 허락을 주장하지 않습니다. 짧은 번역의 충실성을 검토했지만 전문 고전학자의 검수는 미실시입니다.

각 후보에는 저자·원문·언어·장절·링크·번역 출처·검토 상태·이용 가능 여부·문맥 주의사항이 있습니다. AI는 `quoteId`만 선택하고 서버는 고정 catalog를 읽습니다. 그럴듯한 저자나 HTTPS 주소만으로 검증됐다고 취급하지 않으며, 변조된 저자·원문·번역·출처와 알 수 없는 ID를 거부합니다.

선정 이유는 승인 문장의 구체적인 연속 부분 문자열 `q10Anchor`를 포함한 1~2개 짧은 문장입니다. 이 검사는 표현상 연결이지 철학적 적합성의 증명은 아닙니다. 적절한 후보가 없으면 `none` → HTTP 422 `QUOTE_CANDIDATES_INSUFFICIENT`로 종료합니다. 인용을 지어내거나 추가 요청으로 억지 선정하지 않습니다. 더 다양한 검증 후보 확보가 필요합니다.

`inspired` 계약과 `prepareInspiredPhilosophyDraft`는 대체 방식용 초안입니다. `quoteId: null`, `isHistoricalQuotation: false`, 사상에서 영감을 받은 문장이라는 attribution·검증된 사상 출처·fallback 이유를 강제합니다. 현재 `requires-review`, `usable: false`이며 서비스 성공 응답에 자동 사용하지 않습니다. 창작 문장을 실존 철학자의 직접 인용으로 노출하지 않습니다.

## 5. 실제 시각적 반영 근거

`facts.ribbons[].layers`는 실제 active slot의 renderKey·색상 쌍·geometry 목표값·identityProfile과 일치합니다. `visualExplanation`은 기존 globalMotion/coreShares와 원래 energy seed/3개 lane을 보존합니다. `visualExplanationText.origin = deterministic-code`의 semantic/artistic/limitations 설명은 코드가 작성합니다.

- 의미 기반: 답변에서 유래한 팔레트 출처, 의미 혼합, 전체 coreShares로 혼합한 공통 움직임.
- 조형 기반: 개별 폭·곡률·깊이·꼬임, seed/lane, 광맥·림·미스트 차이. 성격의 과학적 지표가 아닙니다.
- 팔레트 비중은 픽셀 면적이 아니며 파라미터는 easing 후 목표값입니다. 실측 물리 속도나 특정 프레임의 면적을 주장하지 않습니다.
- 기존 Q3/Q7/Q8/Q9 별도 효과는 현재 렌더러에서 직접 소비되지 않아 `rendererApplied: false`로 명시합니다. 이미 화면에 적용됐다는 AI 설명을 만들지 않습니다.

## 6. 구조화 출력·검증과 오류

[OpenAI Structured Outputs 공식 문서](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)를 확인했습니다. 모든 객체는 required 전체 키와 `additionalProperties: false`이며 기본 타입·array/items·enum만 사용합니다. 활성 ID는 런타임의 필수 객체 키입니다. 개수·중복·문자열 길이·참조 검증은 서버가 담당합니다.

- 잘못된 JSON, raw 중복 키(escape alias 포함), 필드 누락/추가/빈 값/잘못된 타입, 누락·중복·예상 밖 ribbon ID를 거부합니다.
- 허용되지 않은 근거, 새 사실 필드, 잘못된 quote ID/anchor, 과도한 이유와 일부 확정적 심리 표현을 차단합니다.
- `finish_reason != stop` 또는 refusal은 부분 성공으로 보내지 않습니다. 출력 중단을 단순 토큰 부족이라고 단정하지 않습니다.
- 입력 오류 400/415, 입력 한도 413, 승인 불일치 409, 키 누락 503, 후보 부족 422, provider/network/출력 오류 502, rate limit 429, 취소·시간 초과 408을 구분합니다. 오류 body는 고정 코드·안내·retryable뿐입니다.
- 완성된 출력의 검증 실패에만 최대 1회 추가 요청합니다. length/filter/refusal, provider/network, 취소, 후보 부족에는 자동 재시도하지 않습니다. SDK 재시도는 꺼져 있습니다.
- stream body 512KiB, 모델 입력 JSON 100,000자, 응답 JSON 80,000자 및 기존 Closing 한도를 적용합니다. 입력 초과는 모델 요청 전에 거부합니다.
- 개발 진단은 고정 outcome/finish reason·모델·추론·시도·리본 수·토큰·숫자 provider status·추정 비용만 기록합니다. 원문·분석 전문·키·비밀번호·fingerprint/digest·SDK 오류 메시지는 기록하지 않습니다.

## 7. 호출 수·비용·시간 예산

[모델 공식 문서](https://developers.openai.com/api/docs/models/gpt-6.1-sol)에서 Chat Completions(도구 제외), medium과 구조화 출력 지원을 확인했습니다. 기존 API 방식을 유지하며 temperature/top_p/logprobs/max_tokens를 추가하지 않습니다.

- 지금 UI는 기존 analyze만 사용하므로 새 해석 요청은 **0회**입니다. 새 endpoint를 사용할 때 전체·모든 활성 리본·인용 선정을 보통 1회, 검증 재시도 시 최대 2회에 생성합니다. 클릭 요청은 없습니다.
- 기존 **45초/시도, 95초 전체, route 100초, max_completion_tokens 25,000**을 유지합니다. 내부 추론과 보이는 JSON이 같은 토큰 한도를 나눠 쓰며 무조건 제한을 높이지 않았습니다. 실제 지연·완성률은 미검증입니다.
- 2~6개 리본의 두 해석·질문, 종합문·근거 참조는 상당한 토큰을 쓸 수 있습니다. 항상 더 저렴하다고 주장하지 않습니다. 이전 10개 분석까지 계속 생성하지 않도록 5-C-3B에서 요청을 전환해야 합니다.
- 기존 비용 함수를 재사용합니다. Standard 짧은 문맥 기준 input $2/cached input $0.10/output $10 per 1M입니다. 예시 prompt 4,000 + completion 6,000은 **$0.068**, 동일한 두 시도는 **$0.136**입니다. output 25,000 상한 부분만 시도당 $0.25, 두 시도 $0.50이고 **입력 비용은 별도**입니다. 실제 측정값이 아니며 사용량·가격 조건에 따라 달라집니다. reasoning은 completion에 포함되므로 중복 과금 계산하지 않습니다.
- 성공한 전체 응답을 snapshot에 저장해 재사용할 계약을 준비했습니다. 영구 사용자 캐시·분산 중복 방지·새 UI 잠금은 추가하지 않았으며 별개 POST는 각각 생성 요청입니다.

## 8. 5-C-3B 연결 지점

1. 최종 승인 상태와 현재 quality/flowMode로 `buildAuroraInterpretationRequest`를 호출하고 새 endpoint에 한 번 POST합니다.
2. `interpretation`을 결과 snapshot에 저장합니다. UI 경계에서 버전/형식과 현재 requestDigest, 취소·늦은 응답·중복 요청을 검증해야 합니다.
3. 표제는 `approvedClosing.text`로 유지합니다. 새 auroraName/인용이 Q10 승인을 덮어쓰지 않습니다.
4. 기존 ribbonId로 facts와 generated.ribbons를 조회합니다. evidenceRefs로 실제 원문·문항 역할을 표시하고 문항 전체 분석을 리본 전용 해석으로 바꾸지 않습니다.
5. 인용의 source/translation/attributionNote·inspired 여부와 사실/AI 출처를 표시합니다. 사용 불가 inspired 초안을 노출하지 않습니다.
6. 답변·승인·옵션·버전 변경 시 stale binding을 그대로 재사용하지 않습니다. 품질/활성 리본 변경도 사실과 연결을 재검토하며 클릭마다 생성하지 않습니다.

UI·snapshot 저장·분석 패널 전환은 미구현입니다. 기존 `/api/analyze`, Q10 승인, 결과 UI, Canvas/Scene, 의미 엔진과 `/aurora-lab`을 보존했습니다.

## 9. 테스트와 남는 한계

신규 테스트는 DI 모킹으로 실제 유료 호출을 대체합니다. 모델 계정 접근·실제 응답 품질·철학적 적합성·리본 간 문장 차별화·실제 지연/토큰은 미검증입니다. 전문 심리 평가나 고전 번역 인증을 제공하는 시스템이 아닙니다. 코드가 검증하는 사실과 AI 자연어의 해석 가능성을 구분해야 합니다.

```sh
npx tsc --noEmit --incremental false
npm run lint
for test_file in tests/*.test.mjs; do
  node --test-reporter=tap "$test_file" || exit 1
done
git diff --check
```

최종 결과:

- TypeScript: 통과.
- ESLint: 통과, 경고 없음. 신규 테스트의 미사용 import와 Next가 예약한 변수 이름을 정리한 후 재검사했습니다.
- 전체 **395개 통과** = 기존 338개 + 신규 57개. 14개 테스트 파일을 개별 TAP 실행했습니다. 린트 정리 후 신규 57개도 다시 통과했습니다.
- 신규 검증 범위: 결정성·원문/계산 불변성, 실제 리본 수 2~6개와 렌더러 일치, 복합/중립/미분류/정확 일치 custom, 문항 역할과 Q10 fingerprint, 인용 출처 변조·direct/inspired 구분, 스키마·ID·참조·필수값·중복 키·잘못된 JSON, 재시도 성공/최종 실패, 중단/거절/provider/network/취소/시간 예산, stream/model 한도, 로그·비용, 기존 API와 새 SDK 어댑터를 모킹으로 검사했습니다.
- `git diff --check` 및 신규 파일 공백 검사: 통과.
- 기존 tracked 파일 변경 없음. 새 파일 7개만 추가했으며 ZIP은 원래의 미추적 상태입니다. 환경 파일·package/lockfile·기존 브랜치 참조·Git index는 변경하지 않았습니다.
- 실제 OpenAI 호출 **0회**. UI/렌더러 변경이 없어 이번 단계의 새 브라우저/WebGL 검증은 수행하지 않았습니다. 기존 시각적 한계와 실제 GPU 장시간 성능 미검증 상태는 그대로입니다.

## 10. 추가 파일

- `lib/aurora-interpretation-types.ts`: 요청·사실·AI·리본별 계약.
- `lib/aurora-interpretation.ts`: 승인 검증과 기존 엔진의 순수 어댑터.
- `lib/philosophy-quotes.ts`: 검증 catalog와 direct/inspired 초안 계약.
- `lib/server/aurora-interpretation-service.ts`: strict schema·프롬프트·검증·오류·재시도·진단.
- `app/api/aurora-interpretation/route.ts`: 동일 모델/medium Chat Completions 연결.
- `tests/aurora-interpretation.test.mjs`: 신규 단위·모킹 통합·레거시 회귀 검증.
- `docs/aurora-interpretation-verification.md`: 설계·출처·비용·검증 기록.
