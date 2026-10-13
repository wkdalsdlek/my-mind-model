import { classifyKeyword, SEMANTIC_PROFILES, type SelectedCapsule } from "./capsules";
import { QUESTION_DATA, type QuestionId } from "./question-data";
import { KEYWORD_SEMANTICS } from "./keyword-semantics";
import { SEMANTIC_FAMILIES, type KeywordSemanticWeight } from "./semantic-families";
import { COMMON_CANDIDATES, CORE_EXPANSIONS, contextualExpansion } from "./q10-candidates";
import { Q10_RECOMMENDATION_TARGET, type PersonalizedKeyword, type Q10RecommendationResult, type RecommendationEvidence, type RecommendationProvenance } from "./personalization-contract";

export interface Q10RecommendationInput {
  selections: readonly (readonly SelectedCapsule[])[];
  responses: readonly { questionId: string; status: "pending" | "answered" | "skipped" }[];
}
type Candidate = PersonalizedKeyword;
interface Source {
  questionId: QuestionId;
  keywordId: string;
  label: string;
  evidence: RecommendationEvidence[];
  weights: readonly KeywordSemanticWeight[];
  order: number;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const normalizeRecommendationLabel = (label: string) => label.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/** Exact structured snapshot, not a lossy string-answer adapter or a collision-prone hash. */
export function recommendationFingerprint(input: Q10RecommendationInput): string {
  if (!input || !Array.isArray(input.selections) || !Array.isArray(input.responses)
    || input.selections.slice(0, 9).some(items => !Array.isArray(items))) throw new Error("Invalid structured answers");
  return `q10-local-v1:${JSON.stringify(QUESTION_DATA.slice(0, 9).map((question, i) => ({
    questionId: question.id, status: input.responses[i]?.status ?? "pending",
    selections: [...(input.selections[i] ?? [])].map(selection => ({
      id: selection.id, selectionId: selection.selectionId, label: selection.label,
      originalText: selection.originalText ?? selection.label, source: selection.source ?? "legacy",
      semanticWeights: selection.semanticWeights ?? [],
    })).sort((a, b) => compare(a.selectionId, b.selectionId)),
  })))}`;
}

function validWeights(weights: readonly KeywordSemanticWeight[]): boolean {
  const ids = new Set(SEMANTIC_FAMILIES.map(f => f.id));
  return Array.isArray(weights) && weights.length > 0 && weights.length <= 2
    && weights.every(w => w && typeof w === "object" && ids.has(w.familyId) && Number.isFinite(w.weight) && w.weight >= 0)
    && weights[0].role === "primary"
    && (weights.length === 1 || weights[1].role === "secondary")
    && new Set(weights.map(w => w.familyId)).size === weights.length
    && weights.every(w => ids.has(w.familyId) && Number.isFinite(w.weight) && w.weight >= 0)
    && Math.abs(weights.reduce((sum, w) => sum + w.weight, 0) - 1) < 1e-9;
}

function collectSources(input: Q10RecommendationInput): Source[] {
  const sources = new Map<string, Source>();
  const selectionIds = new Set<string>();
  for (let i = 0; i < 9; i++) {
    const question = QUESTION_DATA[i];
    for (const selection of [...(input.selections[i] ?? [])].sort((a, b) => compare(a.selectionId, b.selectionId))) {
      if (!selection.id || !selection.selectionId || typeof selection.label !== "string" || !selection.label.trim()
        || typeof selection.id !== "string" || typeof selection.selectionId !== "string"
        || (selection.originalText !== undefined && typeof selection.originalText !== "string")
        || selectionIds.has(selection.selectionId) || (selection.questionId && selection.questionId !== question.id)) throw new Error("Invalid selection evidence");
      selectionIds.add(selection.selectionId);
      const fixed = question.keywords.find(keyword => keyword.id === selection.id && keyword.label === selection.label);
      // Custom text only inherits a mapping on an exact match within the same question.
      const exact = fixed ?? question.keywords.find(keyword => keyword.label === selection.label.trim());
      const weights = exact ? KEYWORD_SEMANTICS[exact.id] : selection.semanticWeights ?? [];
      if (weights.length && !validWeights(weights)) throw new Error("Invalid semantic weights");
      const key = `${question.id}:${normalizeRecommendationLabel(selection.label)}`;
      const evidence: RecommendationEvidence = {
        questionId: question.id, keywordId: selection.id, selectionId: selection.selectionId,
        label: selection.label, originalText: selection.originalText ?? selection.label, answerIntent: question.answerIntent,
      };
      const existing = sources.get(key);
      if (existing) existing.evidence.push(evidence);
      else sources.set(key, { questionId: question.id, keywordId: exact?.id ?? selection.id, label: selection.label.trim(), weights,
        evidence: [evidence], order: i * 100 + (exact ? question.keywords.indexOf(exact) : 99) });
    }
  }
  return [...sources.values()].sort((a, b) => a.order - b.order || compare(normalizeRecommendationLabel(a.label), normalizeRecommendationLabel(b.label)))
    .map(source => ({ ...source, evidence: source.evidence.sort((a, b) => compare(a.selectionId, b.selectionId)) }));
}

function candidate(id: string, label: string, weights: readonly KeywordSemanticWeight[], kind: RecommendationProvenance["kind"],
  topicKey: string, evidence: readonly RecommendationEvidence[], reason: string, fingerprint: string, generator: "local" | "fallback" = "local"): Candidate {
  return {
    id: `q10-${id}`, label, originalText: label, questionId: "q10", source: "personalized", answerIntent: "closingMessage",
    group: classifyKeyword(label), semanticWeights: weights.map(weight => ({ ...weight })),
    recommendation: {
      kind, generator, semanticStatus: weights.length ? "mapped" : "unclassified", topicKey, reason, basisFingerprint: fingerprint,
      evidence: evidence.map(item => ({ ...item })),
      evidenceQuestionIds: [...new Set(evidence.map(item => item.questionId))], evidenceSelectionIds: evidence.map(item => item.selectionId),
    },
  };
}

function directCandidate(source: Source, fingerprint: string): Candidate {
  const intent = source.evidence[0].answerIntent;
  const prefix = intent === "currentAtmosphere" ? "지금의 풍경: " : intent === "emotionalWish" ? "바라는 마음: "
    : intent === "releaseTarget" ? "내려놓고 싶은 " : intent === "futureAspiration" ? "미래의 바람: " : "";
  return candidate(`direct-${source.questionId}-${encodeURIComponent(source.keywordId)}`, `${prefix}${source.label}`, source.weights,
    "direct", `direct:${intent}:${normalizeRecommendationLabel(source.label)}`, source.evidence,
    `${source.questionId.toUpperCase()}에서 실제 선택한 표현을 질문의 맥락과 함께 다시 제안해요.`, fingerprint);
}

function commonCandidates(fingerprint: string, generator: "local" | "fallback"): Candidate[] {
  return COMMON_CANDIDATES.map(item => candidate(`common-${item.id}`, item.label, [{ familyId: item.familyId, role: "primary", weight: 1 }],
    "common", item.topicKey, [], "앞선 답변을 단정하지 않는 공통 표현이에요. 마음에 닿는 경우에만 선택해 주세요.", fingerprint, generator));
}

/** Balance primary meanings and evidence questions; iterate lazily with bounded question queues. */
function* diversify(candidates: Candidate[]): Generator<Candidate> {
  const queues = new Map<string, Map<string, { items: Candidate[]; cursor: number }>>();
  for (const item of candidates) {
    const family = item.semanticWeights?.[0]?.familyId ?? "unclassified";
    const question = item.recommendation.evidenceQuestionIds[0] ?? "common";
    const familyQueues = queues.get(family) ?? new Map<string, { items: Candidate[]; cursor: number }>();
    const queue = familyQueues.get(question) ?? { items: [], cursor: 0 };
    queue.items.push(item); familyQueues.set(question, queue); queues.set(family, familyQueues);
  }
  const questionUse = new Map<string, number>();
  let remaining = candidates.length;
  while (remaining) for (const familyQueues of queues.values()) {
    let chosen: { question: string; queue: { items: Candidate[]; cursor: number } } | null = null;
    for (const [question, queue] of familyQueues) {
      if (queue.cursor >= queue.items.length) continue;
      if (!chosen || (questionUse.get(question) ?? 0) < (questionUse.get(chosen.question) ?? 0)) chosen = { question, queue };
    }
    if (!chosen) continue;
    const item = chosen.queue.items[chosen.queue.cursor++];
    questionUse.set(chosen.question, (questionUse.get(chosen.question) ?? 0) + 1);
    remaining--;
    yield item;
  }
}

function localRecommendations(input: Q10RecommendationInput, fingerprint: string): readonly PersonalizedKeyword[] {
  const sources = collectSources(input);
  const questions = new Set(sources.map(source => source.questionId)).size;
  const rich = sources.length >= 6 && questions >= 3;
  const medium = sources.length >= 3 && questions >= 2;
  const directTarget = rich ? 6 : medium ? 4 : Math.min(2, sources.length);
  const expansionTarget = rich ? 5 : medium ? 3 : sources.length ? 1 : 0;
  const expanded: Candidate[] = [];
  for (const source of sources) {
    const primary = source.weights[0]?.familyId;
    if (!primary) continue; // Unknown free text is quoted directly, never semantically guessed.
    const context = contextualExpansion(source.evidence[0].answerIntent, primary);
    const expansions = context ? [context] : CORE_EXPANSIONS[primary];
    expansions.forEach((item, index) => expanded.push(candidate(`expanded-${source.evidence[0].answerIntent}-${primary}-${index}`,
      item.label, source.weights, "expanded", item.topicKey, source.evidence,
      `${source.questionId.toUpperCase()}의 「${source.label}」에서 이어볼 수 있는 표현이에요. 아직 당신의 답변은 아니에요.`, fingerprint)));
  }
  const selected: Candidate[] = [], labels = new Set<string>(), topics = new Set<string>(), ids = new Set<string>(), familyCounts = new Map<string, number>();
  const append = (items: Candidate[], limit: number) => {
    let added = 0;
    for (const item of diversify(items)) {
      if (added >= limit || selected.length >= Q10_RECOMMENDATION_TARGET.total) break;
      const label = normalizeRecommendationLabel(item.label), family = item.semanticWeights?.[0]?.familyId ?? "unclassified";
      if (labels.has(label) || topics.has(item.recommendation.topicKey) || ids.has(item.id) || (familyCounts.get(family) ?? 0) >= 3) continue;
      selected.push(item); labels.add(label); topics.add(item.recommendation.topicKey); ids.add(item.id);
      familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1); added++;
    }
  };
  append(sources.map(source => directCandidate(source, fingerprint)), directTarget);
  append(expanded, expansionTarget);
  append(commonCandidates(fingerprint, "local"), 14);
  if (selected.length !== 14) throw new Error("Insufficient distinct recommendations");
  return selected;
}

/** Guard output and evidence before allowing a result into the UI. */
export function validateQ10Recommendations(input: Q10RecommendationInput, result: readonly PersonalizedKeyword[], fingerprint = recommendationFingerprint(input)): boolean {
  if (!Array.isArray(result) || result.length !== 14) return false;
  const evidence = new Map<string, RecommendationEvidence>();
  QUESTION_DATA.slice(0, 9).forEach((q, i) => (input.selections[i] ?? []).forEach(s => evidence.set(s.selectionId,
    { questionId: q.id, keywordId: s.id, selectionId: s.selectionId, label: s.label, originalText: s.originalText ?? s.label, answerIntent: q.answerIntent })));
  const ids = new Set<string>(), labels = new Set<string>(), topics = new Set<string>();
  const familyCounts = new Map<string, number>();
  return result.every((item: PersonalizedKeyword) => {
    if (!item || typeof item !== "object") return false;
    const provenance = item.recommendation;
    if (!item.id || typeof item.label !== "string" || !item.label.trim() || ids.has(item.id) || labels.has(normalizeRecommendationLabel(item.label))
      || item.source !== "personalized" || item.questionId !== "q10" || item.answerIntent !== "closingMessage" || !provenance
      || !(item.group in SEMANTIC_PROFILES)
      || !["direct", "expanded", "common"].includes(provenance.kind) || !["local", "fallback"].includes(provenance.generator)
      || provenance.basisFingerprint !== fingerprint || typeof provenance.reason !== "string" || !provenance.reason
      || typeof provenance.topicKey !== "string" || !provenance.topicKey || topics.has(provenance.topicKey)
      || !Array.isArray(provenance.evidence) || !Array.isArray(provenance.evidenceQuestionIds) || !Array.isArray(provenance.evidenceSelectionIds)) return false;
    ids.add(item.id); labels.add(normalizeRecommendationLabel(item.label)); topics.add(provenance.topicKey);
    const weights = item.semanticWeights ?? [];
    if (!Array.isArray(weights)) return false;
    if (!(provenance.semanticStatus === "mapped" ? validWeights(weights) : provenance.semanticStatus === "unclassified" && !weights.length && provenance.kind === "direct")) return false;
    const family = weights[0]?.familyId ?? "unclassified";
    const familyCount = (familyCounts.get(family) ?? 0) + 1;
    if (familyCount > 3) return false;
    familyCounts.set(family, familyCount);
    if (provenance.kind === "common" ? provenance.evidence.length !== 0 : provenance.evidence.length === 0) return false;
    if (JSON.stringify(provenance.evidenceSelectionIds) !== JSON.stringify(provenance.evidence.map(e => e.selectionId))
      || JSON.stringify(provenance.evidenceQuestionIds) !== JSON.stringify([...new Set(provenance.evidence.map(e => e.questionId))])) return false;
    return provenance.evidence.every((e: RecommendationEvidence) => e && typeof e === "object" && JSON.stringify(evidence.get(e.selectionId)) === JSON.stringify(e));
  });
}

/** No AI request or API key. A failed/invalid local generator has a deterministic 14-choice fallback. */
export function generateQ10Recommendations(input: Q10RecommendationInput,
  generator: (input: Q10RecommendationInput, fingerprint: string) => readonly PersonalizedKeyword[] = localRecommendations): Q10RecommendationResult {
  let fingerprint: string;
  try { fingerprint = recommendationFingerprint(input); }
  catch {
    fingerprint = "q10-invalid-input-v1";
    return { recommendations: commonCandidates(fingerprint, "fallback"), basisFingerprint: fingerprint, generator: "fallback" };
  }
  try {
    const recommendations = generator(input, fingerprint);
    if (!validateQ10Recommendations(input, recommendations, fingerprint)) throw new Error("Invalid recommendation result");
    return { recommendations, basisFingerprint: fingerprint, generator: "local" };
  } catch {
    return { recommendations: commonCandidates(fingerprint, "fallback"), basisFingerprint: fingerprint, generator: "fallback" };
  }
}
