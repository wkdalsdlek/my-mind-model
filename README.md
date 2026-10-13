## Glass Nebula Aurora · 2단계 Q10 개인화 추천

- Q10에 구조화된 Q1~Q9 선택을 근거로 14개 후보를 제공합니다. AI 호출 없이 로컬에서 같은 입력에 같은 추천을 생성합니다.
- 기본 목표는 직접 연관 6개·의미 확장 5개·공통 3개이며, 근거가 적거나 의미가 편중되면 공통 표현을 늘립니다. 예기치 않은 생성·검증 실패에는 공통 표현 14개로 대체합니다.
- **추천이 어디에서 왔는지 보기**에서 실제 선택 근거와 의미 계열을 확인할 수 있습니다. 선택하지 않은 추천은 답변에 포함되지 않습니다.
- 앞선 선택·삭제·건너뛰기가 바뀌면 추천을 재생성하고, 이전 추천에서 선택한 Q10 캡슐은 무효화합니다. 직접 작성한 답변·단어·문장 초안은 유지합니다. 변화가 없는 작업과 Q10 자체 선택·삭제는 추천을 재생성하지 않습니다.
- Q10 단어 입력(최대 16자)과 문장 입력(최대 1000자)을 분리했습니다. 문장은 왼쪽 답변에 직접 담겨 긴 글이 부유 공간을 과도하게 차지하지 않습니다.
- 최종 AI 함축 문장·승인 화면·새 3D 오로라는 아직 구현하지 않았습니다.

```bash
node tests/q10-personalization.test.mjs
node tests/questionnaire-data.test.mjs
```

[2단계 검증 기록과 미검증 항목](docs/q10-personalization-verification.md).

## 질문 및 데이터 구조

- Q1~Q9의 확정 질문과 키워드 14개씩(총 126개)은 `lib/question-data.ts`에서 관리합니다. 키워드 ID와 한국어 원문을 보존합니다.
- 일곱 의미 계열은 `lib/semantic-families.ts`, 질문별 초기 의미 가중치는 `lib/keyword-semantics.ts`에 분리했습니다. 기존 네 가지 캡슐 UI·물리 프로필은 유지합니다.
- Q1~Q9는 선택하지 않은 상태에서 **건너뛰기**로 이동할 수 있습니다. `pending / answered / skipped`를 선택 배열과 함께 기록합니다. 선택 후에는 다음 버튼을 사용하고, 선택을 모두 삭제하면 다시 미응답 상태가 됩니다.
- Q10의 확정 질문·보조 문구를 유지하며, 고정 키워드 대신 위의 로컬 개인화 추천과 직접 입력을 사용합니다.
- 기존 분석 API는 그대로 사용합니다. `serializeSelections`를 유지하며, 호환 어댑터에서 명시적인 건너뛰기를 문자열로 표시합니다. 새 의미 가중치와 해석 맥락을 전달하는 API 전환은 후속 단계입니다.
- 답변과 건너뛰기 기록은 질문 이동 시 유지되며 새로고침 시 초기화됩니다.

데이터·선택 상태·기존 물리 계산 검사:

```bash
node tests/questionnaire-data.test.mjs
```

검증 결과와 실제 브라우저에서 남은 확인 항목: [1단계 검증 기록](docs/glass-nebula-phase1-verification.md).

## 캡슐 질문 화면 실행

```bash
npm run dev
```

http://localhost:3000 에서 기존 입장 비밀번호로 접속합니다. 질문 화면은 API 키 없이 사용할 수 있습니다. 최종 AI 분석에는 기존 `OPENAI_API_KEY` 환경변수 설정이 필요합니다.

- 우측 캡슐을 좌측 답변 영역으로 드래그하거나, 클릭·탭·키보드 Enter/Space로 추가합니다.
- 원본은 남아 있으며 같은 키워드를 여러 번 선택할 수 있습니다. 선택한 캡슐 또는 ×를 누르면 해당 선택 하나가 제거됩니다.
- 우측 하단에서 최대 16자의 키워드를 입력하고 Enter 또는 ↵ 버튼으로 새 캡슐을 만듭니다. 같은 단어도 생성할 수 있습니다. Q10에서는 왼쪽 별도 문장 입력을 사용할 수 있습니다. 입력 원문은 표시 라벨과 별도로 보존합니다.
- 한 개 이상 선택하면 다음으로 이동하고, Q1~Q9의 빈 응답은 건너뛰기로 이동합니다. 선택과 사용자 키워드는 질문 이동 시 유지되며 새로고침 시 초기화됩니다.
- 모바일에서는 위아래 배치, iPad와 데스크톱에서는 좌우 배치를 사용합니다. 캡슐 사이 여백에서 스크롤할 수 있습니다.
- 캡슐 색상·움직임은 `lib/capsules.ts`의 기존 UI 프로필과 로컬 규칙으로 결정합니다. 일곱 의미 계열과는 독립적이며 사용자 생성 키워드의 의미 가중치는 미분류 상태로 둡니다. 외부 분류 API는 사용하지 않습니다.
- 기존 `/api/analyze`와 3D 결과 화면을 유지합니다. 선택한 키워드는 중복을 포함한 문자열로 변환하여 기존 API에 전달합니다.
- 캡슐 파괴·오로라 형성 연출은 다음 단계 작업입니다.

구현 전 체크포인트: `checkpoint/capsule-phase1-20261009` (`757c25e`).

검사 명령:

```bash
npm run lint
npx tsc --noEmit --incremental false
```

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
