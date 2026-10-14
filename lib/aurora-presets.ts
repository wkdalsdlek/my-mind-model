import type { AuroraPreset } from "./aurora-types";

// Static art direction only. No questionnaire answers, titles, API calls or psychological inference.
export const AURORA_PRESETS: readonly AuroraPreset[] = [
  { id: "serenity", name: "Serenity", description: "고요한 물결 사이, 은빛의 여백.", ribbonCount: 3,
    palette: [{ familyId: "serenity", weight: 0.58 }, { familyId: "grounding", weight: 0.27 }, { familyId: "reflection", weight: 0.15 }],
    motion: { speed: 0.28, amplitude: 0.48, flow: 0.35 } },
  { id: "connection", name: "Connection", description: "서로 다른 빛이 부드럽게 포개지는 곳.", ribbonCount: 3,
    palette: [{ familyId: "connection", weight: 0.56 }, { familyId: "expression", weight: 0.29 }, { familyId: "reflection", weight: 0.15 }],
    motion: { speed: 0.34, amplitude: 0.64, flow: 0.45 } },
  { id: "exploration", name: "Exploration", description: "푸른 경계 너머로 넓어지는 물결.", ribbonCount: 4,
    palette: [{ familyId: "exploration", weight: 0.58 }, { familyId: "serenity", weight: 0.27 }, { familyId: "expression", weight: 0.15 }],
    motion: { speed: 0.42, amplitude: 0.82, flow: 0.68 } },
  { id: "mixed", name: "Mixed", description: "한 가지 색으로 정해지지 않는 작은 우주.", ribbonCount: 4,
    palette: [{ familyId: "expression", weight: 0.34 }, { familyId: "serenity", weight: 0.29 }, { familyId: "exploration", weight: 0.24 }, { familyId: "drive", weight: 0.13 }],
    motion: { speed: 0.36, amplitude: 0.7, flow: 0.55 } },
];
