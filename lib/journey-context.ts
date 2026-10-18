/** Separate from questionnaire fingerprints, semantic weights and Q10 generation. */
export const INTRO_SENTENCE = "마음은 언제나 하나의 색으로 설명되지 않습니다.";
export const SITUATION_MAX_CHARACTERS = 200;
export const SITUATION_REF = "situation:intro" as const;
export const SITUATION_EXAMPLES = ["아이를 키우는 초보 아빠", "연애가 어려운 대학생 남자", "아들을 이해하기 어려운 엄마", "사랑하는 사람과 행복한 연애 중인 여자", "취업을 준비하며 미래를 고민하는 대학생", "새로운 시작을 앞두고 있는 직장인", "요즘 내가 어떤 사람인지 잘 모르겠는 사람"] as const;
/** Preserve original whitespace/Unicode. Reject malformed Unicode and hidden controls,
 * rather than silently editing the user's story. Newlines are permitted. */
export function validJourneySituation(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && [...value].length <= SITUATION_MAX_CHARACTERS
    && new TextEncoder().encode(value).length <= SITUATION_MAX_CHARACTERS * 4
    && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)
    && !/[\ud800-\udfff]/u.test(value);
}
