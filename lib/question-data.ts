export type QuestionId = "q1" | "q2" | "q3" | "q4" | "q5" | "q6" | "q7" | "q8" | "q9" | "q10";
export type AnswerIntent = "selfExperience" | "recoverySource" | "currentAtmosphere" | "relationshipValue" | "decisionDriver" | "enduringValue" | "emotionalWish" | "releaseTarget" | "futureAspiration" | "closingMessage";
export type VisualRole = "coreFlow" | "softness" | "atmosphere" | "ribbonConnection" | "direction" | "structure" | "innerPulse" | "releaseFragments" | "outerExpansion" | "closingMessage";

export interface FixedKeyword {
  id: string;
  label: string;
}

export interface QuestionDefinition {
  id: QuestionId;
  category: string;
  prompt: string;
  description: string;
  helperText?: string;
  answerIntent: AnswerIntent;
  visualRole: VisualRole;
  allowSkip: boolean;
  keywordMode: "fixed" | "personalized";
  keywords: readonly FixedKeyword[];
}

// Approved wording. IDs remain explicit so reordering never changes keyword identity.
export const QUESTION_DATA: readonly QuestionDefinition[] = [
  {
    id: "q1", category: "자기다움", prompt: "당신이 가장 당신답다고 느끼는 순간은 언제인가요?",
    description: "현재의 자기다움을 느끼는 상황과 경험.",
    answerIntent: "selfExperience", visualRole: "coreFlow", allowSkip: true, keywordMode: "fixed",
    keywords: [
      { id: "q1-01", label: "혼자만의 시간" }, { id: "q1-02", label: "깊은 대화" },
      { id: "q1-03", label: "무언가를 창작할 때" }, { id: "q1-04", label: "새로운 도전을 할 때" },
      { id: "q1-05", label: "자연 속에 있을 때" }, { id: "q1-06", label: "좋아하는 일에 몰입할 때" },
      { id: "q1-07", label: "소중한 사람과 함께할 때" }, { id: "q1-08", label: "자유롭게 떠날 때" },
      { id: "q1-09", label: "누군가를 도울 때" }, { id: "q1-10", label: "생각에 잠길 때" },
      { id: "q1-11", label: "몸을 움직일 때" }, { id: "q1-12", label: "목표를 이뤘을 때" },
      { id: "q1-13", label: "함께 웃고 즐길 때" }, { id: "q1-14", label: "내 생각을 표현할 때" },
    ],
  },
  {
    id: "q2", category: "회복과 에너지", prompt: "지친 하루 끝에, 당신의 마음을 다시 채워주는 것은 무엇인가요?",
    description: "정서적 회복 자원. 현재의 회복 방식을 뜻하며 고정 성격으로 단정하지 않습니다.",
    answerIntent: "recoverySource", visualRole: "softness", allowSkip: true, keywordMode: "fixed",
    keywords: [
      { id: "q2-01", label: "고요한 휴식" }, { id: "q2-02", label: "좋아하는 음악" },
      { id: "q2-03", label: "따뜻한 위로" }, { id: "q2-04", label: "누군가와의 대화" },
      { id: "q2-05", label: "충분한 잠" }, { id: "q2-06", label: "자연의 풍경" },
      { id: "q2-07", label: "작은 성취" }, { id: "q2-08", label: "맛있는 음식" },
      { id: "q2-09", label: "가벼운 산책" }, { id: "q2-10", label: "혼자만의 여유" },
      { id: "q2-11", label: "웃음과 장난" }, { id: "q2-12", label: "취미에 몰입하기" },
      { id: "q2-13", label: "익숙한 공간" }, { id: "q2-14", label: "새로운 자극" },
    ],
  },
  {
    id: "q3", category: "현재 마음의 풍경", prompt: "지금 당신의 마음을 하나의 풍경으로 표현한다면, 어떤 모습일까요?",
    description: "현재의 정서적 분위기와 이미지. 풍경을 부정적인 성격, 질환, 위기 또는 심리적 결함의 증거로 취급하지 않습니다.",
    answerIntent: "currentAtmosphere", visualRole: "atmosphere", allowSkip: true, keywordMode: "fixed",
    keywords: [
      { id: "q3-01", label: "잔잔한 바다" }, { id: "q3-02", label: "깊은 숲" },
      { id: "q3-03", label: "따뜻한 햇살" }, { id: "q3-04", label: "짙은 안개" },
      { id: "q3-05", label: "쏟아지는 소나기" }, { id: "q3-06", label: "빛나는 별밤" },
      { id: "q3-07", label: "거센 파도" }, { id: "q3-08", label: "맑고 푸른 하늘" },
      { id: "q3-09", label: "고요한 새벽" }, { id: "q3-10", label: "붉게 물든 노을" },
      { id: "q3-11", label: "바람 부는 들판" }, { id: "q3-12", label: "눈 덮인 산" },
      { id: "q3-13", label: "흐르는 강물" }, { id: "q3-14", label: "구름 사이의 빛" },
    ],
  },
  {
    id: "q4", category: "관계의 가치관", prompt: "누군가와 마음을 나눌 때, 당신이 가장 소중하게 여기는 것은 무엇인가요?",
    description: "관계 안에서 중요하게 생각하는 가치와 원칙.",
    answerIntent: "relationshipValue", visualRole: "ribbonConnection", allowSkip: true, keywordMode: "fixed",
    keywords: [
      { id: "q4-01", label: "신뢰" }, { id: "q4-02", label: "진심" },
      { id: "q4-03", label: "공감" }, { id: "q4-04", label: "존중" },
      { id: "q4-05", label: "솔직함" }, { id: "q4-06", label: "배려" },
      { id: "q4-07", label: "편안함" }, { id: "q4-08", label: "유머" },
      { id: "q4-09", label: "서로의 이해" }, { id: "q4-10", label: "함께하는 시간" },
      { id: "q4-11", label: "개인의 자유" }, { id: "q4-12", label: "안정감" },
      { id: "q4-13", label: "약속을 지키는 마음" }, { id: "q4-14", label: "서로의 성장" },
    ],
  },
  {
    id: "q5", category: "선택의 기준", prompt: "두 갈래 길 앞에 섰을 때, 당신의 발걸음을 움직이는 것은 무엇인가요?",
    description: "결정을 내릴 때 중요하게 고려하는 기준.",
    answerIntent: "decisionDriver", visualRole: "direction", allowSkip: true, keywordMode: "fixed",
    keywords: [
      { id: "q5-01", label: "안정감" }, { id: "q5-02", label: "호기심" },
      { id: "q5-03", label: "직감" }, { id: "q5-04", label: "새로운 가능성" },
      { id: "q5-05", label: "성장" }, { id: "q5-06", label: "설렘" },
      { id: "q5-07", label: "신중한 판단" }, { id: "q5-08", label: "자유로운 선택" },
      { id: "q5-09", label: "확신" }, { id: "q5-10", label: "도전" },
      { id: "q5-11", label: "현실적인 조건" }, { id: "q5-12", label: "삶의 의미" },
      { id: "q5-13", label: "주변의 조언" }, { id: "q5-14", label: "후회 없는 선택" },
    ],
  },
  {
    id: "q6", category: "오래 지키고 싶은 가치", prompt: "시간이 흘러 많은 것이 변하더라도, 당신이 끝까지 지키고 싶은 것은 무엇인가요?",
    description: "사용자가 지속적으로 지키고 싶어 하는 가치.",
    answerIntent: "enduringValue", visualRole: "structure", allowSkip: true, keywordMode: "fixed",
    keywords: [
      { id: "q6-01", label: "진정성" }, { id: "q6-02", label: "사랑" },
      { id: "q6-03", label: "자유" }, { id: "q6-04", label: "나의 신념" },
      { id: "q6-05", label: "따뜻함" }, { id: "q6-06", label: "자존감" },
      { id: "q6-07", label: "정의로움" }, { id: "q6-08", label: "성장하는 마음" },
      { id: "q6-09", label: "가족" }, { id: "q6-10", label: "꿈" },
      { id: "q6-11", label: "인간다운 존엄" }, { id: "q6-12", label: "내면의 평온" },
      { id: "q6-13", label: "정직함" }, { id: "q6-14", label: "삶의 균형" },
    ],
  },
  {
    id: "q7", category: "표현하지 못한 마음", prompt: "괜찮다고 말했던 순간, 사실 당신의 마음은 무엇을 바라고 있었나요?",
    description: "그 순간 사용자가 바랐던 정서적 욕구. 이미 충족된 관계 상태나 확정적인 성격 특성으로 취급하지 않습니다.",
    answerIntent: "emotionalWish", visualRole: "innerPulse", allowSkip: true, keywordMode: "fixed",
    keywords: [
      { id: "q7-01", label: "이해받고 싶었어" }, { id: "q7-02", label: "따뜻한 위로" },
      { id: "q7-03", label: "있는 그대로의 인정" }, { id: "q7-04", label: "조금 더 관심" },
      { id: "q7-05", label: "안심할 수 있는 말" }, { id: "q7-06", label: "진심 어린 사과" },
      { id: "q7-07", label: "혼자 있을 시간" }, { id: "q7-08", label: "누군가의 포옹" },
      { id: "q7-09", label: "솔직한 대화" }, { id: "q7-10", label: "기다려 주는 마음" },
      { id: "q7-11", label: "나를 믿어주기" }, { id: "q7-12", label: "말없는 동행" },
      { id: "q7-13", label: "도움을 청할 용기" }, { id: "q7-14", label: "잠시 멈출 여유" },
    ],
  },
  {
    id: "q8", category: "내려놓고 싶은 마음", prompt: "조금 더 가벼운 마음으로 살아갈 수 있다면, 당신은 무엇을 내려놓고 싶나요?",
    description: "사용자가 놓아주고 싶은 부담이나 습관. 의미 가중치를 추구하는 가치의 긍정 점수로 더하거나 부정적인 사람으로 분류하지 않습니다.",
    answerIntent: "releaseTarget", visualRole: "releaseFragments", allowSkip: true, keywordMode: "fixed",
    keywords: [
      { id: "q8-01", label: "타인의 시선" }, { id: "q8-02", label: "완벽주의" },
      { id: "q8-03", label: "끊임없는 비교" }, { id: "q8-04", label: "지나간 후회" },
      { id: "q8-05", label: "지나친 기대" }, { id: "q8-06", label: "과도한 책임감" },
      { id: "q8-07", label: "인정받아야 한다는 마음" }, { id: "q8-08", label: "실패에 대한 두려움" },
      { id: "q8-09", label: "조급함" }, { id: "q8-10", label: "오래된 미련" },
      { id: "q8-11", label: "나를 향한 비난" }, { id: "q8-12", label: "모든 것을 통제하려는 마음" },
      { id: "q8-13", label: "불필요한 걱정" }, { id: "q8-14", label: "거절하지 못하는 습관" },
    ],
  },
  {
    id: "q9", category: "내면의 소망과 가능성", prompt: "두려움도 한계도 없다면, 당신은 어떤 가능성을 향해 나아가고 싶나요?",
    description: "앞으로 나아가고 싶은 미래의 방향. 현재 성취나 고정된 성격으로 간주하지 않습니다.",
    answerIntent: "futureAspiration", visualRole: "outerExpansion", allowSkip: true, keywordMode: "fixed",
    keywords: [
      { id: "q9-01", label: "새로운 세계 탐험" }, { id: "q9-02", label: "오래된 꿈 실현" },
      { id: "q9-03", label: "나만의 작품 만들기" }, { id: "q9-04", label: "자유로운 삶" },
      { id: "q9-05", label: "깊은 사랑" }, { id: "q9-06", label: "미지의 경험" },
      { id: "q9-07", label: "새로운 시작" }, { id: "q9-08", label: "진정한 자기 발견" },
      { id: "q9-09", label: "세상에 기여하기" }, { id: "q9-10", label: "끝없는 모험" },
      { id: "q9-11", label: "평생의 배움" }, { id: "q9-12", label: "나만의 길" },
      { id: "q9-13", label: "새로운 관계 만들기" }, { id: "q9-14", label: "더 넓은 세상 만나기" },
    ],
  },
  {
    id: "q10", category: "마음에 남기는 말", prompt: "이 여정의 끝에서, 당신의 마음에 남기고 싶은 말은 무엇인가요?",
    description: "최종 사용자 승인 문장. 개인화 추천, 함축 생성, 승인은 후속 단계에서 구현합니다.",
    helperText: "지금까지 발견한 마음의 조각들을 다시 만나보세요. 새로운 단어나 문장을 직접 남겨도 좋아요.",
    answerIntent: "closingMessage", visualRole: "closingMessage", allowSkip: false, keywordMode: "personalized", keywords: [],
  },
];
