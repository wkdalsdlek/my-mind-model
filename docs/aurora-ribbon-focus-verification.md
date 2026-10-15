# Phase 5-C-2 · 리본 선택과 시네마틱 카메라 탐색

기준: `feat/glass-nebula-aurora`, `c48b02d7cd6cd0ae7ea8010777315cd791c11935`.
작업일: 2026-10-15(한국 시간). 범위는 결과 화면의 3D 선택·목록·카메라 포커스·전체 복귀입니다. 새 분석 패널/리본별 AI/새로운 오로라 효과는 구현하지 않습니다.

## 기존 구조와 연결

기존 메인 폐곡선 리본 2~4개, 보조 루프 2개 중 모드별 활성 0~2개, 메인/루프 미스트, 공통 field 변환, 개별 궤도, GPU fold를 유지합니다. 실제 결과는 기본 hybrid입니다. 5-C-1 `ribbonId`와 layer.renderKey를 모든 코어/미스트 mesh의 userData와 name에 연결합니다. 미스트는 부모 ribbonId를 공유하고 core mesh만 선택 registry에 등록합니다. 흐름 모드에서 비활성인 루프는 선택하지 않습니다.

결과 화면은 `buildAuroraRibbonMeaningFromResult`의 활성 항목만 목록으로 표시합니다. 이름과 두 색 endpoint는 매핑 그대로이며, 존재하지 않는 의미나 리본을 추가하지 않습니다. 직접 선택과 목록은 하나의 selectedRibbonId와 동일한 카메라 경로를 사용합니다. 기존 승인 제목과 요약/심층 패널을 유지합니다.

## 실제 보이는 표면 선택

CPU raycast/크기가 큰 투명 proxy 대신 **GPU ID pixel picking**을 사용합니다. [Three.js GPU 선택 안내](https://threejs.org/manual/pages/picking.html)와 [WebGLRenderer 명세](https://threejs.org/docs/pages/WebGLRenderer)를 확인했습니다.

- Scene과 PerspectiveCamera를 새로 만들지 않습니다. 기존 live Scene의 코어 mesh를 동일 geometry·정점 shader·현재 uniform으로 1×1 render target에 그립니다. camera.setViewOffset으로 실제 drawing-buffer 픽셀을 지정하므로 CSS 크기와 DPR을 구분합니다.
- 기존 fragment의 에너지·noise·양면·alpha·discard 경로를 보존하고 최종 RGB만 stable ribbon code로 바꿉니다. output color conversion/tone mapping은 ID 패스에서만 제거합니다.
- depthTest/depthWrite로 해당 픽셀에서 가장 앞쪽의 유효 코어 표면을 선택합니다. 넓고 옅은 미스트·별·성운·유리 조각은 ID 패스에서 제외합니다. 희미한 외곽 alpha<0.003도 선택하지 않으므로 목록이 대체 경로입니다.
- 렌더 target·viewport·scissor·clear 상태·Scene background·mesh material/visibility·camera view/aspect를 finally에서 복원합니다. 렌더 오류 시에도 복원하는 테스트가 있습니다. 픽킹 실패는 목록 안내로 처리하고 민감한 오류 객체를 로그하지 않습니다.
- 클릭/탭 때만 패스를 수행합니다. 매 프레임 픽셀 읽기, 두 번째 Canvas, 복제 Scene, CPU mesh 재생성은 없습니다. 픽킹 material은 리본별 유지하고 시각 material의 uniform 저장소와 geometry를 공유합니다.

실제 GPU fold를 다시 실행하므로 CPU proxy와 GPU 형상의 불일치가 없습니다. 다만 투명 혼합은 여러 리본의 색이 함께 보이므로 **최종 합성 색에서 사용자가 의도한 리본을 완벽히 역추정하는 것은 아닙니다.** 가장 앞쪽 유효 코어를 선택하는 정책입니다. 매우 옅은 미스트, 희박한 루프 구간, 후처리 Bloom만 보이는 위치는 목록을 사용합니다.

## 제스처·카메라 소유권

단일 primary pointer의 650ms 미만, 최대 이동 7 CSS px 이내만 tap으로 처리합니다. 중간에 멀리 이동했다가 돌아와도 drag입니다. 다중 터치·pinch·pointercancel·wheel·긴 누름·보조 버튼은 선택하지 않습니다. native canvas pointerdown과 window의 move/up/cancel을 관찰하지만 OrbitControls 이벤트를 가로채거나 stopPropagation하지 않습니다.

기존 AuroraCameraController가 계속 유일한 카메라 소유자입니다. 포커스/복귀 동안 OrbitControls를 비활성화하고 전체 모드 제어 UI도 잠시 비활성화합니다. 새로운 리본 목록은 계속 사용할 수 있습니다. 자동 공전에서 직접 tap 시 OrbitControls가 먼저 free로 바꾸더라도 pointerdown 시점의 원래 auto 모드를 보관해 복귀합니다. 일반 드래그는 기존 free 전환 동작을 유지합니다.

## 포커스 위치·시간·추적

- 선택 리본의 현재 model/world matrix에 공통 field와 개별 mesh 궤도를 포함합니다. 카메라 갱신이 현재 프레임의 리본 pose 갱신 뒤 실행되도록 frame 순서만 조정했습니다. 기존 운동 수식·시간·seed는 바꾸지 않습니다.
- 기본 geometry bounding box를 현재 closed GPU fold의 최대 변형량으로 확장하고 월드 AABB로 변환합니다. 중심에 실제 곡면 표본을 12% 섞어 얇은 표면 속으로 곧바로 접근하지 않는 완만한 곡률 편향을 만듭니다.
- 카메라의 기존 감상 방향을 유지하면서 월드 box 8개 코너의 수평/수직 FOV 투영을 맞춥니다. portrait aspect를 포함하고, 최소한 보수적 bounding sphere 밖 1.2 단위 여유를 확보합니다. near plane은 기존 0.1을 유지합니다.
- 위치와 look target을 함께 **1.35초 smootherstep**으로 보간합니다. 현재 위치/target에서 전환을 시작하므로 이동 중 다른 리본 선택·복귀 중 재선택에도 처음 구도로 점프하지 않습니다.
- 움직이는 경계/anchor와 거리 계산에는 감쇠를 적용합니다. 집중 후에도 기존 에너지와 궤도는 계속 움직이고 카메라는 천천히 따라갑니다. 매 프레임 React 상태를 바꾸지 않으며 위상 변경만 콜백합니다.
- Reduced Motion은 **0.08초**로 단축하고 수요 렌더링에서도 전환이 끝날 때까지 invalidate합니다. 이때 auto 복귀는 front framing으로 마쳐 추가 장시간 정면 복귀를 유발하지 않습니다.

전체로 복귀는 첫 선택 당시의 camera position/target/mode를 보존해 사용합니다. 같은 세션에서 리본을 바꿔도 원래 구도를 덮어쓰지 않습니다. 화면 비율이 바뀌면 필요한 거리만 보수적으로 조정합니다. 복귀 시 OrbitControls를 다시 설치해 남은 관성을 제거하고 front/free/auto 및 Reduced Motion 정책을 복원합니다. 빠른 재선택은 현재 전환을 새 시작점으로 삼으며 타이머/비동기 카메라 완료 요청을 중첩하지 않습니다.

## 강조·접근성·성능

선택 리본의 색·발광·유리 shader·에너지 계산을 바꾸지 않습니다. 다른 리본/미스트의 기존 opacity target만 0.38배로 감쇠하고, 전체 복귀 시 1로 되돌립니다. 별/성운/유리 조각은 감광하지 않습니다. 추가 시각 material이나 scene을 매 프레임 생성하지 않습니다.

목록은 native button/aria-pressed와 실제 색 swatch를 사용합니다. Tab·Enter·Space와 방향키/Home/End 탐색을 지원합니다. 직접 3D 선택은 복귀 버튼으로 키보드 포커스를 옮겨 Esc도 작동하도록 하고, 목록 선택은 목록의 키보드 포커스를 유지합니다. 전체 복귀 뒤 선택했던 목록 버튼으로 포커스를 돌립니다. 버튼/목록은 WebGL 불가 시 비활성화합니다. 모바일 터치를 지원하며 mobile 여부로 품질을 자동 강등하거나 정적 이미지로 바꾸지 않습니다.

선택용 RT/픽킹 material·이벤트 리스너·registry 등록을 각 소유자의 수명에 맞춰 해제합니다. 기존 Strict Mode resource cleanup을 재사용합니다. frame 내부에는 새 Vector/Box/React 상태를 만들지 않습니다. 동기 1픽셀 GPU readback 및 첫 ID shader compile은 클릭 순간 드라이버 지연을 만들 수 있으며 실기기 측정이 필요합니다.

## 검증

- `npx tsc --noEmit --incremental false`: 통과.
- `npm run lint`: 통과, 경고 없음.
- 전체 자동 테스트 **311개 통과**(기존 288개 + 신규 포커스 23개), 실패/취소/건너뜀 없음. 기존 결과 JSX 테스트에는 실제 의미 매핑 의존성을 추가했고, 5-C-1의 identity metadata 금지 조건만 새 단계의 실제 userData 연결 검증으로 갱신했습니다. 기존 분석/API/질문/5-A/의미 계산 검증은 유지합니다.
- 신규 테스트: 모든 품질/모드 ID 코드, shader/실제 uniform 공유, 배경/잘못된 ID 거부, opacity 정책, mouse/touch tap·drag·pinch·cancel·wheel·보조 버튼 구분, 1.35초 easing, portrait FOV·거리, 연속 선택/복귀 중 재선택, front/free/auto 복원, Reduced Motion 즉시성, 움직이는 bounds 감쇠/resize, registry 교체 cleanup, 공통 field/world 변환, GPU 패스 성공/실패 후 원상복구를 검사했습니다.
- `git diff --check` 및 신규 파일 공백 검사: 통과.

실제 로컬 앱 `http://127.0.0.1:3000/`와 Chromium/ANGLE SwiftShader의 WebGL 2에서 최종 browser helper가 통과했습니다. 검증 viewport는 desktop 820×640, mobile 390×844 및 440×844입니다. 초기 큰 viewport의 소프트웨어 렌더링 검증은 느려 종료하고 작은 검증 화면으로 다시 실행했습니다. 앱의 기기별 품질 정책은 바꾸지 않았습니다.

- 실제 핵심 의미 5계열의 메인 4개 + 활성 루프 1개 목록을 확인했습니다. 전 항목 선택/재선택, 원래 camera position 복귀, 같은 Canvas 유지가 통과했습니다.
- 실제 GPU 패스에서 curtain:1의 `[2,85,170,255]` ID 픽셀을 읽어 목록 선택과 일치함을 확인했습니다. 직접 선택 후 복귀 버튼 포커스와 Esc 복귀도 확인했습니다. 자동 공전의 mode 복원과 실제 카메라 이동 재개를 검사했습니다.
- drag가 선택되지 않음, 전환 중 다른 리본 선택, 돌아가는 중 재선택, 집중 중 energyTime 증가, 방향키/Enter/Esc, Reduced Motion이 통과했습니다.
- mobile 목록 touch와 **3D 표면 직접 touch**, resize 중 선택 유지, low/balanced/high 선택 및 복귀가 통과했습니다. 실제 승인 제목과 기존 요약 패널의 텍스트도 확인했습니다.
- ID shader warm-up 이후 5회 집중/복귀 반복에서 live buffer 76→76, texture 10→10, program 9→9였습니다. 이는 한 context의 짧은 반복에서 관찰한 수이며 전체 GPU 바이트/VAO/장시간 누수 검증은 아닙니다.
- 최종 WebGL getError=0, 관찰한 브라우저/React 오류 없음. 실제 OpenAI 호출 0회, 모킹된 analyze 요청 1회.
- 결과: `/tmp/aurora-focus-browser/report.json`, 캡처: `desktop-focus.png`, `mobile-focus.png`. 최종 helper를 수정 후 다시 실행해 위 결과를 확인했습니다. 정상 완료 보고가 이전 중단 기록보다 우선합니다.

추가·수정 파일:

- `lib/aurora-ribbon-focus.ts`, `lib/aurora-ribbon-focus-camera.ts`, `lib/aurora-ribbon-picking.ts`
- `components/aurora/AuroraRibbonPointerSelection.tsx`, `AuroraRibbons.tsx`, `AuroraCameraController.tsx`, `GlassNebulaAurora.tsx`
- `components/result/AuroraResultScreen.tsx`, `AuroraResultScreen.module.css`
- `tests/aurora-ribbon-focus.test.mjs`, `tests/aurora-result.test.mjs`, `tests/aurora-ribbon-meaning.test.mjs`, `tests/helpers/verify-ribbon-focus.mjs`
- 이 문서

브라우저 helper는 로컬 앱에 로그인한 뒤 합성 Q1 답변, Q2~Q9 명시적 skip, Q10 직접 승인, 모킹된 10개 분석으로 결과에 진입합니다. 로컬 인증 값은 읽기만 하며 로그/보고에 넣지 않습니다. `/api/analyze`는 모킹하고 나머지 `/api/*`와 외부 요청은 차단합니다. 실제 OpenAI 호출은 0회입니다.

재현 명령(Playwright와 Chromium 및 필요한 공유 라이브러리 필요):

```sh
npx tsc --noEmit --incremental false
npm run lint
for test_file in tests/*.test.mjs; do
  node --test-reporter=tap "$test_file" || exit 1
done
git diff --check
AURORA_PLAYWRIGHT_MODULE=/path/to/playwright node tests/helpers/verify-ribbon-focus.mjs
```

검증 의존성과 캡처는 `/tmp/aurora-focus-tools`, `/tmp/aurora-focus-libs`, `/tmp/aurora-focus-browser`에만 준비했습니다. 프로젝트 의존성/lockfile/환경 파일과 기존 실행 중인 개발 서버는 변경하지 않았습니다. 캡처 확인용 복사본은 gitignore 대상 `.next` 안에 있습니다.

## 한계 및 5-C-3 연결

- 실제 하드웨어 GPU의 FPS 급락, 첫 픽킹 지연, 모바일 발열, 장시간 메모리와 기기별 투명 정렬은 미검증입니다. 소프트웨어 WebGL에서는 고화질/큰 뷰포트가 느렸으며 이를 하드웨어 성능 결과로 일반화하지 않습니다.
- 기존 상단/사선 시점의 자기 교차·투명 표면·loop 겹침은 재설계하지 않았습니다. bounding box가 보수적이어서 어떤 리본은 기대보다 덜 가까이 보일 수 있고, 다른 리본과 교차하는 모든 이동 경로의 완전한 충돌 회피를 보장하지 않습니다.
- 테스트 환경의 한글 시스템 글꼴 부족으로 캡처의 일부 글리프가 네모로 보입니다. 제목/목록/분석의 실제 한글은 DOM으로 검증했으며 앱 폰트를 임의로 변경하지 않았습니다.
- 5-C-3는 결과 화면의 selectedRibbonId, focusPhase, 5-C-1 mapping과 기존 분석 데이터를 사용하면 됩니다. 이번에는 ribbonSynthesis를 생성하거나 기존 분석 패널을 삭제하지 않았습니다. 새 AI 요청을 연결하지 않았습니다.
- `/aurora-lab`은 새 선택 콜백을 전달하지 않으므로 픽킹 RT/material/리스너를 만들지 않고 기존 감상 모드를 유지합니다. 5-A·5-C-1 계산·API·Q10/질문 상태·형상·에너지·오로라 shader는 그대로입니다.

커밋·푸시·배포·브랜치 전환을 수행하지 않습니다. ZIP·환경 파일·master·백업 브랜치를 보존합니다.
