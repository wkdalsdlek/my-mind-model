"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { HalfFloatType, UnsignedByteType } from "three";
import { BloomEffect, EffectComposer, EffectPass, RenderPass, Resolution, ToneMappingEffect, ToneMappingMode } from "postprocessing";
import type { AuroraQuality } from "@/lib/aurora-types";
import { useAuroraResourceCleanup } from "./useAuroraResourceCleanup";

/** Own the whole pass graph so removing a layer or changing quality disposes
 * render targets, effect passes and effects together. Bloom precedes tone mapping. */
export default function AuroraOptics({ quality, bloom, bloomHeight }: { quality: AuroraQuality; bloom: boolean; bloomHeight: number }) {
  const gl = useThree(state => state.gl), scene = useThree(state => state.scene), camera = useThree(state => state.camera);
  const size = useThree(state => state.size), dpr = useThree(state => state.viewport.dpr);
  const current = useRef<EffectComposer | null>(null);
  const composer = useMemo(() => {
    const hdr = quality !== "low" && gl.extensions.has("EXT_color_buffer_float");
    const result = new EffectComposer(gl, { multisampling: 0, frameBufferType: hdr ? HalfFloatType : UnsignedByteType });
    result.addPass(new RenderPass(scene, camera));
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    if (bloom) {
      const glow = new BloomEffect({ intensity: 0.32, luminanceThreshold: hdr ? 1.12 : 0.84, luminanceSmoothing: 0.3,
        mipmapBlur: false, resolutionX: Resolution.AUTO_SIZE, resolutionY: bloomHeight });
      result.addPass(new EffectPass(camera, glow, tone));
    } else result.addPass(new EffectPass(camera, tone));
    return result;
  }, [gl, scene, camera, quality, bloom, bloomHeight]);
  useAuroraResourceCleanup(composer);
  useLayoutEffect(() => {
    current.current = composer;
    composer.setSize(size.width, size.height);
    return () => { if (current.current === composer) current.current = null; };
  }, [composer, size.width, size.height, dpr]);
  // Positive priority intentionally replaces Fiber's default render with the composer.
  useFrame((_, delta) => { current.current?.render(delta); }, 1);
  return null;
}
