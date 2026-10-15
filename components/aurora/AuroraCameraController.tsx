"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MathUtils, PerspectiveCamera } from "three";
import { OrbitControls } from "three-stdlib";
import { advanceAuroraCamera, AURORA_CAMERA_POLAR_LIMITS, AURORA_CAMERA_TARGET, auroraCameraFraming, auroraCameraOptions,
  createAuroraCameraState, interruptAuroraAutoOrbit, readAuroraCameraOrbit, requestAuroraCameraMode, resolveAuroraCameraMode,
  writeAuroraCameraPosition, type AuroraCameraOptions } from "@/lib/aurora-camera";
import type { AuroraCameraMode, AuroraRibbonCount } from "@/lib/aurora-types";
import type { AuroraRibbonId } from "@/lib/aurora-ribbon-layout";
import type { AuroraRibbonInteraction } from "@/lib/aurora-ribbon-picking";
import { AuroraRibbonFocusCamera } from "@/lib/aurora-ribbon-focus-camera";
import type { AuroraRibbonFocusPhase } from "@/lib/aurora-ribbon-focus";

export interface AuroraCameraControllerProps {
  mode: AuroraCameraMode; revision: number; reducedMotion: boolean; visible: boolean;
  options?: AuroraCameraOptions;
  ribbonCount: AuroraRibbonCount;
  onModeChange?: (mode: AuroraCameraMode, reason: "interaction" | "reduced-motion") => void;
  selectedRibbonId?: AuroraRibbonId | null;
  interaction?: AuroraRibbonInteraction | null;
  onFocusPhaseChange?: (phase: AuroraRibbonFocusPhase) => void;
  onFocusReturn?: (mode: AuroraCameraMode) => void;
}
/** Sole camera owner: manual OrbitControls OR spherical return/auto, never two frame drivers. */
export default function AuroraCameraController({ mode, revision, reducedMotion, visible, options, ribbonCount, onModeChange,
  selectedRibbonId = null, interaction, onFocusPhaseChange, onFocusReturn }: AuroraCameraControllerProps) {
  const getRendererState = useThree(state => state.get), size = useThree(state => state.size);
  const invalidate = useThree(state => state.invalidate);
  const framing = useMemo(() => auroraCameraFraming(size.width, size.height, ribbonCount), [size.width, size.height, ribbonCount]);
  const config = useMemo(() => auroraCameraOptions(options), [options]);
  const controls = useRef<OrbitControls | null>(null), motion = useRef(createAuroraCameraState());
  const position = useRef<[number, number, number]>([0, 0.4, 17]);
  const lifecycle = useRef({ initialized: false, revision: -1, reduced: reducedMotion, interacting: false });
  const focus = useRef(new AuroraRibbonFocusCamera()), reportedPhase = useRef<AuroraRibbonFocusPhase>("overview");
  const latest = useRef({ reducedMotion, visible, onModeChange, onFocusPhaseChange, onFocusReturn });
  useLayoutEffect(() => {
    latest.current = { reducedMotion, visible, onModeChange, onFocusPhaseChange, onFocusReturn };
    if (!visible) motion.current.velocity = 0;
  }, [reducedMotion, visible, onModeChange, onFocusPhaseChange, onFocusReturn]);
  const readPosition = useCallback(() => {
    getRendererState().camera.position.toArray(position.current);
    readAuroraCameraOrbit(position.current, motion.current.orbit);
  }, [getRendererState]);
  const installControls = useCallback(() => {
    controls.current?.dispose();
    const { camera, gl } = getRendererState();
    const orbit = new OrbitControls(camera);
    orbit.target.set(...AURORA_CAMERA_TARGET);
    orbit.enablePan = false; orbit.autoRotate = false; orbit.enableDamping = false;
    orbit.rotateSpeed = 0.38; orbit.zoomSpeed = 0.65;
    orbit.minAzimuthAngle = -Infinity; orbit.maxAzimuthAngle = Infinity;
    [orbit.minPolarAngle, orbit.maxPolarAngle] = AURORA_CAMERA_POLAR_LIMITS;
    orbit.update(); orbit.connect(gl.domElement);
    orbit.addEventListener("change", () => invalidate());
    orbit.addEventListener("start", () => {
      lifecycle.current.interacting = true;
      if (interruptAuroraAutoOrbit(motion.current)) {
        orbit.enableDamping = !latest.current.reducedMotion;
        latest.current.onModeChange?.("free", "interaction");
      }
    });
    orbit.addEventListener("end", () => { lifecycle.current.interacting = false; });
    controls.current = orbit;
  }, [getRendererState, invalidate]);
  useLayoutEffect(() => () => { controls.current?.dispose(); controls.current = null; }, [getRendererState]);
  useLayoutEffect(() => {
    const { camera, gl } = getRendererState();
    const owner = lifecycle.current, state = motion.current;
    if (owner.initialized && (selectedRibbonId || focus.current.engaged)) {
      if (camera instanceof PerspectiveCamera) { camera.aspect = size.width / Math.max(1, size.height); camera.updateProjectionMatrix(); }
      invalidate(); return;
    }
    // Explicit requests clear old inertia; an auto-to-manual pointer event keeps its active controls.
    const fresh = !controls.current || owner.revision !== revision || (owner.reduced !== reducedMotion && !owner.interacting);
    if (fresh) installControls();
    const orbit = controls.current!;
    const effective = resolveAuroraCameraMode(mode, reducedMotion);
    readPosition();
    const first = !owner.initialized;
    if (first) {
      state.orbit.theta = 0; state.orbit.phi = Math.acos(0.25 / framing.frontDistance); state.orbit.radius = framing.frontDistance;
      writeAuroraCameraPosition(state.orbit, position.current);
      camera.position.set(...position.current); camera.lookAt(...AURORA_CAMERA_TARGET);
      owner.initialized = true;
    }
    if (fresh || state.mode !== effective || effective === "front") requestAuroraCameraMode(state, effective, reducedMotion);
    if (effective === "front" && Math.abs(state.orbit.radius - framing.frontDistance) < 1e-5
      && Math.abs(state.orbit.theta) < 1e-5 && Math.abs(state.orbit.phi - Math.acos(0.25 / framing.frontDistance)) < 1e-5) state.returning = false;
    owner.revision = revision; owner.reduced = reducedMotion;
    orbit.enabled = effective !== "front"; orbit.enableZoom = orbit.enabled;
    orbit.enableDamping = effective === "free" && !reducedMotion;
    orbit.minDistance = framing.minDistance;
    orbit.maxDistance = Math.max(framing.maxDistance, camera.position.distanceTo(orbit.target));
    gl.domElement.style.touchAction = orbit.enabled ? "none" : "auto";
    if (camera instanceof PerspectiveCamera) {
      camera.aspect = size.width / Math.max(1, size.height);
      if (first) camera.fov = framing.fov;
      camera.updateProjectionMatrix();
    }
    if (mode !== effective) onModeChange?.(effective, "reduced-motion");
    invalidate();
  }, [mode, revision, reducedMotion, framing, getRendererState, size.width, size.height, readPosition, installControls, invalidate, onModeChange, selectedRibbonId]);
  useFrame((_, delta) => {
    const camera = getRendererState().camera;
    const orbit = controls.current, state = motion.current;
    if (!orbit || !visible) return;
    const dt = Math.min(Math.max(delta, 0), 0.25);
    if (interaction && camera instanceof PerspectiveCamera && focus.current.update(camera, orbit.target, interaction, selectedRibbonId, state.mode, framing, delta, reducedMotion)) {
      orbit.enabled = false; orbit.enableZoom = false; lifecycle.current.interacting = false;
      getRendererState().gl.domElement.style.touchAction = "pan-y";
      if (Math.abs(camera.fov - framing.fov) > 0.001) {
        camera.fov = reducedMotion ? framing.fov : MathUtils.damp(camera.fov, framing.fov, 4, dt); camera.updateProjectionMatrix();
      }
      if (focus.current.phase !== reportedPhase.current) {
        reportedPhase.current = focus.current.phase; latest.current.onFocusPhaseChange?.(focus.current.phase);
      }
      if (focus.current.restoredMode) {
        const restored = focus.current.restoredMode;
        installControls(); readPosition(); requestAuroraCameraMode(state, restored, reducedMotion); state.returning = false;
        const restoredOrbit = controls.current!;
        restoredOrbit.enabled = restored !== "front"; restoredOrbit.enableZoom = restoredOrbit.enabled;
        restoredOrbit.enableDamping = restored === "free" && !reducedMotion;
        restoredOrbit.minDistance = framing.minDistance; restoredOrbit.maxDistance = Math.max(framing.maxDistance, state.orbit.radius);
        lifecycle.current.reduced = reducedMotion; lifecycle.current.revision = revision;
        getRendererState().gl.domElement.style.touchAction = restoredOrbit.enabled ? "none" : "auto";
        latest.current.onFocusReturn?.(restored);
      }
      if (!reducedMotion || focus.current.phase !== "focused") invalidate();
      return;
    }
    if (state.mode === "free") {
      orbit.dampingFactor = 1 - Math.exp(-dt * 4);
      orbit.update(); readPosition();
      orbit.maxDistance = Math.max(framing.maxDistance, state.orbit.radius);
    } else if (advanceAuroraCamera(state, delta, framing, config, reducedMotion, visible)) {
      writeAuroraCameraPosition(state.orbit, position.current);
      camera.position.set(...position.current); camera.lookAt(...AURORA_CAMERA_TARGET);
    }
    if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - framing.fov) > 0.001) {
      camera.fov = MathUtils.damp(camera.fov, framing.fov, 4, dt); camera.updateProjectionMatrix();
      invalidate();
    }
    if (state.returning) invalidate();
  }, -0.5);
  return null;
}
