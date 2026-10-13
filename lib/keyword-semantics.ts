import type { KeywordSemanticWeight, SemanticFamilyId } from "./semantic-families";
import type { QuestionId } from "./question-data";

const weights = (primary: SemanticFamilyId, secondary?: SemanticFamilyId, primaryWeight = .7): readonly KeywordSemanticWeight[] =>
  secondary
    ? [{ familyId: primary, role: "primary", weight: primaryWeight }, { familyId: secondary, role: "secondary", weight: Number((1 - primaryWeight).toFixed(2)) }]
    : [{ familyId: primary, role: "primary", weight: 1 }];

// Initial adjustable mappings, keyed by question-specific identity, never by label alone.
export const KEYWORD_SEMANTICS: Readonly<Record<string, readonly KeywordSemanticWeight[]>> = {
  "q1-01": weights("serenity", "reflection"), "q1-02": weights("connection", "reflection"),
  "q1-03": weights("expression", "exploration", .8), "q1-04": weights("drive", "exploration", .6),
  "q1-05": weights("serenity", "exploration"), "q1-06": weights("expression", "drive"),
  "q1-07": weights("connection"), "q1-08": weights("exploration"),
  "q1-09": weights("connection", "drive"), "q1-10": weights("reflection", "serenity"),
  "q1-11": weights("drive", "serenity"), "q1-12": weights("drive"),
  "q1-13": weights("connection", "serenity"), "q1-14": weights("expression", "reflection"),
  "q2-01": weights("serenity"), "q2-02": weights("serenity", "expression"),
  "q2-03": weights("connection", "serenity"), "q2-04": weights("connection", "reflection"),
  "q2-05": weights("serenity"), "q2-06": weights("serenity", "exploration"),
  "q2-07": weights("drive", "grounding"), "q2-08": weights("serenity"),
  "q2-09": weights("serenity", "grounding"), "q2-10": weights("serenity", "reflection"),
  "q2-11": weights("connection", "expression"), "q2-12": weights("expression", "serenity"),
  "q2-13": weights("grounding", "serenity"), "q2-14": weights("exploration", "drive"),
  "q3-01": weights("serenity", "grounding"), "q3-02": weights("reflection", "serenity"),
  "q3-03": weights("serenity", "connection"), "q3-04": weights("reflection"),
  "q3-05": weights("expression", "reflection"), "q3-06": weights("reflection", "exploration"),
  "q3-07": weights("expression", "drive"), "q3-08": weights("serenity", "exploration"),
  "q3-09": weights("serenity", "reflection"), "q3-10": weights("reflection", "serenity"),
  "q3-11": weights("exploration", "serenity"), "q3-12": weights("grounding", "reflection"),
  "q3-13": weights("serenity", "exploration"), "q3-14": weights("exploration", "reflection"),
  "q4-01": weights("connection", "grounding", .65), "q4-02": weights("connection", "reflection"),
  "q4-03": weights("connection"), "q4-04": weights("connection", "grounding"),
  "q4-05": weights("expression", "connection"), "q4-06": weights("connection"),
  "q4-07": weights("serenity", "connection"), "q4-08": weights("connection", "expression"),
  "q4-09": weights("connection", "reflection"), "q4-10": weights("connection"),
  "q4-11": weights("exploration", "connection"), "q4-12": weights("grounding", "connection"),
  "q4-13": weights("grounding", "connection"), "q4-14": weights("connection", "drive"),
  "q5-01": weights("grounding"), "q5-02": weights("exploration"),
  "q5-03": weights("exploration", "reflection"), "q5-04": weights("exploration", "drive"),
  "q5-05": weights("drive", "reflection"), "q5-06": weights("exploration", "connection"),
  "q5-07": weights("grounding", "reflection"), "q5-08": weights("exploration", "drive"),
  "q5-09": weights("grounding", "drive"), "q5-10": weights("drive", "exploration"),
  "q5-11": weights("grounding"), "q5-12": weights("reflection"),
  "q5-13": weights("connection", "grounding"), "q5-14": weights("reflection", "grounding"),
  "q6-01": weights("reflection", "expression"), "q6-02": weights("connection"),
  "q6-03": weights("exploration"), "q6-04": weights("reflection", "grounding"),
  "q6-05": weights("connection", "serenity"), "q6-06": weights("grounding", "reflection"),
  "q6-07": weights("grounding", "drive"), "q6-08": weights("drive", "reflection"),
  "q6-09": weights("connection", "grounding"), "q6-10": weights("drive", "exploration"),
  "q6-11": weights("grounding", "reflection"), "q6-12": weights("serenity"),
  "q6-13": weights("grounding", "reflection"), "q6-14": weights("grounding", "serenity", .65),
  "q7-01": weights("connection", "reflection"), "q7-02": weights("connection", "serenity"),
  "q7-03": weights("connection", "grounding"), "q7-04": weights("connection"),
  "q7-05": weights("grounding", "connection"), "q7-06": weights("connection", "grounding"),
  "q7-07": weights("serenity", "grounding"), "q7-08": weights("connection", "serenity"),
  "q7-09": weights("connection", "expression"), "q7-10": weights("serenity", "connection"),
  "q7-11": weights("connection", "drive"), "q7-12": weights("connection", "serenity"),
  "q7-13": weights("drive", "connection"), "q7-14": weights("serenity", "grounding"),
  "q8-01": weights("reflection", "grounding"), "q8-02": weights("grounding", "drive"),
  "q8-03": weights("reflection", "grounding"), "q8-04": weights("reflection"),
  "q8-05": weights("grounding", "reflection"), "q8-06": weights("grounding", "connection"),
  "q8-07": weights("connection", "grounding"), "q8-08": weights("drive", "exploration"),
  "q8-09": weights("drive", "grounding"), "q8-10": weights("reflection", "connection"),
  "q8-11": weights("reflection", "serenity"), "q8-12": weights("grounding"),
  "q8-13": weights("grounding", "reflection"), "q8-14": weights("connection", "grounding"),
  "q9-01": weights("exploration"), "q9-02": weights("drive", "reflection"),
  "q9-03": weights("expression", "drive"), "q9-04": weights("exploration", "serenity"),
  "q9-05": weights("connection"), "q9-06": weights("exploration"),
  "q9-07": weights("exploration", "drive"), "q9-08": weights("reflection", "exploration"),
  "q9-09": weights("connection", "drive"), "q9-10": weights("exploration", "drive"),
  "q9-11": weights("exploration", "reflection"), "q9-12": weights("exploration", "expression"),
  "q9-13": weights("connection", "exploration"), "q9-14": weights("exploration", "connection"),
};

// Only these contexts contribute to future core meaning aggregation; others have separate roles.
export const CORE_QUESTION_CONTRIBUTIONS: Readonly<Partial<Record<QuestionId, number>>> = {
  q1: .18, q2: .13, q4: .20, q5: .20, q6: .29,
};
