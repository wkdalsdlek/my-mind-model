import { AuroraInterpretationError, exactKeys, isRecord } from "../aurora-interpretation";
import { AURORA_REPORT_SECTIONS, type AuroraInterpretationContext } from "../aurora-interpretation-types";
import { parseAuroraInterpretation, parseInterpretationJson } from "../aurora-interpretation-validation";
import { auroraVisualReading } from "../aurora-visual-reading";
import { philosophyQuoteCandidates } from "../philosophy-quotes";
import { interpretationModelInput, interpretationResponseFormat, interpretationSystemPrompt } from "./aurora-interpretation-service";

const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const string = { type: "string" };
const evidence = (context: AuroraInterpretationContext) => context.facts.questions.flatMap(q => q.evidence);
const fields = ["psychological", "philosophical", "currentMind", "reportSummary"] as const;
const topKeys = ["auroraName", "quoteId", "q10Anchor", "quoteReason", "overall", "ribbons", "report"] as const;
const invalid = (reason: string): never => { throw new AuroraInterpretationError("INTERPRETATION_RESPONSE_INVALID", reason); };

/** Provider-only encoding. Public v2 result, prose lengths, evidence and quote
 * validation stay unchanged. Short references are a reversible lookup, not a
 * summary or a new semantic classification of a user's answer. */
export function interpretationProviderRequest(context: AuroraInterpretationContext) {
  if (!context.situation) return { responseFormat: interpretationResponseFormat(context),
    systemPrompt: interpretationSystemPrompt(context), input: interpretationModelInput(context) };
  const refs = evidence(context), aliases = new Map(refs.map((e, i) => [e.ref, `e${i}`]));
  const alias = (ref: string) => {
    const value = aliases.get(ref); if (!value) return invalid("evidence-mismatch"); return value;
  };
  const paragraph = object({ t: string, e: { type: "array", items: { $ref: "#/$defs/evidenceRef" } } });
  const reference = { $ref: "#/$defs/paragraph" };
  const responseFormat = { type: "json_schema" as const, json_schema: { name: "aurora_interpretation_compact_v2", strict: true,
    schema: { ...object({ auroraName: string, quoteId: { type: "string", enum: [...philosophyQuoteCandidates().map(q => q.quoteId), "none"] },
      q10Anchor: string, quoteReason: { type: "array", items: string }, overall: reference,
      ribbons: object(Object.fromEntries(context.facts.ribbons.map(r => [r.ribbonId, object({
        ...Object.fromEntries(fields.map(key => [key, reference])), reflectionQuestion: string,
      })]))), report: object(Object.fromEntries(AURORA_REPORT_SECTIONS.map(key => [key, reference]))) }),
      $defs: { evidenceRef: { type: "string", enum: refs.map(e => alias(e.ref)) }, paragraph } } } };
  const input = {
    readingVersion: "situation-reflection-v2", situation: context.situation, approvedClosing: { ...context.approvedClosing, ref: alias("approved:q10") },
    coreShares: context.facts.coreShares,
    repeatedTexts: context.facts.repeatedTexts,
    // One lossless evidence table replaces repeated copies in traces/context/IDs.
    // Keep question intent, exact user spelling, mapping, weights and repeats.
    questions: context.facts.questions.map(q => ({ questionId: q.questionId, prompt: q.prompt, answerIntent: q.answerIntent, status: q.status,
      evidence: q.evidence.map(e => ({ ref: alias(e.ref), role: e.role, label: e.label, originalText: e.originalText,
        mapping: e.mapping, semanticWeights: e.semanticWeights, coreContributions: e.coreContributions })) })),
    familiesWithoutActiveRibbonColor: context.facts.familiesWithoutActiveRibbonColor,
    ribbons: context.facts.ribbons.map(r => ({ ribbonId: r.ribbonId, name: r.name, composition: r.composition, meaningStatus: r.meaningStatus,
      evidenceRefs: r.evidence.map(e => alias(e.ref)), paletteOrigins: r.paletteOrigins,
      // Geometry/mist prose is rendered deterministically; it is not an AI task.
      deterministicVisual: { colors: auroraVisualReading(r).colors } })),
    quotes: philosophyQuoteCandidates().map(q => ({ quoteId: q.quoteId, philosopher: q.philosopher, text: q.text, themes: q.themes, context: q.source.attributionNote })),
  };
  const systemPrompt = interpretationSystemPrompt(context).replaceAll("approved:q10", "approvedClosing.ref에 지정된 근거") + `
전송 형식만 압축합니다. 본문별 깊이·분량과 모든 리본/여섯 report 본문은 위 지시 그대로 유지하세요. 각 문단은 {t: 본문, e: 실제로 사용한 근거 ref 목록}입니다. e0 등의 ref는 questions.evidence.ref에 주어진 정확한 근거만 가리킵니다. approvedClosing.ref도 같은 표의 승인 문장을 가리킵니다. overall과 letter에는 이 승인 ref를 포함하세요.
리본 키 자체가 정확한 ribbonId이므로 내부에 ribbonId를 반복하지 않습니다. basis와 contextRefs는 서버가 고정 규칙으로 붙입니다. 해당 리본의 evidenceRefs가 비어 있으면 e=[]로 쓰고 근거 부족을 정직하게 인정하세요. currentMind는 해당 리본 핵심 근거와 Q3·Q7·Q8·Q9 맥락만 사용합니다. 나머지 리본 문단의 e는 해당 리본 evidenceRefs로 제한합니다. report.present와 overall은 위 지시대로 제공된 문항 맥락을 빠뜨리지 마세요. t와 e 외의 문단 필드는 출력하지 마세요.`;
  return { responseFormat, systemPrompt, input };
}

/** Expand only deterministic metadata. Never synthesize missing prose or refs.
 * Full existing validation still runs, including per-ribbon scope and Q10/quote
 * grounding, before this can become an HTTP 200 result. */
export function parseInterpretationProviderResponse(raw: unknown, context: AuroraInterpretationContext) {
  if (!context.situation) return parseAuroraInterpretation(raw, context);
  const body = parseInterpretationJson(raw), refs = evidence(context);
  if (!isRecord(body) || !exactKeys(body, topKeys) || !isRecord(body.ribbons) || !isRecord(body.report)
    || !exactKeys(body.ribbons, context.facts.ribbons.map(r => r.ribbonId)) || !exactKeys(body.report, AURORA_REPORT_SECTIONS)) return invalid("invalid-shape");
  const expand = (value: unknown, hasEvidence: boolean) => {
    if (!isRecord(value) || !exactKeys(value, ["t", "e"]) || !Array.isArray(value.e)) return invalid("invalid-shape");
    const evidenceRefs = value.e.map(v => {
      if (typeof v !== "string" || !/^e(?:0|[1-9]\d*)$/.test(v)) return invalid("evidence-mismatch");
      const index = Number(v.slice(1)); if (!Number.isSafeInteger(index) || !refs[index]) return invalid("evidence-mismatch");
      return refs[index].ref;
    });
    return { text: value.t, evidenceRefs, basis: hasEvidence ? "answer-grounded" : "insufficient-evidence", contextRefs: [context.situation!.ref] };
  };
  const entries = body.ribbons, report = body.report;
  const nonCore = context.facts.questions.filter(q => ["q3", "q7", "q8", "q9"].includes(q.questionId)).some(q => q.evidence.length);
  const ribbons = Object.fromEntries(context.facts.ribbons.map(r => {
    const value = entries[r.ribbonId];
    if (!isRecord(value) || !exactKeys(value, [...fields, "reflectionQuestion"])) return invalid("invalid-shape");
    return [r.ribbonId, { ribbonId: r.ribbonId, ...Object.fromEntries(fields.map(key => [key, expand(value[key], !!r.evidence.length || key === "currentMind" && nonCore)])), reflectionQuestion: value.reflectionQuestion }];
  }));
  return parseAuroraInterpretation(JSON.stringify({ ...body, overall: expand(body.overall, !!refs.length), ribbons,
    report: Object.fromEntries(AURORA_REPORT_SECTIONS.map(key => [key, expand(report[key], !!refs.length)])) }), context);
}
