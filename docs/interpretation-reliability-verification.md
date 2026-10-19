# 상황 기반 v2 심층 해석: 실제 실패 진단과 로컬 안정화

검토일: 2026-10-19 (KST). 기준 HEAD `411d1ad456909ec909fc0a3ef5a6ff095501d210`.
**로컬 변경만 적용. 커밋·푸시·배포·실제 OpenAI 호출·운영 DB 조회/변경·환경변수 변경 없음.**

## 1. 실제 Preview에서 확인된 사실

- 프로젝트 `wkdalsdleks-projects/my-mind-model-beta`.
- 배포 `dpl_HqDX4g75XpGPJmgsBuYVjJa1oUxB`, READY.
- `https://my-mind-model-beta-83b2jk5dn-wkdalsdleks-projects.vercel.app`.
- 배포 메타데이터의 커밋은 기준 HEAD와 일치했다.
- Vercel CLI의 읽기 전용 `logs runtime`으로 해당 배포의 `/api/aurora-interpretation` 로그를 조회했다. 처음 48시간/1시간 조회는 Hobby 보존 기간 제한으로 거부됐고, 최근 30분 조회에서 4건을 확인했다. 애플리케이션 URL이나 AI API를 호출하지 않았다.
- 로그 원문은 출력하거나 문서에 저장하지 않았다. 두 진단 prefix의 허용된 단계·고정 코드·숫자만 추출했다. `vercel curl` 및 보호 우회 토큰 생성 명령은 사용하지 않았다.

| 요청 시작 시각 KST | model 단계 진입까지 | attempt 1 경과 | timeout 설정 | 응답 단계 진입까지 | 결과 |
| --- | ---: | ---: | ---: | ---: | --- |
| 11:28:15 부근 | 188ms | 70,026ms | 70,000ms | 70,232ms | cancelled / attempt-timeout |
| 11:29:30 부근 | 34ms | 70,024ms | 70,000ms | 70,072ms | cancelled / attempt-timeout |
| 11:30:45 부근 | 41ms | 70,023ms | 70,000ms | 70,076ms | cancelled / attempt-timeout |
| 11:32:02 부근 | 31ms | 70,038ms | 70,000ms | 70,098ms | cancelled / attempt-timeout |

4건 모두 `expectedRibbons=5`, `attempt=1`, `finishReason=unknown`, 기록된 `providerStatus=408`이었다. `completionTokens`/`reasoningTokens`/`promptTokens`는 제공되지 않았다. 2번째 시도나 완성 응답의 검증 실패 기록은 없었다.

마지막 요청의 단계 시작 누적 시간은 authentication 0ms, origin/rate-limit 6ms, body 12ms, reservation 13ms, input 22ms, model 31ms, settlement 70,070ms, session-check 70,088ms, response 70,098ms였다. 단계 차이는 근사치이며 최종 HTTP 전송 완료 시간이나 순수 provider 실행 시간과 같지 않다. 기존 model 단계에는 재인증·attempt 장부 처리도 포함된다.

**확인된 직접 원인:** 첫 시도의 70초 제한에 도달하여 취소됐다. 인증·초기 예약·입력 준비 지연이 주원인이라는 증거는 없다. 첫 호출 timeout/cancel은 기존 정책대로 자동 재시도하지 않았다. 취소 시 work 예산은 약 14.8~14.9초만 남아 있었다.

**확정할 수 없는 것:** 모델 내부 추론/출력/큐 대기/최초 strict schema 준비 각각의 소요 시간, 실제 토큰 수, 제공자 측 원래 HTTP 오류 여부, 사용자가 본 요청과 4건 중 어느 한 건의 정확한 대응. 기존 `providerStatus`는 로컬 `SecurityError.status=408`도 읽었으므로 이것만으로 OpenAI가 HTTP 408을 반환했다고 단정할 수 없다. 미완성 응답이 도착하지 않아 JSON/근거 검증 성공 여부 자체를 알 수 없다.

브라우저는 HTTP 408을 `REQUEST_TIMEOUT`으로 표시한다. 따라서 JSON 본문의 `INTERPRETATION_FAILED`와 화면의 시간 초과 문구는 모순이 아니다.

## 2. 출력 증가와 70/85/95초 구조의 한계

실제 renderer 계약은 주 리본 2~4개 + 활성 보조 루프 0~2개다. 의미 계열 7종과 1:1 관계가 아니다. 한 리본마다 psychological/philosophical/currentMind/reportSummary의 **별도 심층 문단 4개**, 성찰 질문 1개를 생성한다. 전체 글은 overall + 리본 모음 + report 6종의 8부분 읽기 구성을 유지한다.

기존 프롬프트 권장 분량을 단순 합산하면 본문만 다음과 같다. 질문·인용 선정 이유·JSON·근거 참조 및 내부 추론 토큰은 별도다. 권장 분량을 낮추지 않았다.

| 활성 리본 | 본문 최소~최대 문자 수 (권장값 합계) |
| ---: | ---: |
| 2 | 3,070~5,800 |
| 3 | 3,730~7,050 |
| 4 | 4,390~8,300 |
| 5 | 5,050~9,550 |
| 6 | 5,710~10,800 |

문자/UTF-8 바이트를 실제 토큰 수나 초당 생성 속도로 환산하지 않는다. 출력 25,000토큰은 내부 추론과 보이는 출력이 공유한다. 구조화 출력은 형식 준수를 돕지만 응답 시간, 참조의 의미적 정확성, 비중복 깊이를 보장하지 않는다.

단일 호출이 70초를 넘으면 95초 HTTP 목표를 유지하면서 같은 전체 작업을 다시 시도할 시간은 없다. 입력을 줄이는 것만으로 안정적인 완료 시간을 보장할 수 없다. 출력 생성량이 지연의 큰 요인이므로 결정적 중복을 줄이되, 실제 지연 개선 폭은 승인 후 최소 실호출로 측정해야 한다.

공식 근거: [Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat). 공식 자료에서 이 정확한 모델명의 실제 속도·계정 가격·접근 권한을 검증하지 못했으므로 모델별 수치를 추정 사실로 제시하지 않는다.

## 3. 이번 로컬 변경

### 3.1 본문 깊이를 유지하는 provider 전용 압축 계약

`lib/server/aurora-interpretation-provider.ts`에서 v2에만 별도 strict schema `aurora_interpretation_compact_v2`를 사용한다. v1의 요청/응답은 기존 구현과 동일하다. Chat Completions, 모델 `gpt-6.1-sol`, reasoning `medium`, 최대 출력 25,000, 최대 2회, Q10 모델/출력/프롬프트는 유지한다.

- `selection:qN:index` 근거를 결정적 `e0`, `e1` lookup으로 전송한다. 원문·문항 의도/역할·분류 여부·의미 가중치·핵심 기여·반복 선택·실제 리본 구성·실제 색 출처·Q10 승인 문장·상황은 보존한다.
- questions에 실제 근거를 한 번 제공한다. 같은 근거를 다시 담은 familyTrace/unclassified/nonCoreContext, 내부 selection/keyword ID 등의 중복 사본을 제거한다. 핵심/맥락 의미를 재계산하거나 재분류하지 않는다.
- 정적인 곡률·미스트·형태 설명은 기존 결정적 renderer 설명을 그대로 사용한다. 모델에는 실제 색과 출처만 전달한다. AI가 물리 인과 설명을 생성하지 않는다.
- 문단은 `{t: 본문, e: 실제 사용한 근거 목록}`으로 생성한다. 반복되는 고정 basis/contextRefs/내부 ribbonId는 서버가 원래 계약으로 복원한다. **근거 목록과 본문을 서버가 만들어 채우지 않는다.**
- required 리본 키와 report 6종, 기존 길이 가이드, 모든 본문/질문은 유지한다. 문단 누락을 성공으로 처리하지 않는다.
- 복원 전에도 중복 JSON 키를 거부하고, 복원 후 기존 전체 검증기를 다시 사용한다. 허위 ref·중복 ref·Q3/Q7/Q8/Q9의 핵심 근거 전환·누락된 Q10·잘못된 인용·허구의 인용 키워드·타입/빈 본문을 계속 거부한다.
- 클라이언트 HTTP 결과 v2 계약과 기존 8부분 읽기 UI는 변경하지 않는다. 실제 문장이 같은 합성 fixture는 복원 결과 전체가 기존 결과와 일치한다.

### 3.2 의미 없는 유료 재시도 억제

- timeout, 취소, provider 실패, refusal, finish_reason 중단은 기존처럼 자동 재시도하지 않는다.
- 검증 실패만 최대 1회 재시도한다. v2는 필요한 시간을 `min(70초, max(20초, 첫 시도 경과 × 1.25))`로 판단한다. 60초 첫 생성 후 남은 25초에는 전체 생성을 다시 시키지 않는다. 이 값은 속도 보장이 아니라 낭비를 줄이는 보수적 휴리스틱이다.
- 재시도에는 allowlist의 고정 검증 코드만 전달한다. 잘못된 모델 출력·사용자 원문·예외 메시지를 피드백에 넣지 않는다.
- 예상하지 못한 로컬 parser 오류에는 새 유료 시도를 만들지 않는다.
- 최초 요청부터의 85초 work / 95초 HTTP / 10초 정산 여유, Vercel 100초 및 브라우저 105초는 유지한다.

### 3.3 다음 실호출을 정확히 진단

Preview 전용 로그에 고정 validationReason/retryDecision, outputCharacters/remainingWorkMs/requiredRetryMs를 추가한다. 기존 token 사용량·종료 사유 필드는 유지한다. `provider` 및 `model-accounting`, `validation` 단계 시작점을 분리하여 SDK 대기와 재인증/attempt 장부/검증을 구별한다. `providerStatus`는 실제 OpenAI APIError에서만 읽도록 하여 로컬 timeout의 408과 혼동하지 않게 한다. 로그 실패는 유료 재시도를 유발하지 않는다. 원문·응답 전문·키·스택·세션·헤더는 기록하지 않는다.

## 4. 합성 데이터 측정 (실제 AI 성능 측정 아님)

동일 선택/상황과 balanced 품질에서 전/후 전체 params의 `Buffer.byteLength(JSON.stringify(params), "utf8") + 4096` 및 같은 합성 본문의 JSON만 비교했다. 실제 사용자 원문/실응답을 측정하지 않았다.

| 모드 / 리본 | 입력 이전 → 이후 | 동일 본문의 출력 이전 → 이후 |
| --- | ---: | ---: |
| Independent / 4 | 38,136 → 26,075 bytes | 9,838 → 6,063 bytes |
| Hybrid / 5 | 41,631 → 27,462 bytes | 11,353 → 7,007 bytes |
| Loop Emphasis / 6 | 45,111 → 28,846 bytes | 12,800 → 7,931 bytes |

5개 리본에서 입력 약 34%, 모의 출력 약 38% 감소. 출력의 한글 본문은 동일하며 고정 JSON overhead와 ref 반복이 줄어든 수치다. 실제 심층 본문은 fixture보다 길 수 있어 전체 출력 절감 비율은 더 작을 수 있다. 이 숫자로 응답 시간이 34~38% 빨라진다고 주장하지 않는다.

## 5. 품질을 유지하는 운영용 단계별 생성 설계 (아직 활성화하지 않음)

**중요:** 이번 압축은 단일 요청의 비용·검증 낭비를 줄이는 로컬 개선이다. 실제 70초 내 완료를 보증하는 운영 아키텍처가 완성됐다는 뜻이 아니다. 계속 70초에 걸리면 시간 제한만 늘리는 대신 아래 내구성 있는 job/stage 계약을 구현·검증하는 것을 권장한다. 기존 DB에는 결과/job 저장 테이블이 없고 Preview DB 연결 대상도 미확인이다. 이번에 임의의 새 저장/Worker/환경 설정을 적용하지 않았다.

### 생성 단위와 결과 연결

1. 인증된 시작 요청이 사용자 ID + 정확한 입력 digest + Q10 승인 + 상황 + 실제 ribbonIds + 품질/flow + prompt/schema/catalog/model 버전으로 고정 job을 만든다. 사용자 ID는 서버 세션에서만 얻는다.
2. **각 실제 리본별 stage**는 psychological/philosophical/currentMind/reportSummary와 질문을 생성한다. 전체 실제 근거를 공유하되 핵심 refs 범위는 해당 리본으로 제한한다. 리본 색/조형은 재생성하지 않는다.
3. **synthesis stage**는 검증된 모든 리본 요약과 실제 Q1~Q10/상황으로 overall, report 6종, Q10 기반 철학 인용 선정을 생성한다. 같은 문단을 단순 복사하지 않고 현재 깊이를 유지한다.
4. 전 stage가 완성되고 전체 refs/인용/ID/8부분 검증을 통과한 결과만 완성으로 게시한다. 미완성 결과를 빈 글이나 가짜 글로 채우지 않는다. UI는 승인 문장·3D를 보존한 채 진행/재개 상태만 보여줄 수 있다.
5. 한 stage가 다시 70초를 넘으면 그 stage 자체의 내용/토큰을 실측하고 필요 시 심리·철학/현재 마음을 더 분리한다. 단계 분리만으로 각 호출의 지연을 보장하지 않는다.

### 내구성·중복·취소·부분 실패

- DB의 unique `(user_id, input_digest, generation_version)`과 `(job_id, stage_key)`로 이중 시작 및 동일 리본 재호출을 차단한다. 단순 브라우저 상태나 기존 60초 duplicate window만으로 보장하지 않는다.
- 인증된 worker가 트랜잭션으로 stage를 claim하고 fencing token/lease를 발급받는다. 유료 호출 시작을 장부에 기록한 뒤 실행한다. 응답 이후에도 계속 돌 것이라 가정하는 fire-and-forget이나 오직 브라우저 연결에 의존하는 실행은 사용하지 않는다.
- polling은 모델을 호출하거나 별도 생성 횟수를 소비하지 않는다. 서버 worker 호출도 인증·속도·동시 실행 제한을 통과한다. 소유자 외 조회/재개는 거부한다.
- 성공 stage의 검증된 결과는 재사용한다. 재접속/탭 변경/부분 실패로 이미 성공한 리본을 다시 생성하지 않는다. 입력·승인·상황 변경은 다른 job이며 결과 혼합을 거부한다.
- 불명확한 provider timeout/취소/worker lease 만료는 uncertain으로 남기고 자동 재생성하지 않는다. provider의 실제 idempotency 보장 없이 정확히 한 번 실행된다고 주장하지 않는다. 이미 시작된 호출의 비용 위험은 보존하고 명시적 재시도 시 추가 예약을 확인한다.
- 재인증 및 활성 계정 확인을 유료 stage 직전마다 수행한다. 취소 후 새 stage claim을 차단한다. 실행 중 stage는 취소하고 불명확 비용을 유지한다.
- 고유한 암호화 키, 인증된 암호화(AEAD), 소유권 검사, 짧은 TTL/삭제 정책이 필요한 새로운 개인정보 저장 변경이다. 현재의 서버 원문 비저장 정책에서 달라지는 점을 검토·승인받아야 한다. 원문/결과를 DB나 브라우저 공개 토큰에 평문 보관하지 않는다.

### 예산·횟수 및 비용 장부

- 여러 stage를 현재 `ModelPermit`의 2회 한도에 몰래 끼워 넣지 않는다. 별도 job/stage 장부와 명시적 호출 상한이 필요하다. 기능별 일간 횟수는 논리적 생성 job 1회, 실제 provider 호출/비용은 모든 stage/재시도마다 별도로 집계한다.
- 예: 리본 R개 + synthesis 1개 + **job 전체에서 추가 교정 최대 1회**이면 호출 상한 R+2다. 이는 현재 최대 2회 정책을 변경하는 것이므로 이번에 활성화하지 않았다. stage마다 무조건 2회를 허용하지 않는다.
- 시작 시 전체 job의 엄격한 최대 비용을 계산하여 사용자 월·전역 일/월 USD, 일/월 횟수, 동시 실행 한도 내에서 원자적으로 예약한다. 단가/상한 누락·DB 장애·예산 부족은 호출 전에 fail-closed한다. 각 stage별 할당액을 같은 총 예약에서 소비하고 별도의 신규 예약과 이중 집계하지 않는다.
- 모든 reported 사용량은 stage/attempt별 입력·출력 상한에 맞춰 검증하고 실제 가격으로 정산한다. uncertain attempt는 그 attempt에 예약한 최악 금액을 유지한다. 실행되지 않았음이 입증된 stage의 미사용 예약과 이미 실행된 uncertain 비용을 혼동하지 않는다. 기존 실패 비용 기록을 수정/삭제/0원 처리하지 않는다.
- 기존 request/attempt 테이블/정산은 그대로 유지한다. job별 정산 방식 변경은 신규 테이블·마이그레이션·경쟁/취소/재개 테스트가 동반되어야 한다. 운영 DB 미확인 상태에서 실행하지 않는다.

### 예상 시간과 비용의 정직한 범위

현재 로컬 참조 단가(실제 Secret 단가/현재 청구액 아님): input $2/M, cached input $0.10/M, output $10/M. completion에는 reasoning이 포함되므로 두 번 더하지 않는다.

- 현행 120,000 입력 유효 상한 + 25,000 출력 × 최대 2회 예약은 **$0.98**다. 이번 수정으로 상한을 올리지 않았다. 1회 최대 $0.49. 실제 가격표가 다르면 서버 예약도 다르다.
- 실제 사용량 P, cached C, completion O를 받은 경우 비용은 `((P-C)*2 + C*0.10 + O*10)/1e6`. 예를 들어 합성 사용량 P=5,000/O=10,000/C=0이면 $0.11/회다. 실제 실패의 사용량은 없어 실제 청구액은 산출할 수 없다.
- 현재 정책은 1회만 시작했더라도 사용량 불명확 시 요청 전체 예약액을 유지한다. 이번 코드도 그대로 유지한다. 값싼 완료/미실행으로 임의 환불하지 않는다.
- 위 단계별 설계에 각 호출 기존 최악 상한 $0.49를 그대로 허용하면 R=5의 최대 7회 **$3.43**, R=6의 최대 8회 **$3.92** 예약이 필요하다. 이는 더 높은 상한이므로 별도 승인/실측/정책 검토 대상이다. 실제 입력과 stage별 출력 cap으로 줄일 수 있으나 reasoning 공간을 검증 없이 축소하지 않는다.
- 총 job 입력/출력 누적 한도를 현재 2회 예산(입력 240,000 + 출력 50,000토큰의 최악값)에 묶는 대안도 있다. 같은 비용 상한을 유지할 수 있지만 여러 medium 추론이 이 한도 내에 완성되는지는 아직 검증하지 않았다. 부족하면 안전하게 중단해야 하며 품질 유지 완료를 약속할 수 없다.
- 단계별 처리 시간은 실제 측정 전 미정이다. 가정상 6개 stage가 각각 35~60초라면 직렬 210~360초, 안전한 2개 병렬이면 대략 105~180초 + 정산/큐 지연이다. 이 수치는 계획 가정이며 모델 성능 측정 결과가 아니다. 현재 전역 동시 실행 제한/계정 권한을 무단 확대하지 않는다.

GPT-6.1 Sol Medium을 유지했다. reasoning을 낮추거나 모델을 바꾸면 철학적 일관성/근거 검증 성공률을 같은 fixture 평가로 비교해야 하며, 이번에는 속도·가격·품질 차이를 추정하여 변경하지 않았다.

## 6. 로컬 검증

최종 실행 결과:

- `npx tsc --noEmit --incremental false`: 통과.
- `npm run lint`: 통과. 마지막 추가한 테스트 파일도 별도 ESLint 확인.
- 비DB 전체 **689개 통과**, 독립 임시 Docker PostgreSQL 보안 통합 **55개 통과**, 합계 **744개**. 기존 727개 + 신규 17개(새 파일 14개, timeout 사례 3개).
- `npm run build`: 비밀 환경값을 제외하고 별도 임시 소스/독립 node_modules 복사본에서 **Next.js 16.4.2 Turbopack exit 0**, 약 **90.15초**, 시간 초과/OOM 없음. DB는 접속 불가능한 localhost 가짜 주소, 실제 OpenAI 키는 비운 상태로 검증했다. 로그의 compile 63초, 내장 TypeScript 24.9초를 확인했다. 기존 작업 트리의 환경 파일은 읽어 주입하지 않았다.
- `git diff --check`: 통과. 기존 무관한 8개 항목(ZIP 포함)은 시작 시 SHA-256과 일치. HEAD/브랜치 변경과 staging 없음.
- 새 wire의 본문·근거·최종 공개 결과 전체 일치, v1 계약 보존, 사용자 정의 원문/미분류, 허위/중복 ref와 JSON 키/누락/인용/문항 역할 거부를 검증했다.
- 실제 route 모듈 + 모의 SDK가 같은 permit 경로로 strict compact v2를 보내고 기존 HTTP 결과 계약을 반환하는 것을 검증했다. 실제 Next.js HTTP 서버/브라우저 및 실제 모델 생성은 이번에 실행하지 않았다.
- 가상 시간으로 deep 70초 취소/추가 호출 차단/불명확 비용 유지, 60초 invalid 후 부족한 25초 재시도 생략, 10초 invalid 후 정상 두 번째 완료, SDK timeout/provider 오류/로컬 408 구분을 검증했다. 기존 인증 지연/취소/late 응답/정산 지연/예산·횟수·원자성 테스트도 유지했다.
- 모든 DB 검증은 새 loopback-only 임시 PostgreSQL에서 수행한 후 해당 컨테이너만 제거했다. 운영/Preview DB 조회·쓰기는 없었다.

기록(ignored 로컬 산출물): `node_modules/.cache/interpretation-reliability/{preview-diagnostics.json,before.json,after.json,new-tests.log,typescript.log,lint.log}`, `node_modules/.cache/universe-reading/{unit-summary.json,security-summary.json}`, `node_modules/.cache/final-audio-verification/{build-turbopack-summary.json,build-turbopack.log}`. 실제 요청은 allowlist로 정제된 단계/코드/수치만 저장했고 실제 답변·AI 본문·키는 저장하지 않았다.

## 7. 승인 후 Beta Preview 재검증 절차

1. 이번 변경 파일만 검토/커밋/배포하는 별도 승인을 받는다. 현재 커밋·배포는 하지 않는다. 기존 미커밋 인증 진단 8개 파일/ZIP은 포함하지 않는다.
2. 기존 프로젝트/Preview/보호 상태·고정 alias·배포 SHA를 읽기 전용으로 확인한다. Production·Secrets·가격·예산·입력 120KB·시간 제한을 바꾸지 않는다.
3. **실사용 전 Preview DATABASE_URL의 실제 Neon branch/endpoint를 관리자가 확인**한다. Production일 가능성을 무시하지 않는다. 이 작업에서 운영 DB를 조회하지 않았다.
4. 사용자가 승인한 실제 생성 1건만 실행한다. 5~6개 리본/같은 입력을 유지하고 requestId별 provider 진입, accounting, validation, attempt/retryDecision, finishReason, prompt/completion/reasoningTokens를 안전하게 기록한다. timeout이면 자동 반복 호출하지 않는다.
5. 원문/완성 본문을 운영 로그에 넣지 않고 사람이 화면에서 깊이·8부분·리본별 맥락·철학 인용을 평가한다. Q10 승인·답변 보존·실제 사용량/uncertain 정산을 확인한다.
6. 단일 최적화 후에도 70초 초과가 남으면 이를 실패로 기록하고, 위 내구성 있는 단계별 구조의 비용/개인정보 저장/worker 구성을 승인받아 구현한다. 이번 로컬 자동 테스트만으로 실모델 지연 또는 운영 안정화 완료를 승인하지 않는다.

## 변경 범위

- `app/api/aurora-interpretation/route.ts`
- `lib/aurora-interpretation-validation.ts`
- `lib/server/aurora-interpretation-provider.ts` (신규)
- `lib/server/aurora-interpretation-service.ts`
- `lib/server/interpretation-deadline.ts`
- `tests/interpretation-reliability.test.mjs` (신규)
- `tests/interpretation-timeout.test.mjs`
- `tests/helpers/aurora-universe-fixture.mjs`
- `tests/helpers/verify-journey-reading.mts`
- `docs/interpretation-reliability-verification.md` (신규)

UI·3D·개인화 계산·Q10·기존 분석 API·인증/사용량 장부 구현·환경 파일은 이번 작업에서 수정하지 않았다. 기존 미커밋 인증 진단 및 ZIP은 초기 SHA-256과 대조하여 보존한다.
