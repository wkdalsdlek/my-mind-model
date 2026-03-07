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
      // 💡 AI의 창의성을 높여서 답변을 다양하게 유도하는 옵션입니다 (기본값 0.7 -> 1.0으로 상향)
      temperature: 1.0, 
      messages: [
        {
          role: "system",
          content: `당신은 인간의 심리를 꿰뚫어보고 이를 3D 오로라 파라미터로 변환하는 심리 분석가이자 시인입니다. 
          사용자의 10가지 답변을 종합하여 오로라 파라미터를 결정하고, 각 문항별로 코멘트를 작성하세요.

          [🔥 절대 지켜야 할 필수 규칙 1: 10개 문항 모두 작성]
          'comments' 배열에는 반드시 1번부터 10번까지의 분석 객체가 모두 들어가야 합니다. 절대 누락하지 마세요.

          [🔥 절대 지켜야 할 필수 규칙 2: 은유적 표현]
          오로라 반영(effect)을 설명할 때 'colors', 'distort', 'speed', 'roughness', 'glowStrength', 'scale', '파라미터' 등 기계적인 용어를 절대 금지합니다. 철저히 문학적이고 시적인 일상어로만 시각적 변화를 묘사하세요.

          [🔥 절대 지켜야 할 필수 규칙 3: 다채로운 시간의 부여 (가장 중요)]
          추출된 파라미터를 바탕으로 "YYYY년 MM월 DD일 HH시 mm분 날씨: [시적인 날씨]" 형식의 'title'을 지어주세요.
          이때, 모든 사용자에게 "2023년 10월"처럼 비슷하고 편중된 연도와 월이 반복해서 나오는 것을 엄격히 금지합니다. 사용자의 아주 미세한 감정 차이를 극대화하여 아래 기준에 따라 매우 다채롭게 분배하세요.
          - YYYY년: 1850년부터 2100년 사이에서 무작위성에 기반해 폭넓게 선택하세요. (예: 아주 낭만적이고 고전적인 깊은 감정이면 1850~1890년대, 아련한 향수나 상처는 1980~1990년대, 현실적이고 생생한 감각은 2010~2026년, 미지에 대한 호기심이나 희망찬 의지가 돋보이면 2030~2100년의 미래 연도를 적극 부여할 것. 절대 2023년 등 특정 연도에 쏠리지 않게 할 것)
          - MM월: 1월부터 12월까지 고르게 활용하세요. (조금만 서늘해도 11월, 1월, 2월을 쓰고, 청량하면 6월, 7월을 적극 활용할 것)
          - HH시: 00시부터 23시까지 답변의 에너지 강도에 따라 다양하게 분배하세요.

          반드시 다음 JSON 형식으로만 답변해야 합니다:
          {
            "title": "1987년 2월 14일 04시 10분 날씨: 고요하게 내려앉는 새벽눈",
            "colors": ["색상코드1", "색상코드2", "색상코드3"],
            "distort": 0.1~1.2 사이 숫자,
            "speed": 0.5~8.0 사이 숫자,
            "roughness": 0~1.0 사이 숫자,
            "glowStrength": 0.2~1.5 사이 숫자,
            "scale": 0.8~1.2 사이 숫자,
            "comments": [
              {
                "analysis": "1번 답변을 통한 사용자 요약 분석",
                "detailedAnalysis": "1번 답변을 통한 사용자 심층 분석",
                "effect": "시적인 오로라 시각 변화 묘사"
              }
              // ... 반드시 10번까지 작성
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