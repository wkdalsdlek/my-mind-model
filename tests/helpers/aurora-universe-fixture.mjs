// Synthetic answers only; never an OpenAI/network call.
import { loadModule } from './load-typescript.mjs';
const { createQuestionnaireState, questionnaireReducer: reduce } = loadModule('lib/questionnaire-state.ts');
const { createKeywordPools, createSelectedCapsule } = loadModule('lib/capsules.ts');
const { buildAuroraInterpretationRequest, prepareAuroraInterpretation } = loadModule('lib/aurora-interpretation.ts');
const { parseAuroraInterpretation } = loadModule('lib/aurora-interpretation-validation.ts');
const { prepareAuroraResult } = loadModule('lib/aurora-result.ts');
export function universeState(kind = 'mixed') {
  let s = createQuestionnaireState(); const pools = createKeywordPools();
  for (let i = 0; i < 9; i++) {
    const indexes = i === 0 ? kind === 'single' ? [11] : kind === 'neutral' ? [] : [1, 2, 3, 11] : kind === 'all' ? [0] : [];
    for (const index of indexes) s = reduce(s, { type: 'select', step: i, selection: createSelectedCapsule(pools[i][index], `q${i + 1}`, `fixture-${i}-${index}`) });
    if (!s.selections[i].length) s = reduce(s, { type: 'skip', step: i });
  }
  s = reduce(s, { type: 'closing-input', field: 'authoredText', text: '내 시간을 지키며 함께 걸어간다' });
  return reduce(s, { type: 'closing-approve', direct: true, approvedAt: '2026-10-16T00:00:00.000Z' });
}
export function universeInterpretation(context) {
  const anchor = context.approvedClosing.text.match(/[가-힣 ]{2,}/)?.[0].trim().slice(0, 12) || context.approvedClosing.text.slice(0, 2);
  const grounded = refs => ({ text: '서로 다른 가치가 함께 머물 자리를 찾으려는 가능성을 돌아볼 수 있습니다.', evidenceRefs: refs, basis: refs.length ? 'answer-grounded' : 'insufficient-evidence' });
  return parseAuroraInterpretation(JSON.stringify({ auroraName: '조용히 이어지는 나의 빛', quoteId: 'seneca-letters-1-1-self', q10Anchor: anchor,
    quoteReason: [`승인한 문장의 ${anchor}라는 주제는 자신의 시간을 되찾는 관점과 닿아 있습니다.`],
    overall: { ...grounded(context.facts.questions.flatMap(q => q.evidence.map(e => e.ref))), text: '당신이 남긴 표현에는 여러 가치를 함께 돌보고 싶은 마음의 가능성이 담겨 있습니다. 서로 다른 리본은 각자의 빛을 잃지 않으면서도 하나의 장면을 이룹니다. 이 해석은 정해진 성격이 아니라 지금의 선택을 다시 바라보는 하나의 시선입니다. 앞으로 어떤 가치를 더 가까이 두고 싶은지 천천히 생각해 볼 수 있습니다.' },
    ribbons: Object.fromEntries(context.facts.ribbons.map((r, i) => [r.ribbonId, { ribbonId: r.ribbonId,
      psychological: { ...grounded(r.evidence.map(e => e.ref)), text: `${r.name}에 연결된 표현에서 삶의 여러 가치를 함께 살펴보려는 가능성을 읽어 볼 수 있습니다.` },
      philosophical: { ...grounded(r.evidence.map(e => e.ref)), text: `이 빛을 ${i + 1}번째로 바라보며 가치가 함께 머무는 방식에 질문을 던져 볼 수 있습니다.` },
      reflectionQuestion: `이 ${i + 1}번째 빛에서 일상으로 가져가고 싶은 가치는 무엇인가요?` }])) }), context);
}
export async function universeFixture(state = universeState(), quality = 'balanced', flow = 'hybrid') {
  const payload = buildAuroraInterpretationRequest(state, quality, flow), context = await prepareAuroraInterpretation(payload);
  return { version: 'aurora-universe-v1', snapshot: prepareAuroraResult(state).snapshot, context, status: 'interpreted', interpretation: universeInterpretation(context) };
}
export async function interpretationForRequest(payload) {
  return { interpretation: universeInterpretation(await prepareAuroraInterpretation(payload)) };
}
