"use client";

import { useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, Vector3 } from "three";
import { AURORA_CAMERA_TARGET } from "@/lib/aurora-camera";
import { auroraPaletteColors, type AuroraAppearance, type AuroraQualityBudget } from "@/lib/aurora-types";
import { createAuroraParticleData } from "@/lib/aurora-geometry";
import { particleFragmentShader, particleVertexShader } from "./aurora-shaders";
import { useAuroraResourceCleanup } from "./useAuroraResourceCleanup";

interface Props { appearance: AuroraAppearance; time: RefObject<number>; budget: AuroraQualityBudget }
function Particles({ appearance, time, count, near }: Omit<Props, "budget"> & { count: number; near: boolean }) {
  const material = useRef<ShaderMaterial>(null);
  const geometry = useMemo(() => {
    const data = createAuroraParticleData(count, near, near ? 913 : 471), result = new BufferGeometry();
    result.setAttribute("position", new BufferAttribute(data.positions, 3)); result.setAttribute("aSize", new BufferAttribute(data.sizes, 1));
    result.setAttribute("aPhase", new BufferAttribute(data.phases, 1)); return result;
  }, [count, near]);
  useAuroraResourceCleanup(geometry);
  const dpr = useThree(state => state.viewport.dpr);
  const uniforms = useMemo(() => {
    const colors = auroraPaletteColors(appearance.palette);
    return { uTime: { value: 8.3 }, uNear: { value: near ? 1 : 0 }, uFlow: { value: appearance.motion.flow },
      uSkyCenter: { value: new Vector3(...AURORA_CAMERA_TARGET) },
      uPixelRatio: { value: 1 }, uColorA: { value: new Color(near ? colors[0] : "#b9c9e4") }, uColorB: { value: new Color(near ? colors[1] : "#8898c8") } };
  }, [appearance, near]);
  useFrame(() => {
    if (material.current) { material.current.uniforms.uTime.value = time.current; material.current.uniforms.uPixelRatio.value = dpr; }
  });
  return <points frustumCulled={false} renderOrder={near ? 24 : -10}>
    <primitive attach="geometry" object={geometry} />
    <shaderMaterial ref={material} uniforms={uniforms} vertexShader={particleVertexShader} fragmentShader={particleFragmentShader} transparent depthWrite={false} blending={AdditiveBlending} />
  </points>;
}
export default function StardustField({ budget, ...props }: Props) {
  return <group><Particles {...props} count={budget.stars} near={false} /><Particles {...props} count={budget.dust} near /></group>;
}
