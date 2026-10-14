"use client";

import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, MathUtils, Mesh, NormalBlending, ShaderMaterial, Vector2, Vector4 } from "three";
import { auroraEnergyProfiles, createAuroraEnergyEvent, updateAuroraEnergyEvent, type AuroraEnergyEvent } from "@/lib/aurora-energy";
import { advanceAuroraMotionClock, AURORA_MOTION_WEIGHTS, auroraFlowBudget, auroraPaletteColors, createAuroraMotionClock,
  type AuroraAppearance, type AuroraFlowMode, type AuroraMotionClock, type AuroraQualityBudget } from "@/lib/aurora-types";
import { auroraCurtainMistShape, auroraLoopMistShape, auroraLoopShapes, auroraRibbonShapes, createAuroraRibbonData, updateAuroraFieldPose, updateAuroraRibbonPose,
  type AuroraRibbonPose, type AuroraRibbonShape } from "@/lib/aurora-geometry";
import { ribbonFragmentShader, ribbonVertexShader } from "./aurora-shaders";
import { useAuroraResourceCleanup } from "./useAuroraResourceCleanup";

interface Props { appearance: AuroraAppearance; budget: AuroraQualityBudget; time: RefObject<number>; flowMode: AuroraFlowMode; reducedMotion: boolean }
interface RibbonProps extends Pick<Props, "appearance" | "time" | "reducedMotion"> {
  shape: AuroraRibbonShape; segments: number; rows: number; active: boolean; clock: RefObject<AuroraMotionClock>; mist?: boolean;
}
function Ribbon({ shape, appearance, segments, rows, time, active, clock, reducedMotion, mist = false }: RibbonProps) {
  const material = useRef<ShaderMaterial>(null), mesh = useRef<Mesh>(null);
  const pose = useRef<AuroraRibbonPose>({ position: [0, 0, 0], rotation: [0, 0, 0] });
  const visibility = useRef(0), initialized = useRef(false);
  const energy = useMemo(() => auroraEnergyProfiles(shape.energySeed), [shape.energySeed]);
  const events = useRef<AuroraEnergyEvent[]>([]);
  useLayoutEffect(() => { events.current = energy.map(() => createAuroraEnergyEvent()); }, [energy]);
  const geometry = useMemo(() => {
    const data = createAuroraRibbonData(shape, segments, rows), result = new BufferGeometry();
    result.setAttribute("position", new BufferAttribute(data.positions, 3)); result.setAttribute("uv", new BufferAttribute(data.uvs, 2));
    result.setAttribute("aTangentU", new BufferAttribute(data.tangentU, 3)); result.setAttribute("aTangentV", new BufferAttribute(data.tangentV, 3));
    result.setIndex(new BufferAttribute(data.indices, 1));
    return result;
  }, [shape, segments, rows]);
  useAuroraResourceCleanup(geometry);
  const colors = useMemo(() => {
    const palette = auroraPaletteColors(appearance.palette), a = shape.colorIndex, b = (a + 1) % palette.length;
    const coreShare = shape.kind === "loop" ? 0.58 : 0.95;
    const mistShare = shape.kind === "loop" ? 0.58 * 0.34 : 0.24;
    return { a: new Color(palette[a]), b: new Color(palette[b]),
      opacity: (0.24 + appearance.palette[a].weight * 0.24) * (mist ? mistShare : coreShare), mix: appearance.palette[b].weight };
  }, [appearance.palette, shape, mist]);
  // Owned uniform storage survives presets so colors and amplitude ease in place.
  const uniforms = useMemo(() => ({
    uTime: { value: 8.3 }, uWaveTime: { value: 0 }, uFieldPhase: { value: 0 }, uAmplitude: { value: 0 }, uPhase: { value: 0 },
    uFrequency: { value: 0 }, uColorA: { value: new Color() }, uColorB: { value: new Color() }, uOpacity: { value: 0 },
    uFlow: { value: 0 }, uMix: { value: 0 }, uIntensity: { value: 1 }, uClosed: { value: 0 }, uLoop: { value: 0 }, uMist: { value: 0 }, uVisibility: { value: 0 }, uSurfaceWeight: { value: AURORA_MOTION_WEIGHTS.surface },
    uEnergyTime: { value: 0 }, uEnergyTiming: { value: energy.map(() => new Vector4()) },
    uEnergyShape: { value: energy.map(() => new Vector4()) }, uEnergyWake: { value: energy.map(() => new Vector2()) },
  }), [energy]);
  useFrame(() => {
    const state = clock.current;
    const response = reducedMotion || !initialized.current ? 1 : 1 - Math.exp(-state.delta * 4);
    visibility.current = reducedMotion ? Number(active) : MathUtils.damp(visibility.current, Number(active), 5, state.delta);
    if (material.current) {
      const u = material.current.uniforms;
      u.uTime.value = time.current; u.uWaveTime.value = state.phase * shape.orbitRate; u.uFieldPhase.value = state.phase;
      u.uAmplitude.value = state.motion.amplitude * shape.motionScale; u.uIntensity.value = state.motion.intensity;
      u.uPhase.value = shape.phase; u.uFrequency.value = shape.frequency; u.uClosed.value = Number(shape.closed || shape.kind === "loop");
      u.uLoop.value = Number(shape.kind === "loop"); u.uEnergyTime.value = state.energyTime;
      for (let lane = 0; lane < energy.length; lane++) {
        const event = events.current[lane];
        if (updateAuroraEnergyEvent(energy[lane], state.energyTime, event)) {
          u.uEnergyTiming.value[lane].set(event.start, event.travel, event.speed, event.wakeEnd);
          u.uEnergyShape.value[lane].set(event.length, event.focus, event.direction, event.gain);
          u.uEnergyWake.value[lane].set(event.wakeLength, event.wakeGain);
        }
      }
      u.uMist.value = Number(mist);
      u.uFlow.value = state.motion.flow;
      u.uColorA.value.lerp(colors.a, response); u.uColorB.value.lerp(colors.b, response);
      u.uMix.value = MathUtils.lerp(u.uMix.value, colors.mix, response);
      u.uOpacity.value = MathUtils.lerp(u.uOpacity.value, colors.opacity, response);
      u.uVisibility.value = visibility.current;
    }
    if (mesh.current) {
      updateAuroraRibbonPose(shape, state.motion, state.phase, pose.current);
      mesh.current.position.set(...pose.current.position); mesh.current.rotation.set(...pose.current.rotation);
      // Retain small core/mist buffers for mode fades; idle meshes skip GPU draws.
      mesh.current.visible = visibility.current > 0.002;
    }
    initialized.current = true;
  });
  return <mesh ref={mesh} renderOrder={20} frustumCulled={false}>
    <primitive attach="geometry" object={geometry} />
    <shaderMaterial ref={material} vertexShader={ribbonVertexShader} fragmentShader={ribbonFragmentShader}
      uniforms={uniforms} side={DoubleSide} transparent depthWrite={false} blending={NormalBlending} forceSinglePass />
  </mesh>;
}
export default function AuroraRibbons({ appearance, budget, time, flowMode, reducedMotion }: Props) {
  const shapes = useMemo(() => auroraRibbonShapes(appearance), [appearance]);
  const loops = useMemo(() => auroraLoopShapes(appearance), [appearance]);
  const loopBudget = useMemo(() => auroraFlowBudget(flowMode, budget), [flowMode, budget]);
  const curtainMistShapes = useMemo(() => shapes.map(auroraCurtainMistShape), [shapes]);
  const mistShapes = useMemo(() => loops.map(shape => Array.from({ length: loopBudget.mistLayers }, (_, layer) => auroraLoopMistShape(shape, layer))), [loops, loopBudget.mistLayers]);
  const field = useRef<Group>(null), clock = useRef(createAuroraMotionClock(appearance.motion));
  const pose = useRef<AuroraRibbonPose>({ position: [0, 0, 0], rotation: [0, 0, 0] });
  useFrame(() => {
    advanceAuroraMotionClock(clock.current, time.current, appearance.motion, reducedMotion);
    if (field.current) {
      updateAuroraFieldPose(clock.current.motion, clock.current.phase, pose.current);
      field.current.position.set(...pose.current.position); field.current.rotation.set(...pose.current.rotation);
    }
  }, -1);
  const shared = { appearance, time, reducedMotion, clock };
  return <group ref={field}>
    {shapes.map((shape, i) => <Ribbon key={`curtain-${i}`} {...shared} shape={shape} segments={budget.segments} rows={budget.rows} active />)}
    {curtainMistShapes.map((shape, i) => <Ribbon key={`curtain-mist-${i}`} {...shared} shape={shape} segments={loopBudget.curtainMistSegments} rows={loopBudget.curtainMistRows} active mist />)}
    {loops.map((shape, i) => <Ribbon key={`loop-${i}`} {...shared} shape={shape} segments={loopBudget.segments} rows={loopBudget.rows} active={i < loopBudget.loopCount} />)}
    {mistShapes.map((layers, i) => layers.map((shape, layer) => <Ribbon key={`mist-${i}-${layer}`} {...shared} shape={shape} segments={loopBudget.mistSegments} rows={loopBudget.mistRows} active={i < loopBudget.loopCount} mist />))}
  </group>;
}
