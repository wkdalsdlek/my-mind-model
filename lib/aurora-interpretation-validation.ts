import { AuroraInterpretationError, exactKeys, isRecord } from "./aurora-interpretation";
import { AURORA_REPORT_SECTIONS } from "./aurora-interpretation-types";
import { SITUATION_REF } from "./journey-context";
import type { AuroraInterpretationContext, AuroraInterpretationResult, GroundedAuroraText } from "./aurora-interpretation-types";
import { resolvePhilosophyQuote, isVerifiedPhilosophyQuote } from "./philosophy-quotes";

export const AURORA_INTERPRETATION_OUTPUT_LIMIT = 80000;
const refsFor = (context: AuroraInterpretationContext) => context.facts.questions.flatMap(q => q.evidence.map(e => e.ref));
/** Used for exact local consistency, never for logging original input. */
export function canonicalInterpretationValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalInterpretationValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, v]) => `${JSON.stringify(key)}:${canonicalInterpretationValue(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function invalid(reason: string): never { throw new AuroraInterpretationError("INTERPRETATION_RESPONSE_INVALID", reason); }
function rejectDuplicateKeys(raw: string): void {
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "{") stack.push(new Set()); else if (t === "[") stack.push(null);
    else if (t === "}" || t === "]") stack.pop();
    else if (t.startsWith('"') && tokens[i + 1] === ":") {
      const current = stack[stack.length - 1], key = JSON.parse(t);
      if (current?.has(key)) invalid("duplicate-key");
      current?.add(key);
    }
  }
}
const text = (value: unknown, max: number): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max || !/[가-힣]/.test(value)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|<[^>]*>|\[[^\]]*\]\(|https?:\/\//.test(value)
    || /(?:당신의|사용자의)\s*(?:무의식|진정한 본성)|(?:반드시|틀림없이)\s*(?:성공|행복|성취)|(?:성격|정체성)(?:이|은|을)\s*(?:확정|진단)/.test(value)) invalid("invalid-text");
  return value.trim();
};
function grounded(value: unknown, allowed: readonly string[], keywords: readonly string[], max: number, contextRaw?: string): GroundedAuroraText {
  if (!isRecord(value) || !exactKeys(value, ["text", "basis", "evidenceRefs"]) || !Array.isArray(value.evidenceRefs)
    || value.evidenceRefs.some(r => typeof r !== "string" || !allowed.includes(r)) || new Set(value.evidenceRefs).size !== value.evidenceRefs.length
    || value.evidenceRefs.length > 301 || value.basis !== (allowed.length ? "answer-grounded" : "insufficient-evidence")
    || allowed.length && !value.evidenceRefs.length) invalid("evidence-mismatch");
  const result = text(value.text, max);
  validateQuotedKeywords(result, keywords, contextRaw);
  return { origin: "ai-interpretation", text: result, evidenceRefs: [...value.evidenceRefs] as string[], basis: value.basis as GroundedAuroraText["basis"] };
}
function validateQuotedKeywords(value: string, keywords: readonly string[], contextRaw?: string): void {
  for (const quoted of value.matchAll(/[「“"]([^」”"]+)[」”"]/g)) if (!keywords.includes(quoted[1]) && !contextRaw?.includes(quoted[1])) invalid("unknown-keyword");
}
/** v2 explicitly separates contextual data from core contribution references. */
function contextualGrounded(value: unknown, allowed: readonly string[], keywords: readonly string[], max: number, contextRaw?: string): GroundedAuroraText {
  if (!isRecord(value) || !exactKeys(value, ["text", "basis", "evidenceRefs", "contextRefs"])
    || !Array.isArray(value.contextRefs) || value.contextRefs.length !== 1 || value.contextRefs[0] !== SITUATION_REF) invalid("situation-reference-mismatch");
  return { ...grounded({ text: value.text, basis: value.basis, evidenceRefs: value.evidenceRefs }, allowed, keywords, max, contextRaw), contextRefs: [SITUATION_REF] };
}
export function parseAuroraInterpretation(raw: unknown, context: AuroraInterpretationContext): AuroraInterpretationResult {
  if (typeof raw !== "string" || raw.length > AURORA_INTERPRETATION_OUTPUT_LIMIT) invalid("invalid-json");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { invalid("invalid-json"); }
  rejectDuplicateKeys(raw);
  const deep = !!context.situation;
  if (!isRecord(body) || !exactKeys(body, ["auroraName", "quoteId", "q10Anchor", "quoteReason", "overall", "ribbons", ...(deep ? ["report"] : [])])) invalid("invalid-shape");
  if (body.quoteId === "none") throw new AuroraInterpretationError("QUOTE_CANDIDATES_INSUFFICIENT");
  const quote = typeof body.quoteId === "string" ? resolvePhilosophyQuote(body.quoteId) : null;
  if (!quote || !isVerifiedPhilosophyQuote(quote)) invalid("unknown-quote");
  const anchor = text(body.q10Anchor, 80);
  if ([...anchor].length < Math.min(2, [...context.approvedClosing.text].length)) invalid("quote-grounding");
  if (!context.approvedClosing.text.includes(anchor) || !Array.isArray(body.quoteReason) || body.quoteReason.length < 1 || body.quoteReason.length > 2) invalid("quote-grounding");
  const reason = body.quoteReason.map(v => text(v, 240));
  if (!reason.join(" ").includes(anchor)) invalid("quote-grounding");
  if (reason.flatMap(r => r.split(/[.!?。！？]+(?:\s|$)/u).filter(s => s.trim())).length > 2) invalid("quote-grounding");
  for (const r of reason) for (const quoted of r.matchAll(/[「“"]([^」”"]+)[」”"]/g))
    if (!context.approvedClosing.text.includes(quoted[1]) && !quote.text.includes(quoted[1])) invalid("quote-grounding");
  const allEvidence = context.facts.questions.flatMap(q => q.evidence), allKeywords = allEvidence.flatMap(e => [e.label, e.originalText]);
  const read = (value: unknown, allowed: readonly string[], keywords: readonly string[], max: number) => deep
    ? contextualGrounded(value, allowed, keywords, max, context.situation!.rawText) : grounded(value, allowed, keywords, max);
  const contextKeywords = [...allKeywords, ...(context.situation ? [context.situation.rawText] : [])];
  const overall = read(body.overall, refsFor(context), contextKeywords, deep ? 3200 : 1800);
  if (!overall.evidenceRefs.includes("approved:q10")) invalid("q10-missing");
  // Acknowledge each supplied question in the whole interpretation. Non-core
  // context must not migrate into ribbon core evidence.
  for (const q of context.facts.questions.filter(q => q.questionId !== "q10" && q.evidence.length))
    if (!q.evidence.some(e => overall.evidenceRefs.includes(e.ref))) invalid("context-missing");
  if (!isRecord(body.ribbons) || !exactKeys(body.ribbons, context.facts.ribbons.map(r => r.ribbonId))) invalid("ribbon-count-mismatch");
  const entries = body.ribbons;
  const ribbons = context.facts.ribbons.map(facts => {
    const entry = entries[facts.ribbonId];
    if (!isRecord(entry) || !exactKeys(entry, ["ribbonId", "psychological", "philosophical", "reflectionQuestion", ...(deep ? ["currentMind", "reportSummary"] : [])]) || entry.ribbonId !== facts.ribbonId) invalid("ribbon-id-mismatch");
    const refs = facts.evidence.map(e => e.ref), keywords = facts.evidence.flatMap(e => [e.label, e.originalText]);
    let psychological = read(entry.psychological, refs, [...keywords, ...(context.situation ? [context.situation.rawText] : [])], deep ? 1400 : 600), philosophical = read(entry.philosophical, refs, [...keywords, ...(context.situation ? [context.situation.rawText] : [])], deep ? 1400 : 600);
    let reflectionQuestion = text(entry.reflectionQuestion, 180);
    validateQuotedKeywords(reflectionQuestion, keywords, context.situation?.rawText);
    if (!reflectionQuestion.endsWith("?")) invalid("invalid-reflection");
    if (!refs.length) {
      psychological = { origin: "deterministic-insufficient-evidence", text: "이 리본에는 연결된 핵심 답변 근거가 없어 심리적 의미를 확정할 수 없습니다.", evidenceRefs: [], basis: "insufficient-evidence" };
      philosophical = { ...psychological, text: "이 리본을 특정한 삶의 태도와 연결할 선택 근거가 아직 없습니다. 이 여백은 새로운 선택을 생각해 볼 자리로 남겨둡니다." };
      reflectionQuestion = "이 여백에 지금 어떤 가치를 담아 보고 싶나요?";
    }
    if (deep && !refs.length) {
      psychological = { ...psychological, contextRefs: [SITUATION_REF] };
      philosophical = { ...philosophical, contextRefs: [SITUATION_REF] };
    }
    const contextualRefs = [...refs, ...context.facts.questions.filter(q => ["q3", "q7", "q8", "q9"].includes(q.questionId)).flatMap(q => q.evidence.map(e => e.ref))];
    let currentMind = deep ? contextualGrounded(entry.currentMind, contextualRefs, allEvidence.filter(e => contextualRefs.includes(e.ref)).flatMap(e => [e.label, e.originalText]), 1400, context.situation?.rawText) : undefined;
    const reportSummary = deep ? contextualGrounded(entry.reportSummary, refs, keywords, 1200, context.situation?.rawText) : undefined;
    if (deep && !contextualRefs.length && currentMind) currentMind = { ...psychological, text: "현재 마음을 연결해 읽을 선택 근거가 충분하지 않습니다. 사전 상황만으로 감정을 추정하지 않고 지금의 여백을 존중합니다." };
    if (deep && !refs.length && reportSummary) Object.assign(reportSummary, psychological);
    return { ribbonId: facts.ribbonId, psychological, philosophical, reflectionQuestion, ...(deep ? { currentMind, reportSummary } : {}) };
  });
  let report: AuroraInterpretationResult["generated"]["report"];
  if (deep) {
    if (!isRecord(body.report) || !exactKeys(body.report, AURORA_REPORT_SECTIONS)) invalid("report-sections-mismatch");
    const values = body.report;
    report = Object.fromEntries(AURORA_REPORT_SECTIONS.map(key => [key, contextualGrounded(values[key], refsFor(context), contextKeywords, key === "letter" ? 2400 : 1800, context.situation?.rawText)])) as NonNullable<typeof report>;
    // Emotional wishes and present atmosphere remain separately identifiable.
    for (const q of context.facts.questions.filter(q => ["q3", "q7", "q8", "q9"].includes(q.questionId) && q.evidence.length))
      if (!q.evidence.some(e => report!.present.evidenceRefs.includes(e.ref))) invalid("present-context-missing");
    if (!report.letter.evidenceRefs.includes("approved:q10")) invalid("letter-q10-missing");
  }
  return { ...structuredClone(context), version: deep ? "aurora-interpretation-v2" : "aurora-interpretation-v1", generated: { origin: "ai-interpretation", auroraName: text(body.auroraName, 60),
    philosophy: { line: quote, reason, q10Anchor: anchor }, overall, ribbons, ...(deep ? { report } : {}) } };
}

/** Validate the HTTP boundary against locally recomputed facts and digest, then
 * reuse the SAME generated-text validation as the server. No facts are inferred
 * from colors or accepted just because an object has the expected TypeScript type. */
export function validateAuroraInterpretationResponse(value: unknown, expected: AuroraInterpretationContext): AuroraInterpretationResult {
  if (!isRecord(value) || !exactKeys(value, ["interpretation"]) || !isRecord(value.interpretation)) invalid("invalid-response");
  const i = value.interpretation;
  const deep = !!expected.situation;
  if (!exactKeys(i, ["version", "binding", "approvedClosing", "facts", "generated", ...(deep ? ["situation"] : [])]) || i.version !== (deep ? "aurora-interpretation-v2" : "aurora-interpretation-v1")
    || JSON.stringify(value).length > 2000000) invalid("invalid-response");
  for (const key of ["binding", "approvedClosing", "facts", ...(deep ? ["situation" as const] : [])] as const)
    if (canonicalInterpretationValue(i[key]) !== canonicalInterpretationValue(expected[key])) invalid("binding-mismatch");
  const g = i.generated;
  if (!isRecord(g) || !exactKeys(g, ["origin", "auroraName", "philosophy", "overall", "ribbons", ...(deep ? ["report"] : [])]) || g.origin !== "ai-interpretation"
    || !isRecord(g.philosophy) || !exactKeys(g.philosophy, ["line", "reason", "q10Anchor"]) || !isVerifiedPhilosophyQuote(g.philosophy.line)
    || !Array.isArray(g.ribbons) || g.ribbons.length !== expected.facts.ribbons.length) invalid("invalid-generated-response");
  const stripOrigin = (v: unknown) => {
    if (!isRecord(v) || !exactKeys(v, ["origin", "text", "basis", "evidenceRefs", ...(deep ? ["contextRefs"] : [])])) invalid("invalid-generated-response");
    return { text: v.text, basis: v.basis, evidenceRefs: v.evidenceRefs, ...(deep ? { contextRefs: v.contextRefs } : {}) };
  };
  const seen = new Set<string>();
  const wireRibbons = g.ribbons;
  const entries = wireRibbons.map(v => {
    if (!isRecord(v) || !exactKeys(v, ["ribbonId", "psychological", "philosophical", "reflectionQuestion", ...(deep ? ["currentMind", "reportSummary"] : [])]) || typeof v.ribbonId !== "string"
      || seen.has(v.ribbonId) || !expected.facts.ribbons.some(r => r.ribbonId === v.ribbonId)) invalid("ribbon-id-mismatch");
    seen.add(v.ribbonId);
    return [v.ribbonId, { ribbonId: v.ribbonId, psychological: stripOrigin(v.psychological), philosophical: stripOrigin(v.philosophical), reflectionQuestion: v.reflectionQuestion, ...(deep ? { currentMind: stripOrigin(v.currentMind), reportSummary: stripOrigin(v.reportSummary) } : {}) }];
  });
  if (deep && (!isRecord(g.report) || !exactKeys(g.report, AURORA_REPORT_SECTIONS))) invalid("report-sections-mismatch");
  const report = deep ? Object.fromEntries(AURORA_REPORT_SECTIONS.map(key => [key, stripOrigin((g.report as Record<string, unknown>)[key])])) : undefined;
  const result = parseAuroraInterpretation(JSON.stringify({ ...(deep ? { report } : {}), auroraName: g.auroraName, quoteId: g.philosophy.line.quoteId,
    q10Anchor: g.philosophy.q10Anchor, quoteReason: g.philosophy.reason, overall: stripOrigin(g.overall), ribbons: Object.fromEntries(entries) }), expected);
  const normalized = { ...g, ribbons: expected.facts.ribbons.map(r => wireRibbons.find(v => isRecord(v) && v.ribbonId === r.ribbonId)) };
  if (canonicalInterpretationValue(result.generated) !== canonicalInterpretationValue(normalized)) invalid("generated-origin-mismatch");
  return result;
}
