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
export function universeModelResponse(context) {
  const anchor = context.approvedClosing.text.match(/[가-힣 ]{2,}/)?.[0].trim().slice(0, 12) || context.approvedClosing.text.slice(0, 2);
  const grounded = refs => ({ text: '서로 다른 가치가 함께 머물 자리를 찾으려는 가능성을 돌아볼 수 있습니다.', evidenceRefs: refs, basis: refs.length ? 'answer-grounded' : 'insufficient-evidence' });
  const raw = { auroraName: '조용히 이어지는 나의 빛', quoteId: 'seneca-letters-1-1-self', q10Anchor: anchor,
    quoteReason: [`승인한 문장의 ${anchor}라는 주제는 자신의 시간을 되찾는 관점과 닿아 있습니다.`],
    overall: { ...grounded(context.facts.questions.flatMap(q => q.evidence.map(e => e.ref))), text: '당신이 남긴 표현에는 여러 가치를 함께 돌보고 싶은 마음의 가능성이 담겨 있습니다. 서로 다른 리본은 각자의 빛을 잃지 않으면서도 하나의 장면을 이룹니다. 이 해석은 정해진 성격이 아니라 지금의 선택을 다시 바라보는 하나의 시선입니다. 앞으로 어떤 가치를 더 가까이 두고 싶은지 천천히 생각해 볼 수 있습니다.' },
    ribbons: Object.fromEntries(context.facts.ribbons.map((r, i) => [r.ribbonId, { ribbonId: r.ribbonId,
      psychological: { ...grounded(r.evidence.map(e => e.ref)), text: `${r.name}에 연결된 표현에서 삶의 여러 가치를 함께 살펴보려는 가능성을 읽어 볼 수 있습니다.` },
      philosophical: { ...grounded(r.evidence.map(e => e.ref)), text: `이 빛을 ${i + 1}번째로 바라보며 가치가 함께 머무는 방식에 질문을 던져 볼 수 있습니다.` },
      reflectionQuestion: `이 ${i + 1}번째 빛에서 일상으로 가져가고 싶은 가치는 무엇인가요?` }])) };
  if (context.situation) {
    const contextual = v => ({...v,contextRefs:["situation:intro"]});
    const refs=context.facts.questions.flatMap(q=>q.evidence.map(e=>e.ref));
    raw.overall = contextual(raw.overall);
    raw.report=Object.fromEntries(["interplay","present","direction","relationships","selfCare","letter"].map(key=>[key,contextual({...grounded(refs),text:key==="relationships"?"실제 관계에 대한 선택이나 이야기가 충분하지 않다면 상대의 마음을 단정하기보다 자신이 소중하게 여기는 기준을 먼저 돌아볼 수 있습니다.":"들려준 지금의 이야기와 실제 선택을 함께 돌아보며, 오늘 해 볼 작은 실천을 자신의 속도로 생각해 볼 수 있습니다."})]));
    for (const r of context.facts.ribbons) {
      const entry=raw.ribbons[r.ribbonId];
      entry.psychological=contextual(entry.psychological);entry.philosophical=contextual(entry.philosophical);
      entry.reportSummary=contextual({...grounded(r.evidence.map(e=>e.ref)),text:"이 리본에 연결된 실제 표현은 전체 삶의 이야기와 함께 읽을 수 있는 한 가지 가치의 흐름입니다."});
      const contextualRefs=[...r.evidence.map(e=>e.ref),...context.facts.questions.filter(q=>["q3","q7","q8","q9"].includes(q.questionId)).flatMap(q=>q.evidence.map(e=>e.ref))];
      entry.currentMind=contextual({...grounded(contextualRefs),text:"현재의 분위기와 앞으로 바라는 감정은 다를 수 있습니다. 이야기한 상황만으로 마음을 단정하지 않고 선택에서 확인되는 단서를 돌아볼 수 있습니다."});
    }
  }
  return raw;
}
export function universeInterpretation(context) {
  return parseAuroraInterpretation(JSON.stringify(universeModelResponse(context)),context);
}
/** Reversible provider wire fixture; all prose/evidence still comes from the
 * same synthetic full response, never a network model call. */
export function universeProviderResponse(context) {
  const raw = universeModelResponse(context);
  if (!context.situation) return raw;
  const aliases = new Map(context.facts.questions.flatMap(q => q.evidence).map((e, i) => [e.ref, `e${i}`]));
  const compact = value => ({ t: value.text, e: value.evidenceRefs.map(ref => aliases.get(ref)) });
  return { ...raw, overall: compact(raw.overall), ribbons: Object.fromEntries(Object.entries(raw.ribbons).map(([id, ribbon]) => [id, {
    psychological: compact(ribbon.psychological), philosophical: compact(ribbon.philosophical), currentMind: compact(ribbon.currentMind),
    reportSummary: compact(ribbon.reportSummary), reflectionQuestion: ribbon.reflectionQuestion,
  }])), report: Object.fromEntries(Object.entries(raw.report).map(([key, value]) => [key, compact(value)])) };
}
export async function universeFixture(state = universeState(), quality = 'balanced', flow = 'hybrid', situation) {
  const payload = buildAuroraInterpretationRequest(state, quality, flow, situation), context = await prepareAuroraInterpretation(payload);
  return { version: 'aurora-universe-v1', snapshot: prepareAuroraResult(state).snapshot, context, status: 'interpreted', interpretation: universeInterpretation(context) };
}
export async function interpretationForRequest(payload) {
  return { interpretation: universeInterpretation(await prepareAuroraInterpretation(payload)) };
}
