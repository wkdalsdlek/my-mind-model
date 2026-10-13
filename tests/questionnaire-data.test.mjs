import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-typescript.mjs";

const { QUESTION_DATA, createKeywordPools, createCustomKeyword, createSelectedCapsule, serializeSelections, SEMANTIC_PROFILES } = loadModule("lib/capsules.ts");
const { SEMANTIC_FAMILIES, validateSemanticFamilies } = loadModule("lib/semantic-families.ts");
const { KEYWORD_SEMANTICS, CORE_QUESTION_CONTRIBUTIONS } = loadModule("lib/keyword-semantics.ts");
const { createQuestionnaireState, questionnaireReducer, firstIncompleteQuestion, serializeLegacyAnswers } = loadModule("lib/questionnaire-state.ts");

const approvedQuestions = [
  "당신이 가장 당신답다고 느끼는 순간은 언제인가요?",
  "지친 하루 끝에, 당신의 마음을 다시 채워주는 것은 무엇인가요?",
  "지금 당신의 마음을 하나의 풍경으로 표현한다면, 어떤 모습일까요?",
  "누군가와 마음을 나눌 때, 당신이 가장 소중하게 여기는 것은 무엇인가요?",
  "두 갈래 길 앞에 섰을 때, 당신의 발걸음을 움직이는 것은 무엇인가요?",
  "시간이 흘러 많은 것이 변하더라도, 당신이 끝까지 지키고 싶은 것은 무엇인가요?",
  "괜찮다고 말했던 순간, 사실 당신의 마음은 무엇을 바라고 있었나요?",
  "조금 더 가벼운 마음으로 살아갈 수 있다면, 당신은 무엇을 내려놓고 싶나요?",
  "두려움도 한계도 없다면, 당신은 어떤 가능성을 향해 나아가고 싶나요?",
  "이 여정의 끝에서, 당신의 마음에 남기고 싶은 말은 무엇인가요?",
];
const approvedLabels = [
  "혼자만의 시간|깊은 대화|무언가를 창작할 때|새로운 도전을 할 때|자연 속에 있을 때|좋아하는 일에 몰입할 때|소중한 사람과 함께할 때|자유롭게 떠날 때|누군가를 도울 때|생각에 잠길 때|몸을 움직일 때|목표를 이뤘을 때|함께 웃고 즐길 때|내 생각을 표현할 때",
  "고요한 휴식|좋아하는 음악|따뜻한 위로|누군가와의 대화|충분한 잠|자연의 풍경|작은 성취|맛있는 음식|가벼운 산책|혼자만의 여유|웃음과 장난|취미에 몰입하기|익숙한 공간|새로운 자극",
  "잔잔한 바다|깊은 숲|따뜻한 햇살|짙은 안개|쏟아지는 소나기|빛나는 별밤|거센 파도|맑고 푸른 하늘|고요한 새벽|붉게 물든 노을|바람 부는 들판|눈 덮인 산|흐르는 강물|구름 사이의 빛",
  "신뢰|진심|공감|존중|솔직함|배려|편안함|유머|서로의 이해|함께하는 시간|개인의 자유|안정감|약속을 지키는 마음|서로의 성장",
  "안정감|호기심|직감|새로운 가능성|성장|설렘|신중한 판단|자유로운 선택|확신|도전|현실적인 조건|삶의 의미|주변의 조언|후회 없는 선택",
  "진정성|사랑|자유|나의 신념|따뜻함|자존감|정의로움|성장하는 마음|가족|꿈|인간다운 존엄|내면의 평온|정직함|삶의 균형",
  "이해받고 싶었어|따뜻한 위로|있는 그대로의 인정|조금 더 관심|안심할 수 있는 말|진심 어린 사과|혼자 있을 시간|누군가의 포옹|솔직한 대화|기다려 주는 마음|나를 믿어주기|말없는 동행|도움을 청할 용기|잠시 멈출 여유",
  "타인의 시선|완벽주의|끊임없는 비교|지나간 후회|지나친 기대|과도한 책임감|인정받아야 한다는 마음|실패에 대한 두려움|조급함|오래된 미련|나를 향한 비난|모든 것을 통제하려는 마음|불필요한 걱정|거절하지 못하는 습관",
  "새로운 세계 탐험|오래된 꿈 실현|나만의 작품 만들기|자유로운 삶|깊은 사랑|미지의 경험|새로운 시작|진정한 자기 발견|세상에 기여하기|끝없는 모험|평생의 배움|나만의 길|새로운 관계 만들기|더 넓은 세상 만나기",
];
// Independent transcription of the supplied mapping, including all weight exceptions.
const approvedMappings = [
  "serenity/reflection|connection/reflection|expression:0.8/exploration:0.2|drive:0.6/exploration:0.4|serenity/exploration|expression/drive|connection|exploration|connection/drive|reflection/serenity|drive/serenity|drive|connection/serenity|expression/reflection",
  "serenity|serenity/expression|connection/serenity|connection/reflection|serenity|serenity/exploration|drive/grounding|serenity|serenity/grounding|serenity/reflection|connection/expression|expression/serenity|grounding/serenity|exploration/drive",
  "serenity/grounding|reflection/serenity|serenity/connection|reflection|expression/reflection|reflection/exploration|expression/drive|serenity/exploration|serenity/reflection|reflection/serenity|exploration/serenity|grounding/reflection|serenity/exploration|exploration/reflection",
  "connection:0.65/grounding:0.35|connection/reflection|connection|connection/grounding|expression/connection|connection|serenity/connection|connection/expression|connection/reflection|connection|exploration/connection|grounding/connection|grounding/connection|connection/drive",
  "grounding|exploration|exploration/reflection|exploration/drive|drive/reflection|exploration/connection|grounding/reflection|exploration/drive|grounding/drive|drive/exploration|grounding|reflection|connection/grounding|reflection/grounding",
  "reflection/expression|connection|exploration|reflection/grounding|connection/serenity|grounding/reflection|grounding/drive|drive/reflection|connection/grounding|drive/exploration|grounding/reflection|serenity|grounding/reflection|grounding:0.65/serenity:0.35",
  "connection/reflection|connection/serenity|connection/grounding|connection|grounding/connection|connection/grounding|serenity/grounding|connection/serenity|connection/expression|serenity/connection|connection/drive|connection/serenity|drive/connection|serenity/grounding",
  "reflection/grounding|grounding/drive|reflection/grounding|reflection|grounding/reflection|grounding/connection|connection/grounding|drive/exploration|drive/grounding|reflection/connection|reflection/serenity|grounding|grounding/reflection|connection/grounding",
  "exploration|drive/reflection|expression/drive|exploration/serenity|connection|exploration|exploration/drive|reflection/exploration|connection/drive|exploration/drive|exploration/reflection|exploration/expression|connection/exploration|exploration/connection",
];

test("approved question/keyword originals, 9 × 14 unique fixed identities, and separate Q10", () => {
  assert.deepEqual(QUESTION_DATA.map(q => q.prompt), approvedQuestions);
  assert.deepEqual(QUESTION_DATA.map(q => q.id), Array.from({ length: 10 }, (_, i) => `q${i + 1}`));
  QUESTION_DATA.slice(0, 9).forEach((q, i) => {
    assert.equal(q.keywords.length, 14);
    assert.deepEqual(q.keywords.map(k => k.label), approvedLabels[i].split("|"));
    assert.equal(q.allowSkip, true);
    assert.equal(q.keywordMode, "fixed");
  });
  const all = createKeywordPools().flat();
  assert.equal(all.length, 126);
  assert.equal(new Set(all.map(k => k.id)).size, 126);
  assert.equal(QUESTION_DATA[9].keywordMode, "personalized");
  assert.equal(QUESTION_DATA[9].allowSkip, false);
  assert.deepEqual(QUESTION_DATA[9].keywords, []);
  assert.equal(QUESTION_DATA[9].helperText, "지금까지 발견한 마음의 조각들을 다시 만나보세요. 새로운 단어나 문장을 직접 남겨도 좋아요.");
  all.forEach(k => {
    assert.equal(k.originalText, k.label);
    assert.equal(k.source, "preset");
    assert.ok(k.id.startsWith(`${k.questionId}-`));
  });
});

test("all 126 semantic mappings match approved roles/weights and reference only seven families", () => {
  assert.deepEqual(validateSemanticFamilies(SEMANTIC_FAMILIES), []);
  const ids = new Set(SEMANTIC_FAMILIES.map(f => f.id));
  assert.equal(ids.size, 7);
  assert.equal(Object.keys(KEYWORD_SEMANTICS).length, 126);
  assert.deepEqual(Object.keys(SEMANTIC_PROFILES).sort(), ["calm", "depth", "energy", "warm"]);
  createKeywordPools().slice(0, 9).forEach((pool, i) => pool.forEach((k, j) => {
    const entries = approvedMappings[i].split("|")[j].split("/");
    const expected = entries.map((entry, index) => {
      const [familyId, explicit] = entry.split(":");
      return { familyId, role: index ? "secondary" : "primary", weight: explicit ? Number(explicit) : entries.length === 1 ? 1 : index ? .3 : .7 };
    });
    assert.deepEqual(k.semanticWeights, expected, k.id);
    assert.ok(Math.abs(k.semanticWeights.reduce((sum, w) => sum + w.weight, 0) - 1) < 1e-9);
    k.semanticWeights.forEach(w => { assert.ok(ids.has(w.familyId)); assert.ok(Number.isFinite(w.weight) && w.weight >= 0); });
    assert.ok(SEMANTIC_PROFILES[k.group]);
  }));
});

test("question intents and core contribution config exclude atmosphere/wish/release/future contexts", () => {
  assert.deepEqual(QUESTION_DATA.map(q => q.answerIntent), ["selfExperience", "recoverySource", "currentAtmosphere", "relationshipValue", "decisionDriver", "enduringValue", "emotionalWish", "releaseTarget", "futureAspiration", "closingMessage"]);
  assert.deepEqual(CORE_QUESTION_CONTRIBUTIONS, { q1: .18, q2: .13, q4: .2, q5: .2, q6: .29 });
  assert.ok(Math.abs(Object.values(CORE_QUESTION_CONTRIBUTIONS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test("duplicate selection identity, independent deletion, metadata snapshots and untouched other questions", () => {
  const pools = createKeywordPools();
  const keyword = pools[0][0];
  let state = createQuestionnaireState();
  const otherQuestion = state.selections[1];
  const first = createSelectedCapsule(keyword, "q1", "selection-1");
  const second = createSelectedCapsule(keyword, "q1", "selection-2");
  state = questionnaireReducer(state, { type: "select", step: 0, selection: first });
  state = questionnaireReducer(state, { type: "select", step: 0, selection: second });
  assert.equal(state.selections[0].length, 2);
  assert.deepEqual(state.selections[0].map(k => k.selectionId), ["selection-1", "selection-2"]);
  assert.equal(first.id, keyword.id);
  assert.equal(first.originalText, keyword.label);
  assert.notEqual(first.semanticWeights, keyword.semanticWeights);
  assert.equal(serializeSelections(state.selections)[0], `${keyword.label}, ${keyword.label}`);
  state = questionnaireReducer(state, { type: "remove", step: 0, selectionId: "selection-1" });
  assert.deepEqual(state.selections[0].map(k => k.selectionId), ["selection-2"]);
  assert.equal(state.responses[0].status, "answered");
  assert.equal(state.selections[1], otherQuestion);
  assert.equal(pools[0][0], keyword);
  state = questionnaireReducer(state, { type: "remove", step: 0, selectionId: "selection-2" });
  assert.equal(state.responses[0].status, "pending");
  assert.equal(firstIncompleteQuestion(state), 0);
});

test("explicit skip differs from empty pending, allows final legacy request, and resets on new selection", () => {
  let state = createQuestionnaireState();
  assert.equal(state.responses[0].status, "pending");
  const emptySelections = state.selections;
  state = questionnaireReducer(state, { type: "skip", step: 0 });
  assert.equal(state.selections, emptySelections);
  assert.equal(state.responses[0].status, "skipped");
  assert.equal(firstIncompleteQuestion(state), 1);
  assert.equal(serializeSelections(state.selections)[0], "");
  assert.match(serializeLegacyAnswers(state)[0], /건너뛴 문항/);
  assert.equal(questionnaireReducer(state, { type: "skip", step: 9 }), state);
  const selection = createSelectedCapsule(createKeywordPools()[0][0], "q1", "restored-answer");
  state = questionnaireReducer(state, { type: "select", step: 0, selection });
  assert.equal(state.responses[0].status, "answered");
  assert.equal(questionnaireReducer(state, { type: "skip", step: 0 }), state);
  for (let i = 1; i < 9; i++) state = questionnaireReducer(state, { type: "skip", step: i });
  assert.equal(firstIncompleteQuestion(state), 9);
  const closing = createSelectedCapsule(createCustomKeyword("q10", "내 마음의 속도를 믿고 싶어", "custom-10"), "q10", "closing-selection");
  state = questionnaireReducer(state, { type: "select", step: 9, selection: closing });
  assert.equal(firstIncompleteQuestion(state), -1);
  assert.deepEqual(questionnaireReducer(state, { type: "reset" }), createQuestionnaireState());
});

test("custom input preserves the raw original, permits duplicate labels, and makes no invented semantic claim", () => {
  const first = createCustomKeyword("q8", "  완벽주의  ", "custom-1");
  const second = createCustomKeyword("q8", "  완벽주의  ", "custom-2");
  assert.equal(first.originalText, "  완벽주의  ");
  assert.equal(first.label, "완벽주의");
  assert.notEqual(first.id, second.id);
  assert.equal(first.answerIntent, "releaseTarget");
  assert.equal(first.source, "custom");
  assert.deepEqual(first.semanticWeights, []);
  const legacy = createSelectedCapsule({ id: "legacy-id", label: "원래 답변", group: "depth" }, "q7", "legacy-selection");
  assert.equal(legacy.originalText, "원래 답변");
  assert.equal(legacy.answerIntent, "emotionalWish");
});

test("14 varied-height capsule bodies stay separated and inside mobile/iPad/desktop field bounds", () => {
  const { createBody, advanceBodies, capsuleContact } = loadModule("components/questionnaire/capsule-physics.ts");
  // Solver regression only: synthetic dimensions are not actual browser layout measurements.
  for (const [width, columns] of [[304, 2], [350, 2], [450, 2], [800, 3]]) {
    const rowHeight = 140, trackWidth = width / columns;
    const bounds = { width, height: Math.ceil(14 / columns) * rowHeight };
    const bodies = createKeywordPools()[7].map((keyword, index) => createBody(keyword.id, keyword.group, {
      homeX: trackWidth * (index % columns + .5), homeY: rowHeight * (Math.floor(index / columns) + .5),
      width: Math.min(155, trackWidth - 28), height: [52, 74, 100][index % 3],
    }, 0));
    for (let frame = 1; frame <= 1200; frame++) {
      advanceBodies(bodies, bounds, 1 / 120, frame / 120, false);
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        assert.ok(a.x >= a.width / 2 + 8 - .05 && a.x <= bounds.width - a.width / 2 - 8 + .05);
        assert.ok(a.y >= a.height / 2 + 8 - .05 && a.y <= bounds.height - a.height / 2 - 8 + .05);
        for (const b of bodies.slice(i + 1)) assert.ok(capsuleContact(a, b).penetration < .05);
      }
    }
  }
});

test("holding freezes the solver, release continues its inertia, and sky samples remain continuous", () => {
  const { createBody, advanceBodies, startGlide } = loadModule("components/questionnaire/capsule-physics.ts");
  const { skyAt } = loadModule("components/questionnaire/sky-model.ts");
  const body = createBody("held", "depth", { homeX: 300, homeY: 250, width: 155, height: 90 }, 0);
  const bounds = { width: 1400, height: 800 };
  body.held = true;
  advanceBodies([body], bounds, 1 / 60, 1, false);
  assert.equal(body.x, 300);
  assert.equal(body.y, 250);
  body.held = false;
  startGlide(body, { x: 600, y: 0 }, 0, false);
  assert.equal(body.x, 300);
  for (let frame = 1; frame <= 384; frame++) advanceBodies([body], bounds, 1 / 120, frame / 120, false);
  assert.ok(body.x - 300 > 150 && body.x - 300 < 200);
  assert.ok(Math.hypot(body.vx, body.vy) > 0);
  let previous = skyAt(0);
  for (let index = 1; index <= 1000; index++) {
    const sky = skyAt(index / 1000);
    assert.ok(Math.abs(sky.weights.reduce((sum, w) => sum + w, 0) - 1) < 1e-9);
    assert.ok(Math.abs(sky.sun.x - previous.sun.x) < .2);
    assert.ok(Math.abs(sky.sun.y - previous.sun.y) < .3);
    assert.ok(Math.abs(sky.moon.x - previous.moon.x) < .2);
    assert.ok(Math.abs(sky.moon.y - previous.moon.y) < .4);
    previous = sky;
  }
});
