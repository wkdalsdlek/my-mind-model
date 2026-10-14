"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GlassNebulaAurora from "@/components/aurora/GlassNebulaAurora";
import { useAuroraBrowserSignals } from "@/components/aurora/useAuroraBrowserSignals";
import type { AuroraCameraMode, AuroraQuality } from "@/lib/aurora-types";
import type { AuroraCompletedResult } from "@/lib/aurora-result";
import { QUESTION_DATA } from "@/lib/question-data";
import styles from "./AuroraResultScreen.module.css";

export default function AuroraResultScreen({ result, onReset }: { result: AuroraCompletedResult; onReset: () => void }) {
  const { personalization, answers } = result.snapshot;
  const [quality, setQuality] = useState<AuroraQuality>("balanced");
  const [cameraMode, setCameraMode] = useState<AuroraCameraMode>("front");
  const [cameraRevision, setCameraRevision] = useState(0);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [cameraNotice, setCameraNotice] = useState("");
  const [analysisMode, setAnalysisMode] = useState<"basic" | "detailed" | null>(null);
  const { reduced } = useAuroraBrowserSignals();
  const effectiveReduced = reducedMotion || reduced;
  const heading = useRef<HTMLHeadingElement>(null), panelHeading = useRef<HTMLHeadingElement>(null);
  const basicButton = useRef<HTMLButtonElement>(null), detailedButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<"basic" | "detailed">("basic");
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (analysisMode) panelHeading.current?.focus(); }, [analysisMode]);
  const onAvailabilityChange = useCallback((supported: boolean) => { setAvailable(supported); if (!supported) setCameraMode("front"); }, []);
  const onCameraModeChange = useCallback((mode: AuroraCameraMode, reason: "interaction" | "reduced-motion") => {
    setCameraMode(mode);
    setCameraNotice(reason === "interaction" ? "직접 조작으로 자동 공전을 멈췄어요." : "움직임 감소에 따라 자동 공전을 멈췄어요.");
  }, []);
  const requestCamera = (mode: AuroraCameraMode) => { setCameraMode(mode); setCameraRevision(value => value + 1); setCameraNotice(""); };
  const openAnalysis = (mode: "basic" | "detailed") => { opener.current = mode; setAnalysisMode(mode); };
  const closeAnalysis = () => { setAnalysisMode(null); (opener.current === "basic" ? basicButton : detailedButton).current?.focus(); };
  const fallback = personalization.trace.visualFallback;
  return <main className={styles.result} aria-labelledby="aurora-result-title">
    <header className={styles.header}>
      <p className={styles.brand}><span aria-hidden="true">✦</span> MY MIND MODEL <span>내면의 조각들</span></p>
      <p className={styles.eyebrow}>YOUR GLASS NEBULA AURORA</p>
      <h1 ref={heading} tabIndex={-1} id="aurora-result-title">{personalization.approvedTitle.text}</h1>
      <p className={styles.subtitle}>{fallback === "neutral-palette" ? "선택한 표현만으로 색을 정하기 어려워, 중립적인 빛으로 보여드려요."
        : fallback === "neutral-accent" ? "당신이 남긴 단어에, 빛의 조화를 위한 중립적인 보조색을 더했어요."
          : "당신이 남긴 단어들이 빛의 흐름으로 이어집니다."}</p>
    </header>
    <div className={`${styles.content} ${analysisMode ? styles.withAnalysis : ""}`}>
      <section className={styles.viewer} aria-label="개인화 오로라 감상">
        <div className={styles.stage}>
          <GlassNebulaAurora appearance={personalization.appearance} quality={quality} reducedMotion={reducedMotion}
            cameraMode={cameraMode} cameraRevision={cameraRevision} onCameraModeChange={onCameraModeChange} onAvailabilityChange={onAvailabilityChange} />
        </div>
        <div className={styles.controls}>
          <label>감상 방식<select id="result-camera-mode" value={cameraMode} disabled={available === false}
            onChange={event => requestCamera(event.target.value as AuroraCameraMode)}>
            <option value="front">정면 감상</option><option value="free">자유 탐색</option><option value="auto" disabled={effectiveReduced}>느린 자동 공전</option>
          </select></label>
          <button type="button" disabled={available === false} onClick={() => requestCamera("front")}>정면으로 돌아오기</button>
          <label>렌더링 품질<select id="result-quality" value={quality} onChange={event => setQuality(event.target.value as AuroraQuality)}>
            <option value="low">저사양</option><option value="balanced">기본</option><option value="high">고화질</option>
          </select></label>
          <label className={styles.motion}><input type="checkbox" checked={effectiveReduced} disabled={reduced}
            onChange={event => setReducedMotion(event.target.checked)} />움직임 줄이기</label>
        </div>
        <p className={styles.cameraHint} role="status">{cameraNotice || (effectiveReduced ? "움직임 감소 중 · 자동 공전이 꺼져 있어요."
          : cameraMode === "front" ? "자유 탐색으로 다른 각도의 빛을 바라보세요."
            : cameraMode === "auto" ? "천천히 공전합니다. 직접 조작하면 멈춥니다." : "드래그로 회전 · 휠 또는 두 손가락으로 확대·축소")}</p>
        <nav className={styles.actions} aria-label="결과 화면 작업">
          <button type="button" onClick={onReset}>다시 성찰하기</button>
          <button ref={basicButton} type="button" aria-expanded={analysisMode === "basic"} aria-controls="result-analysis" onClick={() => openAnalysis("basic")}>요약 분석</button>
          <button ref={detailedButton} type="button" aria-expanded={analysisMode === "detailed"} aria-controls="result-analysis" onClick={() => openAnalysis("detailed")}>심층 분석</button>
        </nav>
      </section>
      {analysisMode && <aside id="result-analysis" className={styles.analysis} aria-labelledby="result-analysis-heading" onKeyDown={event => { if (event.key === "Escape") closeAnalysis(); }}>
        <div className={styles.analysisHeader}>
          <h2 ref={panelHeading} id="result-analysis-heading" tabIndex={-1}>{analysisMode === "detailed" ? "심층 분석 결과" : "요약 분석 결과"}</h2>
          <button type="button" aria-label="분석 패널 닫기" onClick={closeAnalysis}>닫기</button>
        </div>
        <div className={styles.analysisBody}>{result.comments.map((comment, i) => <article key={QUESTION_DATA[i].id}>
          <p className={styles.questionNumber}>Question {i + 1} · {QUESTION_DATA[i].category}</p>
          <div className={styles.answer}><p>Q. {QUESTION_DATA[i].prompt}</p><p>A. {answers[i]}</p></div>
          <p className={styles.comment}>{analysisMode === "detailed" ? comment.detailedAnalysis || comment.analysis : comment.analysis || comment.detailedAnalysis}</p>
        </article>)}</div>
      </aside>}
    </div>
  </main>;
}
