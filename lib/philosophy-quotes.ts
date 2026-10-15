/** Curated excerpts, not model-authored quotations. Korean translations are
 * project translations; no modern Korean edition has been copied. */
export interface VerifiedPhilosophyQuote {
  quoteId: string;
  mode: "direct";
  philosopher: string;
  originalText: string;
  originalLanguage: "la";
  text: string;
  source: { work: string; locator: string; url: string; attributionNote: string };
  translation: { language: "ko"; origin: "project-translation"; note: string };
  review: { status: "source-checked"; checkedOn: string; scope: "short-excerpt-and-translation" };
  usage: { enabled: boolean; basis: "ancient-public-domain-project-translation"; sourcePolicy: string; note: string };
  themes: readonly string[];
}
/** Future fallback contract only. It must never be presented as a direct quote.
 * This phase does not automatically generate or publish inspired sentences. */
export interface InspiredPhilosophyLine {
  mode: "inspired";
  quoteId: null;
  text: string;
  philosopher: string;
  displayAttribution: string;
  isHistoricalQuotation: false;
  fallbackReason: "no-suitable-verified-quote";
  ideaSource: { work: string; locator: string; url: string };
  reviewStatus: "requires-review";
  usable: false;
}
const latinPolicy = "https://www.thelatinlibrary.com/about.html";
const common = {
  mode: "direct" as const, originalLanguage: "la" as const,
  translation: { language: "ko" as const, origin: "project-translation" as const,
    note: "라틴어의 짧은 발췌를 프로젝트에서 번역했습니다. 현대 출판 번역문이 아닙니다." },
  review: { status: "source-checked" as const, checkedOn: "2026-10-15", scope: "short-excerpt-and-translation" as const },
  usage: { enabled: true, basis: "ancient-public-domain-project-translation" as const, sourcePolicy: latinPolicy,
    note: "고대 원저작의 짧은 구절과 자체 번역만 사용합니다. 사이트 편집물·주석·현대 번역의 이용 허락을 의미하지 않습니다." },
};
const catalog: readonly VerifiedPhilosophyQuote[] = [
  { ...common, quoteId: "seneca-letters-1-1-self", philosopher: "세네카", originalText: "vindica te tibi",
    text: "너 자신을 너에게 되돌려라.",
    source: { work: "루킬리우스에게 보내는 도덕 서한", locator: "1.1", url: "https://www.thelatinlibrary.com/sen/seneca.ep1.shtml",
      attributionNote: "시간을 되찾아 보존하라는 문맥의 짧은 발췌입니다. 고립이나 타인 배제를 권하는 뜻이 아닙니다." }, themes: ["자기 돌봄", "자기 시간", "주체성"] },
  { ...common, quoteId: "seneca-letters-1-3-present", philosopher: "세네카", originalText: "Dum differtur vita transcurrit.",
    text: "미루는 동안 삶은 흘러간다.",
    source: { work: "루킬리우스에게 보내는 도덕 서한", locator: "1.3", url: "https://www.thelatinlibrary.com/sen/seneca.ep1.shtml",
      attributionNote: "현재의 시간을 붙잡으라는 문맥입니다. 쉼을 부정하거나 성취를 강요하는 문장으로 사용하지 않습니다." }, themes: ["현재", "시간", "작은 실천"] },
  { ...common, quoteId: "cicero-duties-1-22-together", philosopher: "키케로",
    originalText: "non nobis solum nati sumus", text: "우리는 우리 자신만을 위해 태어나지 않았다.",
    source: { work: "의무론", locator: "1.22", url: "https://www.thelatinlibrary.com/cicero/off1.shtml",
      attributionNote: "키케로가 플라톤을 인용하며 전하는 문구입니다. 플라톤의 직접 원문을 검증한 것으로 표시하지 않습니다." }, themes: ["함께 삶", "상호 도움", "관계"] },
];
/** Copies prevent a caller from changing the server's source-of-truth catalog. */
export const philosophyQuoteCandidates = (): VerifiedPhilosophyQuote[] => structuredClone(catalog.filter(q => q.usage.enabled));
export function resolvePhilosophyQuote(quoteId: string): VerifiedPhilosophyQuote | null {
  const value = catalog.find(q => q.quoteId === quoteId && q.usage.enabled);
  return value ? structuredClone(value) : null;
}
/** Opt-in draft contract for a later reviewed fallback, never a service success. */
export function prepareInspiredPhilosophyDraft(ideaQuoteId: string, text: string, reason: "no-suitable-verified-quote"): InspiredPhilosophyLine | null {
  const source = resolvePhilosophyQuote(ideaQuoteId);
  if (!source || reason !== "no-suitable-verified-quote" || typeof text !== "string" || !text.trim() || text.length > 160) return null;
  return { mode: "inspired", quoteId: null, philosopher: source.philosopher, text: text.trim(),
    displayAttribution: `${source.philosopher}의 사상에서 영감을 받은 문장`, isHistoricalQuotation: false,
    fallbackReason: reason, ideaSource: { work: source.source.work, locator: source.source.locator, url: source.source.url },
    reviewStatus: "requires-review", usable: false };
}
/** A plausible author/HTTPS URL alone is not verification: exact curated data is required. */
export function isVerifiedPhilosophyQuote(value: unknown): value is VerifiedPhilosophyQuote {
  if (!value || typeof value !== "object" || !("quoteId" in value) || typeof value.quoteId !== "string") return false;
  const expected = resolvePhilosophyQuote(value.quoteId);
  const canonical = (v: unknown): string => v && typeof v === "object" ? Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]` : `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`).join(",")}}` : JSON.stringify(v);
  return !!expected && canonical(expected) === canonical(value);
}
