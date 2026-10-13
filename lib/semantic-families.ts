/** Meaning belongs to the analysis domain, independently of capsule UI physics. */
export type SemanticFamilyId = "serenity" | "connection" | "exploration" | "expression" | "drive" | "grounding" | "reflection";

export interface SemanticFamily {
  id: SemanticFamilyId;
  label: string;
  color: string;
  description: string;
}

export interface KeywordSemanticWeight {
  familyId: SemanticFamilyId;
  role: "primary" | "secondary";
  weight: number;
}

export const EXPECTED_SEMANTIC_FAMILY_COUNT = 7;

// Visualization meanings, not diagnostic personality types or capsule physics profiles.
export const SEMANTIC_FAMILIES: readonly SemanticFamily[] = [
  { id: "serenity", label: "평온", color: "#69D9E8", description: "휴식, 고요함, 내면의 편안함" },
  { id: "connection", label: "연결", color: "#EDA2CE", description: "사랑, 신뢰, 공감, 관계" },
  { id: "exploration", label: "탐색", color: "#65E4BD", description: "자유, 호기심, 새로운 가능성" },
  { id: "expression", label: "표현", color: "#B59AF4", description: "창작, 몰입, 자기표현" },
  { id: "drive", label: "추진", color: "#FFC17D", description: "성장, 도전, 목표, 성취" },
  { id: "grounding", label: "균형", color: "#D3E1F0", description: "안정, 신중함, 질서, 삶의 균형" },
  { id: "reflection", label: "성찰", color: "#8586D9", description: "자기 이해, 신념, 사유, 내면의 깊이" },
];

export function validateSemanticFamilies(families: readonly SemanticFamily[]): string[] {
  const errors: string[] = [];
  if (families.length !== EXPECTED_SEMANTIC_FAMILY_COUNT) errors.push("의미 계열은 정확히 7개여야 합니다.");
  const ids = new Set<string>();
  for (const family of families) {
    if (!family.id.trim() || !family.label.trim() || !family.description.trim()) errors.push("의미 계열의 ID, 이름, 정의가 필요합니다.");
    if (ids.has(family.id)) errors.push(`중복 의미 계열 ID: ${family.id}`);
    ids.add(family.id);
  }
  return errors;
}
