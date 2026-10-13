import type { Q10RecommendationState } from "@/lib/personalization-contract";
import { SEMANTIC_FAMILIES } from "@/lib/semantic-families";
import styles from "./CapsuleQuestionnaire.module.css";

export default function Q10RecommendationDetails({ personalization }: { personalization: Q10RecommendationState }) {
  const kinds = { direct: "직접 연관", expanded: "의미 확장", common: "공통 표현" };
  const counts = personalization.recommendations.reduce((sum, keyword) => {
    sum[keyword.recommendation.kind]++;
    return sum;
  }, { direct: 0, expanded: 0, common: 0 });
  return <div className={styles.recommendationInfo}>
    {personalization.notice && <p className={styles.recommendationNotice} role="status">{personalization.notice}</p>}
    <p>{personalization.generator === "fallback" ? "개인화 추천을 준비하지 못해 공통 표현 14개를 띄웠어요." : counts.direct + counts.expanded ? "앞서 고른 마음과 이어볼 수 있는 말들을 띄웠어요." : "지금 마음에 닿는 말을 찾을 수 있도록 공통 표현 14개를 띄웠어요."}</p>
    <p>직접 연관 {counts.direct} · 의미 확장 {counts.expanded} · 공통 {counts.common}<br />고르지 않은 추천은 답변에 담기지 않아요.</p>
    <details>
      <summary>추천이 어디에서 왔는지 보기</summary>
      <ul>{personalization.recommendations.map(keyword => <li key={keyword.id}>
        <strong>{keyword.label}</strong><span>{kinds[keyword.recommendation.kind]}</span>
        <p>{keyword.recommendation.reason}</p>
        {keyword.recommendation.evidence.length > 0 && <p>{[...new Set(keyword.recommendation.evidence.map(e => `${e.questionId.toUpperCase()} · ${e.label}`))].join(" / ")}</p>}
        <p>{keyword.semanticWeights?.length ? keyword.semanticWeights.map(w => `${SEMANTIC_FAMILIES.find(f => f.id === w.familyId)?.label} ${Math.round(w.weight * 100)}%`).join(" · ") : "직접 적은 표현의 의미는 아직 분류하지 않았어요."}</p>
      </li>)}</ul>
    </details>
  </div>;
}
