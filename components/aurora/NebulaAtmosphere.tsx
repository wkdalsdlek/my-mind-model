"use client";

import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, Euler, Mesh, NormalBlending, Quaternion, ShaderMaterial, Vector3 } from "three";
import { AURORA_CAMERA_TARGET } from "@/lib/aurora-camera";
import { auroraPaletteColors, type AuroraAppearance } from "@/lib/aurora-types";
import { nebulaFragmentShader, nebulaVertexShader } from "./aurora-shaders";

interface Props { appearance: AuroraAppearance; time: RefObject<number>; count: number }
function NebulaCloud({ appearance, time, index }: Omit<Props, "count"> & { index: number }) {
  const material = useRef<ShaderMaterial>(null);
  const mesh = useRef<Mesh>(null);
  const axes = useRef({ outward: new Vector3(), right: new Vector3(), up: new Vector3(), center: new Vector3(...AURORA_CAMERA_TARGET) });
  const tilt = useMemo(() => new Quaternion().setFromEuler(new Euler(0.06 * index, -0.07 * index, index * 0.37)), [index]);
  const uniforms = useMemo(() => {
    const colors = auroraPaletteColors(appearance.palette);
    return { uTime: { value: 8.3 }, uSeed: { value: 1.7 + index * 2.9 }, uOpacity: { value: 0.32 },
      uColorA: { value: new Color(index % 3 === 1 ? "#384588" : index % 3 === 2 ? "#2b7680" : colors[index % colors.length]) }, uColorB: { value: new Color("#584b9e") } };
  }, [appearance, index]);
  useFrame(({ camera }) => {
    if (material.current) material.current.uniforms.uTime.value = time.current;
    if (mesh.current) {
      const basis = axes.current;
      basis.outward.copy(camera.position).sub(basis.center).normalize();
      basis.right.set(1, 0, 0).applyQuaternion(camera.quaternion); basis.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      // A soft background veil stays behind the field from every viewing direction.
      mesh.current.position.copy(basis.center).addScaledVector(basis.outward, -16.6 - index * 9)
        .addScaledVector(basis.right, (index % 2 ? 1 : -1) * 3).addScaledVector(basis.up, (index % 3 - 1) * 2.3);
      mesh.current.quaternion.copy(camera.quaternion).multiply(tilt);
    }
  });
  return <mesh ref={mesh} renderOrder={5 - index}>
    <planeGeometry args={[46 + index * 9, 27 + index * 5, 8, 4]} />
    <shaderMaterial ref={material} uniforms={uniforms} vertexShader={nebulaVertexShader} fragmentShader={nebulaFragmentShader} transparent depthWrite={false} blending={NormalBlending} />
  </mesh>;
}
export default function NebulaAtmosphere({ count, ...props }: Props) {
  return <group>{Array.from({ length: count }, (_, i) => <NebulaCloud key={i} {...props} index={count - 1 - i} />)}</group>;
}
