import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `당신은 인간의 감정을 시각적 3D 파라미터로 변환하는 전문가입니다. 
          입력된 문장을 분석하여 반드시 다음 JSON 형식으로만 답변하세요:
          {
            "colors": ["색상코드1", "색상코드2", "색상코드3"],
            "distort": 0.1~1.2 사이 숫자,
            "speed": 0.5~8.0 사이 숫자,
            "roughness": 0~1.0 사이 숫자,
            "glowStrength": 0.2~1.5 사이 숫자,
            "scale": 0.8~1.2 사이 숫자
          }` // 💡 pulse 관련 항목을 삭제했습니다.
        },
        { role: "user", content: text }
      ],
      response_format: { type: "json_object" },
    });

    return NextResponse.json(JSON.parse(response.choices[0].message.content || "{}"));
  } catch (error) {
    return NextResponse.json({ error: "분석 실패" }, { status: 500 });
  }
}