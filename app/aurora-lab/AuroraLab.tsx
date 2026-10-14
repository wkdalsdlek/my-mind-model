"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import GlassNebulaAurora from "@/components/aurora/GlassNebulaAurora";
import { useAuroraBrowserSignals } from "@/components/aurora/useAuroraBrowserSignals";
import { AURORA_PRESETS } from "@/lib/aurora-presets";
import { AURORA_DEFAULT_FLOW_MODE, AURORA_DEFAULT_LAYERS, auroraFlowBudget, auroraPaletteColors, auroraQualityBudget, type AuroraCameraMode, type AuroraFlowMode, type AuroraLayers, type AuroraPerformanceSample, type AuroraQuality, type AuroraRibbonCount } from "@/lib/aurora-types";
import { SEMANTIC_FAMILIES } from "@/lib/semantic-families";
import { AURORA_CAMERA_DEFAULTS } from "@/lib/aurora-camera";
import styles from "./AuroraLab.module.css";

const layerLabels: Record<keyof AuroraLayers, string> = { nebula: "성운 안개", ribbons: "오로라 리본", glass: "유리 조각", stardust: "별과 은하수", bloom: "부드러운 발광" };
const cameraLabels: Record<AuroraCameraMode, string> = { front: "정면 감상", free: "자유 탐색", auto: "느린 자동 공전" };
export default function AuroraLab() {
  const [presetId, setPresetId] = useState("serenity");
  const [quality, setQuality] = useState<AuroraQuality>("balanced");
  const [count, setCount] = useState<AuroraRibbonCount>(3);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dynamicMotion, setDynamicMotion] = useState(false);
  const [flowMode, setFlowMode] = useState<AuroraFlowMode>(AURORA_DEFAULT_FLOW_MODE);
  const [cameraMode, setCameraMode] = useState<AuroraCameraMode>("front");
  const [cameraRevision, setCameraRevision] = useState(0);
  const [cameraInterruption, setCameraInterruption] = useState<"interaction" | "reduced-motion" | null>(null);
  const [layers, setLayers] = useState<AuroraLayers>({ ...AURORA_DEFAULT_LAYERS });
  const [panelOpen, setPanelOpen] = useState(true);
  const [performance, setPerformance] = useState<AuroraPerformanceSample | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const { compact, reduced, visible } = useAuroraBrowserSignals();
  const preset = AURORA_PRESETS.find(item => item.id === presetId)!;
  const appearance = useMemo(() => ({ palette: preset.palette, motion: { ...preset.motion, intensity: dynamicMotion ? 1.35 : 1 }, ribbonCount: count }), [preset, count, dynamicMotion]);
  const colors = auroraPaletteColors(appearance.palette);
  const budget = useMemo(() => auroraQualityBudget(quality), [quality]);
  const loopCount = auroraFlowBudget(flowMode, budget).loopCount;
  const onPerformanceSample = useCallback((sample: AuroraPerformanceSample) => setPerformance(sample), []);
  const onAvailabilityChange = useCallback((supported: boolean) => { setAvailable(supported); if (!supported) setCameraMode("front"); }, []);
  const onCameraModeChange = useCallback((mode: AuroraCameraMode, reason: "interaction" | "reduced-motion") => {
    setCameraMode(mode); setCameraInterruption(reason);
  }, []);
  const requestCamera = (mode: AuroraCameraMode) => { setCameraMode(mode); setCameraRevision(value => value + 1); setCameraInterruption(null); };
  const effectiveReduced = reducedMotion || reduced;
  return <main className={styles.lab}>
    <GlassNebulaAurora appearance={appearance} quality={quality} layers={layers} reducedMotion={reducedMotion} flowMode={flowMode}
      cameraMode={cameraMode} cameraRevision={cameraRevision} onCameraModeChange={onCameraModeChange}
      onPerformanceSample={onPerformanceSample} onAvailabilityChange={onAvailabilityChange} />
    <div className={styles.vignette} aria-hidden="true" />
    <header className={styles.header}>
      <Link href="/" className={styles.brand}><span aria-hidden="true">✦</span><span>MY MIND MODEL<small>내면의 조각들</small></span></Link>
      <div className={styles.headerRight}><span className={styles.prototype}>04 · AURORA LAB</span><Link href="/">질문으로 돌아가기 <span aria-hidden="true">↗</span></Link></div>
    </header>
    <div className={styles.introduction}>
      <p className={styles.eyebrow}>GLASS NEBULA AURORA</p>
      <h1>빛이 머무는<br /><em>마음의 우주.</em></h1>
      <p className={styles.description}>서로 다른 깊이의 빛을 천천히 바라보세요.<br />유리 같은 물결 너머로, 또 다른 색이 흐릅니다.</p>
    </div>
    <aside className={styles.panel} aria-label="오로라 실험 조작 패널">
      <div className={styles.panelHeader}><div><span>LIGHT STUDY</span><h2>빛의 조합</h2></div>
        <button className={styles.collapse} type="button" aria-expanded={panelOpen} aria-controls="aurora-controls" onClick={() => setPanelOpen(value => !value)} aria-label={panelOpen ? "조작 패널 접기" : "조작 패널 펼치기"}>{panelOpen ? "−" : "+"}</button>
      </div>
      {panelOpen && <div id="aurora-controls" className={styles.panelContent}>
        <details className={styles.cameraSection} open>
          <summary>카메라 감상 <span>{cameraLabels[cameraMode]}</span></summary>
          <div className={styles.selectRow}><label htmlFor="aurora-camera-mode">감상 방식</label><select id="aurora-camera-mode" value={cameraMode} disabled={available === false}
            onChange={event => requestCamera(event.target.value as AuroraCameraMode)}>
            <option value="front">정면 감상</option><option value="free">자유 탐색</option><option value="auto" disabled={effectiveReduced}>느린 자동 공전</option>
          </select></div>
          <button type="button" id="aurora-camera-front" className={styles.returnFront} disabled={available === false} onClick={() => requestCamera("front")}>정면으로 돌아오기 <span aria-hidden="true">↺</span></button>
          <p className={styles.cameraStatus} role="status">{cameraInterruption === "interaction" ? "직접 조작으로 자동 공전을 멈췄어요. 다시 선택하면 이어서 감상합니다." : cameraInterruption === "reduced-motion" ? "움직임 감소에 따라 자동 공전을 멈췄어요." : cameraMode === "auto" ? `자동 공전 켜짐 · 한 바퀴 약 ${AURORA_CAMERA_DEFAULTS.autoOrbitSeconds}초` : `자동 공전 꺼짐 · ${cameraLabels[cameraMode]}`}</p>
          <p className={styles.cameraHint}>{cameraMode === "front" ? "자유 탐색을 선택하면 측면과 후면을 둘러볼 수 있어요." : "드래그로 회전 · 휠 또는 두 손가락 핀치로 확대·축소"}{effectiveReduced && <span>움직임 감소 중에는 자동 공전을 사용하지 않습니다.</span>}</p>
        </details>
        <fieldset className={styles.presetField}><legend>테스트 프리셋</legend><div className={styles.presetGrid}>
          {AURORA_PRESETS.map(item => <button key={item.id} type="button" className={`${styles.preset} ${presetId === item.id ? styles.activePreset : ""}`} aria-pressed={presetId === item.id}
            onClick={() => { setPresetId(item.id); setCount(item.ribbonCount); setPerformance(null); }}>
            <span className={styles.swatches} aria-hidden="true">{auroraPaletteColors(item.palette).map(color => <i key={color} style={{ backgroundColor: color }} />)}</span><span>{item.name}</span>
          </button>)}
        </div></fieldset>
        <p className={styles.presetDescription}>{preset.description}</p>
        <div className={styles.colorShares}>{appearance.palette.map((share, i) => <span key={share.familyId}><i style={{ backgroundColor: colors[i] }} aria-hidden="true" />{SEMANTIC_FAMILIES.find(f => f.id === share.familyId)!.label} {Math.round(share.weight * 100)}%</span>)}</div>
        <div className={styles.selectRow}><label htmlFor="aurora-quality">렌더링 품질</label><select id="aurora-quality" value={quality} onChange={event => { setQuality(event.target.value as AuroraQuality); setPerformance(null); }}>
          <option value="low">저사양</option><option value="balanced">기본</option><option value="high">고화질</option>
        </select></div>
        <div className={styles.selectRow}><label htmlFor="aurora-count">독립 리본 수</label><select id="aurora-count" value={count} onChange={event => { setCount(Number(event.target.value) as AuroraRibbonCount); setPerformance(null); }}>
          <option value={2}>2개</option><option value={3}>3개</option><option value={4}>4개</option>
        </select></div>
        <div className={styles.selectRow}><label htmlFor="aurora-flow-mode">흐름 모드</label><select id="aurora-flow-mode" value={flowMode} onChange={event => { setFlowMode(event.target.value as AuroraFlowMode); setPerformance(null); }}>
          <option value="independent">Independent</option><option value="hybrid">Hybrid Flow</option><option value="loop-emphasis">Loop Emphasis</option>
        </select></div>
        <div className={styles.selectRow}><label htmlFor="aurora-motion">움직임 강도</label><select id="aurora-motion" value={dynamicMotion ? "dynamic" : "basic"} onChange={event => { setDynamicMotion(event.target.value === "dynamic"); setPerformance(null); }}>
          <option value="basic">기본 · 부드러운 공전</option><option value="dynamic">역동적 · 비교용</option>
        </select></div>
        <label className={styles.toggle}><span>움직임 감소{reduced && <small>시스템 설정 적용</small>}</span><input type="checkbox" checked={effectiveReduced} disabled={reduced} onChange={event => { setReducedMotion(event.target.checked); setPerformance(null); }} /></label>
        <fieldset className={styles.layers}><legend>공간 레이어</legend>{(Object.keys(layerLabels) as (keyof AuroraLayers)[]).map(layer => <label key={layer} className={styles.layer}>
          <span>{layerLabels[layer]}</span><input type="checkbox" checked={layers[layer]} onChange={event => { setLayers(current => ({ ...current, [layer]: event.target.checked })); setPerformance(null); }} />
        </label>)}</fieldset>
        <div className={styles.diagnostics} aria-live="polite">
          <span>{available === null ? "그래픽 확인 중" : available ? "WebGL 2" : "정적 대체 화면"}{compact ? " · 모바일 구도" : " · 데스크톱 구도"}</span>
          <strong>{available === false ? "정적인 빛" : !visible ? "비활성 · 렌더링 중지" : effectiveReduced ? "움직임 감소 · 정적 보기" : performance ? `${Math.round(performance.fps)} FPS · ${performance.frameMs.toFixed(1)} ms` : "프레임 측정 대기"}</strong>
          <span>독립 {layers.ribbons ? count : 0} · 루프 {layers.ribbons ? loopCount : 0} · 입자 {layers.stardust ? budget.stars + budget.dust : 0} · 유리 {layers.glass ? budget.fragments : 0} · DPR ≤ {budget.dpr}</span>
          <small>FPS는 최근 활성 프레임의 평균입니다. 품질은 기기 종류와 관계없이 선택값을 유지합니다.</small>
        </div>
        <p className={styles.labNote}>정적 테스트 색상만 사용하는 독립 실험 공간입니다. 실제 답변이나 AI 분석은 연결하지 않았어요.</p>
      </div>}
    </aside>
    <footer className={styles.footer}><div><span className={styles.presetNumber}>0{AURORA_PRESETS.indexOf(preset) + 1}</span><div><strong>{preset.name}</strong><p>{preset.description}</p></div></div><span className={styles.gesture}>{cameraMode === "front" ? "정면 감상 · 자유 탐색으로 깊이 살펴보기" : cameraMode === "auto" ? "느린 자동 공전 · 직접 조작하면 멈춥니다" : "드래그로 회전 · 휠로 확대·축소"} <span aria-hidden="true">↔</span></span></footer>
  </main>;
}
