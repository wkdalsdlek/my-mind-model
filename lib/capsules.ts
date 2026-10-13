export type SemanticGroup = "calm" | "warm" | "depth" | "energy";

export interface KeywordCapsule {
  id: string;
  label: string;
  group: SemanticGroup;
}

export interface SelectedCapsule extends KeywordCapsule {
  selectionId: string;
}

export const SEMANTIC_PROFILES: Record<SemanticGroup, { color: string; duration: number }> = {
  calm: { color: "117, 217, 217", duration: 13 },
  warm: { color: "235, 161, 192", duration: 10 },
  depth: { color: "177, 157, 236", duration: 16 },
  energy: { color: "208, 182, 240", duration: 8 },
};

// Local, provisional classification: no external request or paid service is used.
export function classifyKeyword(label: string): SemanticGroup {
  if (/고요|휴식|안정|자연|숲|바다|산책|잠|평온|침묵|호흡|여유|명상|일상|차분|정리|균형/.test(label)) return "calm";
  if (/사람|친구|가족|대화|공감|사랑|온기|관계|함께|연결|배려|다정|웃음|위로|진심|경청|신뢰/.test(label)) return "warm";
  if (/도전|탐험|여행|변화|성장|용기|행동|실행|모험|자유|열정|시작|운동|새로움|호기심/.test(label)) return "energy";
  return "depth";
}

export const QUESTION_DATA = [
  { id: "energy", category: "에너지와 자아", prompt: "가장 나다운 시간에는\n무엇이 함께하나요?", keywords: ["고요", "친구", "자연", "여행", "휴식", "창작", "산책", "음악", "대화", "독서", "자유", "혼자만의 시간"] },
  { id: "afterimage", category: "내면의 잔상", prompt: "마음에 오래 머무는 것은\n어떤 것들인가요?", keywords: ["추억", "사랑", "바다", "꿈", "그리움", "온기", "별빛", "여행", "가족", "질문", "가능성", "침묵"] },
  { id: "decision", category: "의사결정 방식", prompt: "중요한 선택 앞에서\n무엇을 따르나요?", keywords: ["직감", "사실", "공감", "경험", "균형", "용기", "신뢰", "논리", "가치관", "사람", "가능성", "신중함"] },
  { id: "crisis", category: "위기 대응", prompt: "계획이 흔들릴 때,\n무엇이 당신을 이끄나요?", keywords: ["호흡", "행동", "도움", "정리", "용기", "수용", "대화", "분석", "새로움", "차분함", "책임", "성장"] },
  { id: "connection", category: "소통의 지향점", prompt: "당신이 꿈꾸는 대화에는\n무엇이 있나요?", keywords: ["경청", "웃음", "침묵", "진심", "공감", "호기심", "깊이", "배려", "자유", "신뢰", "상상", "온기"] },
  { id: "acceptance", category: "수용과 방어", prompt: "비판을 마주할 때,\n무엇을 지키고 싶나요?", keywords: ["진심", "성장", "존중", "사실", "경계", "신뢰", "용기", "자존감", "균형", "대화", "신중함", "수용"] },
  { id: "values", category: "삶의 핵심 가치", prompt: "당신의 삶을 닮은 단어는\n무엇인가요?", keywords: ["사랑", "자유", "성장", "평온", "연결", "진실", "창작", "용기", "배려", "탐험", "균형", "의미"] },
  { id: "motivation", category: "무조건적인 동기", prompt: "보상이 없어도\n마음이 향하는 것은 무엇인가요?", keywords: ["창작", "배움", "사람", "자연", "탐험", "돌봄", "음악", "호기심", "공감", "운동", "상상", "함께"] },
  { id: "recovery", category: "회복 탄력성", prompt: "지친 마음이 돌아갈 곳에는\n무엇이 있나요?", keywords: ["휴식", "가족", "숲", "잠", "친구", "음악", "산책", "위로", "고요", "일상", "바다", "명상"] },
  { id: "change", category: "변화와 유지", prompt: "앞으로의 당신에게\n어떤 것들이 함께하길 바라나요?", keywords: ["용기", "평온", "변화", "진심", "성장", "균형", "사랑", "자유", "신뢰", "새로움", "다정함", "깊이"] },
];

export const QUESTIONS = QUESTION_DATA.map(({ category, prompt }) => `[${category}] ${prompt.replaceAll("\n", " ")}`);

export function createKeywordPools(): KeywordCapsule[][] {
  return QUESTION_DATA.map((question) => question.keywords.map((label, index) => ({
    id: `${question.id}-${index}`,
    label,
    group: classifyKeyword(label),
  })));
}

// The existing API accepts text answers; repetition remains visible in this adapter.
export function serializeSelections(selections: SelectedCapsule[][]): string[] {
  return selections.map((items) => items.map(({ label }) => label).join(", "));
}
