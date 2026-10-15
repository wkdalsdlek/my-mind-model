# Phase 5-C-1 · 리본 정체성과 분석 근거 계약

브랜치: `feat/glass-nebula-aurora`. 기준: `c0cf8685c29302be2106bbd7d80f5e4d1f7f7055`.
이번 단계는 타입·순수 계산·기존 결과 어댑터·단위 테스트까지만 구현합니다. UI, 리본 클릭/강조, 카메라 이동, 새 애니메이션과 API 호출은 추가하지 않습니다.

## 실제 구조 조사

- `auroraRibbonShapes(appearance)`는 메인 curtain 슬롯 2~4개를 만듭니다. 이름은 curtain이지만 현재 모두 `closed: true`인 폐곡선입니다. 형상·위상·궤도·에너지 seed는 Phase 4의 슬롯 설계값입니다.
- 5-A의 핵심 계열 수 0/1/2~3/4~7에 따라 appearance.ribbonCount는 3/2/3/4입니다. 의미 계열 7종을 리본 7개로 나누지 않습니다.
- `auroraLoopShapes`는 항상 보조 half-twist 루프 슬롯 2개를 생성합니다. independent/hybrid/loop-emphasis는 목표 가시 루프를 0/1/2개로 정합니다. 결과 화면은 기본 hybrid입니다.
- 실제 리본 색은 `a = shape.colorIndex`, `b = (a + 1) % palette.length` 두 항목입니다. 메인 슬롯과 루프 슬롯의 a는 각각 슬롯 번호를 palette 길이로 나눈 나머지입니다. 메인과 루프가 같은 두 의미를 공유할 수 있습니다.
- palette는 핵심 비중 내림차순이며 동률은 기존 의미 계열 순서입니다. 핵심 의미가 하나면 92% 실제 색 + 8% 중립 보조색, 없으면 두 중립 색을 사용하는 기존 정책을 유지합니다.
- shader의 baseMix는 B의 palette.weight입니다. 실제 blend는 너비 위치·cloud/noise·warp에 따라 달라지고 iridescence·시점·에너지·Bloom·투명 중첩도 최종 색을 바꿉니다. baseMix나 의미 비중은 측정된 픽셀 면적/화면 색 분포가 아닙니다.
- 각 리본의 에너지 3 lane은 `shape.energySeed`로 생성합니다. 이벤트의 시작·길이·방향·잔광 등은 시드와 이벤트 순서에서 결정됩니다. 의미 계열마다 독립 시드를 할당한 구조가 아닙니다. 모든 핵심 계열이 섞인 appearance.motion이 공통 운동/energy clock을 조절합니다.
- 메인마다 미스트 1개, 루프마다 low에서 미스트 1개, balanced/high에서 2개가 있습니다. 미스트는 독립 의미 리본이 아니라 부모의 동일 색/시드를 공유하는 보조 mesh입니다.
- 숨겨진 루프도 mode fade를 위해 mesh/buffer가 유지됩니다. 데이터의 active는 **모드 전환 완료 후 목표 상태**이며 프레임별 visibility가 아닙니다.

리본 레이어가 활성화된 3D 장면에서 메인 N개, 활성 루프 L개, 루프 미스트 M개일 때 논리 슬롯은 N+2, 목표 활성 리본은 N+L, mounted mesh는 2N+2(1+M), 목표 활성 mesh는 2N+L(1+M)입니다. 각 품질은 기존 segment/row/DPR 예산을 그대로 사용하며 기기로 자동 강등하지 않습니다. WebGL fallback 또는 layers.ribbons=false인 화면에서 실제 draw가 발생했다는 의미는 아닙니다.

## 정체성과 의미 매핑

`lib/aurora-ribbon-layout.ts`는 기존 geometry·flow/quality 예산을 재사용해 슬롯·층·React renderKey·draw 순서·실제 color target을 순수 데이터로 출력합니다. `aurora-ribbon-v1:curtain:0` 및 `aurora-ribbon-v1:loop:0`처럼 kind/슬롯으로 ID를 만듭니다. ID는 결과 스냅샷 내부 식별자이며 다른 질문 결과에서도 같은 슬롯 ID가 나올 수 있습니다. 품질·카메라·모드 전환으로 의미 ID를 바꾸지 않습니다.

색상/불투명도 공식만 `auroraRibbonVisualParameters`로 추출해 기존 AuroraRibbons와 계약이 함께 사용합니다. RGB endpoint, B 혼합 target, alpha target의 기존 수식을 바꾸지 않았습니다. uniform easing, useFrame, geometry, energy seed, shader와 render 순서는 그대로입니다. 데이터의 target-after-easing은 완료된 목표값이며 전환 중 실제 uniform 스냅샷이 아닙니다.

각 리본은 두 색의 familyId·실제 hex·palette index/weight·origin을 기록합니다. 의미는 hex에서 추측하지 않고 해당 endpoint 중 `trace.paletteOrigins.origin=answer`인 계열의 **기존 coreShares**를 연결합니다. representativeFamily는 해당 실제 의미 중 기존 coreShares 순서의 첫 계열이며, 대표색 하나로 전체를 단정하지 않고 두 색을 모두 제공합니다.

복합 구성의 withinPairShare는 실제 두 색에 대응하는 핵심 비중을 그 쌍 안에서 재정규화한 값입니다. globalCoreShare도 함께 제공하며 compositionBasis는 core-shares-within-color-pair입니다. 화면 색 면적 비중이 아님을 명시합니다. 중립 보조색은 의미 구성/선택 근거에서 제외하고 neutral-visual로 표시합니다. 전부 중립인 리본에는 representativeFamily가 없고 이름도 ‘중립 빛’입니다. trace가 없거나 불일치하면 실제 형상·색은 유지하되 의미를 unavailable로 처리합니다.

팔레트 7색, 메인 4개와 기본 hybrid 루프에서는 직접 endpoint가 팔레트 0~4번까지만 사용됩니다. 나머지 두 의미를 억지로 리본에 배분하지 않고 familiesWithoutActiveRibbonColor로 기록합니다. globalMotionFamilyShares에는 7개 모두 남고, 공통 근거는 map.globalMotionEvidence/globalMotionRepetitions 및 결과 어댑터의 globalMotionAnalyses에 별도로 제공합니다. 리본 자체의 evidenceScope는 direct-color-pair입니다. 이를 통해 공통 운동 기여와 직접 색상 기여를 구별할 수 있습니다. 이는 기존 디자인의 제약이며 이번에 재설계하지 않습니다.

## 답변·반복 근거와 원문

evidence는 기존 trace.questions의 실제 selectionIds/keywordId/mapping과 coreContributions에서 가져옵니다. 질문 정의, answerIntent, visualRole, 문항의 configured/effective 가중치를 보존합니다. 기존 family repetitionMultiplier를 그대로 적용해 emphasizedScore, globalShareContribution 및 withinPairContribution을 설명용으로 계산합니다. 추가 반복 가중치를 만들지 않습니다. 한 문항의 동일 키워드 중복 선택은 trace의 단일 의미 기여로 남으며 원래 선택 ID/원문은 모두 제공할 수 있습니다. repeatedTexts는 관련된 **서로 다른 문항**에서 실제 반복된 그룹만 제공합니다.

Q3 currentAtmosphere, Q7 emotionalWish, Q8 releaseTarget, Q9 futureAspiration은 리본의 핵심 의미/기여에서 제외합니다. 이 정보는 nonCoreContext로 남습니다. 현재 5-B-1은 renderer에 appearance만 전달하므로 별도의 atmosphere/innerPulse/releaseFragments/outerExpansion 효과가 적용됐다고 설명하지 않습니다(rendererApplied=false). Q10 승인 문장은 색상 의미를 만드는 근거로 사용하지 않습니다.

5-A trace에는 원문이 없으므로 ID에서 사용자 말을 만들어내거나 API용 문자열을 임의로 쪼개지 않습니다. source를 제공하면 기존 5-A 엔진을 다시 실행해 appearance/coreShares/trace 일치를 확인합니다. 이 단계의 sourceBinding=meaning-replay-matched는 **의미 추적 일치**이며 원문 공백/미분류 표현의 역사적 동일성까지 입증하지 않습니다. text는 제공한 실제 선택 기록에서만 복사합니다.

실제 결과 어댑터는 QuestionnaireState를 source로 받고 기존 승인 fingerprint·승인 문장·serializeLegacyAnswers와 완료 결과 snapshot을 추가로 확인합니다. 일치할 때만 snapshot-verified입니다. 같은 의미지만 원문 공백이 바뀐 경우도 거부하고 원문을 제외합니다. fingerprint는 비교에만 쓰며 출력/로그에 넣지 않습니다. source가 없으면 ID 근거는 유지하되 texts는 비워 둡니다. source 불일치/invalid와 분석 누락은 명시적 issues로 구분합니다.

미분류 사용자 정의 키워드는 unclassifiedSelections에 원문과 ID를 보존하지만 의미를 확정하거나 리본 핵심 기여에 추가하지 않습니다. exact-custom과 호출자가 검증한 verified-custom은 기존 5-A 정책만 사용합니다. 검증 옵션은 이미 5-A에 사용한 동일 옵션을 제공해야 하며 raw client 의미 가중치는 계속 무시합니다.

## 기존 분석 재사용과 이후 생성 구분

`buildAuroraRibbonMeaningFromResult`는 기존 AuroraCompletedResult의 고정 문항 순서와 스냅샷 답변을 사용합니다. 기존 응답 validator로 10개/ID/문구를 확인한 뒤 해당 리본 evidence 문항의 요약·심층 분석을 그대로 복사합니다. scope=whole-question, origin=existing-analysis이므로 분석이 다른 선택도 함께 설명할 수 있음을 분명히 합니다. 분석 전문을 새 리본 전용 결론으로 바꾸지 않습니다.

Q3/Q7/Q8/Q9/Q10 분석은 contextualAnalyses로 별도 보존합니다. 요청/생성/모델 변경은 없습니다. 기존 GPT-6.1 Sol Medium API, 10개 분석 계약과 승인 시스템은 그대로입니다.

리본 이름, 질문/실제 선택, 반복 가치, 색/운동 설명과 관련 기존 문항 분석은 현재 데이터로 재구성할 수 있습니다. 리본 자체의 새 철학적 종합문·여러 문항을 하나로 엮는 AI 설명은 아직 생성하지 않았습니다. ribbonSynthesis={status:not-generated, requiresSeparateGeneration:true}로 명시합니다. 향후 별도 생성은 동의·예산·근거 계약을 갖춘 다음 단계이며 이번에 호출하지 않습니다.

## 5-C-2 연결 지점

```ts
const mapping = buildAuroraRibbonMeaningFromResult(completedResult, {
  source: questionnaireState,
  quality: selectedQuality,
  flowMode: "hybrid",
});
```

- 실제 mesh에 새 클릭 판정을 넣을 때 layer.renderKey와 ribbonId를 userData 등으로 연결합니다. 미스트와 코어의 교차점은 같은 부모 ribbonId로 모읍니다. 이번에는 mesh 이벤트/userData/클릭 판정을 추가하지 않았습니다.
- 숨김·fade·투명 표면은 실제 mesh.visibility/alpha 기준으로 처리해야 합니다. active만으로 전환 중 클릭 가능 여부를 결정하지 않습니다. 셰이더 변형된 모양과 CPU raycast mesh의 차이도 확인해야 합니다.
- 확대 target은 단순 slot.position을 world 좌표로 쓰지 않습니다. shared field group 변환, updateAuroraFieldPose/updateAuroraRibbonPose, GPU 정점 파동을 반영한 실제 월드 bounds/중심이 필요합니다. 계약에는 기존 shape·energySeed/profile이 있지만 카메라 목표 계산은 구현하지 않았습니다.
- 같은 결과 snapshot에 속한 매핑을 사용하고 결과 교체/reset 때 선택을 무효화합니다. 의미 계약을 매 프레임 재계산하지 말고 결과/옵션 변경 시 memoize합니다. 실제 응답/원문은 로그에 남기지 않습니다.

## 검증

- `npx tsc --noEmit --incremental false`: 통과.
- `npm run lint`: 통과, 경고 없음.
- 전체 자동 테스트 **288개 통과**: 기존 251개 유지 + 신규 리본 의미 37개. 실패·취소·건너뜀 없음. 테스트 로그는 `/tmp/phase5c1-*.tap`에 있습니다.
- 단일/균등 다계열/혼합 의미, 중립 보조색/전체 fallback, 미분류·exact/verified custom, 동일 입력·순서 변경 재현성, 원문 보존·source 누락/변조, 승인 fingerprint 불일치, core 역할 분리, 반복/중복 가중치 유지, provenance 불일치, 입력 불변성, 기존 문항 분석 복사·누락/잘못된 ID를 확인했습니다.
- 메인 2/3/4개와 low/balanced/high × independent/hybrid/loop-emphasis를 검사했습니다. 실제 geometry·mist·seed/profile·목표 활성 수·mounted 수, 부모 ID 및 렌더 순서가 기존 생성 함수/예산과 일치합니다. 기존 색/혼합/불투명도 공식도 직접 비교해 동일함을 확인했습니다.
- 공통 움직임의 전체 근거/정규화 기여와 직접 색상 쌍의 근거를 별도 검증했습니다. 직접 색상을 갖지 않는 계열도 공통 운동 근거에서 사라지지 않습니다.
- `git diff --check` 및 신규 파일 공백 검사: 통과.
- 기준 커밋과 비교해 5-A 엔진·5-B-1 결과/UI·질문/Q10·GPT-6.1 Sol Medium 분석 API·실험실·형상/에너지/셰이더·품질/카메라 파일에 변경이 없습니다. AuroraRibbons의 유일한 변경은 기존 색상 수식을 공유 함수로 옮긴 호출입니다.

추가 파일: `lib/aurora-ribbon-layout.ts`, `lib/aurora-ribbon-meaning-types.ts`, `lib/aurora-ribbon-meaning.ts`, `tests/aurora-ribbon-meaning.test.mjs`, 이 문서. 수정 파일: `components/aurora/AuroraRibbons.tsx`.

실제 브라우저의 클릭/카메라/패널은 이번 범위 밖이며 검증하지 않습니다. GPU 화면, 최종 픽셀 비중, FPS/발열/장시간 메모리는 이 데이터 테스트로 확인할 수 없습니다. Phase 4의 상단 시점, 투명 자기 교차 한계도 그대로 남습니다.

커밋·푸시·배포·브랜치 전환, 환경 파일/ZIP 변경, 실제 유료 OpenAI 호출은 수행하지 않습니다.
