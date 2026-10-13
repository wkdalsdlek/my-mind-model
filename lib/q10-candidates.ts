import type { AnswerIntent } from "./question-data";
import type { SemanticFamilyId } from "./semantic-families";

export interface CommonCandidate { id: string; label: string; familyId: SemanticFamilyId; topicKey: string }

// Open choices, never evidence of a user's values. Two distinct topics per family.
export const COMMON_CANDIDATES: readonly CommonCandidate[] = [
  { id: "pause", label: "잠시 숨 고르기", familyId: "serenity", topicKey: "serenity-pause" },
  { id: "voice", label: "내 마음의 말", familyId: "expression", topicKey: "expression-voice" },
  { id: "care", label: "따뜻한 마음", familyId: "connection", topicKey: "connection-care" },
  { id: "possibility", label: "열린 가능성", familyId: "exploration", topicKey: "exploration-possibility" },
  { id: "step", label: "작은 한 걸음", familyId: "drive", topicKey: "drive-step" },
  { id: "pace", label: "나만의 속도", familyId: "grounding", topicKey: "grounding-pace" },
  { id: "listening", label: "내 마음 듣기", familyId: "reflection", topicKey: "reflection-listening" },
  { id: "space", label: "마음의 여백", familyId: "serenity", topicKey: "serenity-space" },
  { id: "expression", label: "나만의 표현", familyId: "expression", topicKey: "expression-creation" },
  { id: "together", label: "함께하는 시간", familyId: "connection", topicKey: "connection-together" },
  { id: "path", label: "새로운 길", familyId: "exploration", topicKey: "exploration-path" },
  { id: "continuing", label: "이어가는 마음", familyId: "drive", topicKey: "drive-continuing" },
  { id: "balance", label: "편안한 균형", familyId: "grounding", topicKey: "grounding-balance" },
  { id: "meaning", label: "나에게 남는 의미", familyId: "reflection", topicKey: "reflection-meaning" },
];

export const CORE_EXPANSIONS: Readonly<Record<SemanticFamilyId, readonly { label: string; topicKey: string }[]>> = {
  serenity: [{ label: "마음의 여백", topicKey: "serenity-space" }, { label: "고요를 위한 시간", topicKey: "serenity-quiet" }],
  connection: [{ label: "마음을 나누는 연결", topicKey: "connection-sharing" }, { label: "따뜻한 관계", topicKey: "connection-care" }],
  exploration: [{ label: "열린 가능성", topicKey: "exploration-possibility" }, { label: "자유로운 걸음", topicKey: "exploration-path" }],
  expression: [{ label: "나만의 표현", topicKey: "expression-creation" }, { label: "몰입의 순간", topicKey: "expression-absorption" }],
  drive: [{ label: "꾸준한 한 걸음", topicKey: "drive-step" }, { label: "도전의 방향", topicKey: "drive-challenge" }],
  grounding: [{ label: "나를 지탱하는 균형", topicKey: "grounding-balance" }, { label: "내 선택의 기준", topicKey: "grounding-standard" }],
  reflection: [{ label: "나를 알아가는 시간", topicKey: "reflection-listening" }, { label: "내면을 들여다보기", topicKey: "reflection-understanding" }],
};

// These contexts must not use core-value expansions, even when their weights match.
export function contextualExpansion(intent: AnswerIntent, family: SemanticFamilyId): { label: string; topicKey: string } | null {
  if (intent === "currentAtmosphere") return { label: "지금의 마음 풍경", topicKey: "current-atmosphere" };
  if (intent === "releaseTarget") return { label: "부담을 조금 내려놓기", topicKey: "release-target" };
  if (intent === "emotionalWish") {
    const labels: Partial<Record<SemanticFamilyId, string>> = {
      connection: "마음을 알아주는 말", serenity: "잠시 기다려 주는 마음", grounding: "안심을 바라는 마음", drive: "도움에 손 내밀기",
    };
    return { label: labels[family] ?? "내가 바라는 마음", topicKey: `emotional-wish-${family}` };
  }
  if (intent === "futureAspiration") {
    const labels: Partial<Record<SemanticFamilyId, string>> = {
      exploration: "가능성을 향한 한 걸음", drive: "꿈을 향한 발걸음", expression: "앞으로 만들고 싶은 것", reflection: "나를 알아갈 여정", connection: "앞으로 이어갈 인연",
    };
    return { label: labels[family] ?? "앞으로의 가능성", topicKey: `future-aspiration-${family}` };
  }
  return null;
}
