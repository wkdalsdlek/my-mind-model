# Phase 6-B — Vercel + Neon 인프라 준비 및 검증

검토일: **2026-10-17 KST**. 기준 `feat/glass-nebula-aurora`, HEAD `f4363aa1c9bcc3955e71f697ce1aeddf0fa9f723`.

6-B 구현 단계는 준비와 로컬 검증이었다. 에이전트는 클라우드 생성·설정 변경·비밀 등록·운영 migration·Owner 생성·배포·유료 AI 호출을 하지 않았다. Vercel 프로젝트/배포 메타데이터 조회만 읽기 전용으로 수행했다. 실제 DB URL이나 비밀번호는 이 문서에 없다. 체크포인트 저장은 아래 최신 사용자 요청으로 별도 승인됐으며, 검증 후 지정된 5개 파일만 commit/일반 push한다.

**최신 사용자 확인 — 체크포인트 저장 요청 시점:**

- 기존 Vercel `my-mind-model`의 GitHub 연결을 사용자가 해제했다.
- 새 Vercel `my-mind-model-beta`가 생성됐으며 GitHub 미연동, Function Region은 Singapore(`sin1`)다.
- Neon PostgreSQL `my-mind-model`이 AWS 싱가포르 리전에 생성됐다.
- 운영 migration·최초 Owner 생성·환경 변수 등록·실제 beta 배포는 아직 하지 않았다.

위 내용은 **사용자가 완료했다고 알려준 상태**이며, 이번 체크포인트 작업에서 클라우드 변경이나 접속 검증을 대신 수행한 것이 아니다. 이전 403 권한 문제를 우회하지 않는다. 두 Vercel 프로젝트의 Git 미연동 상태를 전제로 이번 일반 Git push만 수행하고, 연결·배포는 실행하지 않는다. 기존/새 프로젝트의 보호 정책·실제 DB TLS·최소 권한·HTTPS 로그인은 후속 승인 검증 항목이다.

## 1. 확인된 Git·기존 Vercel 상태 — 초기 감사 기록

| 항목 | 확인 결과 |
| --- | --- |
| 현재 브랜치·로컬/원격 feature HEAD | 위 기준과 일치 |
| GitHub 기본 브랜치 | `master` |
| 로컬/원격 master | `757c25e22e9e1e8d4005cfc9f1484094840b7fdd`; 최신 보안 구현으로 간주하지 않는다 |
| 백업·기존 체크포인트 브랜치 | 보존; 참조 변경 없음 |
| 시작 시 작업 트리 | 미추적 `my-mind-model-review.zip`만 존재 |
| 로컬 `.vercel/project.json`, `.neon`, `vercel.json` | 없음; CLI도 설치되어 있지 않음 |
| 기존 Vercel 프로젝트 | 연결된 계정에서 `my-mind-model` 발견; Next.js, Node `24.x` |
| 기존 배포 | `dpl_GB5PcRSPGaK8aFU9gbnnkhpnLGLm`, READY, `source: git` |
| 기존 배포 Git 메타데이터 | `wkdalsdlek/my-mind-model`, feature 브랜치, 기준 `f4363aa1…` 커밋과 일치 |
| 기존 배포 region | `iad1` |
| 기존 SSO 보호 응답 | enabled=true, `all_except_custom_domains` |
| 기존 Password Protection | enabled=false |

기존 배포 URL: `https://my-mind-model-2rlurvmd9-wkdalsdleks-projects.vercel.app`.
기존 feature 브랜치 alias: `https://my-mind-model-git-feat-glass-nebula-aurora-wkdalsdleks-projects.vercel.app`.

이 과거 배포는 에이전트가 생성하지 않았다. READY는 빌드 상태이며 **DB·인증·결과 생성 성공의 증거가 아니다**. 초기 감사에서는 Git 연동 배포가 있었고 Production 브랜치·현재 trigger 설정은 확인되지 않았다. 이후 사용자가 위와 같이 기존 프로젝트의 연결 해제를 완료했다고 알렸다. 과거 master/feature alias를 새 beta의 주소나 현재 연결 상태로 간주하지 않는다. 기존 운영 URL을 변경하거나 접근 보호를 테스트 삼아 해제하지 않았다.

## 2. 안전한 배포 방법 비교 — 검토 기록과 선택 결과

| 방법 | 장점 | 위험/선행 조건 |
| --- | --- | --- |
| **별도 beta 프로젝트, Git 미연동, 승인한 수동 Preview** | 기존 master·기존 프로젝트와 배포를 격리; push로 최초 배포 발생 방지 | 신규 프로젝트 승인·보호 설정·고정 Preview alias·환경 scope 지정 필요 |
| 기존 프로젝트에서 수동 Preview | 프로젝트 중복을 줄이고 확인된 feature alias 활용 가능 | 기존 Git 연동·Production 브랜치·자동 trigger·도메인 보호를 먼저 확인; 변경 시 별도 승인 |
| GitHub import 및 자동 배포 | 이후 배포 자동화가 편리 | 기본 master의 옛 버전이 최초 Production으로 나갈 위험; 현 단계에서 추천하지 않음 |

사용자는 첫 번째 방식에 맞춰 별도 `my-mind-model-beta`를 Git 미연동으로 준비했고, 기존 프로젝트도 Git 연결을 해제했다고 확인했다. 에이전트는 새 프로젝트를 생성하거나 연결·보호·배포 설정을 변경하지 않는다. 현재 팀의 실제 plan 조회는 확인되지 않아 가격표를 계정 계약으로 간주하지 않는다.

실제 배포 승인 후에는 beta의 team/project ID, 배포 커밋, Preview 환경, root, build command, Node 24, Fluid Compute를 확인한다. 사용자가 설정한 `sin1`과 Neon AWS 싱가포르 배치를 유지한다. `git rev-parse HEAD`와 `git status --short`를 확인하고 승인된 소스만 업로드한다. 이번 체크포인트의 후속 전체 SHA를 배포 대상으로 다시 지정해야 하며, Git 저장만으로 배포가 완료됐다고 표현하지 않는다.

`vercel link`/환경 pull/프로젝트 생성은 아직 하지 않았다. `vercel` 단독 실행은 배포를 시작할 수 있으므로 연결 확인 명령으로 쓰지 않는다. CLI 업로드에는 `.gitignore`만 믿지 말고 ZIP·환경 파일·`.next`·DB 덤프를 제외하는 명시적 업로드 검토가 필요하다. `.vercelignore` 작성 및 배포 명령은 실제 방식 선택 후 진행한다.

근거: [Git 배포](https://vercel.com/docs/git), [프로젝트 CLI](https://vercel.com/docs/cli/project), [GitHub Production 브랜치](https://vercel.com/docs/git/vercel-for-github).

## 3. pg·Neon 연결 정책과 실제 수정

기존 `pg` 드라이버와 Better Auth를 유지한다. Neon Managed Auth, Data API, HTTP 드라이버 또는 새 AI Gateway로 옮기지 않는다.

- 런타임의 `DATABASE_URL`: 같은 DB의 **pooled** endpoint, 전용 런타임 role, TLS `sslmode=verify-full` 권장/운영 설정 필수.
- 관리 CLI·migration·dump/restore: **direct** endpoint와 관리용 role. 같은 변수 `DATABASE_URL`에 관리 프로세스에서만 direct 값을 주입한다. 새로운 환경 변수 이름을 만들거나 런타임 URL을 direct로 덮어쓰지 않는다.
- 기존 max=5는 **프로세스/인스턴스당** 상한이다. 전체 연결 수가 5라는 뜻이 아니다. 인스턴스 수·DB pooler queue·실제 backend 연결을 운영에서 관측해야 한다.
- Pool은 요청마다 새로 만들지 않고 모듈에서 재사용한다. `@vercel/functions@3.10.1`의 `attachDatabasePool`을 생성 직후 Vercel 환경에서만 연결했다. freeze 전에 유휴 연결 정리가 가능하도록 돕는다. 실제 Fluid Compute suspend 동작은 아직 미검증이다. CLI/로컬 프로세스에는 연결하지 않는다.
- 연결 대기 5초, 유휴 10초를 유지한다. 응답 대기는 `query_timeout=15초`, 잠금 트랜잭션에는 `SET LOCAL statement_timeout='10s'`를 적용한다. client timeout은 서버 cancel과 동일하지 않다. 인증의 단일 query에도 서버 제한이 필요하므로 운영 DB role에 적절한 server-side statement timeout을 별도로 설정·검증한다.
- 연결 실패·쿼리 실패·guard 누락은 그대로 503 또는 명시적 거부다. DB 실패를 메모리 인증이나 무료 호출로 대체하지 않는다. 결제 가능 작업/COMMIT를 자동 재실행하지 않는다. 불확실한 시도 비용과 5분 lease 복구 정책은 유지한다.

### 재현된 startup parameter 문제

설치된 pg는 `statement_timeout` 옵션을 startup packet으로 보낸다. 로컬 PgBouncer 1.24.1의 기본 transaction 설정은 이를 **08P01: unsupported startup parameter**로 거부했다. 서버 timeout을 없애거나 pooler가 무시하게 하지 않고, 클라이언트 응답 제한과 트랜잭션 범위 `SET LOCAL`로 분리했다. 다른 client에 세션 설정이 새어 나가지 않는다.

Neon은 PgBouncer transaction pooling을 사용한다. `BEGIN`부터 `COMMIT/ROLLBACK`까지 **같은 `PoolClient`**를 사용하는 기존 `locked` 구조와 행 잠금을 유지했다. SDK 네트워크 대기 동안 DB 트랜잭션을 열어 두지 않는다. session advisory lock/임시 테이블/전역 SET에 의존하지 않는다. 이론적 호환성에 더해 로컬 PgBouncer 경유 실제 경쟁·롤백 검사를 완료했다. **Neon의 실제 pooler 설정·TLS·재시작은 미검증**이며 같은 오류가 Neon에서 발생했다고 주장하지 않는다.

근거: [Neon pooled/direct·transaction 제약](https://neon.com/docs/connect/connection-pooling), [PgBouncer startup 정책](https://www.pgbouncer.org/config.html#ignore_startup_parameters), [pg 트랜잭션](https://node-postgres.com/features/transactions), [Vercel 풀 수명 관리](https://vercel.com/kb/guide/connection-pooling-with-functions).

### TLS와 role 분리

운영 URL에 `sslmode=verify-full`을 명시한다. `sslmode=no-verify`, `ssl=no-verify`, `rejectUnauthorized:false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`을 사용하지 않는다. pg에서 URL의 SSL 옵션이 config의 ssl 객체를 덮어쓸 수 있으므로 상충 설정을 혼합하지 않는다. 인증서 검증 실패를 무시하지 않는다. 현재 코드는 운영 URL의 TLS 모드를 강제 재작성하지 않으므로 **URL 검토와 실제 인증서 검증이 배포 승인 조건**이다. 로컬 loopback PostgreSQL/PgBouncer는 비TLS이며 Neon TLS의 증거가 아니다.

관리 role은 migration/초대/비활성화/한도 수정에만 쓴다. Vercel 런타임에 DB owner 자격 증명을 등록하지 않는다. runtime role은 필요한 테이블 DML과 schema USAGE, DB CONNECT만 검토해 부여하며 DDL/role 생성/회원 role 수정은 허용하지 않는 구성을 검증한다. `beta_guard`의 `SELECT FOR UPDATE`에는 SELECT와 해당 열의 UPDATE 권한이 필요하다. `user`·`account`의 읽기, session·DB rate limit·사용량 테이블의 실제 쓰기 경로를 Better Auth와 함께 시험해야 한다. 계정 관리 CLI에는 별도의 관리 권한이 필요하다. 운영 최소 권한 grants는 이번에 실행하지 않았으며 실제 Neon에서 검증할 항목이다.

근거: [Neon TLS](https://neon.com/docs/connect/connect-securely), [pg SSL/URL 설정](https://node-postgres.com/features/ssl).

## 4. 마이그레이션·Owner·복구 순서

사용자가 실제 DB 대상과 관리 작업을 승인한 뒤 신뢰할 수 있는 TTY 환경에서만 진행한다. 비밀값을 채팅·argv·터미널 출력에 넣지 않고 관리 프로세스 환경으로 공급한다. 현재 tsx CLI가 `.env.local`을 자동으로 읽는다고 가정하지 않는다.

1. Neon 프로젝트·branch·database·role·region, direct endpoint를 이름/ID로 확인한다. 테스트/운영 DB를 분리한다.
2. 기존 DB가 있으면 plan의 restore history와 별도 암호화 dump를 확인하고, 별도 격리 DB에서 복구를 시험한다. dump는 Git·공개 artifact에 올리지 않는다.
3. 관리 프로세스 `DATABASE_URL`만 direct 관리 연결로 설정한다. 인증 설정(`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`)도 필요하며 실제 OpenAI 키/예산은 없어도 된다.
4. `npm run beta:admin -- migrate`를 명시적으로 실행한다. migration 자체가 BEGIN/COMMIT이며 오류는 전체 rollback이다. 배포 build/start/postinstall에 이 명령을 추가하지 않는다.
5. Better Auth 스키마 및 9개 테이블·FK·index·guard seed를 확인한다. `IF NOT EXISTS`는 임의의 오래된 스키마를 자동 업그레이드하는 보장이 아니다. 다른 schema가 있으면 먼저 비교한다.
6. `npm run beta:admin -- bootstrap-owner`에서 이메일/표시 이름과 비밀번호를 입력한다. raw TTY에서 비밀번호는 두 번 숨겨 받고, 기존 Owner가 있으면 추가 bootstrap을 거부한다. 실제 계정은 생성하지 않았다.
7. 승인 후 HTTPS 로그인·세션·로그아웃·disable/revoke를 시험한다. 관리자가 현재 유일한 Owner를 disable하면 CLI 복구가 필요하므로 접근 가능한 관리 환경을 유지한다.
8. runtime role 권한과 pooled URL을 Vercel에 별도로 등록한다. 관리자 URL을 서버리스 런타임에 계속 두지 않는다.

로컬에서는 임시 새 스키마의 최초 migration 생성 성공, 의도적 중간 SQL 오류의 DDL rollback, 기존 migration 2회 재실행과 사용자 행 수 보존을 확인했다. 운영에서는 실행하지 않았다. DB/배포 rollback은 별개이며, DB를 과거로 복구하면 사용량 장부도 되돌아가 예산을 재사용할 수 있으므로 AI를 잠그고 장부·인증 세션을 점검한 뒤 재개한다. secret rotation 또는 세션 무효화 정책도 복구 계획에 포함한다.

근거: [Neon 백업 전략](https://neon.com/docs/postgres/backup-restore/backups), [direct pg_dump/복원](https://neon.com/docs/manage/backup-pg-dump).

## 5. Vercel 실행 시간·비용

| 경로 | 현재 maxDuration | 모델 제한 | 점검 결과 |
| --- | --- | --- | --- |
| closing-message | 40초 | SDK 30초, 1회 | 인증·본문·DB·정산은 별도 시간 |
| aurora-interpretation | 100초 | 시도 45초, 총 95초, 최대 2회 | 생성 외 시간이 5초를 넘으면 플랫폼 제한과 충돌 가능 |
| analyze | 100초 | 시도 45초, 총 95초, 최대 2회 | 동일; Owner 전용 유지 |
| auth·동적 페이지 | 별도 export 없음 | AI 없음 | 프로젝트의 실제 플랫폼 설정 확인 필요 |

공식 Fluid Compute 한도는 Hobby 기본/최대 300초, Pro/Enterprise 기본 300초·일반 최대 800초다. 현재 export는 이 한도 이내지만 **애플리케이션 전체가 100초 안에 끝난다는 보장은 아니다**. 생성 95초 타이머는 보안 wrapper 전후의 DB 작업/본문 읽기 10초/서버 cold start를 포함하지 않는다. 실제 프로젝트 Fluid 설정·region·DB 지연·통합 p95/p99를 측정하고 전체 요청 deadline과 정산 여유를 설계한 뒤 필요한 범위만 조정한다. 이번에는 maxDuration·모델 timeout을 임의로 늘리지 않았다. 실제 유료 AI 활성화 전에 해결할 조건이다. 인증만 점검하는 1차 배포는 별도 승인으로 진행할 수 있다.

Fluid 비용은 active CPU, 처리 중 인스턴스 메모리, 호출 수에 영향을 받으며 외부 I/O 대기 중에도 메모리 비용이 생길 수 있다. 장시간 상한을 늘리면 비용 노출이 늘 수 있다. 리전과 실제 plan/남은 allowance를 확인하기 전 고정 비용을 약속하지 않는다. 유료 업그레이드는 하지 않는다.

근거: [공식 duration 표](https://vercel.com/docs/functions/configuring-functions/duration), [Fluid 비용](https://vercel.com/docs/functions/usage-and-pricing).

## 6. 고정 HTTPS Origin과 2중 접근 보호

첫 beta 배포 전에 `my-mind-model-beta`의 canonical Preview origin을 하나 선택한다. 과거 프로젝트의 feature alias를 새 beta Origin으로 재사용하지 않는다. 승인된 고정 Preview alias/domain을 먼저 정하고 사용하며, 생성 URL을 문자열 규칙으로 추측하지 않는다.

- `BETTER_AUTH_URL`은 정확한 canonical HTTPS origin 하나(경로와 끝 slash 없음).
- `AUTH_TRUSTED_ORIGINS`는 비워도 canonical 자체가 허용된다. 추가 주소가 꼭 필요할 때만 정확한 HTTPS origin을 쉼표로 나열한다.
- `*.vercel.app`, `Host`/forwarded 헤더 기반 자동 허용, `VERCEL_URL`을 신뢰 목록으로 동적 변환하지 않는다.
- 브라우저는 같은 canonical URL에서 로그인·질문·API·로그아웃을 수행한다. 쿠키는 host-only여서 alias마다 별도 로그인 상태다. 임의 commit URL을 추가 허용하지 않고 canonical에서 접속한다.
- 재배포로 URL이 바뀌면 고정 alias 정책을 확인한다. env 변경은 기존 배포에 자동 반영된다고 가정하지 않고 승인된 새 배포로 적용한다.

**플랫폼**의 Vercel Authentication과 **앱**의 Better Auth는 별개다. Vercel 로그인을 통과해도 앱 Owner 세션이 필요하고, 플랫폼 보호를 해제해도 세 AI API 인증/예산 검사는 남는다. 현재 관리자 1명만 허용하고 shareable bypass 링크·자동화 bypass secret·외부 Tester 접근은 만들지 않는다.

권장 보호 범위는 **All Deployments**다. 기존 응답 `all_except_custom_domains`는 모든 URL이 보호된다는 증거가 아니므로 canonical alias/커스텀 도메인/Production 도메인 각각의 보호를 확인해야 한다. 변경은 승인 후 수행한다. Vercel Authentication은 모든 plan에서 사용할 수 있다. Password Protection은 Hobby에서 지원하지 않으며 공식 가격표상 Pro는 보호 프로젝트당 월 $20, Enterprise 포함(legacy Pro team 요금 별도)이다. 현재 plan 계약을 확인하기 전에 구매·업그레이드하지 않는다.

근거: [고정 브랜치 URL](https://vercel.com/docs/deployments/generated-urls), [Deployment Protection 범위](https://vercel.com/docs/deployment-protection), [Password Protection 가격](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/password-protection).

## 7. 환경 변수 설정 명세

이름과 빈 `.env.example`은 변경하지 않았다. 아래 Vercel 항목은 **승인된 beta Preview 환경/선택 브랜치 scope**에만 등록한다. Production 전체에 일괄 복사하지 않는다. 비밀은 서버 Secret로, 공개 설정도 서버 Config로 관리하며 `NEXT_PUBLIC_`를 붙이지 않는다. 실제 값은 기록하지 않는다.

| 변수 | 1차 인증 검증 | 위치/정책 |
| --- | --- | --- |
| DATABASE_URL | 필수 | Vercel: pooled runtime role + verify-full; 관리 TTY 프로세스: direct admin role |
| BETTER_AUTH_URL | 필수 | 고정 HTTPS canonical origin |
| BETTER_AUTH_SECRET | 필수 | 충분한 무작위 서버 Secret, 최소 32자; 테스트/과거 인증값 재사용 금지 |
| AUTH_TRUSTED_ORIGINS | 선택 | 필요할 때만 추가 정확한 origin; 기본 빈 값 |
| OPENAI_API_KEY | 등록하지 않음 | 2차 별도 승인 후 전용 프로젝트 Secret |
| AI_USER_MONTH_USD | 등록하지 않음 | 2차 승인 후 사용자 월 예산 기본값 |
| AI_GLOBAL_DAY_USD | 등록하지 않음 | 2차 승인 후 전역 일 예산 |
| AI_GLOBAL_MONTH_USD | 등록하지 않음 | 2차 승인 후 전역 월 예산 |
| AI_GLOBAL_DAY_REQUESTS | 등록하지 않음 | 2차 승인 후 전역 일 기능 요청 수 |
| AI_GLOBAL_MONTH_REQUESTS | 등록하지 않음 | 2차 승인 후 전역 월 기능 요청 수 |
| AI_GLOBAL_CONCURRENCY | 등록하지 않음 | 2차 승인 후 전역 동시 생성 수 |
| AI_MODEL_PRICES_JSON | 등록하지 않음 | 2차 승인 후 기존 두 모델의 검증된 input/cachedInput/output/maxInputTokens/verifiedAt/source |

1차에서는 budgetConfig가 불완전하여 인증된 AI 요청도 SDK 전에 거부된다. 로그인·세션·로그아웃은 예산/모델 키에 의존하지 않는다. 안전한 503을 질문/결과 생성 성공으로 보고하지 않는다. 2차에도 실제 AI 1회 검증은 별도 명시적 승인이 필요하고, 이번 6-B에서는 유료 호출 0회다.

## 8. 검증 수준과 실행 결과

| 수준 | 상태 |
| --- | --- |
| 코드·정적 검사·빌드 | 최종 검사 결과 아래 기재 |
| 로컬 PostgreSQL | 직접 연결 및 PgBouncer transaction 경유 검증 완료 |
| 실제 Neon TLS/pooled/direct 연결 | 미실행; 대상 선택·접속 승인 필요 |
| 실제 Vercel HTTPS 로그인·재시작·보호 설정 | 미실행; 배포/환경 등록 승인 필요 |
| 실제 OpenAI 모델·가격·비용 | 미실행; 이번 작업 범위 밖 |

검사 명령은 `npx tsc --noEmit --incremental false`, `npm run lint`, 기존 16개 `tests/*.test.mjs` 각각의 TAP 실행, `node --import tsx --test --test-reporter=tap tests/private-beta.test.mts`, `npm run build`, `git diff --check`, `npm audit --omit=dev`다.

DB 테스트는 명시적인 `PRIVATE_BETA_TEST_DATABASE_URL`과 DB 이름 `/mmm_security_test`를 요구하고 해당 **격리 DB를 초기화**한다. 운영 URL을 주지 않는다. 직접 실행에는 로컬 direct URL, pool 실행에는 local PgBouncer URL을 별도의 프로세스 환경에 공급한다. 기존 테스트 DB 자격 정보는 ignored 자료에서 읽고 값은 출력하지 않았다. pgBouncer 실행 파일/공유 라이브러리/설정/합성 비밀은 `/tmp/mmm-phase6b/pgbouncer`에만 두고 시스템에 설치하지 않았다. local trust·비TLS 설정을 Neon 설정으로 복사하면 안 된다.

추가한 2개 테스트는 transaction-local timeout의 적용/회수와 실패한 잠금 트랜잭션의 write rollback/guard 재획득이다. 기존 45개가 유지되어 보안 테스트는 47개다. 기존 438개 + 보안 47개 = **고유 테스트 485개**다. 직접/풀링 각각의 47개를 94개의 서로 다른 테스트로 부풀리지 않는다. 경쟁 예약과 두 별도 서버 프로세스, 중복·재시도 비용, DB 장애·예산 미설정·쿠키·출처·권한 회귀가 포함된다.

검사 로그는 실행 당시 `/tmp/mmm-phase6b`에 보관했다. 이후 실행 환경이 재시작되어 해당 `/tmp`와 일부 `.next` 검증 자료가 사라졌고 원본 로그/스크린샷의 복원은 확인하지 못했다. 위 검사는 당시 도구의 종료 결과로 확인했으며, 현재 파일이 존재한다고 보고하지 않는다. 제품 소스와 이번 수정은 보존됐다. 최종 정적 검사·빌드·감사 자료는 Git에서 제외되는 `node_modules/.cache/phase6b`에 새로 보관한다. 실제 UI 자료를 만들었다고 주장하지 않는다.

최종 실행 결과:

| 검사 | 결과 |
| --- | --- |
| TypeScript | 통과; 프로덕션 빌드 내부 타입 검사도 통과 |
| ESLint | 통과 |
| 기존 자동 테스트 | 438/438 통과 |
| PostgreSQL 직접 연결 | 47/47 통과, 실패/skip 0 |
| 로컬 PgBouncer transaction 연결 | 같은 47/47 통과, 실패/skip 0 |
| 고유 전체 테스트 | **485개 통과**; 기존 483개 유지 + 신규 2개 |
| `npm run build` | Next.js 16.4.2 Turbopack 통과, 종료 코드 0 |
| 빌드 환경 | 합성 HTTPS/비밀, 접속 불가능한 DB 주소, 빈 AI 예산; 운영 접속/AI 호출 없음 |
| 운영 의존성 감사 | 0건 |
| 전체 의존성 감사 | 기존 개발 체인 10건(High 9, Moderate 1), 증가 없음 |
| migration | 로컬 새 스키마 생성/실패 rollback, 기존 스키마 2회 재실행 통과 |

풀 헬퍼를 로컬에도 무조건 연결했던 중간 실행에서는 DEBUG 출력이 테스트 worker의 JSON 출력을 방해했다. Vercel 환경에서만 연결하도록 범위를 제한한 최종 코드에서 직접/풀링 모두 다시 통과했다. 이는 인증을 끄는 환경 분기가 아니라 연결 수명 관리에만 해당한다. 실제 Vercel suspend/재시작 검증을 대체하지 않는다.

## 9. 승인 후 수행할 실제 클라우드 시나리오

1. 사용자가 준비한 `my-mind-model-beta`와 Git 미연동·`sin1`, 계정 plan/고정 URL/Production 정책 확인; All Deployments 보호 적용 승인.
2. 사용자가 생성한 Neon `my-mind-model` AWS 싱가포르 프로젝트의 테스트용 branch/DB/role, TLS, direct 관리/pooled runtime 접속을 승인받아 확인.
3. backup/restore 검증 후 migration·최초 Owner를 각각 승인받아 실행.
4. AI 변수 없이 고정 HTTPS Preview를 승인받아 배포; 로그인/새로고침/로그아웃/disable/revoke를 확인.
5. 세 AI API에서 익명·만료·비활성·Tester의 analyze·다른 Origin·예산 미설정 거부, 실제 SDK 0회 확인. 계정 정보/쿠키/요청 본문은 로그 제외.
6. 실제 pool에서 독립 인스턴스 경쟁·중복·복구·연결 수를 검증. 강제 restart/장애 주입은 격리 branch에서만 추가 승인 후 수행.
7. 기존 로컬 모형을 이용한 Q1~Q9 → Q10 승인 → 오로라/인용/비콘/매크로 경로는 Phase 6-A 검증 기록을 유지한다. 이번에는 실제 운영에서 전체 생성 성공을 확인했다고 주장하지 않는다.
8. 실제 모델 활성화는 별도 단계로 가격/접근 권한/전체 deadline/보수적 한도를 확정한 뒤, 승인된 단일 호출만 검토한다.

## 10. 이번 변경 범위

- `lib/server/security/database.ts`: PgBouncer 호환 timeout 범위, Vercel 풀 수명 연결.
- `package.json`, `package-lock.json`: 공식 `@vercel/functions@3.10.1` 고정 추가.
- `tests/private-beta.test.mts`: 기존 보안 테스트 유지 및 2개 회귀 추가.
- `docs/private-beta-infrastructure-readiness.md`: 감사·선택지·환경 명세·검증/승인 경계.

기존 인증 정책·개인화 계산·오로라 셰이더·Q10·철학적 프롬프트·결과 UI·분석 10개 계약·/aurora-lab 렌더링은 변경하지 않았다. `.env.example` 및 실제 환경 파일·ZIP·master/백업을 유지한다. 운영 DB/계정 생성과 실제 배포는 실행하지 않는다. 이번 체크포인트에서는 최종 검사 후 이 5개 파일만 지정된 메시지로 commit하고 `origin/feat/glass-nebula-aurora`에 일반 push한다.

### 체크포인트 저장 전 재검증

TypeScript, ESLint, 기존 자동 테스트 438개와 실제 로컬 PostgreSQL 보안 테스트 47개(합계 485개, 실패/skip 0), 프로덕션 빌드, 공백 검사를 다시 통과했다. 보안 테스트에는 두 별도 프로세스의 경쟁 예약·DB 장애·예산 미설정 거부·transaction-local timeout·롤백이 포함된다. 이번 재실행은 **로컬 직접 연결**이며 PgBouncer 경유 결과는 앞선 6-B 검증 기록과 구분한다. Neon에 연결하거나 운영 migration을 실행하지 않았다.

빌드는 실제 비밀 대신 합성 HTTPS 인증 설정·접속 불가능한 loopback DB 주소·비어 있는 AI 예산으로 검증했다. 운영 의존성 감사 0건, 기존 개발 경고 High 9/Moderate 1건이다. 기존 lockfile 패키지 버전은 유지되고 공식 풀 헬퍼 및 전이 의존성만 추가됐다. 새 코드에 TLS 우회 설정은 없으며 인증/사용량 정책은 바꾸지 않았다.

현재 재검증 로그는 ignored `node_modules/.cache/phase6b-checkpoint/`의 `unit-report.json`, `security-tests.log`, `build.log`, `audit-runtime.json`, `audit-all.json`에 보관한다. 실제 비밀·사용자 원문·환경 파일·ZIP·빌드 산출물을 커밋하지 않는다. 이 저장은 클라우드 배포·실제 TLS·Vercel freeze/재시작·실제 AI 과금 검증을 뜻하지 않는다.
