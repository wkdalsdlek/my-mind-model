"use client";

import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { NoToneMapping } from "three";
import { advanceAuroraTime, AURORA_DEFAULT_FLOW_MODE, AURORA_DEFAULT_LAYERS, auroraFrameLoop, auroraPaletteColors, auroraQualityBudget, validateAuroraAppearance,
  type AuroraAppearance, type AuroraCameraMode, type AuroraFlowMode, type AuroraLayers, type AuroraPerformanceSample, type AuroraQuality } from "@/lib/aurora-types";
import type { AuroraCameraOptions } from "@/lib/aurora-camera";
import AuroraCameraController from "./AuroraCameraController";
import AuroraRibbons from "./AuroraRibbons";
import NebulaAtmosphere from "./NebulaAtmosphere";
import StardustField from "./StardustField";
import GlassFragments from "./GlassFragments";
import AuroraOptics from "./AuroraOptics";
import AuroraRibbonBeacons from "./AuroraRibbonBeacons";
import AuroraRibbonPointerSelection from "./AuroraRibbonPointerSelection";
import { AuroraRibbonInteraction } from "@/lib/aurora-ribbon-picking";
import type { AuroraRibbonId } from "@/lib/aurora-ribbon-layout";
import type { AuroraRibbonFocusPhase } from "@/lib/aurora-ribbon-focus";
import { useAuroraResourceCleanup } from "./useAuroraResourceCleanup";
import { useAuroraBrowserSignals } from "./useAuroraBrowserSignals";
import styles from "./GlassNebulaAurora.module.css";

/** Standalone visual contract. The owning result screen can later supply color shares
 * and place its approved title alongside this renderer. No questionnaire or API access here. */
export interface GlassNebulaAuroraProps {
  appearance: AuroraAppearance;
  quality?: AuroraQuality;
  layers?: AuroraLayers;
  reducedMotion?: boolean;
  flowMode?: AuroraFlowMode;
  cameraMode?: AuroraCameraMode;
  cameraRevision?: number;
  cameraOptions?: AuroraCameraOptions;
  onCameraModeChange?: (mode: AuroraCameraMode, reason: "interaction" | "reduced-motion") => void;
  onPerformanceSample?: (sample: AuroraPerformanceSample) => void;
  onAvailabilityChange?: (available: boolean) => void;
  selectedRibbonId?: AuroraRibbonId | null;
  selectedRibbonSegment?: number;
  beaconHost?: RefObject<HTMLDivElement | null>;
  onRibbonSelect?: (id: AuroraRibbonId) => void;
  onRibbonPickError?: () => void;
  onRibbonFocusPhaseChange?: (phase: AuroraRibbonFocusPhase) => void;
  onRibbonFocusReturn?: (mode: AuroraCameraMode) => void;
}
class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
const noInteraction = { dispose() {} };
function Scene({ appearance, quality, layers, reducedMotion, flowMode, cameraMode, cameraRevision, cameraOptions, onCameraModeChange, onPerformanceSample, onContextLost,
  selectedRibbonId, selectedRibbonSegment, beaconHost, onRibbonSelect, onRibbonPickError, onRibbonFocusPhaseChange, onRibbonFocusReturn }: Required<Pick<GlassNebulaAuroraProps, "appearance" | "quality" | "layers" | "reducedMotion" | "flowMode" | "cameraMode" | "cameraRevision">>
  & Pick<GlassNebulaAuroraProps, "selectedRibbonSegment" | "beaconHost" | "onPerformanceSample" | "cameraOptions" | "onCameraModeChange" | "selectedRibbonId" | "onRibbonSelect" | "onRibbonPickError" | "onRibbonFocusPhaseChange" | "onRibbonFocusReturn"> & { onContextLost: () => void }) {
  const { visible } = useAuroraBrowserSignals();
  const budget = useMemo(() => auroraQualityBudget(quality), [quality]);
  const time = useRef(8.3);
  const statistics = useRef({ frames: 0, elapsed: 0 });
  const getRendererState = useThree(state => state.get);
  const interaction = useMemo(() => onRibbonSelect ? new AuroraRibbonInteraction() : null, [onRibbonSelect]);
  useAuroraResourceCleanup(interaction ?? noInteraction);
  useLayoutEffect(() => {
    if (interaction && selectedRibbonId) interaction.segmentU.set(selectedRibbonId,
      Number.isFinite(selectedRibbonSegment) ? Math.max(.001, Math.min(.999, selectedRibbonSegment!)) : .2);
  }, [interaction, selectedRibbonId, selectedRibbonSegment]);
  useLayoutEffect(() => {
    const renderer = getRendererState().gl;
    const canvas = renderer.domElement;
    const previousShaderError = renderer.debug.onShaderError;
    renderer.debug.onShaderError = onContextLost;
    const lost = (event: Event) => { event.preventDefault(); onContextLost(); };
    canvas.addEventListener("webglcontextlost", lost);
    return () => { canvas.removeEventListener("webglcontextlost", lost); renderer.debug.onShaderError = previousShaderError; };
  }, [getRendererState, onContextLost]);
  useLayoutEffect(() => { statistics.current.frames = 0; statistics.current.elapsed = 0; }, [visible, reducedMotion]);
  useFrame((_, delta) => {
    time.current = advanceAuroraTime(time.current, delta, !reducedMotion);
    if (!reducedMotion && Number.isFinite(delta) && delta > 0 && delta < 1) {
      statistics.current.frames++; statistics.current.elapsed += delta;
      if (statistics.current.elapsed >= 1.2) {
        onPerformanceSample?.({ fps: statistics.current.frames / statistics.current.elapsed, frameMs: statistics.current.elapsed * 1000 / statistics.current.frames });
        statistics.current.frames = 0; statistics.current.elapsed = 0;
      }
    }
  }, -10);
  return <>
    <color attach="background" args={["#080d23"]} />
    <group>
      {layers.nebula && <NebulaAtmosphere appearance={appearance} time={time} count={budget.nebulaLayers} />}
      {layers.ribbons && <AuroraRibbons appearance={appearance} time={time} budget={budget} flowMode={flowMode} reducedMotion={reducedMotion}
        interaction={interaction} selectedRibbonId={selectedRibbonId} />}
      {layers.stardust && <StardustField appearance={appearance} time={time} budget={budget} />}
      {layers.glass && <GlassFragments appearance={appearance} time={time} count={budget.fragments} />}
    </group>
    <AuroraCameraController mode={cameraMode} revision={cameraRevision} options={cameraOptions} reducedMotion={reducedMotion}
      visible={visible} ribbonCount={appearance.ribbonCount} onModeChange={onCameraModeChange} interaction={interaction}
      selectedRibbonId={selectedRibbonId} onFocusPhaseChange={onRibbonFocusPhaseChange} onFocusReturn={onRibbonFocusReturn} />
    {interaction && onRibbonSelect && layers.ribbons && <AuroraRibbonPointerSelection interaction={interaction} mode={cameraMode} onSelect={onRibbonSelect} onError={onRibbonPickError} />}
    {interaction && beaconHost && <AuroraRibbonBeacons interaction={interaction} host={beaconHost} hidden={!!selectedRibbonId} />}
    <AuroraOptics quality={quality} bloom={layers.bloom} bloomHeight={budget.bloomHeight} />
  </>;
}
function Fallback({ appearance, checking, onRetry }: { appearance: AuroraAppearance; checking: boolean; onRetry: () => void }) {
  const colors = auroraPaletteColors(appearance.palette);
  return <div className={styles.fallback} role="status">
    <div className={styles.fallbackArtwork} aria-hidden="true">
      {colors.slice(0, 4).map((color, i) => <span key={i} style={{ borderColor: color, transform: `translateY(${i * 26}px) rotate(${-18 + i * 14}deg)` }} />)}
    </div>
    <div className={styles.fallbackMessage}><p>{checking ? "빛의 공간을 준비하고 있어요" : "이 기기에서는 정적인 빛의 모습을 보여드려요"}</p>
      <span>{checking ? "그래픽 지원 확인 중" : "WebGL 2 미지원 또는 그래픽 연결이 중단되었습니다."}</span>
      {!checking && <button type="button" onClick={onRetry}>그래픽 다시 확인</button>}
    </div>
  </div>;
}
export default function GlassNebulaAurora({ appearance, quality = "balanced", layers = AURORA_DEFAULT_LAYERS, reducedMotion = false, flowMode = AURORA_DEFAULT_FLOW_MODE,
  cameraMode = "front", cameraRevision = 0, cameraOptions, onCameraModeChange, onPerformanceSample, onAvailabilityChange,
  selectedRibbonId = null, selectedRibbonSegment, beaconHost, onRibbonSelect, onRibbonPickError, onRibbonFocusPhaseChange, onRibbonFocusReturn }: GlassNebulaAuroraProps) {
  const { reduced, visible } = useAuroraBrowserSignals();
  const effectiveReduced = reducedMotion || reduced;
  const budget = useMemo(() => auroraQualityBudget(quality), [quality]);
  const errors = useMemo(() => validateAuroraAppearance(appearance), [appearance]);
  const camera = useMemo(() => ({ position: [0, 0.4, 17] as [number, number, number], fov: 43, near: 0.1, far: 400 }), []);
  const pixelRatio = useMemo<[number, number]>(() => [1, budget.dpr], [budget.dpr]);
  const rendererOptions = useMemo(() => ({ antialias: false, alpha: false, powerPreference: "high-performance" as const, toneMapping: NoToneMapping }), []);
  const [support, setSupport] = useState<"checking" | "supported" | "unavailable">("checking");
  const [attempt, setAttempt] = useState(0);
  const handleContextLost = useCallback(() => { setSupport("unavailable"); onAvailabilityChange?.(false); }, [onAvailabilityChange]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      let available = false;
      try {
        const probe = document.createElement("canvas");
        const context = probe.getContext("webgl2", { failIfMajorPerformanceCaveat: false });
        available = !!context;
        context?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch { available = false; }
      setSupport(available ? "supported" : "unavailable");
      onAvailabilityChange?.(available);
    });
    return () => cancelAnimationFrame(frame);
  }, [attempt, onAvailabilityChange]);
  const retry = () => { setSupport("checking"); setAttempt(value => value + 1); };
  const fallback = <Fallback appearance={appearance} checking={support === "checking"} onRetry={retry} />;
  if (errors.length) return <div className={styles.invalid} role="alert">표현 설정을 확인해 주세요. {errors.join(" ")}</div>;
  return <div className={styles.stage} aria-label={onRibbonSelect ? "개인화 오로라 3D 우주 공간" : "독립 Glass Nebula Aurora 3D 실험 장면"}>
    {support === "supported" ? <SceneBoundary key={attempt} onFailure={handleContextLost} fallback={<Fallback appearance={appearance} checking={false} onRetry={retry} />}>
      <Canvas key={attempt} camera={camera}
        dpr={pixelRatio} frameloop={auroraFrameLoop(visible, effectiveReduced)} fallback={fallback}
        gl={rendererOptions}>
        <Scene appearance={appearance} quality={quality} layers={layers} reducedMotion={effectiveReduced} flowMode={flowMode}
          cameraMode={cameraMode} cameraRevision={cameraRevision} cameraOptions={cameraOptions} onCameraModeChange={onCameraModeChange}
          selectedRibbonId={selectedRibbonId} selectedRibbonSegment={selectedRibbonSegment} beaconHost={beaconHost} onRibbonSelect={onRibbonSelect} onRibbonPickError={onRibbonPickError}
          onRibbonFocusPhaseChange={onRibbonFocusPhaseChange} onRibbonFocusReturn={onRibbonFocusReturn}
          onPerformanceSample={onPerformanceSample} onContextLost={handleContextLost} />
      </Canvas>
    </SceneBoundary> : fallback}
  </div>;
}
