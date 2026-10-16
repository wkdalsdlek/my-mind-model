import MindJourney from "@/components/MindJourney";
import SessionBoundary from "@/components/auth/SessionBoundary";
import { pagePrincipal } from "@/lib/server/security/page-access";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await pagePrincipal();
  if (!user) return <main role="alert">인증 서비스를 사용할 수 없습니다. 관리자에게 문의해 주세요.</main>;
  return <SessionBoundary><MindJourney /></SessionBoundary>;
}
