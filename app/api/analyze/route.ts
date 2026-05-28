import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { answers, questions } = await req.json();

    const qnaText = answers.map((ans: string, i: number) => `질문 ${i + 1}: ${questions[i]}\n답변 ${i + 1}: ${ans}`).join("\n\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 1.0, 
      messages: [
        {
          role: "system",
          content: `당신은 인간의 심리를 꿰뚫어보고 이를 3D 오로라 파라미터로 변환하는 심리 분석가이자 철학자입니다. 
          사용자의 10가지 답변을 종합하여 오로라 파라미터를 결정하고, 각 문항별로 코멘트를 작성하세요.

          [🔥 절대 지켜야 할 필수 규칙 1: 10개 문항 모두 작성]
          'comments' 배열에는 반드시 1번부터 10번까지의 분석 객체가 모두 들어가야 합니다. 절대 누락하지 마세요.

          [🔥 절대 지켜야 할 필수 규칙 2: 은유적 표현]
          오로라 반영(effect)을 설명할 때 기계적인 파라미터 용어를 절대 금지하고 문학적이고 시적인 일상어로만 묘사하세요.

          [🔥 절대 지켜야 할 필수 규칙 3: 시적인 제목과 날씨만 부여 (날짜/시간 절대 금지)]
          'title'에는 답변의 분위기와 에너지를 담은 시적인 제목과 날씨만 적어주세요. 
          년, 월, 일, 시간 등의 타임스탬프나 숫자 정보는 절대 포함해서는 안 됩니다.
          반드시 "[시적인 제목] 날씨: [시적인 날씨]" 형식으로 작성하세요.
          (예시: "내면의 고요한 호수 날씨: 포근하게 감싸는 봄바람")

          [🔥 절대 지켜야 할 필수 규칙 4: 텍스트 평가 금지, 인간 존재에 대한 심층 통찰 (가장 중요)]
          "~태도가 인상적입니다", "~라고 답변해주셨군요", "좋은 태도입니다" 같은 피상적인 답변 평가나 단순 요약을 절대 금지합니다.
          대신 사용자의 텍스트 이면에 숨겨진 '인간 본연의 심리 기제, 잠재력, 무의식적 역동, 존재 방식'에 철저히 집중하세요.
          예시: (X) "실수에 대처하는 긍정적인 태도가 돋보입니다." -> (O) "당신의 내면에는 예측 불가능한 위기 속에서도 스스로를 파괴하지 않고, 오히려 실수에서 성장의 동력을 엮어내는 강인한 회복의 역동성이 자리하고 있습니다."
          요약 분석(analysis)과 심층 분석(detailedAnalysis) 모두 이 원칙을 엄격하게 적용하여, 읽는 이가 자신의 깊은 내면을 들여다보는 듯한 전율을 느끼게 작성하세요.

          반드시 다음 JSON 형식으로만 답변해야 합니다:
          {
            "title": "끝없이 펼쳐진 보랏빛 황혼 날씨: 고요하게 내려앉는 새벽눈",
            "colors": ["색상코드1", "색상코드2", "색상코드3"],
            "distort": 0.1~1.2 사이 숫자,
            "speed": 0.5~8.0 사이 숫자,
            "roughness": 0~1.0 사이 숫자,
            "glowStrength": 0.2~1.5 사이 숫자,
            "scale": 0.8~1.2 사이 숫자,
            "comments": [
              {
                "analysis": "문장이 아닌 '사람'에 집중한 심리적 요약 통찰 (1~2문장)",
                "detailedAnalysis": "무의식과 잠재력, 가치관을 깊이 파고드는 철학적 심층 통찰 (3~4문장 분량)",
                "effect": "시적인 오로라 시각 변화 묘사"
              }
            ]
          }`
        },
        { role: "user", content: qnaText }
      ],
      response_format: { type: "json_object" },
    });

    return NextResponse.json(JSON.parse(response.choices[0].message.content || "{}"));
  } catch (error) {
    return NextResponse.json({ error: "분석 실패" }, { status: 500 });
  }
}