# 오로라 심층 해석 160/190/210/225/240초 검증

2026-10-19 KST. 브랜치 `feat/glass-nebula-aurora`, HEAD `411d1ad456909ec909fc0a3ef5a6ff095501d210`.
기존 미커밋 모델 설정/압축 최적화/인증 진단 작업을 보존한 로컬 후속 변경이다. 이전 검증 문서의 70/85/95/105/100초는 당시 설정의 기록이며 현재 로컬 설정은 이 문서로 대체한다.

## 적용 범위와 시간 배분

오직 `/api/aurora-interpretation`의 요청/브라우저 시간 제한을 변경했다.

| 경계 | 새 값 | 계산 시작 / 역할 |
| --- | ---: | --- |
| 모델 시도 상한 | 160,000ms | 요청 진입부터 남은 시간을 차감한 개별 시도 상한 |
| AI 작업 | 190,000ms | 서버 진입부터 인증·입력 준비·모델·attempt 장부·검증 포함 |
| 서버 전체 응답 목표 | 210,000ms | 위 작업 + 최종 요청 정산·세션 재확인·응답 |
| 브라우저 | 225,000ms | 로컬 입력 준비 시작부터 fetch/JSON 검증/전환 포함 |
| Vercel 함수 | 240초 | route의 정적 `export const maxDuration = 240` |

`lib/aurora-interpretation-timing.ts`는 서버 의존성이 없는 공통 계약이다. 브라우저에서 server/security 모듈을 import하지 않는다. Next.js가 정적으로 읽도록 route maxDuration은 리터럴을 유지하며 실제 route export를 테스트한다.

안전 여유:

- AI 작업 190초 안에서 **20초를 attempt 사용량 DB 기록·응답 검증 여유**로 남긴다. 실제 모델 허용량은 `min(160초, 190초 - 요청 경과 - 20초)`다. 인증이나 예약이 오래 걸리면 모델 한도가 짧아진다.
- 모델이 제시간에 응답하면 providerCompleted로 **해당 모델 타이머만** 종료한다. 이후 DB 사용량 기록/검증이 진행되는 동안 모델 타이머가 뒤늦게 성공을 취소하지 않는다. 클라이언트 취소·190초 work·210초 total 제한은 계속 유효하다. 이미 timeout/취소된 응답은 이 콜백으로 되살릴 수 없다.
- 190→210초의 추가 **20초**는 최종 ai_request 정산·세션 재확인을 위한 여유다. 정상 정산 과정에서 work 시간이 끝나도 total 이내면 응답을 완료할 수 있다.
- 브라우저는 서버 목표보다 15초, 함수는 서버 목표보다 30초 길다. 네트워크/로컬 준비가 비정상적으로 오래 걸리면 이 여유를 소진할 수 있으므로 절대적인 네트워크 완료 보장은 아니다.
- 시간 경계는 전체 합산이며 모델을 160초씩 2번 실행하는 정책이 아니다. 두 번째 SDK 호출 직전에도 재인증/DB 처리 후 실제 남은 시간을 다시 확인한다.

## 재시도·취소·비용 장부

- GPT-6.1 Sol High / 25,000 완료 토큰 / 최대 2회, SDK maxRetries=0을 유지한다.
- 첫 시도 timeout, 사용자 취소, provider 실패에는 자동 재시도하지 않는다.
- 검증 실패만 최대 1회 교정한다. 상황 기반 v2와 호환 v1 모두 첫 시도 경과 ×1.25(최소 20초, 최대 160초)가 **모델에 실제 사용할 수 있는 남은 시간** 이내일 때만 재시도한다. 정산/검증 여유 20초를 재시도 예산으로 빌리지 않는다.
- 예: 첫 검증 실패가 130초라면 work는 60초 남지만 실제 모델 시간은 40초다. 필요한 160초를 충족하지 않아 새 유료 호출을 생략한다.
- SDK 응답 이후에도 입력·출력·추론 토큰 상한, strict JSON/문단별 근거/인용/8부분 보고서 검증을 그대로 통과해야 한다. 성공 본문을 만들어 채우지 않는다.
- 사용량이 알려지면 기존 실제 사용량 기준 정산, 불명확하면 기존 전체 예약 유지 정책을 사용한다. 실패 기록을 삭제/초기화하거나 불확실 비용을 0원으로 만들지 않는다.
- 기존 DB query timeout 15초 / transaction statement timeout 10초 / usage lease 5분은 변경하지 않았다. 210초 응답 목표와 240초 함수 한도는 5분 lease 안이다. 서버 응답 제한에 걸려 정산이 지연되면 pending 예약을 유지한다. 늦은 예약/정산 완료 후 새 SDK 호출은 금지된다.
- DB 장애/플랫폼 강제 종료 시 즉시 정산 완료를 보장하지 않는다. DB에 유지된 보수적 예약과 기존 5분 만료 복구가 비용 보호를 담당한다. `maxDuration` 확대만으로 background 작업의 내구성이 보장되는 것은 아니다.

USD 예산·가격 Secret·사용자 daily/monthly override·전역 횟수/동시성·중복 digest·인증/Origin 정책은 바꾸지 않았다. 모델/입력·출력 한도와 최대 시도가 같으므로 설정 단가 기준 예약 상한도 같다(120KB 오로라/참조 단가의 경우 $0.98). 실제 토큰 소모 및 Vercel 실행 시간에 따른 비용은 증가할 수 있다.

## Q10·레거시 분석·기존 작업 보존

- Q10: GPT-6.1 Sol Low / 4,096 / 1회, SDK 30초·브라우저 35초·함수 40초 유지.
- 레거시 문항별 분석: GPT-6.1 Sol High / 25,000 / 최대 2회, SDK 45초 및 기존 전체 기한·함수 100초 유지.
- 오로라 압축 provider의 본문/스키마/입력 축약·복원, 8부분 읽기, 리본별 해석, 의미 계산, 3D, Q10 승인 및 원문은 재설계하지 않았다.
- 사전 snapshot 36개 파일과 비교하여 이번 timing 관련 수정 외의 모델 설정·인증 진단·ZIP 등을 보존한다. 과거 timeout 회귀는 테스트 안에서 명시적인 45/70/85/95초 historical profile로 유지하고 새 production profile 사례를 별도로 추가했다.

## Vercel 실행 가능 여부: 읽기 전용 확인

기존 CLI 인증으로 다음만 조회했다. 앱/AI/API/DB를 실행하거나 보호 우회 토큰을 생성하지 않았다.

1. `vercel project inspect my-mind-model-beta --json --scope wkdalsdleks-projects --non-interactive`.
2. CLI 요약에 resourceConfig가 없어 GET `/v9/projects/my-mind-model-beta`로 보완.
3. GET `/v2/teams/team_a1GqW3yPFyLyQASbumnMw1FP`에서 plan만 추출.

확인된 값:

- 프로젝트 `my-mind-model-beta`, ID `prj_HA7hlfFxJADv973Le5zbcgDjwvKG`.
- 팀 `wkdalsdleks-projects`, accountId 일치.
- `resourceConfig.fluid = true` (**최상위 fluid가 null인 CLI 요약을 비활성으로 오인하지 않음**).
- Node.js `24.x`, region `sin1`, 팀 plan **hobby**.
- 저장소에 별도 `vercel.json`/`vercel.ts` override는 없었다.

현재 [Vercel 공식 Duration limits](https://vercel.com/docs/functions/configuring-functions/duration#duration-limits) 및 [Functions limits](https://vercel.com/docs/functions/limitations)에 따르면 Fluid Compute의 Hobby 최대는 300초이므로 **240초는 지원 범위**다. [Fluid settings precedence](https://vercel.com/docs/fluid-compute#order-of-settings-precedence)에서 함수 코드 maxDuration이 우선한다.

프로젝트/플랜 지원은 확인했지만 **아직 배포하지 않았으므로 현재 Preview에 240초가 적용된 것은 아니다**. 승인된 새 배포에서 실제 함수 설정을 재확인해야 한다. Fluid/region/플랜/프로젝트 설정·환경변수·Secret·Production을 변경하지 않았다. read-only CLI 응답은 허용된 ID/설정/plan만 추출하여 로그에 비밀값을 출력하지 않았다.

## 사용자 대기 시간과 남은 위험

첫 모델만 길게 실행되면 최대 약 2분 40초 + 준비·정산 시간이다. 교정/DB 처리까지 포함한 서버 응답 목표는 최대 약 3분 30초이며 브라우저는 최대 약 3분 45초까지 기다린다. 이는 타이머 경계이지 측정된 평균 응답 시간이 아니다.

High가 160초 내에도 끝나지 않거나 25,000토큰을 소진하면 실패할 수 있다. 연결 중단·브라우저 백그라운드/모바일 절전·중간 프록시의 idle timeout·플랫폼 종료도 남는다. 스트리밍/heartbeat나 내구성 있는 단계별 job을 이번에 추가하지 않았다. 기존 단계별 생성 설계는 보존하며, 시간 확대만으로 실제 서비스 완료율을 보증하지 않는다.

실제 유료 호출 없이 가상 시간으로 안전성을 확인한다. 실모델의 품질·평균 대기·추론/출력 토큰은 승인 후 최소 호출로 확인해야 한다. 실제 AI 테스트 전에 Preview DATABASE_URL의 실제 연결 대상 확인은 여전히 별도 절차이며 이 작업에서 운영/Preview DB를 조회하지 않는다.

## 변경 파일

소스:

- `lib/aurora-interpretation-timing.ts` (신규 공통 시간 계약)
- `lib/server/interpretation-deadline.ts`
- `lib/server/aurora-interpretation-service.ts`
- `lib/aurora-universe.ts`
- `app/api/aurora-interpretation/route.ts`

테스트:

- `tests/interpretation-timeout.test.mjs`
- `tests/interpretation-reliability.test.mjs`
- `tests/ai-model-settings.test.mjs`
- `tests/aurora-deep-reading.test.mjs`
- `tests/aurora-interpretation.test.mjs`

문서: `docs/interpretation-duration-verification.md` (신규).

## 최종 검사

- TypeScript (`npx tsc --noEmit --incremental false`): 통과.
- ESLint (`npm run lint`): 통과, 경고/오류 없음.
- 비DB 전체 **727개 통과**, 독립 임시 PostgreSQL 보안 **55개 통과**, 합계 **782개**, 실패/skip 0. 이전 767개에서 extended timing/browser/실 route 검증 15개를 추가했다.
- 전체 검사 중 남아 있던 70/85/95초 기대값 3개가 실패하여 새 계약으로 갱신했고, 최종 전체 비DB 검사를 다시 통과했다. 마지막 v1 재시도 보호도 이 최종 검사에 포함했다.
- Turbopack 프로덕션 빌드 통과. 분리된 임시 소스의 첫 전체 빌드 37.05초, 마지막 v1/v2 공통 재시도 보호 소스를 반영한 최종 증분 빌드 **20.42초 / exit 0**. fake loopback DB와 비워 둔 OpenAI 키를 사용했고 프로젝트 환경 파일을 주입하지 않았다.
- 최종 `.next/server/functions-config-manifest.json`: `/api/aurora-interpretation` **240**, `/api/closing-message` **40**, `/api/analyze` **100**. 첫 빌드 소스에서 관련 5개 중 4개의 해시 일치를 확인했고, 이후 수정된 서비스 파일 1개를 현재 소스로 동기화하여 최종 증분 빌드를 수행했다. 이후 제품 코드 변경은 없다. 실제 Vercel에 새 설정을 배포한 것은 아니다.
- 가상 시간으로 110초 정상 완료, 160초 timeout/추가 호출 차단, 130초 invalid 후 불충분한 교정 생략, 초기 invalid 후 두 번째 장시간 완료, 60초 인증 차감, 190초 work/210초 total 제한, 취소/abort 무시 late 응답, 장부 지연/보수적 예약, 225초 브라우저와 200/210초 응답 관계를 검증했다.
- 실제 route 모듈 + 모의 SDK로 159초에 받은 응답이 15초 DB accounting을 거쳐도 모델 타이머 때문에 취소되지 않음을 확인했다. 실제 Next.js 브라우저/실 GPU/실 OpenAI 생성은 이번에 실행하지 않았다.
- `git diff --check`: 통과. 기존 36개 미커밋 항목 중 timing 관련 8개를 갱신했고 나머지 **28개는 byte-for-byte 동일**. 신규 공통 시간 파일/클라이언트 변경/문서를 포함해 이번 작업 변경 범위는 **11개 파일**이다. stage/commit/push/브랜치 전환 없음.
- 독립 Docker PostgreSQL은 테스트 후 해당 임시 컨테이너만 제거했다. 운영/Preview DB, 비용 기록, Secret, AI 예산 및 Vercel 설정은 변경하지 않았다.

로컬 ignored 증빙은 `node_modules/.cache/interpretation-duration-verification/`의 초기 해시, Vercel capability, `timeouts.log`, `build-final-summary.json`, `build-final.log` 및 `node_modules/.cache/universe-reading/{unit-summary.json,security-summary.json}`에 있다. Vercel 메타데이터는 ID/플랜/허용된 함수 설정만 보관했다.
