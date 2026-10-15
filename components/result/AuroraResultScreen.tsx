"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GlassNebulaAurora from "@/components/aurora/GlassNebulaAurora";
import { useAuroraBrowserSignals } from "@/components/aurora/useAuroraBrowserSignals";
import type { AuroraCameraMode, AuroraQuality } from "@/lib/aurora-types";
import type { AuroraCompletedResult } from "@/lib/aurora-result";
import { QUESTION_DATA } from "@/lib/question-data";
import { buildAuroraRibbonMeaningFromResult } from "@/lib/aurora-ribbon-meaning";
import type { AuroraRibbonId } from "@/lib/aurora-ribbon-layout";
import type { AuroraRibbonFocusPhase } from "@/lib/aurora-ribbon-focus";
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
  const [selectedRibbonId, setSelectedRibbonId] = useState<AuroraRibbonId | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<number | undefined>(undefined);
  const beaconHost = useRef<HTMLDivElement>(null);
  const [focusPhase, setFocusPhase] = useState<AuroraRibbonFocusPhase>("overview");
  const [pickNotice, setPickNotice] = useState("");
  const ribbonList = useRef<HTMLDivElement>(null), returnFocus = useRef<AuroraRibbonId | null>(null);
  const overviewButton = useRef<HTMLButtonElement>(null), focusOverviewButton = useRef(false);
  const mapping = useMemo(() => buildAuroraRibbonMeaningFromResult(result, { quality }), [result, quality]);
  const ribbons = mapping.ribbons.filter(r => r.active);
  const selectedRibbon = ribbons.find(r => r.ribbonId === selectedRibbonId);
  const focusActive = !!selectedRibbon || focusPhase !== "overview";
  const { reduced } = useAuroraBrowserSignals();
  const effectiveReduced = reducedMotion || reduced;
  const heading = useRef<HTMLHeadingElement>(null), panelHeading = useRef<HTMLHeadingElement>(null);
  const basicButton = useRef<HTMLButtonElement>(null), detailedButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<"basic" | "detailed">("basic");
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (analysisMode) panelHeading.current?.focus(); }, [analysisMode]);
  const onAvailabilityChange = useCallback((supported: boolean) => {
    setAvailable(supported);
    if (!supported) { setCameraMode("front"); setSelectedRibbonId(null); setFocusPhase("overview"); }
  }, []);
  const selectRibbon = useCallback((id: AuroraRibbonId) => {
    focusOverviewButton.current = !ribbonList.current?.contains(document.activeElement);
    returnFocus.current = null; setSelectedSegment(undefined); setSelectedRibbonId(id); setPickNotice("");
  }, []);
  useEffect(() => {
    if (selectedRibbonId && focusOverviewButton.current) { overviewButton.current?.focus({ preventScroll: true }); focusOverviewButton.current = false; }
  }, [selectedRibbonId]);
  const onFocusPhaseChange = useCallback((phase: AuroraRibbonFocusPhase) => {
    setFocusPhase(phase);
    if (phase === "overview" && returnFocus.current) {
      ribbonList.current?.querySelector<HTMLButtonElement>(`[data-ribbon-id="${returnFocus.current}"]`)?.focus({ preventScroll: true });
      returnFocus.current = null;
    }
  }, []);
  const onFocusReturn = useCallback((mode: AuroraCameraMode) => { setCameraMode(mode); setCameraNotice(""); }, []);
  const onPickError = useCallback(() => setPickNotice("화면에서 선택하기 어려우면 아래 리본 목록을 이용해 주세요."), []);
  const backToOverview = () => { returnFocus.current = selectedRibbonId; setSelectedRibbonId(null); setPickNotice(""); };
  const onCameraModeChange = useCallback((mode: AuroraCameraMode, reason: "interaction" | "reduced-motion") => {
    setCameraMode(mode);
    setCameraNotice(reason === "interaction" ? "직접 조작으로 자동 공전을 멈췄어요." : "움직임 감소에 따라 자동 공전을 멈췄어요.");
  }, []);
  const requestCamera = (mode: AuroraCameraMode) => { setCameraMode(mode); setCameraRevision(value => value + 1); setCameraNotice(""); };
  const openAnalysis = (mode: "basic" | "detailed") => { opener.current = mode; setAnalysisMode(mode); };
  const closeAnalysis = () => {
    setAnalysisMode(null);
    (focusActive ? overviewButton : opener.current === "basic" ? basicButton : detailedButton).current?.focus();
  };
  const fallback = personalization.trace.visualFallback;
  return <main className={`${styles.result} ${focusActive ? styles.immersed : ""}`} data-experience={focusActive ? "macro" : "universe"} onKeyDown={event => {
      if (event.key === "Escape" && focusActive && !analysisMode) { event.preventDefault(); backToOverview(); }
    }} aria-labelledby="aurora-result-title">
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
            cameraMode={cameraMode} cameraRevision={cameraRevision} onCameraModeChange={onCameraModeChange} onAvailabilityChange={onAvailabilityChange}
            selectedRibbonId={selectedRibbonId} selectedRibbonSegment={selectedSegment} beaconHost={beaconHost} onRibbonSelect={selectRibbon} onRibbonPickError={onPickError}
            onRibbonFocusPhaseChange={onFocusPhaseChange} onRibbonFocusReturn={onFocusReturn} />
        </div>
        <div ref={beaconHost} className={styles.beacons} hidden={focusActive || available !== true} role="group" aria-label="리본 빛 선택점">
          <svg className={styles.leaders} aria-hidden="true">{ribbons.map(ribbon => <line key={ribbon.ribbonId} data-leader-id={ribbon.ribbonId}
            stroke={ribbon.layers[0].visual.colorA.color} />)}</svg>
          {ribbons.map((ribbon, index) => <button key={ribbon.ribbonId} type="button" className={styles.beacon} data-beacon-id={ribbon.ribbonId}
            style={{ color: (ribbon.layers[0].identityProfile?.colors.coreMix ?? 0) > .5 ? ribbon.layers[0].visual.colorB.color : ribbon.layers[0].visual.colorA.color }} aria-label={`${ribbon.name} 빛 선택점 · 가까이 보기`} onClick={event => {
              const u = Number(event.currentTarget.dataset.segmentU);
              selectRibbon(ribbon.ribbonId); setSelectedSegment(Number.isFinite(u) ? u : undefined);
            }}><span className={styles.beaconHalo} aria-hidden="true" /><span className={styles.beaconNumber} aria-hidden="true">{index + 1}</span></button>)}
        </div>
        <div className={styles.focusBar} id="ribbon-focus-status" role="status" aria-live="polite" data-focus-phase={focusPhase}>
          {focusActive ? <><div><p>{selectedRibbon?.name ?? "전체 오로라"}</p><span>{!selectedRibbon ? "전체 구도로 돌아가고 있어요."
            : focusPhase === "focused" ? "리본의 빛과 흐름을 가까이 바라보세요." : "리본을 향해 천천히 다가갑니다."}</span></div>
            <button ref={overviewButton} type="button" onClick={backToOverview} disabled={!selectedRibbonId}>전체 오로라로 돌아가기</button></>
            : <p>{pickNotice || "빛나는 선택점을 눌러 리본 속 빛의 흐름을 만나보세요."}</p>}
        </div>
        <div ref={ribbonList} className={styles.ribbonList} role="group" aria-label="리본 탐색" onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0 || !buttons.length) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus();
        }}>
          {ribbons.map(ribbon => <button key={ribbon.ribbonId} type="button" data-ribbon-id={ribbon.ribbonId}
            aria-label={`${ribbon.name} 집중 감상`} aria-pressed={selectedRibbonId === ribbon.ribbonId} disabled={available !== true}
            onClick={() => selectRibbon(ribbon.ribbonId)}>
            <span aria-hidden="true" className={styles.ribbonSwatch} style={{ background: `linear-gradient(120deg, ${ribbon.layers[0].visual.colorA.color}, ${ribbon.layers[0].visual.colorB.color})` }} />
            <span>{ribbon.name}</span><span aria-hidden="true">{selectedRibbonId === ribbon.ribbonId ? "선택됨" : "감상"}</span>
          </button>)}
        </div>
        <details className={styles.settings}><summary>감상 설정</summary><div className={styles.controls}>
          <label>감상 방식<select id="result-camera-mode" value={cameraMode} disabled={available === false || focusActive}
            onChange={event => requestCamera(event.target.value as AuroraCameraMode)}>
            <option value="front">정면 감상</option><option value="free">자유 탐색</option><option value="auto" disabled={effectiveReduced}>느린 자동 공전</option>
          </select></label>
          <button type="button" disabled={available === false || focusActive} onClick={() => requestCamera("front")}>정면으로 돌아오기</button>
          <label>렌더링 품질<select id="result-quality" value={quality} onChange={event => setQuality(event.target.value as AuroraQuality)}>
            <option value="low">저사양</option><option value="balanced">기본</option><option value="high">고화질</option>
          </select></label>
          <label className={styles.motion}><input type="checkbox" checked={effectiveReduced} disabled={reduced}
            onChange={event => setReducedMotion(event.target.checked)} />움직임 줄이기</label>
        </div></details>
        <p className={styles.cameraHint} role="status">{focusActive ? "다른 리본을 골라 이동 · Esc 또는 전체로 돌아가기" : cameraNotice || (effectiveReduced ? "움직임 감소 중 · 자동 공전이 꺼져 있어요."
          : cameraMode === "front" ? "자유 탐색으로 다른 각도의 빛을 바라보세요."
            : cameraMode === "auto" ? "천천히 공전합니다. 직접 조작하면 멈춥니다." : "드래그로 회전 · 휠 또는 두 손가락으로 확대·축소")}</p>
        <nav className={styles.actions} aria-label="결과 화면 작업">
          <button type="button" onClick={onReset}>다시 성찰하기</button>
          <button ref={basicButton} type="button" aria-expanded={analysisMode === "basic"} aria-controls="result-analysis" onClick={() => openAnalysis("basic")}>요약 분석</button>
          <button ref={detailedButton} type="button" aria-expanded={analysisMode === "detailed"} aria-controls="result-analysis" onClick={() => openAnalysis("detailed")}>심층 분석</button>
        </nav>
      </section>
      {selectedRibbon && !analysisMode && <aside className={styles.ribbonMeaning} aria-labelledby="selected-ribbon-title">
        <p className={styles.eyebrow}>INSIDE YOUR LIGHT</p>
        <h2 id="selected-ribbon-title">{selectedRibbon.name}</h2>
        <p className={styles.meaningIntro}>선택한 리본의 한 구간에서, 당신이 남긴 단어와 빛의 흐름을 바라봅니다.</p>
        <div className={styles.composition} aria-label="이 리본의 의미 구성">
          {selectedRibbon.composition.length ? selectedRibbon.composition.map(share => <span key={share.familyId}>{share.label} {Math.round(share.withinPairShare * 100)}%</span>)
            : <span>중립적인 빛</span>}
        </div>
        <p className={styles.scopeNote}>비중은 실제 두 색상에 연결된 의미 구성입니다. 화면에서 차지하는 색 면적이나 성격 점수는 아닙니다.</p>
        <h3>이 빛에 이어진 선택</h3>
        {selectedRibbon.evidence.length ? <ul className={styles.evidence}>{selectedRibbon.evidence.map(evidence => {
          const question = QUESTION_DATA.find(q => q.id === evidence.questionId);
          const fixed = evidence.mapping === "fixed" ? question?.keywords.find(k => k.id === evidence.keywordId)?.label : undefined;
          const labels = evidence.texts.length ? evidence.texts.map(t => t.originalText || t.label).join(" · ") : fixed;
          return <li key={`${evidence.questionId}:${evidence.keywordId}`}><small>{evidence.questionId.toUpperCase()} · {question?.category}</small>
            <p>{labels || "선택 기록의 의미 연결 · 원문을 확인할 수 없어 단어를 추정하지 않습니다."}</p></li>;
        })}</ul> : <p className={styles.scopeNote}>직접 연결된 선택 근거가 없는 중립 표현입니다.</p>}
        <h3>기존 질문 해석 참고</h3>
        <p className={styles.scopeNote}>아래 내용은 해당 문항 전체의 해석입니다. 이 리본만을 위한 분석이나 새 AI 종합문이 아닙니다.</p>
        {selectedRibbon.interpretation.questionAnalyses.map(reference => <details key={reference.questionId} className={styles.reference}>
          <summary>{reference.questionId.toUpperCase()} · {QUESTION_DATA.find(q => q.id === reference.questionId)?.category} 문항 전체 해석</summary>
          <p className={styles.referenceAnswer}>내 답변 · {reference.actualAnswer}</p><p>{reference.analysis}</p>
        </details>)}
        <p className={styles.scopeNote}>모양과 개별 에너지 흐름은 기존 리본 설계와 시드에서 이어집니다. 리본별 심층 종합문은 다음 단계에서 연결합니다.</p>
      </aside>}
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
