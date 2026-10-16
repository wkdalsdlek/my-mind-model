# Phase 6-A — 초대 전용 Private Beta 보안

기준: `feat/glass-nebula-aurora`, `58229081622e68fe26c1a42627e12ed846cc2e4e`.
구현·통합 검증에서는 유료 OpenAI 호출·커밋·푸시·배포를 하지 않았다. 아래 최종 검증은 사용자가 별도로 요청한 체크포인트 저장 절차다. 이 문서의 테스트용 가격/계정/토큰은 합성이다.

## 감사와 적용 경계

기존 로그인은 `app/page.tsx`의 React state/상수 비교였다. 서버 신원·로그아웃·세션 지속성이 없었고, 새로고침하면 로그인 화면으로 돌아갔다. 초기 SSR도 로그인 분기였지만 클라이언트 번들에는 질문 코드와 인증 상수가 내려갔다. UI를 거치지 않은 AI API 호출이 가능했다. 기존 값은 폐기 대상으로 보고 원문을 복사하거나 출력하지 않았다. Git 이력에 남은 공개 값을 새 계정 비밀번호로 재사용하면 안 된다.

확인한 유료 경로는 `closing-message`, `aurora-interpretation`, 레거시 `analyze` 세 Route Handler다. 다른 유료 Route Handler/Server Action은 없다. 실제 SDK 호출 위치는 각 `app/api/*/route.ts`이며, SDK 자동 재시도는 0이다. Q10은 30초 SDK/180 출력 토큰, 분석/해석은 기존 총 95초·최대 2회·25000 completion 토큰 정책을 유지한다. 철학적 프롬프트·검증 카탈로그·정확히 10 comments·5-A·리본 의미/셰이더/비콘/매크로 계산은 재설계하지 않는다.

## 인증과 화면

- **Better Auth 1.7.10**, PostgreSQL(`pg`), 안전한 라이브러리 비밀번호 해싱/DB 세션을 사용한다. 공식 Next 통합 문서와 실제 패키지 peer dependency에서 Next 16 호환을 확인했다.
- `app/page.tsx`는 동적 Server Component에서 실제 세션과 최신 계정 상태를 검사한다. 기존 질문/결과 클라이언트는 `components/MindJourney.tsx`로 옮기고 기존 클라이언트 로그인 상수·비교 분기만 제거했다.
- 세션 없으면 `/login`, 인증 인프라 오류면 보호 콘텐츠를 렌더링하지 않는다. 클라이언트 옛 암호로 우회하는 경로는 없다.
- `/aurora-lab`는 같은 경계에서 Owner만 허용한다. `AuroraLab.tsx`와 렌더러는 그대로다.
- `SessionBoundary`는 새로고침/포커스/페이지 복귀 및 30초 간격으로 세션을 확인한다. 401/403이면 로그인으로 이동해 클라이언트 질문 상태를 폐기한다. 인프라 장애 시 덮개를 표시하되 현재 메모리의 답변은 유지한다. 유휴 화면의 차단 반영에는 최대 약 30초가 걸릴 수 있으며 서버 API/새 페이지 요청은 즉시 다시 검사한다.
- 로그아웃은 실제 Better Auth 세션 삭제 성공 후 전체 페이지 이동이다. 로그인/로그아웃/세션 확인 응답은 no-store다. 비밀번호/세션 토큰은 응답 로그에 기록하지 않는다. 로그인 JSON에서 라이브러리가 반환하는 세션 토큰을 제거한다.
- 쿠키는 HttpOnly, SameSite=Lax, host-only, Path=/이다. HTTPS 기준 URL에서는 Secure, 운영 환경의 비HTTPS URL은 설정 오류로 거부한다. DB 세션 유효기간은 최대 7일이며 서버 권한 검사에서 refresh/cookie cache를 사용하지 않는다.
- DB에서 계정 status를 매번 확인한다. 비활성 계정의 세션 생성도 library hook에서 막으며, 관리자 비활성화는 기존 세션도 삭제한다.

## 초대와 관리

공개 회원가입은 `disableSignUp:true`, 사용자 생성 DB hook 거부, HTTP auth 경로 allowlist의 세 겹으로 막는다. 공개되는 인증 기능은 sign-in/email, sign-out, get-session뿐이다. role/status 추가 필드는 `input:false`이며 사용자 갱신·관리자 플러그인 API는 열지 않는다.

신뢰할 수 있는 서버의 DB 자격 증명이 관리 권한이다. `scripts/private-beta.ts`는 웹에 연결되지 않는다. 관리자가 로그인 이메일/이름을 대화식으로 입력하고 비밀번호는 raw TTY에서 echo 없이 두 번 입력한다. 비밀번호를 argv로 받지 않으며 비대화식 비밀번호 입력도 거부한다. 최초 Owner 생성은 DB 잠금 아래 기존 Owner가 없는 경우만 허용한다. CLI의 이후 계정 생성은 Tester만 생성한다.

```sh
npm run beta:admin -- migrate
npm run beta:admin -- bootstrap-owner
npm run beta:admin -- create-tester
npm run beta:admin -- disable
npm run beta:admin -- enable
npm run beta:admin -- revoke
npm run beta:admin -- usage
npm run beta:admin -- limits
npm run beta:admin -- prune
```

계정/비밀번호를 명령줄 뒤에 붙이지 않는다. `limits`는 사용자별 Q10·해석·레거시 일일 한도와 월간 USD 한도를 대화식으로 받는다. 사용자 월간 한도는 서버 기본값을 대체하며 전체 서비스 예산은 항상 적용된다. 초기 Tester 한도는 Q10 5회/일, 해석 3회/일, 사용자 동시 요청 1개다. CLI 생성 Owner는 Q10 20회/일·해석 10회/일·레거시 10회/일이며 변경할 수 있다. 전체 서비스 한도는 Owner에게도 적용된다.

## 세 AI API의 공통 경계

`protectAI` 순서:

1. 라이브러리 서버 세션 확인 + 최신 계정 상태 확인. 레거시 analyze는 Owner 확인.
2. 명시적으로 설정한 Origin allowlist, Fetch Metadata, Referer 일관성, JSON Content-Type 확인.
3. 바이트 수/읽기 시간에 제한을 둔 JSON 읽기. 여기까지 비싼 개인화 재계산/SDK 호출을 하지 않는다.
4. 사용자 ID와 HMAC digest로 PostgreSQL 사용량 예약.
5. 기존 서비스의 본문/승인/분석 검증. 실제 SDK 호출 직전 다시 권한/예약/모델/토큰 상한 확인.
6. 실제 모델 시도별 토큰/비용 기록, 기존 AI 응답 검증, 요청 정산, 응답 전 세션/계정 재검사.

세션 없음/변조/만료는 401, 비활성 계정/권한 없음/출처 위반은 403, 한도·동시성·중복은 429, 인프라·예산 미설정은 503이다. 본문 오류·생성 오류·출력 검증 오류는 기존 서비스 계약을 유지한다. 세션이 이미 삭제된 비활성 계정은 401이 될 수 있다.

`sec-fetch-site`만 믿지 않는다. 상태 변경에는 정확한 Origin이 필수다. `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, 임의 IP 헤더로 허용 출처를 넓히지 않는다. CORS 허용 헤더는 추가하지 않는다. 로그인에는 라이브러리 CSRF 보호도 유지한다.

로그인 무차별 대입은 PostgreSQL 원자적 account HMAC bucket(5/분)과 전체 bucket(100/분)으로 제한한다. IP 헤더를 바꿔 회피할 수 없다. Better Auth DB rate limiter도 켜 두되 신뢰할 프록시 IP가 구성되지 않았으므로 IP 수집은 끈다. 전체 로그인 제한은 분산 공격 방어와 동시에 서비스 방해의 표적이 될 수 있어 운영 프록시/WAF 보호도 검토해야 한다.

AI 요청에도 본문 읽기 전에 사용자 20회/분·전체 100회/분의 공유 DB 제한을 적용한다. JSON 오류나 모델 미시작 실패로 기능 슬롯을 반환해도 이 남용 방지 횟수는 반환하지 않는다.

기존 `createClosingRequestLimiter`는 순수 서비스와 과거 회귀 테스트에 남긴다. 실제 Q10 Route에서는 더 강한 공통 영속 통제가 먼저 적용되므로 옛 쿠키/프로세스 Map limiter를 사용하지 않는다. 옛 `closing-session` 쿠키는 인증/한도 권한에 사용하지 않는다.

## PostgreSQL 예약/비용 집계

`db/migrations/001_private_beta.sql`:

- Better Auth: user, session, account, verification, rateLimit.
- 계정 확장: role/status, 기능별 일일 한도, 월간 한도.
- beta_guard: 모든 예약·시도 시작·정산·관리 변경을 직렬화하는 단일 행 잠금.
- beta_login_limit: 원문 이메일 대신 HMAC/전체 로그인 횟수.
- ai_request: 사용자, 기능, HMAC digest, 한국 날짜/월, 상태, 예약/집계 비용, 실제 시도 수, 생성/만료/완료 시각, 적용 가격/모델 상한 스냅샷.
- ai_attempt: 시도 번호, 모델, 상태, 토큰 수, 추정 비용. 답변·AI 출력·인용 이유는 저장하지 않는다.

모든 새 예약은 트랜잭션/`SELECT ... FOR UPDATE` 안에서 최신 공유 DB를 기준으로 판단한다. JS Map이나 파일은 보안 상태의 저장소가 아니다. 사용자 동시 요청 1개 및 전역 동시 요청 수를 적용하고, 한 요청에서 모델 시도도 순차 실행만 허용한다. 서버 재시도는 사용자 기능 1회 + 실제 모델 시도 최대 2회로 기록한다.

한국 날짜/월은 DB 시각을 Asia/Seoul의 UTC+9로 변환한다. 기간은 예약 시작 시점 기준이다. 동일 사용자의 canonical 요청 HMAC을 60초간 중복 차단하며 requestId/승인 시각/fingerprint/선택 인스턴스 ID 같은 비의미 메타데이터는 digest에서 제외한다. 원문과 digest를 API 로그에 출력하지 않는다. 이는 모든 의미적 유사 문장을 판별하는 AI 기반 중복 제거가 아니다.

예약은 모델별 설정된 최대 입력과 기존 최대 출력, 최대 시도 수의 보수적 비용을 먼저 확보한다. 실제 SDK 요청 JSON의 UTF-8 바이트 길이와 여유분을 입력 토큰의 보수적 상한으로 확인한다. 메시지와 strict schema도 포함하며 설정 상한을 넘으면 SDK 호출 전에 거부한다. 이는 실제 tokenizer/청구서 측정이 아니다.

정산은 보고된 prompt/completion/cached/reasoning 토큰을 검증한다. cached input은 할인 단가, completion에 포함된 reasoning은 다시 더하지 않는다. 모든 시도의 사용량이 확인되면 실제 보고 토큰 기반 추정액으로 정산한다(소액 반올림은 보수적으로 올림). 시도 시작 이후 네트워크 오류/타임아웃/사용량 불명은 확보한 최대 금액을 유지한다. 모델 시도 0이 DB에서 확실하면 비용과 일일 기능 슬롯을 반환한다.

예약은 5분 lease다(기존 최대 실행 95초보다 길다). 다음 예약 때 만료를 복구하고, 늦게 돌아온 worker가 새 모델을 시작하지 못하게 한다. 이미 시작한 요청의 불확실한 비용은 반환하지 않는다. 단일 행 잠금은 소규모 베타에 적합하지만 규모 확대 시 집계 테이블/짧은 lock wait/운영 모니터링을 검토해야 한다.

## 환경 변수와 인프라

`.env.example`에는 이름과 빈 값만 둔다. 실제 `.env`는 수정하지 않는다.

| 변수 | 역할 |
| --- | --- |
| DATABASE_URL | 영속 PostgreSQL 전용 DB 접속. 운영에서는 TLS 검증, 최소 권한, 백업 필요 |
| BETTER_AUTH_URL | 정확한 기준 origin. 운영 HTTPS 필수 |
| BETTER_AUTH_SECRET | 최소 32자, 안전한 무작위 서버 비밀. 재사용하지 않고 secret manager로 공급 |
| AUTH_TRUSTED_ORIGINS | 추가로 허용할 정확한 origin의 쉼표 목록. wildcard 금지 |
| OPENAI_API_KEY | 별도 OpenAI 프로젝트 서버 키 |
| AI_USER_MONTH_USD | 사용자 월간 예산 기본 예산 |
| AI_GLOBAL_DAY_USD / AI_GLOBAL_MONTH_USD | 전체 일/월 예산 |
| AI_GLOBAL_DAY_REQUESTS / AI_GLOBAL_MONTH_REQUESTS | 전체 일/월 기능 요청 수 |
| AI_GLOBAL_CONCURRENCY | 전역 동시 생성 요청 수 |
| AI_MODEL_PRICES_JSON | 모델별 검증한 가격과 최대 입력 상한 |

가격 JSON에는 두 기존 모델 각각에 `input`, `cachedInput`, `output`(USD/1M), `maxInputTokens`, `verifiedAt`(YYYY-MM-DD), `source`(HTTPS)를 설정한다. **실제 달러 가격이나 예산 기본값을 하드코딩하지 않는다.** 운영자가 모델 접근 권한·최신 가격·입출력 분포를 확인해야 하며 메타데이터가 있다고 실제 과금이 검증된 것은 아니다. 기존 서비스의 개발용 정적 단가 추정 함수와 새 예산 장부는 구분한다.

localhost/127.0.0.1은 각각 정확한 개발 origin으로 등록한다. Codespaces는 실제 HTTPS 미리보기 origin을 명시한다. 어느 경우도 요청 Host에서 동적으로 허용 목록을 만들지 않는다. HTTP 로컬과 HTTPS 프리뷰의 Secure 쿠키 정책이 다르므로 각 환경의 canonical BETTER_AUTH_URL을 맞추고 운영은 HTTPS로만 제공한다.

운영자가 해야 하는 작업:

1. 유료 인프라 자동 생성 없이 영속 PostgreSQL을 준비하고 TLS·백업·접근 권한을 설정한다.
2. 안전한 서버 환경에 비밀/정확한 origin을 공급한다.
3. migration과 명시적 최초 Owner bootstrap을 실행한다.
4. 실제 가격·검증 일자·모델 상한·보수적인 예산을 설정한다. 미설정 상태에서는 유료 호출이 차단된다.
5. 테스트 계정을 각각 생성하고 초기 자격 정보는 안전한 별도 채널로 전달한다.
6. OpenAI 프로젝트 사용량 모니터링·알림·모델/속도 제한을 별도로 설정한다. 프로젝트 월 예산 알림을 하드 차단 장치로 간주하지 않는다.

## 개인정보와 운영

질문 상태/승인/결과는 기존 클라이언트 메모리를 유지하고 DB에 저장하지 않는다. 운영 장부에는 원문/AI 출력/인용 이유/API 키/쿠키를 넣지 않는다. 계정 이메일·표시 이름·비밀번호 hash와 세션은 인증에 필요한 데이터다. 세션의 IP/User-Agent도 저장하지 않는다.

기능 장부·시도는 90일 보존 후 `prune`으로 정리한다. 로그인 제한 행은 1일, 만료 세션은 prune 때 삭제한다. 실제 계정 삭제 시 서버 관리자는 세션/계정을 FK CASCADE로 삭제하되 사용량 장부는 user_id를 NULL로 익명화해 보존한다. 계정 삭제로 전체 예산이 초기화되면 안 된다. 필요하면 해당 장부 digest도 삭제용 임의 값으로 바꾸고, 숫자 예산 기록은 보존 기간까지 유지한다. 동작 중 계정을 먼저 비활성화하고 데이터 삭제·백업의 별도 보존 정책을 확인한다. 운영 DB/프록시/APM도 요청 본문·쿠키·로그인 정보를 기록하지 않도록 별도 설정해야 한다.

## 검증 실행

기존 `tests/*.test.mjs` 438개를 유지한다. SDK 파라미터를 확인하는 기존 테스트는 공통 보안 경계만 명시적으로 주입해 분리하며, 실제 접근 통제를 모킹으로 대체했다는 뜻은 아니다. 별도의 PostgreSQL 테스트가 실제 라이브러리·Route·트랜잭션·여러 프로세스를 통과한다.

```sh
npx tsc --noEmit --incremental false
npm run lint
# 기존 16개 *.test.mjs를 각각 node --test-reporter=tap으로 실행
npm run test:security
npm run test:security:next
```

보안 테스트는 `PRIVATE_BETA_TEST_DATABASE_URL`을 명시적으로 요구한다. DB 이름은 `mmm_security_test`로 제한한다. 이 DB는 테스트에서 초기화되므로 운영 DB를 지정하면 안 된다. 테스트용 인증/예산 환경도 별도로 공급한다. 미설정이면 DB 테스트를 skip하며 이를 보안 검증 통과로 간주하면 안 된다.

실제 Next 도구는 현재 소스를 ignored `.next/private-beta-verification/project`에 복사해 개발 서버를 별도 포트(기본 3002)로 실행한다. 환경 파일은 복사하지 않는다. 브라우저↔Next API↔PostgreSQL↔Better Auth는 실제이며 상위 OpenAI 응답만 loopback 모형이다. 가짜 키와 실제 OpenAI 주소 차단을 함께 사용한다. 출력에는 상태·개수·토큰·비용만 남긴다. 자신의 서버/브라우저만 정리한다. 최종 검증용 DB 컨테이너도 중지했으며 테스트 데이터는 삭제하지 않았다.

Chromium 준비는 `npx playwright install chromium` 및 OS 의존성이 필요하다. 환경 재시작으로 초기 `/tmp` 자료가 사라져, 최종 실행의 공유 라이브러리/한글 폰트는 시스템 대신 ignored `.next/private-beta-browser`에 추출했다. 재실행 시 해당 LD_LIBRARY_PATH와 FONTCONFIG_FILE 또는 시스템에 설치된 동등한 의존성을 사용한다. 스크린샷/DB 자격 정보/영상은 Git에 추가하지 않는다.

Phase 5의 이전 `verify-universe-ui`/`verify-next-universe` 도구는 클라이언트 상수 로그인을 전제로 한 과거 검증 기록이다. Phase 6의 인증된 전체 경로는 `verify-private-beta.mts`로 검증한다.

## 최종 결과와 남는 한계

최종 자동 검사는 기존 **438개 + 실제 PostgreSQL 보안 45개 = 483개** 모두 통과했다. 보안 테스트 skip은 0이다. TypeScript, ESLint, 공백 검사도 통과했다. 실제 운영 DB, HTTPS 프록시/호스팅 접근 제어, 실제 계정 전달, 실제 모델 접근 권한·가격·과금은 이 로컬 모킹 검증으로 승인되지 않는다. 소프트웨어 WebGL은 실제 GPU 성능·장기 안정성 검증이 아니다.

공식 근거:

- [Better Auth Next.js 통합·Next 16 호환](https://better-auth.com/docs/integrations/next)
- [Email/password·공개 가입 비활성화](https://better-auth.com/docs/authentication/email-password)
- [DB 세션](https://better-auth.com/docs/concepts/session-management)
- [쿠키](https://better-auth.com/docs/concepts/cookies)
- [DB rate limit](https://better-auth.com/docs/concepts/rate-limit)
- [Next 보안 권고](https://github.com/vercel/next.js/security)

### 실제 완료한 검증

- PostgreSQL 16 실제 컨테이너에서 Better Auth 로그인·쿠키·서버 세션·스키마 호환을 확인했다. 인메모리 대체 저장소가 아니다.
- 45개 보안 테스트: 잘못된 로그인/가입/권한 상승 차단, HttpOnly/Lax 및 HTTPS Secure 속성·7일 상한, 세션 변조/만료/로그아웃/계정 차단, 세 API의 SDK 전 거부, Owner 권한, 출처/Content-Type, DB 장애, 예산 미설정, 마지막 한도 1개의 동시 예약, 독립 프로세스 2개, KST 일/월 경계, 중복/시도 정산/불확실한 비용/만료 복구, 계정 삭제 후 전체 예산 보존을 통과했다.
- 관리 CLI는 실제 TTY/DB로 계정 생성·비활성·재활성·세션 취소·사용량·한도 변경·중복 Owner bootstrap 거부를 확인했다. 비밀번호 2회 입력 시 terminal ECHO가 꺼져 있고 출력에 값이 없었다. prune도 실제 DB에서 별도로 통과했다. 운영 DB에서 최초 Owner 생성은 운영자가 수행할 미설정 작업이다.
- 실제 Next.js **16.4.2**, PostgreSQL, Better Auth, Chromium에서 로그인 → 새로고침 세션 유지 → Q1~Q9 선택 → 실제 Q10 Route → 승인 → 실제 해석 Route → 인용문/결과 → 전체 읽기 → 리본 매크로/복귀 → 로그아웃 POST 200 → 후속 API 401/페이지 로그인 이동까지 한 실행에서 완료했다. `authOnly:false`, `stage:complete`, runtimeErrors=[]다.
- Owner의 실제 레거시 Route 응답은 comments 10개, Tester는 403이었다. 익명 요청은 모델 0회에서 거부됐다.
- 정상 전체 흐름의 로컬 모형 SDK 요청은 Q10 1회 + 해석 1회, 별도 Owner 호환성 검사 1회였다. 탐색 중 추가 요청은 0, 실제 유료 OpenAI는 0회다. 사용자 기능 2건/각 모델 시도 1회가 실제 DB에 저장됐다. 합성 토큰·가격·비용을 실제 제공자 청구로 해석하지 않는다.
- 첫 전체 실행은 마지막 로그아웃 구간에서 실패했고 세부 추적이 부족해 원인은 확정하지 않았다. 좁힌 인증 전용 실행은 로그아웃 200/후속 401을 확인했고, 최종 실행은 단계·HTTP 기록을 보강해 결과 화면에서의 로그아웃까지 통과했다. 이를 근거 없이 제품 로그아웃 결함 수정으로 보고하지 않는다.
- 중간에 실행 환경의 `/tmp`와 프로세스가 사라지고 최초 테스트 DB 컨테이너가 종료됐다. 재시작은 OCI 잔여 상태 때문에 실패해 기존 컨테이너/데이터를 삭제하지 않고 별도 로컬 포트의 테스트 DB로 최종 검사를 다시 완료했다. 운영용 DB를 생성하거나 사용자 프로세스를 종료한 것이 아니다.

### 의존성 감사

기존 Next 16.1.6의 실제 알려진 취약점을 확인해 같은 major의 16.4.2와 대응 eslint-config-next로 갱신했다. 호환 범위의 fflate/source-map-js도 갱신했다. 운영 의존성 `npm audit --omit=dev`는 **0건**이다. 전체 감사에는 개발 도구 체인 **10건(High 9, Moderate 1)**이 남는다. `eslint-config-next`, `@next/eslint-plugin-next` 및 glob/파일 처리 전이 의존성 관련이며 이번에 강제 major 변경을 하지 않았다. 공개/운영 승인 전에 해당 advisory의 적용성과 수정 버전을 검토해야 한다. npm 감사 0은 전체 보안 무결성 증명이 아니다.

### 재현 자료와 한계

최종 ignored 자료:

- `.next/private-beta-security-tests.log`: 실제 PostgreSQL 45개, fail/skip 0.
- `.next/private-beta-unit-checks/report.json`: 기존 438개.
- `.next/private-beta-verification/report.json`: 실제 Next 전체 흐름 완료와 HTTP/비민감 사용량.
- `.next/private-beta-verification/authenticated-universe.png`.
- `.next/private-beta-verification/authenticated-macro.png`.
- `.next/private-beta-audit-runtime.json`, `.next/private-beta-audit-all.json`.

화면을 직접 열어 기존 우주 공간/인용문/비콘·매크로와 로그아웃 컨트롤을 확인했다. ANGLE SwiftShader이며 실제 GPU의 FPS/발열/장기 메모리나 실제 모바일 장치는 미검증이다. 이번에는 대규모 시점/품질 스크린샷 행렬을 반복하지 않았다. 상단 시점 자기 교차/곡면 및 초근접 미스트의 기존 특성은 유지했다.

보호 대상 제품 코드의 셰이더·5-A·5-C-1·질문 상태·카탈로그·분석 프롬프트는 변경하지 않았다. 인증과 한도 오류의 사용자 메시지만 확장했다. 현재 질문/승인/결과는 메모리 상태이므로 일시적인 API/DB 실패에는 유지하지만 명시적 로그아웃·세션 무효화에 따른 페이지 이동·새로고침의 영속 복원은 제공하지 않는다.

현재 실제 운영 환경 값/DB 계정/HTTPS 배포/가격·모델 접근 권한/프로젝트 예산 알림은 설정·검증하지 않았다. **즉시 공개 배포 승인 상태가 아니다.** 인프라/운영자 계정/정확한 origin/검증한 가격과 예산을 설정하기 전에는 서버가 fail-closed다. 외부 TLS 프록시·DB TLS/백업·서비스 범위의 접근 제어·로그 수집 정책·개발 의존성 경고 검토가 남는다. 개발 서버를 공개 서비스로 운영하지 않는다.

구현 완료 시점에는 Git commit/push/deploy를 하지 않았고 HEAD는 기준 체크포인트 그대로였다. ZIP·실제 환경 파일·master/백업 브랜치를 보존한다.

### 체크포인트 저장 전 최종 재검증 — 2026-10-16

제품 소스와 테스트는 추가 수정하지 않았다. 보고된 38개 파일과 실제 변경 범위가 일치했고, 비어 있는 index에서 명시적인 경로 목록으로만 저장한다. 실제 환경 파일·ZIP의 해시와 master/백업을 포함한 로컬 branch ref가 검증 중 그대로임을 확인했다.

- `npx tsc --noEmit --incremental false`, `npm run lint`: 통과.
- 기존 438개와 실제 PostgreSQL 보안 45개: **483개 통과, 실패 0, skip 0**. 샌드박스의 로컬 DB 접속 제한을 해제한 실행으로 확인했다. 운영 DB와 유료 제공자는 사용하지 않았다.
- `npm run build`: **Next.js 16.4.2 Turbopack 프로덕션 빌드 통과**. 실제 비밀 대신 임시 합성 인증 설정·연결 불가능한 loopback DB 주소를 주었고, 예산 변수는 비웠다. DB/모델 호출 없이 컴파일·타입 검사·정적 생성이 완료됐다. `/`, `/login`, `/aurora-lab`, 네 API 경로는 동적으로 빌드됐다. 이는 운영 DB 연결·운영 HTTPS 인증·실제 모델 접근 권한 검증을 뜻하지 않는다.
- 첫 빌드가 `.next`의 사용자 정의 검사 로그 디렉터리를 정리해 검사 래퍼의 로그 저장이 실패했다. 빌드 실패로 단정하지 않고 로그를 `/tmp`로 옮겨 재실행하여 종료 코드 0을 확보했다. 이전 검증 보고서와 스크린샷은 사전에 복사하고 원래 ignored 경로에 복원했다.
- 기존 테스트 DB에서 migration을 추가로 두 번 실행했다. user/session/account/ai_request/ai_attempt의 기존 행 수가 유지됐다. 실제 Better Auth 스키마 일치 검사는 45개 테스트에 포함된다. 운영 migration은 실행하지 않았다.
- 세 API와 Owner 페이지의 서버 인증, 가입 차단, 비활성 계정 거부, Origin/CSRF, 영속 제한·동시 예약·재시도 비용·DB 장애·예산 미설정 차단을 코드와 테스트로 재확인했다. 제품 코드에 테스트 전용 환경 변수나 모형 SDK 분기는 없다.
- 새 credential 패턴 및 과거 클라이언트 인증 상수의 재유입은 발견되지 않았다. URL 패턴에 걸린 한 건은 기준 커밋부터 있던 잘못된 URL 입력 테스트였다. `.env.example`의 12개 변수는 모두 빈 값이다. 운영 진단은 허용된 상태/토큰/비용 메타데이터만 사용한다.
- 클라이언트 import 경계와 프로덕션 JS의 보안 모듈 표식/합성 비밀 유입을 확인했다. 서버 auth/DB/usage 모듈의 클라이언트 유입은 발견되지 않았다. 이 검사는 일반적인 취약점 부재를 증명하지 않는다.
- 5-A, 5-C-1, 질문 상태, 결과 컴포넌트, 분석 서비스 계약, 오로라 셰이더와 `/aurora-lab/AuroraLab.tsx`의 변경은 없다. 랩의 서버 Owner 접근 경계만 이번 6-A 범위다. 기존 대규모 브라우저 검증은 반복하지 않았다.

최신 `npm audit --omit=dev`는 **0건**, 전체 감사는 **10건(High 9, Moderate 1)**이다. `npm ls`에서 모두 ESLint/Next ESLint 설정의 개발 전이 의존성임을 확인했다. glob/brace 패턴·YAML 입력은 CPU/스택/메모리 고갈, flatted는 악성 캐시 역직렬화 및 prototype pollution, humanfs는 신뢰하지 않는 symlink 복사 시 파일 노출 위험이다. 현재 제품 API에서 이 도구에 사용자 입력을 전달하는 경로는 확인되지 않아 체크포인트 저장을 막는 운영 취약점으로 판단하지 않았다. 개발·CI에서 신뢰하지 않는 설정/캐시/파일 트리를 실행하지 않고 수정 버전 검토를 계속해야 한다. `braces` 권고는 현재 수정 버전이 없으며 npm의 제안은 eslint-config-next major 하향이어서 자동 적용하지 않았다. 이번 저장에서 의존성/기능을 추가 변경하지 않는다.

검토 근거: [Better Auth Next 통합](https://better-auth.com/docs/integrations/next), [flatted 권고](https://github.com/advisories/GHSA-rf6f-7fwh-wjgh), [braces 권고](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [humanfs 권고](https://github.com/advisories/GHSA-p498-v437-472g). 설치된 Better Auth의 Next `^16.0.0`/pg `^8.0.0` peer 범위와 실제 설치/빌드도 확인했다.

최종 빌드 로그는 `.next/private-beta-checkpoint/build.log`에 둔다. 기존 ignored 검증 자료는 저장 대상이 아니다. 체크포인트는 배포 승인이 아니다. 운영 PostgreSQL TLS/최소 권한/백업, 관리 CLI로 최초 Owner 생성, HTTPS·정확한 origin·새 서버 비밀, 확인한 모델 가격·예산, 로그/APM 마스킹, 과거 Git 이력의 인증값 폐기, 개발 도구 경고 정리가 배포 전에 남는다.

### 변경 파일 전체

**38개** (ZIP/실제 환경 파일/ignored 검증 자료 제외).

```text
.env.example
.gitignore
app/api/analyze/route.ts
app/api/aurora-interpretation/route.ts
app/api/auth/[...all]/route.ts
app/api/closing-message/route.ts
app/aurora-lab/page.tsx
app/login/Login.tsx
app/login/page.tsx
app/page.tsx
components/MindJourney.tsx
components/auth/SessionBoundary.tsx
db/migrations/001_private_beta.sql
docs/aurora-next-integration-verification.md
docs/aurora-universe-verification.md
docs/private-beta-security-verification.md
lib/aurora-universe.ts
lib/closing-message-client.ts
lib/closing-message.ts
lib/server/closing-message-service.ts
lib/server/security/api.ts
lib/server/security/auth.ts
lib/server/security/database.ts
lib/server/security/page-access.ts
lib/server/security/policy.ts
lib/server/security/rate-limit.ts
lib/server/security/usage.ts
package-lock.json
package.json
scripts/private-beta.ts
tests/analysis-service.test.mjs
tests/aurora-interpretation.test.mjs
tests/aurora-universe.test.mjs
tests/closing-message.test.mjs
tests/helpers/beta-reserve-worker.mts
tests/helpers/beta-secure-cookie-worker.mts
tests/helpers/verify-private-beta.mts
tests/private-beta.test.mts
```
