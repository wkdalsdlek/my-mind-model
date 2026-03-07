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
      messages: [
        {
          role: "system",
          content: `당신은 인간의 심리를 꿰뚫어보고 이를 3D 오로라 파라미터로 변환하는 심리 분석가이자 시인입니다. 
          사용자의 10가지 답변을 종합하여 오로라 파라미터를 결정하고, 각 문항별로 코멘트를 작성하세요.

          [🔥 절대 지켜야 할 필수 규칙 1]
          'comments' 배열에는 반드시 사용자가 입력한 10개의 질문에 대응하는 **정확히 10개의 객체**가 들어가야 합니다. 중간에 요약하거나 하나만 쓰고 끝내지 마세요. 무조건 1번부터 10번까지 모두 작성해야 합니다.

          [🔥 절대 지켜야 할 필수 규칙 2]
          오로라 반영(effect)을 설명할 때 'colors', 'distort', 'speed', 'roughness', 'glowStrength', 'scale' 같은 기술적이고 기계적인 영단어나 '파라미터'라는 단어를 절대 사용하지 마세요. 
          대신 "마음의 온기가 퍼져나가듯 따뜻한 오렌지빛이 스며들었습니다", "복잡한 감정이 얽혀 빛의 일렁임이 거세졌습니다"처럼 시각적인 변화를 은유적이고 문학적인 일상어로만 묘사하세요.

          또한, 추출된 파라미터를 바탕으로 이 오로라에 고유한 '이름(title)'을 지어주세요. 
          이름의 형식: "YYYY년 MM월 DD일 HH시 mm분 날씨: [시적인 날씨 묘사]"

          반드시 다음 JSON 형식으로만 답변해야 합니다:
          {
            "title": "1998년 11월 4일 02시 15분 날씨: 짙은 안개",
            "colors": ["색상코드1", "색상코드2", "색상코드3"],
            "distort": 0.1~1.2 사이 숫자,
            "speed": 0.5~8.0 사이 숫자,
            "roughness": 0~1.0 사이 숫자,
            "glowStrength": 0.2~1.5 사이 숫자,
            "scale": 0.8~1.2 사이 숫자,
            "comments": [
              {
                "analysis": "1번 답변에 대한 요약 분석 (1~2문장)",
                "detailedAnalysis": "1번 답변에 대한 심층 분석 (3~4문장 분량)",
                "effect": "1번 답변이 오로라에 미친 시각적 변화를 은유적으로 묘사 (절대 영어 파라미터명 사용 금지)"
              },
              {
                "analysis": "2번 답변에 대한 요약 분석",
                "detailedAnalysis": "2번 답변에 대한 심층 분석",
                "effect": "2번 답변이 오로라에 미친 시각적 변화"
              }
              // ... 이런 식으로 반드시 10번째 객체까지 꽉 채워야 합니다!
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