# Phase 5-C-3B — Philosophical Universe

Phase 6-A 이후 인증된 통합 실행 방법은 [보안 검증 문서](private-beta-security-verification.md)를 사용한다. 아래 상수 로그인·비인증 API 결과는 Phase 5 당시의 기록이다.

실제 Next.js 후속 통합 검증과 인증 위험은 [별도 기록](aurora-next-integration-verification.md)을 참고한다. 아래의 별도 번들 검증은 당시 수행 범위의 기록으로 유지한다.

기준: `feat/glass-nebula-aurora`, `297333184d1b72798cb7ba52b3cb37a03aef6b61`.
5-C-3A 데이터 계약을 실제 결과 화면에 연결한다. 커밋·푸시·배포와 실제 OpenAI 호출은 수행하지 않는다.

## 생성 경로와 비용

- `app/page.tsx`는 현재 Q10 승인을 확인한 뒤 `AuroraUniverseRequestController.generate`를 사용한다.
- 브라우저의 정상 생성은 `/api/aurora-interpretation` POST **1회**다. `/api/analyze`를 병행하지 않는다.
- 서버의 기존 GPT-6.1 Sol Medium, strict 출력, 시도당 45초/전체 95초 및 검증 실패 시 최대 1회 추가 시도 정책은 변경하지 않았다. 브라우저의 1회 요청이 서버 내부에서 최대 2회의 유료 생성으로 이어질 수 있다.
- 클라이언트 자동 재시도는 없다. 사용자가 명시적으로 다시 요청한 경우만 새 POST를 보낸다. 인용 후보 부족 상태에서도 재요청은 명시적 버튼으로만 실행한다.
- 리본 선택, 비콘, 매크로, 전체 읽기, 복귀, 품질 변경은 저장된 결과만 사용한다. 추가 API 비용이 없다.
- 레거시 `/api/analyze`, 10 comments 검증, 독립 요청 컨트롤러 및 테스트는 보존했다.

## 결과 계약과 응답 경계

`AuroraUniverseResult`는 로컬 개인화 스냅샷, 로컬 재계산 context와 두 상태를 가진다.

- `interpreted`: 서버의 검증된 철학적 전체·리본 해석.
- `quote-unavailable`: HTTP 422 + `QUOTE_CANDIDATES_INSUFFICIENT`일 때만 진입. `interpretation: null`. 실제 오로라·승인 문장·결정적 근거만 표시하고 전체 해석 버튼은 비활성화한다. 없는 이름·인용·분석을 생성하지 않는다.

공유 순수 검증기 `aurora-interpretation-validation.ts`로 기존 서버 파서를 이동하고 서버의 기존 export도 유지했다. 모델·프롬프트·스키마·재시도 조건은 바꾸지 않았다. 클라이언트는 다음을 다시 확인한다.

1. 버전과 정확한 필드 구조.
2. 로컬 입력 fingerprint/digest, 승인 문장·출처, quality/flowMode 바인딩. 승인 시각은 요청 형식 검사 대상이며, digest에는 본문·출처를 묶는 기존 5-C-3A 정책을 유지한다.
3. 모든 결정적 facts가 로컬 계산과 정확히 일치하는지.
4. 검증된 카탈로그 인용의 원문·저자·출처·번역 메타데이터.
5. 모든 활성 ribbonId의 존재·유일성. 배열 순서는 달라도 ID로 정규화한다.
6. 기존 서버와 동일한 텍스트·근거 참조·Q10 연결 검증. 중립 리본의 결정적 안내문과 origin도 재검증한다.

동기 잠금은 비동기 digest 준비부터 응답 JSON 검증과 화면 전환까지 유지된다. 취소·언마운트·이전 요청의 지연 응답은 새 요청의 잠금이나 화면을 변경하지 않는다. 클라이언트 전체 제한은 105초다. 입력 변경 또는 승인 무효화 시 취소하고, 완료 시 fingerprint뿐 아니라 승인 문장과 출처도 다시 비교한다. 응답 원문이나 입력 원문을 로그에 출력하지 않는다.

## 화면과 의미 일관성

- 기존 Canvas·Scene·GPU 셰이더·카메라·비콘·매크로·5-A·5-C-1 계산을 재사용한다.
- 헤더는 `generated.auroraName`, 검증된 인용문, 저자, 선정 이유를 표시한다. 키케로의 문구는 플라톤의 말을 전한다는 맥락도 표시한다. 출처 정보에서 원문·번역 출처·문맥을 확인할 수 있다.
- Q10 승인 문장은 내부 스냅샷과 전체 해석의 참고 문장으로 보존한다.
- `나의 오로라 읽기` 한 곳에서 `generated.overall`을 표시한다. 기존 요약/심층 버튼은 새 화면에서 제거했다.
- 읽기 패널은 배경을 inert로 만들고, 제목에 포커스를 주며 Tab을 패널 안에 유지한다. Esc/닫기 후 inert 해제 뒤 진입 버튼으로 포커스를 복원한다. 읽는 동안 뒤쪽 제목·컨트롤을 숨겨 겹침을 줄였다.
- 매크로 분석은 선택한 **동일 ribbonId**의 psychological/philosophical/reflectionQuestion과 결정적 실제 답변·질문·복합 의미·visualExplanationText만 사용한다. 선택 변경 시 분석 스크롤을 처음으로 되돌린다.
- Q3·Q7·Q8·Q9의 비핵심 맥락을 핵심 성격 근거로 옮기지 않으며, 아직 구현하지 않은 특수 효과를 적용된 것처럼 설명하지 않는다.
- quality 변경은 결과의 flowMode를 고정한 채 렌더링 예산만 변경한다. 활성 ID와 핵심 shape/visual/identityProfile이 같을 때만 적용한다. 다른 리본의 분석을 색이나 배열 순서로 추정하지 않는다.
- 모든 기기에서 사용자가 고른 low/balanced/high를 유지한다. 브라우저 검증 중 low는 테스트가 명시적으로 선택한 값이며 기기 자동 강등이 아니다.
- 목록은 한 줄 가로 탐색으로, 리본 6개인 데스크톱과 좁은 모바일에서도 안내문과 겹치지 않도록 했다. 폰트·긴 선정 이유는 줄바꿈과 스크롤로 처리하며 텍스트는 HTML이다.

## 폰트

- 제품에 자체 호스팅한 `NanumPenScript-Regular.ttf`와 원본 `OFL.txt`를 포함했다. [Google Fonts 원본 메타데이터](https://github.com/google/fonts/blob/main/ofl/nanumpenscript/METADATA.pb), [SIL OFL 원문](https://github.com/google/fonts/blob/main/ofl/nanumpenscript/OFL.txt).
- 폰트 3,201,664 bytes, SHA-256 `6f0d1ab29c7894010dc88831fb7a0a51edb79136e450344183de5b1a8b52bd43`.
- `font-display: swap`과 Apple Chancery / Georgia / Noto Serif KR / serif fallback을 사용한다. 외부 폰트 요청이 필요 없다. 라이선스는 폰트와 함께 보관한다.
- Chromium의 UI 한글 표시에는 별도의 임시 Noto Sans KR 시스템 폰트를 사용한다. 이것은 제품 의존성에 추가하지 않았다. 모든 실제 운영체제의 한글 fallback을 확인한 것은 아니다.

## 자동 검사

최종 검사: TypeScript, ESLint, 전체 자동 테스트 **438/438**, 공백 검사 모두 통과했다.

- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `tests/*.test.mjs` 각 파일을 `node --test-reporter=tap`으로 실행한다. 총합은 각 TAP의 `# tests`를 합산한다.
- `git diff --check`
- 기존 395개 회귀 범위를 유지하며 결과 화면의 기존 4개 검증은 새 계약에 맞게 수정했다. 신규 요청/검증/전체 응답 경로 36개 + 신규 UI 7개, 총 **438개**.
- 신규 회귀: 단일/중복 요청, 모든 문항 답변, 바인딩·원문·색·ID·인용·origin 변조, 중립 근거, 실패/재시도, 취소/언마운트/지연 응답, timeout, 네이티브 fetch 호출 문맥, 품질별 ID 일관성, 카탈로그/명시적 fallback/폰트 라이선스.

## Chromium 검증과 재생성

도구: `tests/helpers/verify-universe-ui.mjs`. 실제 Home와 AuroraResultScreen 소스를 번들링하고 실제 WebGL 렌더러를 사용한다. 모든 외부/API 네트워크 요청을 Playwright에서 가로챈다. 합성 답변과 합성 해석만 사용하며 유료 API 요청은 0회다.

기존 Next 개발 서버가 127.0.0.1:3000에서 응답하지 않아 종료하거나 변경하지 않았다. 이 검증은 **실제 Next 런타임/라우팅 검증이 아니다**. 서버 처리기는 기존·신규 모킹 단위 테스트로 확인한다.

현재 환경 재실행 예:

```sh
# Playwright, esbuild와 Chromium/OS 라이브러리가 설치된 테스트 환경에서 실행.
# 의존성은 프로젝트 package.json/lockfile 대신 /tmp/aurora-universe-tools에 설치.
env LD_LIBRARY_PATH=/tmp/aurora-universe-libs/root/usr/lib/x86_64-linux-gnu FONTCONFIG_FILE=/tmp/aurora-universe-fonts/fonts.conf node tests/helpers/verify-universe-ui.mjs
env AURORA_UI_CASE=full AURORA_UI_OUTPUT=/tmp/aurora-universe-browser-final LD_LIBRARY_PATH=/tmp/aurora-universe-libs/root/usr/lib/x86_64-linux-gnu FONTCONFIG_FILE=/tmp/aurora-universe-fonts/fonts.conf node tests/helpers/verify-universe-ui.mjs
```

이미 통과한 동작을 반복하지 않고 이미지만 보완할 때는 `AURORA_UI_CASE=captures`, 6개 리본의 목록과 마지막 리본 키보드 선택만 확인할 때는 `AURORA_UI_CASE=six`를 사용할 수 있다. Scene 교체 시 이전 Canvas가 제거되고 새 Canvas·모든 비콘이 준비될 때까지 기다리며, 촬영 전 두 animation frame을 더 기다린다. 초기화 직후의 빈 프레임은 최종 시각 자료로 사용하지 않는다.

`AURORA_UI_TOOLS`로 Playwright/esbuild 설치 경로, `AURORA_UI_OUTPUT`으로 출력 경로를 지정할 수 있다. 실행에는 실제 OpenAI 키가 필요 없다. 실제 Home 로그인 상수는 로컬에서만 읽어 입력하고 출력하지 않는다. 임시 JS 번들은 배포/공유 자료에 포함하지 않는다.

과거 `verify-aurora-result`, `verify-analysis-integration`, `verify-ribbon-focus/macro`의 Home 경로는 당시 레거시 제목·요약/심층 UI를 전제로 한 기록이다. 현행 결과 화면 검증은 새 `verify-universe-ui`를 사용한다. 독립 Polish 프리뷰와 레거시 API 단위 테스트는 보존했다.

검증 이미지와 비민감 JSON은 ignored `.next/aurora-universe-verification/`에 보관한다. Git에 강제 추가하지 않는다.

### 실제 확인 결과

- 기본 회귀 실행: 통과. 신규 API 모킹 4회(최초 성공 1 + 의도적 실패 1 + 수동 재시도 성공 1 + 후보 부족 1), 레거시 API 0회. 실제 유료 호출 0회. 중복 클릭은 최초 요청 1회로 잠겼다.
- 전체 입력 실행: Q1~Q9 모두 선택 → 직접 작성한 Q10 승인 → 신규 해석 모킹 1회 → 실제 결과 Canvas 진입. 매크로 심리·철학 해석, 모바일, 긴 인용문, 읽기 패널과 Esc 포커스 복원 통과.
- 추가 촬영: 후보 부족 HTTP 422 후 실제 오로라와 승인 문장, 리본 2개·6개·중립, 가장 긴 카탈로그 문구와 긴 선정 이유, 모바일 읽기 화면 확인. API 요청은 후보 부족 1회뿐이며 fixtures 탐색은 0회다.
- 6개 리본의 최종 데스크톱 촬영과 목록 Home/End → 마지막 리본 Enter 선택 → 전체 복귀도 통과했다. 이 실행의 API 요청은 0회이며 `six-report.json`에 남겼다.
- 모든 활성 기본 비콘 5개 선택·복귀, 리본 간 재선택, 자동 공전 모드 복원, 모바일 터치/리사이즈, Reduced Motion, low/balanced/high와 고정 ribbonId를 확인했다. 감상·품질 변경 중 요청 증가가 없었다.
- 포커스/복귀 반복 전후 추적한 GL 객체 수: buffers 76→76, textures 9→9, programs 8→8. 이것은 짧은 실행의 객체 수 확인이며 실제 GPU 메모리 측정이나 장기 누수 검증이 아니다.
- ANGLE SwiftShader에서 `gl.getError() = 0`, 셰이더 컴파일/링크 오류 0, 실제 page/runtime 오류 0. 의도적으로 주입한 HTTP 502·422의 Chrome 네트워크 콘솔 메시지는 별도로 분류했다.
- 이미지 직접 확인 후 읽기 패널 뒤의 제목 겹침, inert 해제 전 포커스 복원, 모바일/6개 목록과 안내문 겹침, 인용문 한국어 어절 중간 줄바꿈을 수정했다. 3D 형상·셰이더·색·에너지 파라미터는 변경하지 않았다.

선별한 최종 자료(저장소 루트 기준):

| 자료 | `.next/aurora-universe-verification/` 아래 파일 |
| --- | --- |
| 데스크톱 전체 우주 | `desktop-universe-final.png` |
| 데스크톱 전체 읽기 | `desktop-overall.png` |
| 데스크톱 매크로와 심리·철학 해석 | `desktop-macro-final.png`, `desktop-macro-analysis-final.png` |
| 모바일 전체 / 매크로 | `mobile-universe-final.png`, `mobile-macro-final.png` |
| 모바일 품질 비교 | `mobile-macro-balanced.png`, `mobile-macro-high.png` |
| 후보 부족의 명시적 대체 상태 | `quote-unavailable-final.png` |
| 리본 2개 / 6개 / 중립 | `final-fixture-two.png`, `final-fixture-six.png`, `final-fixture-neutral.png` |
| 마지막 보조 루프 키보드 선택 | `final-sixth-ribbon-macro.png` |
| 좁은 화면의 카탈로그 최장 문구 / 읽기 | `mobile-longest-catalog-quote.png`, `mobile-overall.png` |
| 비민감 실행 기록 | `matrix-report.json`, `full-report.json`, `captures-report.json`, `six-report.json` |

## 남는 한계

- Chromium ANGLE SwiftShader는 소프트웨어 WebGL이다. 실제 GPU FPS·발열·장시간 메모리·터치 기기 품질은 미검증이다.
- 카메라 상단 시점의 기존 자기 교차/곡면 어색함과 초근접 미스트의 부드러움은 이번에 재설계하지 않았다.
- 인용 카탈로그는 여전히 세 개다. 부적합하면 명시적 대체 상태를 사용하며 해석을 꾸며내지 않는다.
- digest와 근거 참조 검증은 연결 일관성을 보장한다. AI 해석의 철학적 적합성·품질·심리적 단정 여부를 전부 증명하지는 못한다.
- 실제 모델 접근 권한, 생성 품질, 지연·토큰·비용과 실제 Next 서버에서의 전체 경로는 유료 호출 없이 확인하지 않았다.
- 폰트 파일은 약 3.2 MB이며 최초 로딩 비용이 있다. 실패 시 fallback 텍스트로 읽을 수 있다.

## 변경 파일 전체 — 16개

```text
app/page.tsx
app/page.module.css
app/api/aurora-interpretation/route.ts
components/result/AuroraResultScreen.tsx
components/result/AuroraResultScreen.module.css
lib/aurora-universe.ts
lib/aurora-interpretation-validation.ts
lib/server/aurora-interpretation-service.ts
tests/aurora-result.test.mjs
tests/aurora-universe.test.mjs
tests/aurora-universe-ui.test.mjs
tests/helpers/aurora-universe-fixture.mjs
tests/helpers/verify-universe-ui.mjs
public/fonts/nanum-pen-script/NanumPenScript-Regular.ttf
public/fonts/nanum-pen-script/OFL.txt
docs/aurora-universe-verification.md
```
