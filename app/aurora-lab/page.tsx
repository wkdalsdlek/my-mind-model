import { pagePrincipal } from "@/lib/server/security/page-access";
import SessionBoundary from "@/components/auth/SessionBoundary";
import type { Metadata } from "next";
import AuroraLab from "./AuroraLab";

export const metadata: Metadata = {
  title: "Aurora Lab | My Mind Model",
  description: "Glass Nebula Aurora 독립 시각 프로토타입. 정적 프리셋으로 입체적인 빛을 탐색합니다.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default async function AuroraLabPage() {
  const user = await pagePrincipal(true);
  if (!user) return <main role="alert">Owner 권한 또는 인증 서비스 상태를 확인해 주세요.</main>;
  return <SessionBoundary><AuroraLab /></SessionBoundary>;
}
