"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GlassNebulaAurora from "@/components/aurora/GlassNebulaAurora";
import { useAuroraBrowserSignals } from "@/components/aurora/useAuroraBrowserSignals";
import type { AuroraCameraMode, AuroraQuality } from "@/lib/aurora-types";
import { universeRibbonLayout, type AuroraUniverseResult } from "@/lib/aurora-universe";
import { isVerifiedPhilosophyQuote } from "@/lib/philosophy-quotes";
import { QUESTION_DATA } from "@/lib/question-data";
import type { AuroraRibbonId } from "@/lib/aurora-ribbon-layout";
import type { AuroraRibbonFocusPhase } from "@/lib/aurora-ribbon-focus";
import styles from "./AuroraResultScreen.module.css";

export default function AuroraResultScreen({ result, onReset, onRetryInterpretation, onCancelInterpretation, onReviewClosing, busy = false, requestError = "" }: {
  result: AuroraUniverseResult; onReset: () => void; onRetryInterpretation?: () => void; onCancelInterpretation?: () => void; onReviewClosing?: () => void; busy?: boolean; requestError?: string;
}) {
  const { personalization } = result.snapshot;
  const interpretation = result.interpretation;
  const line = interpretation?.generated.philosophy.line;
  const quote = line && isVerifiedPhilosophyQuote(line) ? line : null;
  const [quality, setQuality] = useState<AuroraQuality>(result.context.binding.quality);
  const [cameraMode, setCameraMode] = useState<AuroraCameraMode>("front");
  const [cameraRevision, setCameraRevision] = useState(0);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [cameraNotice, setCameraNotice] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [selectedRibbonId, setSelectedRibbonId] = useState<AuroraRibbonId | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<number | undefined>(undefined);
  const beaconHost = useRef<HTMLDivElement>(null);
  const [focusPhase, setFocusPhase] = useState<AuroraRibbonFocusPhase>("overview");
  const [pickNotice, setPickNotice] = useState("");
  const ribbonList = useRef<HTMLDivElement>(null), returnFocus = useRef<AuroraRibbonId | null>(null);
  const overviewButton = useRef<HTMLButtonElement>(null), focusOverviewButton = useRef(false);
  const ribbons = useMemo(() => universeRibbonLayout(result, quality) ?? [], [result, quality]);
  const selectedRibbon = ribbons.find(r => r.ribbonId === selectedRibbonId);
  const selectedInterpretation = interpretation?.generated.ribbons.find(r => r.ribbonId === selectedRibbonId);
  const focusActive = !!selectedRibbon || focusPhase !== "overview";
  const { reduced } = useAuroraBrowserSignals();
  const effectiveReduced = reducedMotion || reduced;
  const heading = useRef<HTMLHeadingElement>(null), panelHeading = useRef<HTMLHeadingElement>(null);
  const analysisButton = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null), restoreAnalysisFocus = useRef(false);
  const meaningPanel = useRef<HTMLElement>(null);
  useEffect(() => { if (meaningPanel.current) meaningPanel.current.scrollTop = 0; }, [selectedRibbonId]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (analysisOpen) panelHeading.current?.focus({ preventScroll: true });
    else if (restoreAnalysisFocus.current) { restoreAnalysisFocus.current = false; analysisButton.current?.focus({ preventScroll: true }); }
  }, [analysisOpen]);
  const onAvailabilityChange = useCallback((supported: boolean) => {
    setAvailable(supported);
    if (!supported) { setCameraMode("front"); setSelectedRibbonId(null); setFocusPhase("overview"); }
  }, []);
  const selectRibbon = useCallback((id: AuroraRibbonId) => {
    if (!result.context.facts.ribbons.some(r => r.ribbonId === id)) return;
    focusOverviewButton.current = !ribbonList.current?.contains(document.activeElement);
    returnFocus.current = null; setSelectedSegment(undefined); setSelectedRibbonId(id); setPickNotice(""); setAnalysisOpen(false);
  }, [result.context]);
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
  const closeAnalysis = () => { restoreAnalysisFocus.current = true; setAnalysisOpen(false); };
  const changeQuality = (value: AuroraQuality) => {
    if (universeRibbonLayout(result, value)) { setQuality(value); setPickNotice(""); }
    else setPickNotice("현재 해석과 리본 구성을 유지하기 위해 이 품질 변경을 적용하지 않았어요.");
  };
  const fallback = personalization.trace.visualFallback;
  return <main className={`${styles.result} ${focusActive ? styles.immersed : ""}`} data-experience={focusActive ? "macro" : "universe"} data-reading={analysisOpen} onKeyDown={event => {
      if (event.key === "Escape" && focusActive && !analysisOpen) { event.preventDefault(); backToOverview(); }
    }} aria-labelledby="aurora-result-title">
    <header className={styles.header} inert={analysisOpen}>
      <p className={styles.brand}><span aria-hidden="true">✦</span> MY MIND MODEL <span>내면의 조각들</span></p>
      <p className={styles.eyebrow}>YOUR GLASS NEBULA AURORA</p>
      <h1 ref={heading} tabIndex={-1} id="aurora-result-title">{interpretation?.generated.auroraName ?? "나의 오로라"}</h1>
      {quote && interpretation ? <figure className={styles.philosophy}>
        <blockquote cite={quote.source.url} className={styles.quote}>{quote.text}</blockquote>
        <figcaption><span>{quote.philosopher}{quote.source.attributionNote.includes("플라톤") ? " · 플라톤의 말을 전하며" : ""}</span>
          <details className={styles.quoteSource}><summary>출처와 번역</summary><div>
            <a href={quote.source.url} target="_blank" rel="noopener noreferrer" aria-label={`${quote.philosopher} ${quote.source.work} ${quote.source.locator} 원문 출처`}>{quote.source.work} · {quote.source.locator} 원문 ↗</a>
            <p lang="la" className={styles.originalQuote}>{quote.originalText}</p><p>{quote.source.attributionNote}</p><p>{quote.translation.note}</p>
          </div></details>
        </figcaption>
        <p className={styles.quoteReason} tabIndex={0} aria-label="철학자 문장 선정 이유">{interpretation.generated.philosophy.reason.join(" ")}</p>
      </figure> : <div className={styles.quoteFallback}>
        <p className={styles.fallbackLabel}>내가 승인한 마지막 문장</p><p className={styles.ownSentence}>{personalization.approvedTitle.text}</p>
        <p>어울리는 검증된 철학자 문구를 찾지 못했어요. 지금은 승인한 문장과 오로라를 먼저 감상해요.</p>
        <div>{onRetryInterpretation && <button type="button" disabled={busy} onClick={onRetryInterpretation}>{busy ? "해석을 다시 읽고 있어요…" : "해석 다시 요청하기"}</button>}
          {onReviewClosing && <button type="button" disabled={busy} onClick={onReviewClosing}>마지막 문장 살펴보기</button>}
          {busy && onCancelInterpretation && <button type="button" onClick={onCancelInterpretation}>요청 취소</button>}</div>
        {busy && <p role="status">해석을 새로 요청하고 있어요.</p>}{requestError && <p role="alert">{requestError}</p>}
      </div>}
      <p className={styles.subtitle}>{fallback === "neutral-palette" ? "선택한 표현만으로 색을 정하기 어려워, 중립적인 빛으로 보여드려요."
        : fallback === "neutral-accent" ? "당신이 남긴 단어에, 빛의 조화를 위한 중립적인 보조색을 더했어요."
          : "당신이 남긴 단어들이 빛의 흐름으로 이어집니다."}</p>
    </header>
    <div className={`${styles.content} ${analysisOpen ? styles.withAnalysis : ""}`}>
      <section className={styles.viewer} aria-label="개인화 오로라 감상" inert={analysisOpen}>
        <div className={styles.stage}>
          <GlassNebulaAurora appearance={personalization.appearance} quality={quality} flowMode={result.context.binding.flowMode} reducedMotion={reducedMotion}
            cameraMode={cameraMode} cameraRevision={cameraRevision} onCameraModeChange={onCameraModeChange} onAvailabilityChange={onAvailabilityChange}
            selectedRibbonId={selectedRibbonId} selectedRibbonSegment={selectedSegment} beaconHost={beaconHost} onRibbonSelect={selectRibbon} onRibbonPickError={onPickError}
            onRibbonFocusPhaseChange={onFocusPhaseChange} onRibbonFocusReturn={onFocusReturn} />
        </div>
        <div ref={beaconHost} className={styles.beacons} hidden={focusActive || analysisOpen || available !== true} role="group" aria-label="리본 빛 선택점">
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
          <label>렌더링 품질<select id="result-quality" value={quality} onChange={event => changeQuality(event.target.value as AuroraQuality)}>
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
          <button ref={analysisButton} type="button" disabled={!interpretation} aria-expanded={analysisOpen} aria-controls="result-analysis" onClick={() => setAnalysisOpen(true)}>나의 오로라 읽기</button>
        </nav>
      </section>
      {selectedRibbon && !analysisOpen && <aside ref={meaningPanel} className={styles.ribbonMeaning} aria-labelledby="selected-ribbon-title">
        <p className={styles.eyebrow}>INSIDE YOUR LIGHT</p>
        <h2 id="selected-ribbon-title">{selectedRibbon.name}</h2>
        <p className={styles.meaningIntro}>선택한 리본의 한 구간에서, 당신이 남긴 단어와 빛의 흐름을 바라봅니다.</p>
        <div className={styles.composition} aria-label="이 리본의 의미 구성">
          {selectedRibbon.composition.length ? selectedRibbon.composition.map(share => <span key={share.familyId}>{share.label} {Math.round(share.withinPairShare * 100)}%</span>)
            : <span>중립적인 빛</span>}
        </div>
        <p className={styles.scopeNote}>비중은 실제 두 색상에 연결된 의미 구성입니다. 화면에서 차지하는 색 면적이나 성격 점수는 아닙니다.</p>
        <h3>이 빛을 만든 나의 선택</h3>
        {selectedRibbon.evidence.length ? <ul className={styles.evidence}>{selectedRibbon.evidence.map(evidence => {
          const question = QUESTION_DATA.find(q => q.id === evidence.questionId);
          return <li key={evidence.ref}><small>{evidence.questionId.toUpperCase()} · {question?.category}</small>
            <p>{evidence.originalText}</p><small>{question?.prompt}</small></li>;
        })}</ul> : <p className={styles.scopeNote}>직접 연결된 핵심 답변 근거가 없는 중립 표현입니다.</p>}
        <h3>이 리본이 말하는 마음</h3>
        <p className={styles.interpretationText}>{selectedInterpretation?.psychological.text ?? "아직 이 리본의 해석을 만들지 못했어요. 실제로 남긴 선택과 빛을 먼저 바라볼 수 있어요."}</p>
        <h3>철학적 시선</h3>
        <p className={styles.interpretationText}>{selectedInterpretation?.philosophical.text ?? "검증된 문구와 연결된 해석을 준비하지 못해 철학적 의미를 임의로 붙이지 않습니다."}</p>
        <h3>빛으로 표현된 방식</h3>
        <p className={styles.interpretationText}>{selectedRibbon.visualExplanationText.semantic.replace("composition과 paletteOrigins", "의미 구성과 색의 출처").replace("coreShares", "핵심 의미 비중")}</p>
        <p className={styles.scopeNote}>{selectedRibbon.visualExplanationText.artistic.replace("기존 렌더러 슬롯", "기존 리본 설계")}</p>
        <p className={styles.scopeNote}>{selectedRibbon.visualExplanationText.limitations.replace("현재 렌더러에 직접 적용되지 않습니다", "현재 빛에 직접 적용된 특수 효과를 뜻하지 않습니다")}</p>
        {selectedInterpretation && <div className={styles.reflection}><h3>나에게 남기는 질문</h3><p>{selectedInterpretation.reflectionQuestion}</p></div>}
      </aside>}
      {analysisOpen && interpretation && <aside ref={panel} id="result-analysis" className={styles.analysis} role="dialog" aria-modal="true" aria-labelledby="result-analysis-heading"
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeAnalysis(); }
          if (event.key === "Tab") {
            const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]') ?? []);
            const first = nodes[0], last = nodes[nodes.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panelHeading.current)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <div className={styles.analysisHeader}>
          <h2 ref={panelHeading} id="result-analysis-heading" tabIndex={-1}>나의 오로라 읽기</h2>
          <button type="button" aria-label="오로라 해석 닫기" onClick={closeAnalysis}>닫기</button>
        </div>
        <p className={styles.readingIntro}>이 해석은 당신이 남긴 표현을 돌아보는 하나의 시선입니다. 당신을 고정된 성격으로 정의하지 않습니다.</p>
        <p className={styles.overallText}>{interpretation.generated.overall.text}</p>
        <div className={styles.approvedReference}><h3>내가 승인한 마지막 문장</h3><p>{personalization.approvedTitle.text}</p></div>
      </aside>}
    </div>
  </main>;
}
