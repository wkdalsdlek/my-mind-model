import { validJourneySituation, SITUATION_REF } from "./journey-context";
import { buildClosingMessageInput, validateClosingMessageInput, validFinalClosingText, type ApprovedClosingMessage } from "./closing-message";
import { createQuestionnaireState, firstIncompleteQuestion, getApprovedClosingMessage, type QuestionnaireState } from "./questionnaire-state";
import { createCustomKeyword, createSelectedCapsule, createKeywordPools, type SelectedCapsule } from "./capsules";
import { prepareAuroraResult } from "./aurora-result";
import { buildAuroraRibbonMeaningMap } from "./aurora-ribbon-meaning";
import { QUESTION_DATA } from "./question-data";
import type { AuroraFlowMode, AuroraQuality } from "./aurora-types";
import type { AuroraInterpretationContext, AuroraInterpretationEvidence, AuroraInterpretationRequest, AuroraRibbonInterpretationFacts } from "./aurora-interpretation-types";

export type AuroraInterpretationErrorCode = "INVALID_INPUT" | "APPROVAL_MISMATCH" | "REQUEST_TOO_LARGE" | "AI_NOT_CONFIGURED"
  | "INTERPRETATION_FAILED" | "INTERPRETATION_RESPONSE_INVALID" | "QUOTE_CANDIDATES_INSUFFICIENT";
export class AuroraInterpretationError extends Error {
  constructor(readonly code: AuroraInterpretationErrorCode, readonly reason = code as string) { super(code); }
}
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const coreIds = ["q1", "q2", "q4", "q5", "q6"];
const role = (id: string): AuroraInterpretationEvidence["role"] => coreIds.includes(id) ? "core" : id === "q3" ? "currentAtmosphere"
  : id === "q7" ? "emotionalWish" : id === "q8" ? "releaseTarget" : id === "q9" ? "futureAspiration" : "closingMessage";

/** 5-C-3B can call this once at final generation, never from ribbon clicks. */
export function buildAuroraInterpretationRequest(state: QuestionnaireState, quality: AuroraQuality = "balanced", flowMode: AuroraFlowMode = "hybrid", situation?: string): AuroraInterpretationRequest {
  const approval = getApprovedClosingMessage(state);
  if (!approval || firstIncompleteQuestion(state) !== -1) throw new AuroraInterpretationError("APPROVAL_MISMATCH");
  if (situation !== undefined && !validJourneySituation(situation)) throw new AuroraInterpretationError("INVALID_INPUT");
  return structuredClone({ version: situation === undefined ? "aurora-interpretation-request-v1" : "aurora-interpretation-request-v2", ...(situation === undefined ? {} : { situation }), closingInput: buildClosingMessageInput(state, state.closing.authoredText, state.closing.authoredWord), approval, quality, flowMode });
}
/** Rebuilds every computed fact from bounded actual selections. Fingerprints are
 * consistency checks, not signatures/authentication or a proof of a human click. */
export async function prepareAuroraInterpretation(value: unknown): Promise<AuroraInterpretationContext> {
  const v2 = isRecord(value) && value.version === "aurora-interpretation-request-v2";
  if (!isRecord(value) || !exactKeys(value, ["version", "closingInput", "approval", "quality", "flowMode", ...(v2 ? ["situation"] : [])])
    || (v2 ? !validJourneySituation(value.situation) : value.version !== "aurora-interpretation-request-v1") || !["low", "balanced", "high"].includes(String(value.quality))
    || !["independent", "hybrid", "loop-emphasis"].includes(String(value.flowMode))) throw new AuroraInterpretationError("INVALID_INPUT");
  const a = value.approval;
  if (!isRecord(a) || !exactKeys(a, ["text", "source", "approvedAt", "inputFingerprint"]) || typeof a.text !== "string" || !validFinalClosingText(a.text)
    || a.text !== a.text.trim() || !["ai", "user-edited", "user-authored"].includes(String(a.source)) || typeof a.approvedAt !== "string"
    || a.approvedAt.length > 80 || !Number.isFinite(Date.parse(a.approvedAt)) || typeof a.inputFingerprint !== "string" || a.inputFingerprint.length > 262144)
    throw new AuroraInterpretationError("APPROVAL_MISMATCH");
  let input;
  try { input = validateClosingMessageInput(value.closingInput); } catch { throw new AuroraInterpretationError("INVALID_INPUT"); }
  const state = createQuestionnaireState(), pools = createKeywordPools();
  state.closing = { ...state.closing, authoredText: input.authoredText, authoredWord: input.authoredWord, approved: structuredClone(a) as unknown as ApprovedClosingMessage };
  for (let i = 0; i < 10; i++) {
    const q = QUESTION_DATA[i], context = input.context.find(c => c.questionId === q.id);
    const selections = i === 9 ? input.q10Selections : context!.selections;
    if (i < 9 && context!.status === "pending") throw new AuroraInterpretationError("INVALID_INPUT");
    state.responses[i] = { questionId: q.id, status: i === 9 ? "answered" : context!.status };
    state.selections[i] = selections.map(s => {
      if (s.source === "preset") {
        const fixed = pools[i].find(k => k.id === s.keywordId);
        if (!fixed || fixed.label !== s.label || fixed.label !== s.originalText) throw new AuroraInterpretationError("INVALID_INPUT");
        return createSelectedCapsule(fixed, q.id, s.selectionId);
      }
      if (s.originalText.trim() !== s.label) throw new AuroraInterpretationError("INVALID_INPUT");
      return createSelectedCapsule({ ...createCustomKeyword(q.id, s.originalText, s.keywordId), source: s.source }, q.id, s.selectionId);
    });
  }
  if (!getApprovedClosingMessage(state)) throw new AuroraInterpretationError("APPROVAL_MISMATCH");
  const prepared = prepareAuroraResult(state);
  if (!prepared.ready) throw new AuroraInterpretationError("INVALID_INPUT");
  const p = prepared.snapshot.personalization;
  const quality = value.quality as AuroraQuality, flowMode = value.flowMode as AuroraFlowMode;
  const map = buildAuroraRibbonMeaningMap(p, { source: state, quality, flowMode });
  if (map.status !== "ready" || map.sourceBinding !== "meaning-replay-matched" || map.issues.length) throw new AuroraInterpretationError("INVALID_INPUT");
  const evidenceFor = (s: SelectedCapsule, i: number, index: number): AuroraInterpretationEvidence => {
    const trace = p.trace.questions[i]?.selections.find(t => t.selectionIds.includes(s.selectionId));
    return { ref: `selection:${QUESTION_DATA[i].id}:${index}`, questionId: QUESTION_DATA[i].id, role: role(QUESTION_DATA[i].id),
      answerIntent: QUESTION_DATA[i].answerIntent, keywordId: s.id, selectionId: s.selectionId, label: s.label,
      originalText: s.originalText ?? s.label, mapping: trace?.mapping === "fixed" ? "fixed" : trace?.mapping === "exact-custom" ? "exact-custom" : "unclassified",
      semanticWeights: trace?.weights ?? [], coreContributions: trace?.coreContributions ?? [] };
  };
  const questions = QUESTION_DATA.map((q, i) => ({ questionId: q.id, prompt: q.prompt, answerIntent: q.answerIntent,
    status: state.responses[i].status as "answered" | "skipped", evidence: [...state.selections[i]].sort((a, b) => a.selectionId < b.selectionId ? -1 : a.selectionId > b.selectionId ? 1 : 0).map((s, index) => evidenceFor(s, i, index)) }));
  questions[9].evidence.push({ ref: "approved:q10", questionId: "q10", role: "closingMessage", answerIntent: "closingMessage", keywordId: null,
    selectionId: null, label: a.text, originalText: a.text, mapping: "approved-sentence", semanticWeights: [], coreContributions: [] });
  const ribbons: AuroraRibbonInterpretationFacts[] = map.ribbons.filter(r => r.active).map(r => {
    const pair = r.layers[0].visual;
    return { ribbonId: r.ribbonId, name: r.name, kind: r.kind, representativeFamily: r.representativeFamily, meaningStatus: r.meaningStatus,
      composition: r.composition, paletteOrigins: r.paletteOrigins, repetitions: r.repetitions, repeatedTexts: r.repeatedTexts, layers: r.layers,
      visualExplanation: r.visualExplanation, evidence: questions.flatMap(q => q.evidence).filter(e => r.evidence.some(v => v.questionId === e.questionId && v.selectionIds.includes(e.selectionId ?? ""))),
      visualExplanationText: { origin: "deterministic-code",
        semantic: `실제 색상 쌍은 ${pair.colorA.color}와 ${pair.colorB.color}입니다. 답변 유래 의미 구성과 중립색의 출처는 composition과 paletteOrigins에 구분되어 있습니다. 전체 움직임은 전체 coreShares의 혼합값입니다.`,
        artistic: "개별 폭·곡률·꼬임과 에너지 시드·세 흐름 채널, 광맥·미스트 비율은 기존 렌더러 슬롯의 조형 설정입니다. 성격의 과학적 지표가 아닙니다.",
        limitations: "의미 비중은 색상 픽셀 면적이 아닙니다. Q3·Q7·Q8·Q9의 별도 효과 데이터는 현재 렌더러에 직접 적용되지 않습니다." } };
  });
  if (ribbons.length !== map.activeRibbonCount || new Set(ribbons.map(r => r.ribbonId)).size !== ribbons.length) throw new AuroraInterpretationError("INVALID_INPUT");
  // Digest binds approval text AND exact raw selections to renderer options. Never
  // send the lossless closing fingerprint to the model or diagnostics.
  const bindingInput = { version: value.version, ...(v2 ? { situation: value.situation } : {}), closingInput: buildClosingMessageInput(state, input.authoredText, input.authoredWord), approval: { text: a.text, source: a.source }, quality, flowMode, catalogVersion: "philosophy-quotes-v1" };
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(bindingInput)));
  const requestDigest = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
  return structuredClone({ ...(v2 ? { situation: { ref: SITUATION_REF, rawText: value.situation as string } } : {}), binding: { requestDigest, quality, flowMode, catalogVersion: "philosophy-quotes-v1" }, approvedClosing: { text: a.text, source: a.source as ApprovedClosingMessage["source"] },
    facts: { origin: "deterministic-engines", coreShares: p.coreShares, familyTrace: p.trace.families, repeatedTexts: p.trace.repeatedTexts,
      context: { atmosphere: p.atmosphere, innerPulse: p.innerPulse, releaseFragments: p.releaseFragments, outerExpansion: p.outerExpansion, rendererApplied: false },
      questions, unclassified: questions.slice(0, 9).flatMap(q => q.evidence.filter(e => e.mapping === "unclassified")), ribbons,
      familiesWithoutActiveRibbonColor: map.familiesWithoutActiveRibbonColor } });
}
