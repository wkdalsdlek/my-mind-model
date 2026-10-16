import { AuroraInterpretationError, exactKeys, isRecord } from "./aurora-interpretation";
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
function grounded(value: unknown, allowed: readonly string[], keywords: readonly string[], max: number): GroundedAuroraText {
  if (!isRecord(value) || !exactKeys(value, ["text", "basis", "evidenceRefs"]) || !Array.isArray(value.evidenceRefs)
    || value.evidenceRefs.some(r => typeof r !== "string" || !allowed.includes(r)) || new Set(value.evidenceRefs).size !== value.evidenceRefs.length
    || value.evidenceRefs.length > 301 || value.basis !== (allowed.length ? "answer-grounded" : "insufficient-evidence")
    || allowed.length && !value.evidenceRefs.length) invalid("evidence-mismatch");
  const result = text(value.text, max);
  validateQuotedKeywords(result, keywords);
  return { origin: "ai-interpretation", text: result, evidenceRefs: [...value.evidenceRefs] as string[], basis: value.basis as GroundedAuroraText["basis"] };
}
function validateQuotedKeywords(value: string, keywords: readonly string[]): void {
  for (const quoted of value.matchAll(/[「“"]([^」”"]+)[」”"]/g)) if (!keywords.includes(quoted[1])) invalid("unknown-keyword");
}
export function parseAuroraInterpretation(raw: unknown, context: AuroraInterpretationContext): AuroraInterpretationResult {
  if (typeof raw !== "string" || raw.length > AURORA_INTERPRETATION_OUTPUT_LIMIT) invalid("invalid-json");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { invalid("invalid-json"); }
  rejectDuplicateKeys(raw);
  if (!isRecord(body) || !exactKeys(body, ["auroraName", "quoteId", "q10Anchor", "quoteReason", "overall", "ribbons"])) invalid("invalid-shape");
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
  const overall = grounded(body.overall, refsFor(context), allKeywords, 1800);
  if (!overall.evidenceRefs.includes("approved:q10")) invalid("q10-missing");
  // Acknowledge each supplied question in the whole interpretation. Non-core
  // context must not migrate into ribbon core evidence.
  for (const q of context.facts.questions.filter(q => q.questionId !== "q10" && q.evidence.length))
    if (!q.evidence.some(e => overall.evidenceRefs.includes(e.ref))) invalid("context-missing");
  if (!isRecord(body.ribbons) || !exactKeys(body.ribbons, context.facts.ribbons.map(r => r.ribbonId))) invalid("ribbon-count-mismatch");
  const entries = body.ribbons;
  const ribbons = context.facts.ribbons.map(facts => {
    const entry = entries[facts.ribbonId];
    if (!isRecord(entry) || !exactKeys(entry, ["ribbonId", "psychological", "philosophical", "reflectionQuestion"]) || entry.ribbonId !== facts.ribbonId) invalid("ribbon-id-mismatch");
    const refs = facts.evidence.map(e => e.ref), keywords = facts.evidence.flatMap(e => [e.label, e.originalText]);
    let psychological = grounded(entry.psychological, refs, keywords, 600), philosophical = grounded(entry.philosophical, refs, keywords, 600);
    let reflectionQuestion = text(entry.reflectionQuestion, 180);
    validateQuotedKeywords(reflectionQuestion, keywords);
    if (!reflectionQuestion.endsWith("?")) invalid("invalid-reflection");
    if (!refs.length) {
      psychological = { origin: "deterministic-insufficient-evidence", text: "이 리본에는 연결된 핵심 답변 근거가 없어 심리적 의미를 확정할 수 없습니다.", evidenceRefs: [], basis: "insufficient-evidence" };
      philosophical = { ...psychological, text: "이 리본을 특정한 삶의 태도와 연결할 선택 근거가 아직 없습니다. 이 여백은 새로운 선택을 생각해 볼 자리로 남겨둡니다." };
      reflectionQuestion = "이 여백에 지금 어떤 가치를 담아 보고 싶나요?";
    }
    return { ribbonId: facts.ribbonId, psychological, philosophical, reflectionQuestion };
  });
  return { ...structuredClone(context), version: "aurora-interpretation-v1", generated: { origin: "ai-interpretation", auroraName: text(body.auroraName, 60),
    philosophy: { line: quote, reason, q10Anchor: anchor }, overall, ribbons } };
}

/** Validate the HTTP boundary against locally recomputed facts and digest, then
 * reuse the SAME generated-text validation as the server. No facts are inferred
 * from colors or accepted just because an object has the expected TypeScript type. */
export function validateAuroraInterpretationResponse(value: unknown, expected: AuroraInterpretationContext): AuroraInterpretationResult {
  if (!isRecord(value) || !exactKeys(value, ["interpretation"]) || !isRecord(value.interpretation)) invalid("invalid-response");
  const i = value.interpretation;
  if (!exactKeys(i, ["version", "binding", "approvedClosing", "facts", "generated"]) || i.version !== "aurora-interpretation-v1"
    || JSON.stringify(value).length > 2000000) invalid("invalid-response");
  for (const key of ["binding", "approvedClosing", "facts"] as const)
    if (canonicalInterpretationValue(i[key]) !== canonicalInterpretationValue(expected[key])) invalid("binding-mismatch");
  const g = i.generated;
  if (!isRecord(g) || !exactKeys(g, ["origin", "auroraName", "philosophy", "overall", "ribbons"]) || g.origin !== "ai-interpretation"
    || !isRecord(g.philosophy) || !exactKeys(g.philosophy, ["line", "reason", "q10Anchor"]) || !isVerifiedPhilosophyQuote(g.philosophy.line)
    || !Array.isArray(g.ribbons) || g.ribbons.length !== expected.facts.ribbons.length) invalid("invalid-generated-response");
  const stripOrigin = (v: unknown) => {
    if (!isRecord(v) || !exactKeys(v, ["origin", "text", "basis", "evidenceRefs"])) invalid("invalid-generated-response");
    return { text: v.text, basis: v.basis, evidenceRefs: v.evidenceRefs };
  };
  const seen = new Set<string>();
  const wireRibbons = g.ribbons;
  const entries = wireRibbons.map(v => {
    if (!isRecord(v) || !exactKeys(v, ["ribbonId", "psychological", "philosophical", "reflectionQuestion"]) || typeof v.ribbonId !== "string"
      || seen.has(v.ribbonId) || !expected.facts.ribbons.some(r => r.ribbonId === v.ribbonId)) invalid("ribbon-id-mismatch");
    seen.add(v.ribbonId);
    return [v.ribbonId, { ribbonId: v.ribbonId, psychological: stripOrigin(v.psychological), philosophical: stripOrigin(v.philosophical), reflectionQuestion: v.reflectionQuestion }];
  });
  const result = parseAuroraInterpretation(JSON.stringify({ auroraName: g.auroraName, quoteId: g.philosophy.line.quoteId,
    q10Anchor: g.philosophy.q10Anchor, quoteReason: g.philosophy.reason, overall: stripOrigin(g.overall), ribbons: Object.fromEntries(entries) }), expected);
  const normalized = { ...g, ribbons: expected.facts.ribbons.map(r => wireRibbons.find(v => isRecord(v) && v.ribbonId === r.ribbonId)) };
  if (canonicalInterpretationValue(result.generated) !== canonicalInterpretationValue(normalized)) invalid("generated-origin-mismatch");
  return result;
}
