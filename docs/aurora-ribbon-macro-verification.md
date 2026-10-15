# Phase 5-C-2R · Immersive Universe & Ribbon Macro Focus

기준 브랜치 `feat/glass-nebula-aurora`, 저장 HEAD `c48b02d7cd6cd0ae7ea8010777315cd791c11935`.
미커밋된 5-C-2 구현을 유지하면서 결과 화면의 공간 구성·선택·카메라를 확장합니다.
이 문서는 5-C-2 검증 문서의 전체 경계 상자 포커스 설명을 대체하는 후속 기록입니다.

## 실제 리본과의 연결

- 기존 Canvas 한 개와 live Scene, core/mist geometry, 개인화 색상, GPU fold, 에너지 이벤트/seed/clock을 재사용합니다. Scene 복제, 매크로용 가짜 리본, 영상 대체를 만들지 않습니다.
- `AuroraRibbonInteraction.surfacePoint`는 현재 geometry의 UV 격자에서 실제 indexed triangle을 찾습니다. 세 꼭짓점에 현재 vertex shader의 periodic closed fold를 동일하게 적용한 뒤 triangle barycentric 보간과 현재 `matrixWorld`를 적용합니다. 단순 해석 곡선 대용이나 변형 전 CPU raycast가 아닙니다.
- `surfaceFrame`은 선택 구간의 중앙, 길이 방향 양옆, 너비 방향 양옆을 샘플링해 접선·너비·법선을 계산합니다. 공통 field와 개별 궤도 변환을 포함합니다. geometry를 매 프레임 다시 만들지 않습니다.
- 비콘에서 선택한 실제 u를 registry에 전달합니다. 목록/GPU 보조 선택은 안정적인 기본 u=.2를 사용합니다. 같은 ribbonId 안에서 구간을 바꿔도 현재 카메라에서 다시 연속적으로 전환합니다.

## 전체 화면과 선택

- 빈 HTML 오버레이 영역은 pointer-events를 통과시키고, 버튼·텍스트·설명 영역만 입력을 받습니다. 기존 Canvas의 직접 선택·드래그·자동 공전 제어를 가로채지 않습니다.
- 결과 화면의 기존 Canvas를 `fixed; inset:0; height:100svh`로 확장합니다. 중앙 사각 뷰어·테두리를 제거하고, 승인 문장과 제어는 HTML로 유지합니다.
- 실제 5-C-1 active mapping에서 비콘·목록을 생성합니다. 이름과 색 endpoint, ID를 그대로 사용하며 비활성 loop나 임의의 리본을 추가하지 않습니다.
- 각 비콘은 실제 surface 후보 8개 중 화면에 잘 노출되고 앞에 있는 후보를 선택합니다. 후보 유지 편향으로 불필요한 교체를 줄입니다.
- 비콘은 HTML 오버레이이므로 다른 투명 리본의 depth에 가려지지 않습니다. 화면 투영 후 48px native button의 충돌을 피하고 실제 표면 투영점과 버튼 사이에 leader를 표시합니다. 겹친 경우의 화면 이동은 실제 앵커 위치를 바꾸지 않습니다. 근처 배치가 어려우면 화면 내 격자 후보로 분리합니다.
- Hover 또는 키보드 포커스 중에는 48px 선택 목표와 구간 u를 잠시 고정합니다. 연결선의 시작점은 움직이는 실제 표면을 계속 추적하고, 다른 비콘은 고정된 목표를 피해 배치합니다. 입력 의도가 있는 동안 버튼이 커서 아래에서 달아나지 않습니다.
- 매 프레임 DOM transform/leader만 갱신하며 React state나 별도 GPU picking pass를 사용하지 않습니다. GPU ID picking은 기존 표면 클릭의 보조 수단으로 유지합니다.
- 매크로에서는 비콘을 숨겨 감상을 방해하지 않고, 실제 활성 리본 목록으로 다른 리본을 즉시 선택할 수 있습니다. 목록은 native button/방향키/Home/End를 유지합니다.

## 매크로 구도와 전환

- 전체 AABB/sphere를 맞추는 기존 카메라 대신, 선택한 작은 실제 표면의 법선 방향에서 약간 비스듬히 접근합니다. 국소 너비와 FOV로 거리를 계산하고 최소 .9 world unit를 유지합니다. 전체 리본 확대나 scene scale 변경이 아닙니다.
- 위치·look target·camera up을 1.35초 smootherstep으로 보간합니다. Reduced Motion은 기존 .08초 정책을 유지합니다. normal 방향의 부호는 선택 순간 고정해 추적 중 앞뒤 반전이 일어나지 않도록 합니다.
- 집중 후 위치·방향에는 감쇠를 적용합니다. desktop aspect>=1.2에서는 표면 중앙을 NDC x=-.38(화면 왼쪽 31%)에 놓고, portrait에서는 y=.4(화면 위쪽 30%)에 놓습니다.
- 기존 shader에 periodic UV 마스크만 추가합니다. 같은 core/mist의 u 구간을 부드럽게 남기고 나머지 구간을 숨깁니다. 다른 리본은 기존 opacity의 .018배로 감쇠합니다. 마스크 0인 전체 감상과 `/aurora-lab`의 원래 shading은 그대로입니다.
- 선택 표면의 실제 noise/색/유리/flow/에너지 uniforms은 바꾸지 않습니다. 개별 에너지 lane의 실제 이동 방향과 중첩도 보존합니다.
- 첫 선택 시 position/target/up/mode를 저장하고 연속 선택에서도 덮어쓰지 않습니다. 복귀·복귀 중 재선택·종횡비 변경·auto/front/free 복원은 기존 카메라 소유권 구조를 사용합니다.

## 의미와 분석 범위

- desktop 오른쪽 38%, mobile 상단 57% 감상 영역 아래에서 실제 이름·복합 의미 비중·선택 근거를 보여줍니다. 화면 내 색 면적이나 성격 점수로 표현하지 않습니다.
- 원문이 검증되어 전달된 경우만 원문을 사용합니다. fixed evidence는 검증된 keywordId의 고정 문구를 표시하고, 사용자 정의 원문이 없는 경우 추정하지 않는다고 표시합니다.
- 기존 분석 참조는 명시적으로 **문항 전체 해석**이라고 표시합니다. 리본 전용 분석으로 재포장하지 않으며 새 AI 종합문을 생성하지 않습니다. Q3/7/8/9의 맥락은 기존 매핑 정책을 유지합니다.
- 기존 전체 요약/심층 분석 패널과 승인 문장은 유지합니다. 전체 분석 버튼은 전체 감상에서 접근합니다. 5-C-3은 selectedRibbonId, segment u, 기존 `interpretation.questionAnalyses`, `ribbonSynthesis: not-generated`에 연결할 수 있습니다.

## 검증 기록

- TypeScript: `npx tsc --noEmit --incremental false` 통과.
- ESLint: `npm run lint` 통과, 경고 없음.
- 전체 자동 테스트 **320개 통과**: 기존 311개 유지 + 신규 9개(실제 변형 표면/품질/폐곡선 경계, 이동 추적, 6개 비콘 겹침/화면 밖 앵커, desktop/mobile 매크로 프레이밍, 구간 재선택, 실제 JSX 비콘 계약 등). 실패/취소/건너뜀 없음.
- `git diff --check` 및 신규 소스·테스트·문서 공백 검사 통과.

최종 `tests/helpers/verify-ribbon-macro.mjs`가 실제 로컬 앱과 Chromium **ANGLE Vulkan SwiftShader WebGL 2**에서 정상 종료했습니다. Desktop 820×640, mobile 390×844 및 440×844를 사용했습니다. 첫 큰 viewport의 소프트웨어 검증은 느려 작은 화면으로 다시 검증했으며 앱의 기기별 품질 설정은 바꾸지 않았습니다.

- 활성 메인 4개 + 보조 루프 1개의 ID와 48px 비콘이 일치하며, 실제 화면 hit testing으로 전부 가림/겹침 없이 선택 가능한 것을 확인했습니다. 모든 비콘의 올바른 목록 선택과 각각의 매크로 캡처가 통과했습니다. 6개가 같은 위치/화면 밖에 있는 경우의 분리 배치는 단위 테스트로 별도 확인했습니다.
- 전체 화면 Canvas bounds가 viewport 전체와 일치합니다. 전체/집중/복귀와 다른 리본 선택에도 **동일 Canvas**를 유지합니다.
- 실제 1픽셀 GPU 보조 선택, 빈 HTML 오버레이의 입력 통과, drag가 선택으로 오인되지 않음, 자유 탐색 중 비콘 노출이 통과했습니다.
- 연속 선택/복귀 중 재선택, 원래 camera position 복귀, 자동 공전의 mode 복원 및 실제 이동 재개가 통과했습니다. 움직이는 비콘은 실제 mouse 이동으로 Hover한 뒤 클릭했습니다.
- Reduced Motion의 키보드 비콘 진입/Enter/Esc 복귀, 모바일 실제 beacon tap, 집중 중 resize가 통과했습니다.
- low에서 desktop 및 mobile 화면을 캡처했고, mobile balanced/high에서도 구간 선택·캡처·복귀 및 사용자 품질 유지가 통과했습니다. 모든 품질의 표면·geometry 정합성은 단위 테스트로 검증했습니다.
- desktop 메인/루프의 **한 줄기가 화면 왼쪽을 크게 가로지르는 구도**, 오른쪽 HTML 의미 영역, mobile 상단 확대/하단 의미 영역을 직접 캡처로 확인했습니다. 시간차 `desktop-macro-animated.png` / `desktop-macro-animated-later.png`를 비교해 기존 energy clock 증가와 실제 유색 코어의 밝기 변화가 이어짐을 확인했습니다. 일부 에너지 휴지기에는 구간이 더 부드러운 안개로 보입니다. 모든 시점의 최종 미학을 승인한 것은 아닙니다.
- 반복 집중/복귀 5회에서 live buffer **76→76**, texture **10→10**, program **9→9**였습니다. GPU 바이트·VAO 전체나 장시간 누수 검증은 아닙니다.
- 최종 `gl.getError()=0`, 관찰한 shader compile/link 오류 **0**, 브라우저/React 오류 **0**. 기존 승인 문장과 전체 요약 분석 텍스트를 DOM으로 확인했습니다.
- 모킹된 analyze 요청 **1회**, 실제 OpenAI 요청 **0회**. 기타 앱 API와 외부 요청은 차단했습니다. 로컬 인증 값은 출력하지 않으며 실패 보고도 해당 값을 마스킹합니다.

성공 보고서는 `.next/aurora-macro-verification/report.json`, 캡처는 같은 폴더의 `desktop-universe.png`, `desktop-macro-0.png`~`4.png`, `desktop-macro-animated*.png`, `mobile-universe.png`, `mobile-macro.png`, `mobile-macro-balanced.png`, `mobile-macro-high.png`에 있습니다. 원본은 `/tmp/aurora-macro-browser`에 있습니다. `.next` 복사본은 gitignore 대상이며 실패/중간 캡처를 성공 보고서에 포함하지 않았습니다.

재현:

```sh
npx tsc --noEmit --incremental false
npm run lint
for test_file in tests/*.test.mjs; do
  node --test-reporter=tap "$test_file" || exit 1
done
git diff --check
AURORA_PLAYWRIGHT_MODULE=/path/to/playwright node tests/helpers/verify-ribbon-macro.mjs
```

검증 도구/다운로드한 공유 라이브러리는 `/tmp/aurora-macro-tools`, `/tmp/aurora-macro-libs`에만 준비했습니다. 시스템 패키지 설치, 프로젝트 의존성·lockfile·환경 파일 변경이나 기존 실행 서버 교체는 하지 않았습니다.

## 한계

- HTML 비콘은 선택 가능성을 위해 깊이 가림을 사용하지 않습니다. 연결선이 있는 비콘은 실제 투영점에서 화면상으로 이동한 표식입니다. 매우 작은/가로로 낮은 화면에서는 목록도 보조 경로로 사용합니다.
- 기존 투명 자기 교차와 일부 상단/사선에서의 면 겹침은 geometry 재설계로 해결하지 않습니다. 매크로는 다른 구간을 숨겨 이를 완화합니다. 모든 가능한 이동 경로의 표면 충돌 회피를 보장하지 않습니다.
- 실제 에너지 lane의 방향과 seed를 유지하므로 서로 반대 방향으로 흐르는 lane이 겹칠 수 있습니다. 단방향 가짜 애니메이션으로 대체하지 않습니다.
- 자동 검증 환경의 한글 시스템 글꼴이 부족해 캡처 일부 글리프는 네모로 보일 수 있습니다. 실제 한글 문장·이름·기존 분석은 DOM과 실제 JSX 테스트로 별도 확인합니다. 앱 폰트는 변경하지 않습니다.
- 소프트웨어 WebGL 검증은 실제 GPU의 FPS·열·장시간 메모리 검증을 대신하지 않습니다.

커밋·푸시·배포·브랜치 전환과 유료 OpenAI 호출을 수행하지 않습니다. 환경 파일·ZIP·질문·Q10·API·5-A·5-C-1·`/aurora-lab` 및 master/백업 브랜치를 보존합니다.

## 이번 5-C-2R 변경 파일

- `components/result/AuroraResultScreen.tsx`, `AuroraResultScreen.module.css`: 전체 화면·비콘 버튼·목록·매크로 의미 영역과 기존 분석 패널.
- `components/aurora/GlassNebulaAurora.tsx`, `AuroraRibbons.tsx`, `aurora-shaders.ts`: 비콘/구간 연결과 기존 shader의 선택 구간 마스크. 매크로에서만 alpha 1.35배와 RGB 1.18배의 제한된 대비 보정을 사용하며, 순백색 광원을 더하지 않습니다.
- `components/aurora/AuroraRibbonBeacons.tsx`(신규): live 표면 투영과 DOM 위치 갱신.
- `lib/aurora-ribbon-picking.ts`, `aurora-ribbon-focus-camera.ts`: 실제 변형 표면 샘플과 구간 카메라.
- `lib/aurora-ribbon-beacons.ts`(신규): 화면 내 비콘 충돌 분리.
- `tests/aurora-ribbon-focus.test.mjs`, `tests/aurora-result.test.mjs`: 표면·매크로·비콘·실제 JSX 계약 검증.
- `tests/helpers/verify-ribbon-macro.mjs`(신규), `verify-ribbon-focus.mjs`: 모킹된 실제 앱의 WebGL 검증 및 기존 보조 검증의 설정 메뉴 대응.
- `docs/aurora-ribbon-macro-verification.md`(신규): 이 기록.

기존 미커밋 5-C-2의 `AuroraCameraController.tsx`, `AuroraRibbonPointerSelection.tsx`, `aurora-ribbon-focus.ts`, `tests/aurora-ribbon-meaning.test.mjs`, `docs/aurora-ribbon-focus-verification.md`도 삭제/초기화하지 않고 그대로 보존합니다.
