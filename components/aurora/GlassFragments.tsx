"use client";

import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, DoubleSide, InstancedBufferAttribute, InstancedMesh, NormalBlending, Object3D, OctahedronGeometry, ShaderMaterial } from "three";
import { auroraPaletteColors, type AuroraAppearance } from "@/lib/aurora-types";
import { createAuroraGlassData, sortAuroraGlassOrder } from "@/lib/aurora-geometry";
import { glassFragmentShader, glassVertexShader } from "./aurora-shaders";
import { useAuroraResourceCleanup } from "./useAuroraResourceCleanup";

interface Props { appearance: AuroraAppearance; time: RefObject<number>; count: number }
export default function GlassFragments({ appearance, time, count }: Props) {
  const mesh = useRef<InstancedMesh>(null);
  const material = useRef<ShaderMaterial>(null);
  const data = useMemo(() => createAuroraGlassData(count), [count]);
  const storage = useRef<{ matrices: Float32Array; colors: Float32Array; order: Uint16Array;
    depths: Float32Array; previousView: Float64Array; dirty: boolean } | null>(null);
  const geometry = useMemo(() => {
    const result = new OctahedronGeometry(1, 0);
    result.setAttribute("aPhase", new InstancedBufferAttribute(data.phases.slice(), 1));
    return result;
  }, [data]);
  useAuroraResourceCleanup(geometry);
  const uniforms = useMemo(() => ({ uTime: { value: 8.3 } }), []);
  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    if (!storage.current || storage.current.matrices.length !== count * 16) storage.current = {
      matrices: new Float32Array(count * 16), colors: new Float32Array(count * 3), order: new Uint16Array(count),
      depths: new Float32Array(count), previousView: new Float64Array(16).fill(NaN), dirty: true };
    const buffers = storage.current;
    const transform = new Object3D(), color = new Color(), colors = auroraPaletteColors(appearance.palette);
    for (let i = 0; i < count; i++) {
      transform.position.fromArray(data.positions, i * 3);
      transform.rotation.set(data.rotations[i * 3], data.rotations[i * 3 + 1], data.rotations[i * 3 + 2]);
      transform.scale.setScalar(data.sizes[i]);
      transform.updateMatrix(); target.setMatrixAt(i, transform.matrix);
      transform.matrix.toArray(buffers.matrices, i * 16);
      color.set(colors[i % colors.length]); target.setColorAt(i, color);
      color.toArray(buffers.colors, i * 3);
    }
    target.instanceMatrix.needsUpdate = true;
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
    target.computeBoundingSphere();
    buffers.dirty = true;
  }, [appearance, count, data]);
  useFrame(({ camera }) => {
    if (material.current) material.current.uniforms.uTime.value = time.current;
    const target = mesh.current;
    const buffers = storage.current;
    if (!target?.instanceColor || !buffers) return;
    // One draw call, but its <=18 transparent instances follow the viewing depth.
    camera.updateMatrixWorld();
    const view = camera.matrixWorldInverse.elements;
    let changed = buffers.dirty;
    for (let i = 0; i < 16; i++) {
      if (view[i] !== buffers.previousView[i]) changed = true;
      buffers.previousView[i] = view[i];
    }
    if (!changed) return;
    sortAuroraGlassOrder(data.positions, view, buffers.order, buffers.depths);
    const phases = geometry.getAttribute("aPhase");
    for (let i = 0; i < count; i++) {
      const source = buffers.order[i];
      for (let j = 0; j < 16; j++) target.instanceMatrix.array[i * 16 + j] = buffers.matrices[source * 16 + j];
      for (let j = 0; j < 3; j++) target.instanceColor.array[i * 3 + j] = buffers.colors[source * 3 + j];
      phases.setX(i, data.phases[source]);
    }
    target.instanceMatrix.needsUpdate = true; target.instanceColor.needsUpdate = true; phases.needsUpdate = true;
    buffers.dirty = false;
  });
  return <instancedMesh key={count} ref={mesh} args={[undefined, undefined, count]} renderOrder={20} frustumCulled={false}>
    <primitive attach="geometry" object={geometry} />
    <shaderMaterial ref={material} uniforms={uniforms} vertexShader={glassVertexShader} fragmentShader={glassFragmentShader}
      transparent depthWrite={false} side={DoubleSide} forceSinglePass blending={NormalBlending} />
  </instancedMesh>;
}
