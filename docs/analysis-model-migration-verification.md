# 분석 API · GPT-6.1 Sol Medium 적용

작업일: 2026-10-14 UTC. 브랜치: `feat/glass-nebula-aurora`.
기준 체크포인트: `8e111c2273add33df9e8a17f7c3b9047c33b85e4`.
이 문서는 모델 변경 이후 설정을 기록합니다. 기존 분석 안정화 문서는 이전 체크포인트의 기록으로 보존합니다.

## 적용 범위와 호환성

`/api/analyze`의 Q1~Q10 분석만 `gpt-6.1-sol`, `reasoning_effort: "medium"`으로 변경했습니다. Q10 마지막 문장 생성은 기존 `gpt-4o-mini`와 설정을 그대로 사용합니다. 5-A, 결과 화면, 승인, 오로라 실험실과 시각 효과는 변경하지 않습니다.

[공식 모델 페이지](https://developers.openai.com/api/docs/models/gpt-6.1-sol)에서 도구 없는 Chat Completions, medium 추론 및 구조화 출력 지원을 확인했습니다. 현재 분석은 도구를 사용하지 않으므로 Chat Completions를 유지하고 SDK 버전도 바꾸지 않습니다. 설치된 SDK는 문자열 모델 ID, reasoning_effort, max_completion_tokens 및 기존 usage 상세 필드를 지원합니다.

[공식 GPT-6 마이그레이션 안내](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6.1-sol)에 따라 medium에서 지원되지 않는 기존 temperature를 제거했습니다. top_p, logprobs, top_logprobs는 보내지 않으며 tools/tool_choice, 구식 max_tokens도 추가하지 않습니다. 표준 처리 비용을 기준으로 진단하기 위해 service_tier를 default로 명시했습니다.

## 출력 예산과 완료 조건

max_completion_tokens를 8,000에서 **25,000**으로 조정했습니다. [Chat Completions 명세](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)의 이 제한은 내부 추론과 최종 JSON 출력이 공유합니다. [추론 가이드](https://developers.openai.com/api/docs/guides/reasoning)의 초기 추론/출력 공간 권고를 참고한 설정이며, 이 작업의 실측 최적값이나 10개 분석의 완료 보장은 아닙니다.

완료 조건은 계속 finish_reason=stop, refusal 없음, strict JSON의 q1~q10 전부 존재, 정확한 ID와 문자열 analysis/detailedAnalysis, 비어 있지 않은 내용입니다. length나 다른 중단 종료는 JSON 형태가 정상이더라도 502 ANALYSIS_RESPONSE_INVALID로 거부합니다. 추론만으로 예산을 소진하고 출력이 없는 경우도 거부하며 추가 자동 호출하지 않습니다.

정상 stop 후 구조 검증 실패만 최대 1회 추가 생성합니다. SDK 재시도는 0이며 모델/추론/토큰 상한은 두 시도에서 동일합니다. 400/404 모델·파라미터 오류, 제공자/네트워크 오류, refusal, 중단과 취소는 기존 오류 코드로 종료하며 대체 모델을 몰래 호출하지 않습니다. 클라이언트의 답변·승인 유지와 수동 재시도 경로는 그대로입니다.

SDK timeout 45초/시도, 서비스 기한 95초, route maxDuration 100초도 유지했습니다. medium 추론의 실제 지연은 미측정이므로 충분한 토큰 공간이 있더라도 시간 한도에 걸릴 수 있습니다. 실호출 검증 이후 토큰 사용량·시간 한도를 함께 평가해야 합니다.

## 토큰·비용·개인정보 진단

개발 환경의 `[analysis-server]` 로그에 고정 모델명, 추론 수준, 토큰 상한 및 시도별 promptTokens/completionTokens/totalTokens와 reasoningTokens, cachedPromptTokens를 추가했습니다. SDK usage의 completion_tokens_details.reasoning_tokens, prompt_tokens_details.cached_tokens를 사용합니다. usage가 없으면 숫자나 비용을 만들어내지 않습니다. token 수는 음수·소수·NaN·문자열을 제외합니다.

estimatedStandardCostUsd는 확인 가능한 입력/출력 토큰에서 계산합니다. 내부 추론은 completionTokens에 이미 포함되어 있으므로 다시 합산하지 않습니다. 입력/출력이 없거나 캐시 사용량이 잘못되면 비용을 출력하지 않습니다. 캐시 상세가 없을 때만 입력을 미캐시로 가정합니다.

[공식 모델 페이지의 표준 단문맥 요금](https://developers.openai.com/api/docs/models/gpt-6.1-sol)을 2026-10-14에 확인했습니다. 백만 토큰당 입력 $2, 캐시 입력 $0.10, 출력 $10입니다. 계산식은 `(미캐시 입력 × 2 + 캐시 입력 × 0.1 + 전체 출력 × 10) / 1,000,000`입니다.

- 입력 2,000·전체 출력 4,000(내부 추론 포함), 캐시 없음: **약 $0.044/시도**, 같은 규모 두 시도 약 $0.088.
- 시도당 출력 25,000 상한 비용: **$0.25**, 두 시도 출력 상한 비용 $0.50. 입력 비용은 별도입니다.
- 기존 gpt-4o-mini보다 토큰당 비용이 높습니다. 상한은 실제 소비량이 아닙니다.

이는 시도별 **토큰 기반 추정**으로 청구서가 아닙니다. 캐시 쓰기 추가 요금, 지역 처리 가산, 가격 변경 등은 포함하지 않습니다. 오류로 usage가 제공되지 않으면 발생 비용을 알 수 없으며 이를 0으로 표시하지 않습니다. 재시도가 있으면 각 시도의 비용을 합산해야 합니다. 입력 제한과 짧은 텍스트 전용 요청에 맞춰 단문맥 요금을 사용합니다.

허용된 숫자·고정 문자열만 기록하고 API 키, 답변 원문, 분석 전문, 내부 추론 내용, SDK 오류 전문은 기록하지 않습니다. 비용도 외부 메타데이터 값을 그대로 출력하지 않고 재계산합니다. production에서는 이 진단 로그를 출력하지 않으며 SDK logLevel off도 유지합니다.

## 검증 및 남은 위험

- `npx tsc --noEmit --incremental false`: 통과.
- `npm run lint`: 통과.
- 전체 자동 테스트 **251개 통과**(기존 245개 + 신규 6개), 실패·취소·건너뜀 없음. 분석 서버 38개, 카메라 15·오로라 데이터 34·에너지 11·품질 7·5-A 37·결과 연결 29·Q10 문장 생성 53·추천 19·질문 8개입니다.
- 모의 SDK로 실제 route의 모델/medium/25,000/default tier, 미지원 파라미터 부재, usage 상세 수집 및 조건부 두 시도의 설정 일치를 검사했습니다. 기존 strict 10개 검증·오류·재시도·승인 보존 테스트도 통과했습니다.
- 신규 회귀 검사는 추론 비용 중복 계산 방지, 캐시 사용량 반영, usage 누락·비정상 값, 추론 중 예산 소진/빈 출력 거부, 민감값 제외·운영 로그 억제, 실제 route의 단일 재생성을 확인합니다. 모델/요청 오류 400·404에도 대체 모델이나 자동 추가 호출을 하지 않는 검사도 보강했습니다.
- `git diff --check`: 통과. 신규 문서의 공백 검사도 통과.
- 기준 체크포인트와 비교하여 Q10 문장 생성·승인/질문 상태, 5-A, 결과 화면, 오로라 실험실에 diff가 없음을 확인했습니다. 기존 245개 테스트를 삭제하거나 비활성화하지 않았습니다.

변경 파일은 `lib/server/analysis-service.ts`, `app/api/analyze/route.ts`, `tests/analysis-service.test.mjs`, 이 문서의 4개입니다. 자동 테스트는 외부 제공자를 모킹했으며 브라우저에서 실제 분석 API를 호출하는 검사는 실행하지 않았습니다. 임시 테스트 로그는 `/tmp/analysis-model-*.tap`에 있으며 저장 대상이 아닙니다.

모델명·요청 설정·구조 계약은 공식 문서와 모의 SDK로 확인합니다. **실제 OpenAI 호출은 하지 않습니다.** 실제 계정의 모델 접근 권한, 제공자의 실제 strict 출력, 생성 문구/근거 충실도, 내부 추론 사용량, 지연과 청구 비용은 미검증입니다. 모델 접근 실패 시 기존 오류/재시도 UI를 유지하며 자동 다운그레이드하지 않습니다.

커밋·푸시·배포·브랜치 전환, 리본 탐색 UI 구현은 수행하지 않습니다. ZIP과 환경 파일은 보존합니다.
