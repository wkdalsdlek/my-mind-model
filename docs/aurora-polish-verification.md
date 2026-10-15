# Phase 5-C-2R Polish · 검증 기록

기준 브랜치 `feat/glass-nebula-aurora`, HEAD `c48b02d7cd6cd0ae7ea8010777315cd791c11935`.
5-C-2/5-C-2R 미커밋 작업을 초기화하지 않고 이어서 수정합니다. 기존 결과 레이아웃과 AI 분석 시스템은 바꾸지 않습니다.

## A. 확인한 비콘 흔들림의 원인

1. 기존 비콘은 매 프레임 8개 후보를 depth·다른 비콘 위치·점수 편향(-18)으로 다시 비교했습니다. 정상적으로 노출된 리본 구간도 점수 순위가 바뀌면 u가 즉시 교체됐습니다.
2. 화면 충돌 회피는 매 프레임 물리 앵커에서 spiral/grid 후보를 새로 검색했습니다. 이전 offset/회피 방향과 시간 상태가 없어 작은 거리 변화도 다른 후보로 이어질 수 있었습니다.
3. 카메라는 priority -.5에서 position/lookAt/OrbitControls를 변경하지만 비콘(-.25)의 `Vector3.project` 전에 최신 matrixWorldInverse를 명시적으로 갱신하지 않았습니다. 실제 render traversal은 그 뒤에 행렬을 갱신합니다. 이 때문에 실제 렌더링과 비콘의 투영 시점이 어긋날 수 있었습니다.
4. React state/별도 requestAnimationFrame 경쟁과 CSS 정수 반올림이 원인은 아니었습니다. 원래도 프레임별 React state는 없었고 부동소수점 transform을 썼습니다.
5. 전체 복귀 중에는 selectedId가 먼저 null이 되지만 HTML 비콘 host는 전환 종료까지 숨겨집니다. 숨긴 동안 가까운 카메라에서 앵커를 재평가하면 돌아온 뒤 다른 위치로 바뀔 수 있어 DOM host.hidden도 함께 확인합니다.

### 정책

- 카메라 갱신과 배경 프레임 처리 뒤인 priority .5에서 `camera.updateMatrixWorld(true)` 후 투영합니다. postprocessing render는 기존 priority 1을 유지합니다.
- 정상 노출된 물리 u는 점수가 바뀌어도 유지합니다. 최소 유지 1.2초, 화면 밖 상태 .22초를 거쳐 fallback을 검토합니다. 투명 리본에 의한 가림은 HTML 비콘/leader로 선택 가능성을 보장하며, 매 프레임 depth readback을 추가하지 않습니다.
- 교체 시 .65초 smootherstep으로 폐곡선의 짧은 u 경로를 이동합니다. 보간 중에도 실제 geometry/GPU fold를 샘플링하므로 비콘이 가짜 직선 궤도로 떠다니지 않습니다.
- 화면 회피 offset을 저장하고, 공간이 92px 이상 확보된 상태가 .8초 지속될 때만 천천히 회수합니다. stable ribbon 순서가 충돌 우선순위입니다. 마지막 최소 nonpenetration 투영으로 전환 중 버튼의 접근성도 지킵니다.
- 카메라/물리 앵커의 화면 이동은 지연 없이 따라가고, 의도적인 충돌 회피 offset만 delta 기반 지수 damping으로 움직입니다. 실제 앵커 추적과 배치 이동을 분리해 카메라 지연을 줄이는 제한이 큰 회피 점프로 바뀌지 않도록 합니다. 회피 offset은 정상 배치에서 144px 이내를 우선하며 화면 밖 앵커에는 clipped leader가 남습니다.
- Hover/키보드 포커스는 버튼과 u를 고정하고 다른 비콘이 이를 피합니다. leader 시작점은 실제 리본을 계속 추적합니다. viewport 변경/전체 복귀는 안전하게 재동기화합니다. Reduced Motion의 필수 fallback은 즉시 완료하며 긴 이동을 추가하지 않습니다.
- 기존 48px native button과 목록, GPU 보조 picking, 기존 카메라 소유권을 유지합니다. 프레임 내 React state·DOM bounding-box 측정·GPU readback·새 Vector/geometry/material 할당을 추가하지 않습니다.

## B. 휴지기 가시성 원인과 보정

기존 코어 계수는 기본 .26에 energy.x 최대 2.05배와 wake를 더하는 구조였습니다. 본체는 quiet density가 0이 되지는 않지만, 얇은 코어의 상대 대비가 크게 줄어듭니다. loop는 추가 opacity .58, noise 기반 loopPresence 최저 .16, grazing bodyPresence가 곱해져 더욱 희미해질 수 있었습니다. 반면 넓은 미스트에도 매크로 alpha 1.35배와 RGB 1.18배를 동일하게 적용해 확대 시 확산층이 본체보다 우세해질 수 있었습니다. Bloom/톤 매핑만의 문제로 판단하지 않았습니다.

- 실제 shader의 동일 UV에 얇고 연속적인 유색 광맥과 부드러운 가장자리 선을 추가했습니다. pulse가 없는 때도 최소 구조가 보이고, 에너지 이벤트는 기존 광맥 위에서 계속 이동합니다.
- 중앙 코어와 가장자리는 실제 두 색 endpoint만 사용합니다. 순백색 emission이나 새 색상 계열을 추가하지 않습니다.
- 광맥 폭 .019~.029, quiet core 계수 .82~.98, rim .19~.26의 제한된 슬롯 프로필을 공유합니다. 본체 alpha는 여전히 투명하며 전체를 불투명하게 밝히지 않습니다.
- 미스트는 제거하지 않고 기존 opacity에 overview .84~.88, macro .5~.58의 부드러운 비율을 곱합니다. 새 결과용 처리에서 미스트는 본체용 macro 대비 증폭을 받지 않습니다.
- geometry·GPU fold·에너지 seed/event/cycle/speed/direction/wake·global appearance motion·Bloom .32·기존 tone mapping과 품질 예산은 변경하지 않습니다.
- 결과용 분기에서는 더 이상 사용하지 않는 기존 grain fBm 계산을 수행하지 않도록 else로 분리했습니다. 새 질감을 단순화하지 않고 중복 연산을 줄였으며, 기존 실험실 분기는 동일합니다.
- `uPolish=1`은 interaction이 있는 결과 렌더러에서만 사용합니다. `/aurora-lab`은 기존 표현을 유지합니다. 새 형상이나 매크로 대체 오브젝트는 없습니다.

## C. 리본별 정체성 및 의미의 신뢰성

기존에도 각 슬롯의 width/height/curve/depth/phase와 세 에너지 lane의 seed·cycle·speed·length·wake가 달랐습니다. 넓은 혼색과 확산, 휴지기의 낮은 코어 대비로 차이가 묻혔습니다. 이 차이를 먼저 드러내며 geometry나 에너지 파라미터를 새로 덮어쓰지 않았습니다.

`auroraRibbonIdentityProfile(shape, visual)`은 순수·결정적 함수입니다.

- `colors`: 기존 두 endpoint의 실제 familyId/색상/weight와 기존 baseMix. 코어는 그 쌍에서 더 큰 palette weight를 가진 endpoint를 강조하고, 가장자리는 반대 endpoint를 씁니다. 색 면적과 의미 구성 비중은 같은 값이라고 주장하지 않습니다.
- `structure`: 기존 Phase 4 슬롯의 폭·높이·곡률·깊이·위상 형상 파라미터입니다. 사용자 성격이 만든 형태라고 주장하지 않습니다.
- `energy`: 기존 renderer seed와 원래 `auroraEnergyProfiles` 3개를 그대로 기록합니다. seed 차이를 심리적 의미라고 설명하지 않습니다. speed는 u/energy-clock 기준이므로 실제 공간 속도에는 geometry 크기와 global flow도 함께 작용합니다.
- `surface`: seed에서 결정되는 제한된 광맥 폭·대비·rim 차이입니다. 순수 조형적 차이이며, 선택하지 않은 의미를 생성하지 않습니다.

기존 layer 계약에 선택적 `identityProfile`만 추가했습니다. `visual`·shape·ribbonId·renderKey·meaning composition·coreShares·trace·문항 가중치·neutral fallback·Q3/7/8/9 분리 정책은 유지합니다. 중립색은 `ribbon.paletteOrigins`의 neutral-visual 출처를 함께 확인해야 하며, 프로필의 색상 이름만 보고 답변 근거라고 해석하면 안 됩니다.

5-C-3에서는 `ribbon.layers[0].identityProfile`, 기존 evidence/composition/paletteOrigins, 기존 문항 전체 분석 참조를 분리해 설명할 수 있습니다. 이번에는 리본별 새 AI 해석이나 분석 패널 전면 교체를 구현하지 않습니다.

## D. 자동 검증

- TypeScript `npx tsc --noEmit --incremental false`: 통과.
- ESLint `npm run lint`: 통과, 경고 없음.
- 전체 **338개 테스트 통과**: 기존 320개 유지 + 신규 18개. 정상 앵커 유지/노출 손실/최소 유지/폐곡선 연속 전환/Reduced Motion/30·60·120fps offset 보간/카메라 지연/회피 side 유지/충돌 전환 연속성/Hover 해제/viewport 복귀/4개 preset 결정성/팔레트·의미·geometry·seed 불변/quiet 구조 및 mist 범위를 검사합니다.
- `git diff --check`: 통과. 신규/미추적 소스·테스트·문서의 trailing whitespace 별도 검사도 통과했습니다.

각 `tests/*.test.mjs`를 `node 파일명`으로 순차 실행해 테스트 자체의 총개수 338을 합산했습니다. `node --test` 실행도 통과했지만 이 환경에서는 파일 단위 13개만 보고하므로 개별 실행 결과로 개수를 확인했습니다.

## E. 실제 Chromium 검증 방법

`tests/helpers/aurora-polish-preview.mjs`는 **검증 전용**으로 기존 실제 GlassNebulaAurora를 번들합니다. 앱에 새 route/테스트 모드를 추가하지 않습니다. 원래 Scene/Canvas/geometry/material/shader를 그대로 사용합니다. `serenity`, `connection`, `exploration`, `mixed`의 실제 appearance와 합성 질문 응답으로 생성한 balanced/dominant/neutral 개인화 결과를 사용합니다. dominant는 같은 두 색이 여러 슬롯에 반복되는 경우도 포함합니다.

Before는 수정 전 미커밋 파일의 `.next/aurora-polish-before/*.source` 사본을 번들합니다. Git HEAD나 작업 트리를 되돌리지 않습니다. After는 현재 소스를 번들합니다. 외부와 모든 API 요청은 차단하며 OpenAI 호출은 0회입니다.

- 비콘은 연속 requestAnimationFrame 좌표를 기록하고, 실제 mesh를 동일 sampler로 샘플링해 **실제로 그려진 카메라 행렬의 스냅샷**과 비교합니다. 정지·자동·느린/빠른 마우스 회전·CDP 실제 touch 회전·Hover/Focus·복귀를 검사합니다. 스크린샷만으로 움직임을 승인하지 않습니다. WebM 원본 영상도 기록합니다.
- 터치/OrbitControls는 이벤트에서 camera 객체를 다음 프레임 전에 변경할 수 있습니다. 계측 기준도 live 객체의 중간 상태가 아니라 실제 render 후 복사한 view/projection 행렬로 고정합니다.
- 시간별 비교는 동일 geometry pose와 카메라에서 **기존 seed의 실제 energy event 함수**로 찾은 quiet/medium/strong 시간을 uniform에 적용합니다. 새 에너지 함수를 만들지 않고, 변수 하나를 고정해 구조 가시성을 비교하는 재현 실험입니다. 별도의 움직임 영상에서는 시간을 고정하지 않습니다.
- 정지 비교의 desktop/mobile 각 low/balanced/high에서 세 강도를 비교합니다. 기본 품질을 기기별로 강등하지 않습니다. 소프트웨어 WebGL 검증 비용 때문에 테스트 viewport는 제한하며 앱 품질 예산은 바꾸지 않습니다.
- 실제 결과 화면 통합은 기존 `verify-ribbon-macro.mjs`에서 별도로 검사합니다. 질문·직접 승인·모킹된 10개 분석 후 기존 전체 결과로 들어가 같은 Canvas/비콘/목록/포커스/복귀를 검사합니다.

### Chromium / SwiftShader 결과

- Before/After 각각 desktop 820×640, mobile 390×844에서 low/balanced/high × quiet/medium/strong의 **18장씩**을 같은 geometry pose·에너지 seed·카메라로 촬영했습니다. quiet 에너지 0, medium .3446, strong .6886인 기존 이벤트 시점을 사용했습니다. 정지 비교는 혼색 mixed의 같은 리본 구간이며 모든 개인화 입력을 포괄하는 검사는 아닙니다.
- 이미지 직접 확인: mixed high의 Before quiet는 넓은 확산층에 내부 구조가 묻혔고, After quiet에는 연속적인 라벤더 광맥과 청록 가장자리, 그 사이 반투명 본체가 드러납니다. strong은 같은 구조 위의 광량과 잔광이 증가하며, 관찰한 화면에서 순백색 덩어리로 포화하지 않았습니다. mobile low/high에서도 같은 구조가 유지됩니다. 이것은 실제 재질의 표면 표현이며 새 리본을 합성하지 않았습니다.
- serenity/connection/exploration/mixed 및 balanced/dominant/neutral의 전체 구도와 메인 슬롯 0/1의 quiet 매크로를 별도로 촬영했습니다. serenity는 청록, connection은 분홍·보라·푸른 계열, exploration은 청록·민트, mixed는 복합 색 조합이 드러납니다. dominant의 반복 색상은 같은 계열로 남고, 슬롯 곡률·폭·광맥에서 차이가 보입니다. neutral은 중립색을 유지하며 성격 의미를 부여하지 않습니다. 모든 비슷한 의미의 리본이 색만으로 구별된다고 주장하지 않습니다.
- 연속 프레임 검증: 정지 12, 자동 40, 느린 마우스 24, 빠른 마우스 24, 터치 24, 복귀 12프레임을 기록했습니다. 최종 렌더 행렬 기준 물리 앵커 투영 오차 **0px**, 불연속 u 전환 **0회**, Hover/Focus 버튼 이동 **0px**입니다. 이 수치는 앵커 추적 일치와 계측 구간의 연속성을 뜻하며 모든 움직임의 지각적 완벽함을 보증하지 않습니다.
- 실제 카메라 이동과 충돌 회피는 계속 존재합니다. 빠른 마우스 회전의 최대 버튼 이동은 약 42px/샘플, 충돌 offset 변화는 약 32px/샘플이었습니다. 화면 안에 여러 앵커가 모일 때의 배치 이동을 완전히 제거했다고 보고하지 않습니다. 영상과 프레임 좌표를 함께 남겼습니다.
- 반복 매크로 진입/복귀 5회 전후 Three renderer 리소스 수는 geometry **17→17**, texture **5→5**, program **8→8**로 동일합니다. 이것은 짧은 실행의 객체 수이며 GPU 메모리 바이트나 장시간 누수 검증이 아닙니다.
- 정지 비교와 움직임 실행에서 WebGL error **0**, 수집된 브라우저 오류 없음. 모두 **SwiftShader 소프트웨어 WebGL2**이며 실기기 FPS로 해석하지 않습니다. API 호출은 차단했고 유료 호출은 **0회**입니다.
- 캡처와 계측 JSON·영상은 Git ignored `.next/aurora-polish-verification/`에 남겼습니다. 원본 긴 영상은 `motion/before-motion.webm`·`motion/after-motion.webm`, 1배속 20초 발췌는 `motion/before-orbit-20s.webm`·`motion/after-orbit-20s.webm`, 비교 이미지는 `before/`·`after/`, 계측은 `motion/report.json`입니다. 임시 번들·검증 도구를 제품 의존성에 추가하지 않았습니다.
- 여러 소프트웨어 Chromium을 동시에 실행한 초기 검증에서는 브라우저가 종료돼, 마지막 정지 비교는 단일 브라우저 순차 실행으로 완료했습니다. 초기 종료의 환경 원인은 확정하지 않았으며 앱의 GPU 오류라고 단정하지 않습니다.

### 실제 결과 화면 통합: 중단 뒤 완료된 실행 결과 확인

재개 시 `/tmp/aurora-polish-result-quick/report.json`이 정상 완료 상태로 남아 있음을 확인했습니다. 같은 소스의 브라우저 검증을 다시 실행하거나 이미지를 재생성하지 않았습니다.

- 첫 전체 실행: 질문 → 직접 문장 승인 → 10개 분석 모킹 → 전체 결과, 실제 활성 비콘 5개 각각의 진입·목록 ID 일치·복귀, 동일 Canvas, 키보드/Reduced Motion, 보조 GPU Picking, 자유 회전까지 확인했습니다. 이후 `desktop-macro-animated.png` 촬영 중 브라우저가 종료됐습니다. 실패 기록은 `result/partial-run.json`입니다.
- 후속 축약 실행: 위 5개 비콘 촬영 반복만 1개로 줄였고 나머지 검사를 끝까지 완료했습니다. `everyBeaconMatchesList: false`는 축약 모드에서 전체 비콘 반복을 생략했다는 표시이며 실패 판정이 아닙니다. 모든 비콘 반복은 앞선 실행에서 확인했습니다.
- 축약 실행 통과: 원래 카메라 위치 복귀, 전환 중 재선택·취소·다른 리본 선택, 실제 에너지 시계 증가, 자동 회전 모드 복원과 실제 이동, 모바일 5개 48px 비콘 hit-test, 터치 선택, 집중 상태 리사이즈, balanced/high 사용자 선택 유지, 승인 문장과 기존 분석 유지, Canvas 동일성.
- 실제 결과 화면의 WebGL 리소스 생성/해제 계측: 5회 집중/복귀 전후 buffer **76→76**, texture **10→10**, program **9→9**. 앞선 독립 렌더러의 Three 객체 계측과는 측정 단위가 다릅니다. 모두 짧은 반복 시험입니다.
- 완료된 실행의 WebGL error **0**, shader compile/link 오류 **없음**, 수집된 console/page 오류 **없음**. 분석 요청 1회는 모킹했고 실제 OpenAI 호출은 **0회**입니다.
- 브라우저 종료는 `Target page, context or browser has been closed`로 기록됐고, 그 직전 수집된 앱/셰이더 오류는 없었습니다. 동일 코드의 축약 실행은 완료됐지만 **앱 문제인지 Chromium/SwiftShader 리소스 문제인지는 증거가 부족해 확정하지 못했습니다**. 하드웨어 GPU에서의 재현 점검이 남습니다.
- 완료된 보고서·실제 모바일/데스크톱 캡처는 `result-quick/`에 복사했습니다. 자료 페이지 `index.html`에도 링크했습니다.

### 재개 시 최종 검사

- 제품/테스트 코드 추가 수정 없음. 이번 재개에서는 검증 문서와 ignored 자료 페이지·기존 결과 복사만 갱신했습니다.
- 13개 개별 테스트 로그의 tests/pass 합계를 확인해 **338개 전부 통과**를 재확인했습니다. 테스트 완료 후 수정된 제품/테스트 소스는 **0개**여서 기존 결과가 유효하며 전체 테스트를 중복 실행하지 않았습니다.
- 재개 후 `npx tsc --noEmit --incremental false`: 통과. `npm run lint`: 통과, 경고 없음. `git diff --check` 및 신규 파일 공백 검사: 통과.
- 브랜치/HEAD, master/백업/checkpoint 참조 유지. index는 비어 있으며 ZIP은 미추적 상태입니다.

## F. 보존 및 남은 위험

- 검증 Chromium에는 한글 글꼴이 부족해 실제 결과 화면 캡처의 일부 한글이 사각형으로 표시됩니다. DOM 문자열·접근성 이름 검증은 별도로 수행하며 제품 글꼴을 변경하지 않았습니다.
- 실제 하드웨어 GPU의 장시간 FPS·발열·GPU 메모리와 모든 모바일 드라이버는 별도 검증이 필요합니다. SwiftShader를 실기기 성능 결과로 일반화하지 않습니다.
- 선택한 의미가 비슷하면 실제 색상도 비슷하게 남습니다. 차별화를 위해 의미 계열·키워드·가중치를 만들어 넣지 않습니다.
- 기존 투명 자기 교차·상단 시점의 곡면 문제는 geometry 재제작으로 해결하지 않습니다. 매크로 UV 구간 억제와 연속 구조가 완화하지만 모든 카메라 경로의 무충돌을 보장하지 않습니다.
- 좁은 화면/화면 밖 물리 앵커는 접근 가능한 버튼과 leader로 표시하며, 리스트도 유지합니다. 극단적으로 작은 viewport의 모든 배치 조합은 검증 범위 밖입니다.
- 새로운 Canvas/오로라 Scene/API/유료 호출/질문 변경/5-A 의미 변경/커밋/푸시/배포는 하지 않습니다. ZIP·환경 파일·master·백업 브랜치와 기존 미커밋 작업을 보존합니다.

## G. 이번 Polish의 추가·수정 파일

기존 5-C-2/2R 변경과 구분해 이번에 손댄 파일입니다. 이전 단계에서 이미 존재하던 미추적 파일도 포함합니다.

- `components/aurora/AuroraRibbonBeacons.tsx`: 최종 카메라 행렬·앵커/화면 위치 상태 연결.
- `lib/aurora-ribbon-beacons.ts`: 안정 앵커와 지속 충돌 배치 순수 로직.
- `lib/aurora-ribbon-identity.ts` (신규): 출처를 구분하는 결정적 시각 프로필.
- `lib/aurora-ribbon-layout.ts`: 선택적 프로필 계약 확장.
- `components/aurora/AuroraRibbons.tsx`: 기존 재질 uniform 재사용 및 결과용 프로필 적용.
- `components/aurora/aurora-shaders.ts`: 결과용 quiet 본체/광맥/림·미스트 균형.
- `components/result/AuroraResultScreen.tsx`: 비콘 색을 실제 강조 코어 endpoint와 일치시킴. 레이아웃과 분석 콘텐츠는 유지.
- `tests/aurora-polish.test.mjs` (신규): 18개 회귀 검증.
- `tests/aurora-ribbon-focus.test.mjs`: 보존된 매크로 마스크 검증 조정.
- `tests/helpers/aurora-polish-preview.mjs` (신규): 실제 렌더러와 합성 fixture 검증 전용 번들.
- `tests/helpers/verify-aurora-polish.mjs` (신규): 시간별 화면·연속 프레임·입력·리소스 검증.
- `tests/helpers/verify-ribbon-macro.mjs`: 통합 검증 실패 시 비밀번호를 제거한 메시지만 재전달.
- `docs/aurora-polish-verification.md` (신규): 원인·정책·증거와 검증 범위.

## H. 체크포인트 준비 상태와 전체 작업 트리

현재 코드와 자동 검증은 체크포인트 저장이 가능한 상태입니다. 실제 GPU 시각 승인·장시간 성능 검증 완료를 뜻하지 않습니다. Polish 마무리 당시에는 커밋/푸시하지 않았고, 후속 통합 체크포인트 요청에서는 아래 25개 파일을 함께 저장합니다.

아래는 Phase 5-C-2/2R에서 이어진 기존 변경까지 포함한 전체 소스·테스트·문서 목록입니다. ZIP은 포함 대상이 아닙니다. G의 13개만 Polish에서 변경했고, 이번 재개에서는 이 문서와 ignored 검증 자료만 정리했습니다.

- `components/aurora/AuroraCameraController.tsx`
- `components/aurora/AuroraRibbons.tsx`
- `components/aurora/GlassNebulaAurora.tsx`
- `components/aurora/aurora-shaders.ts`
- `components/result/AuroraResultScreen.module.css`
- `components/result/AuroraResultScreen.tsx`
- `lib/aurora-ribbon-layout.ts`
- `tests/aurora-result.test.mjs`
- `tests/aurora-ribbon-meaning.test.mjs`
- `components/aurora/AuroraRibbonBeacons.tsx`
- `components/aurora/AuroraRibbonPointerSelection.tsx`
- `docs/aurora-polish-verification.md`
- `docs/aurora-ribbon-focus-verification.md`
- `docs/aurora-ribbon-macro-verification.md`
- `lib/aurora-ribbon-beacons.ts`
- `lib/aurora-ribbon-focus-camera.ts`
- `lib/aurora-ribbon-focus.ts`
- `lib/aurora-ribbon-identity.ts`
- `lib/aurora-ribbon-picking.ts`
- `tests/aurora-polish.test.mjs`
- `tests/aurora-ribbon-focus.test.mjs`
- `tests/helpers/aurora-polish-preview.mjs`
- `tests/helpers/verify-aurora-polish.mjs`
- `tests/helpers/verify-ribbon-focus.mjs`
- `tests/helpers/verify-ribbon-macro.mjs`

## I. 검증 자료 재생성 방법

프로젝트 루트에서 실행합니다. 브라우저 검증에는 별도로 준비한 Playwright(Chromium 설치 포함)와 esbuild가 필요합니다. 프로젝트 의존성이나 환경 파일에 추가할 필요는 없습니다. `AURORA_POLISH_TOOLS`는 두 패키지가 설치된 `node_modules`의 절대 경로이며, 현재 환경에서는 `/tmp/aurora-polish-tools/node_modules`를 사용했습니다. Linux의 Chromium 공유 라이브러리도 실행 환경에 준비되어 있어야 합니다.

```sh
# 동일 테스트 파일의 개별 테스트 개수를 확인하는 방식
for test_file in tests/*.test.mjs; do
  node --test-reporter=tap "$test_file" || exit 1
done

# 실제 렌더러의 움직임/영상과 정지 비교를 각각 순차 실행
AURORA_POLISH_TOOLS=/tmp/aurora-polish-tools/node_modules AURORA_POLISH_OUTPUT=/tmp/aurora-polish-motion AURORA_POLISH_MOTION_ONLY=1 node tests/helpers/verify-aurora-polish.mjs
AURORA_POLISH_TOOLS=/tmp/aurora-polish-tools/node_modules AURORA_POLISH_OUTPUT=/tmp/aurora-polish-after AURORA_POLISH_STATIC_ONLY=1 node tests/helpers/verify-aurora-polish.mjs

# 실제 결과 화면: 로컬 개발 서버 http://127.0.0.1:3000 실행 필요
AURORA_PLAYWRIGHT_MODULE=/tmp/aurora-polish-tools/node_modules/playwright AURORA_FOCUS_OUTPUT=/tmp/aurora-polish-result-quick AURORA_MACRO_QUICK=1 node tests/helpers/verify-ribbon-macro.mjs
```

현재 Codespaces에서 별도 추출한 공유 라이브러리를 사용할 때에는 위 node 명령에 `LD_LIBRARY_PATH=/tmp/aurora-polish-libs/root/usr/lib/x86_64-linux-gnu`도 지정했습니다. `/tmp` 의존성과 라이브러리는 일시적이며 새 환경에는 없을 수 있습니다. 검증 도구는 분석 API를 모킹하거나 차단하며 실제 유료 API를 호출하지 않습니다. 한 번에 한 Chromium만 실행하는 것이 좋습니다.

After는 체크포인트 소스만으로 다시 렌더링할 수 있습니다. **동일한 Before는 수정 전 미커밋 소스 사본이 필요**합니다. 기존 `.next/aurora-polish-before/<원래 상대 경로>.source`의 네 파일(`AuroraRibbonBeacons.tsx`, `AuroraRibbons.tsx`, `aurora-shaders.ts`, `lib/aurora-ribbon-beacons.ts`의 원래 디렉터리 포함)을 보존한 환경에서만 `AURORA_POLISH_BEFORE=1`을 추가합니다. 이 사본은 Git에 포함하지 않으며 없을 때 과거 Before가 재현됐다고 보고하면 안 됩니다.

이미 생성된 36장 시간별 비교와 프리셋 비교, 실제 결과 화면, JSON·영상 및 자료 페이지의 경로는 `.next/aurora-polish-verification/`입니다. 이 경로의 파일은 강제 스테이징하지 않습니다. 새 실행 결과는 지정한 `/tmp` 출력 폴더에 생성되며 기존 자료 페이지는 자동 생성되지 않습니다. 필요한 캡처·보고서만 별도로 복사해 확인할 수 있습니다.

## J. 통합 체크포인트 최종 검증

후속 저장 요청에 따라 Phase 5-C-2, 5-C-2R 및 Polish의 전체 25개 파일을 함께 저장 대상으로 확인했습니다. 문서 H와 실제 변경 목록이 일치하고 로컬 import 78개가 기존 추적 파일 또는 저장 대상 파일에 연결됩니다.

- `npx tsc --noEmit --incremental false`: 통과.
- `npm run lint`: 통과, 경고 없음.
- 전체 자동 테스트를 개별 TAP 실행으로 다시 수행: **338/338 통과**.
- `git diff --check`: 통과.
- 5-A 의미 엔진·Q10·분석 API·기존 5-C-1 의미 계산 및 `/aurora-lab` 페이지 소스는 변경하지 않았습니다. 공유 렌더러의 호환성은 전체 테스트와 기존 브라우저 검증 결과를 유지합니다.
- 브라우저는 중복 실행하지 않았습니다. 위 SwiftShader 검증과 미검증된 실제 GPU 한계는 그대로 적용됩니다.
- ZIP·환경 파일·ignored `.next` 산출물은 저장 대상에서 제외합니다. master·백업·기존 checkpoint 참조는 보존합니다.
- 체크포인트 메시지: `feat: add immersive aurora ribbon exploration and polish`.

이 절의 커밋/일반 푸시는 후속 요청으로 승인된 저장 작업이며, 앞선 구현·검증 단계에서 저장하지 않았다는 기록과 구분합니다. Phase 5-C-3 구현은 시작하지 않습니다.
