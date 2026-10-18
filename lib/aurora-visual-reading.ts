import type { AuroraRibbonInterpretationFacts } from "./aurora-interpretation-types";
/** Hue/lightness labels describe actual renderer endpoints, never inferred personality. */
export function koreanAuroraColor(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return "부드러운 혼합빛";
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, light = (max + min) / 2;
  if (delta < .09) return light > .75 ? "은은한 유백빛" : light < .3 ? "깊은 먹빛" : "부드러운 은회빛";
  const hue = (((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60) + 360) % 360;
  const name = hue < 18 || hue >= 345 ? "장밋빛" : hue < 43 ? "살구빛" : hue < 68 ? "황금빛" : hue < 155 ? "초록빛"
    : hue < 190 ? "청록빛" : hue < 225 ? "하늘빛" : hue < 260 ? "남보랏빛" : hue < 295 ? "라벤더빛" : "분홍빛";
  return `${light > .72 ? "부드러운" : light < .36 ? "깊은" : "맑은"} ${name}`;
}
export function auroraVisualReading(ribbon: AuroraRibbonInterpretationFacts) {
  const main = ribbon.layers[0], { shape, visual } = main;
  const colors = [visual.colorA, visual.colorB].map(endpoint => {
    const origin = ribbon.paletteOrigins.find(p => p.paletteIndex === endpoint.paletteIndex);
    const share = ribbon.composition.find(s => s.familyId === origin?.familyId);
    return { color: endpoint.color, name: koreanAuroraColor(endpoint.color), origin: origin?.origin ?? "unknown",
      explanation: origin?.origin === "answer" && share ? `${share.label} 계열의 실제 핵심 선택에 연결됩니다.`
        : origin?.origin === "neutral-visual" ? "빛의 조화를 위해 더한 중립 보조색입니다." : "확인된 선택 유래 의미를 붙이지 않는 색입니다." };
  });
  return { origin: "deterministic-code" as const, colors,
    palette: colors.map(c => `${c.name}: ${c.explanation}`).join(" "),
    composition: ribbon.composition.length ? ribbon.composition.map(s => `${s.label} ${Math.round(s.withinPairShare * 100)}%`).join(" · ") : "중립적인 빛",
    motion: `장면 전체의 핵심 선택 비중을 함께 섞은 움직임을 공유합니다. 흐름 속도 ${ribbon.visualExplanation.globalMotion.speed.toFixed(2)}, 진폭 ${ribbon.visualExplanation.globalMotion.amplitude.toFixed(2)}는 렌더러 단위입니다. 특정 단어 하나가 움직임을 얼마나 늘렸는지는 계산하지 않습니다.`,
    structure: `${shape.kind === "loop" ? "한 번 꼬여 이어지는 보조 폐곡선" : "완만하게 감기는 주 리본 폐곡선"}입니다. 길이 방향 폭 ${shape.width.toFixed(2)}, 띠 너비 ${shape.height.toFixed(2)}, 휨 ${shape.curve.toFixed(2)}, 깊이 ${shape.depth.toFixed(2)}는 기존 조형 설정입니다. 꼬임·곡률·길이는 성격이나 사전 상황 때문에 변한 값이 아닙니다.`,
    light: `기존 시드의 세 에너지 흐름과 ${ribbon.layers.filter(l => l.mist).length}개 안개층을 유지합니다. 빛 농도의 기본 가중치 ${Math.round(visual.targetOpacity * 100)}%는 빛의 겹침을 위한 설정이며, 선택의 강도나 실제 화면 밝기 점수가 아닙니다.`,
    limitation: "의미 구성 비중은 이 리본의 색상 계열 사이 비중이며 픽셀 면적이 아닙니다. 사전 상황은 해석 맥락입니다. Q3 현재 풍경·Q7 바라는 감정·Q8 내려놓을 것·Q9 미래 방향의 별도 효과는 렌더러에 직접 적용되지 않습니다." };
}
