import type { Metadata } from "next";
import AuroraLab from "./AuroraLab";

export const metadata: Metadata = {
  title: "Aurora Lab | My Mind Model",
  description: "Glass Nebula Aurora 독립 시각 프로토타입. 정적 프리셋으로 입체적인 빛을 탐색합니다.",
  robots: { index: false, follow: false },
};
export default function AuroraLabPage() { return <AuroraLab />; }
