"use client";

import { useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "three";
import { AuroraRibbonTapGesture } from "@/lib/aurora-ribbon-focus";
import type { AuroraRibbonId } from "@/lib/aurora-ribbon-layout";
import type { AuroraCameraMode } from "@/lib/aurora-types";
import type { AuroraRibbonInteraction } from "@/lib/aurora-ribbon-picking";

export default function AuroraRibbonPointerSelection({ interaction, mode, onSelect, onError }: {
  interaction: AuroraRibbonInteraction; mode: AuroraCameraMode; onSelect: (id: AuroraRibbonId) => void; onError?: () => void;
}) {
  const get = useThree(s => s.get), invalidate = useThree(s => s.invalidate);
  const latest = useRef({ mode, onSelect, onError });
  useLayoutEffect(() => { latest.current = { mode, onSelect, onError }; }, [mode, onSelect, onError]);
  useLayoutEffect(() => {
    const canvas = get().gl.domElement, gesture = new AuroraRibbonTapGesture();
    let startMode: AuroraCameraMode = "front";
    const down = (e: PointerEvent) => { startMode = latest.current.mode; gesture.down(e.pointerId, e.clientX, e.clientY, e.timeStamp, e.isPrimary, e.button); };
    const move = (e: PointerEvent) => gesture.move(e.pointerId, e.clientX, e.clientY);
    const cancel = (e: PointerEvent) => gesture.cancel(e.pointerId);
    const wheel = () => gesture.cancel();
    const up = (e: PointerEvent) => {
      if (!gesture.up(e.pointerId, e.clientX, e.clientY, e.timeStamp)) return;
      const { gl, scene, camera } = get();
      if (!(camera instanceof PerspectiveCamera)) return;
      try {
        const id = interaction.pick(gl, scene, camera, e.clientX, e.clientY);
        if (id) { interaction.selectionOriginMode = startMode; latest.current.onSelect(id); }
      } catch { latest.current.onError?.(); }
      finally { invalidate(); }
    };
    const reset = () => gesture.reset();
    canvas.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true); window.addEventListener("blur", reset);
    canvas.addEventListener("wheel", wheel, { passive: true });
    return () => {
      canvas.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true); window.removeEventListener("blur", reset); canvas.removeEventListener("wheel", wheel);
      reset();
    };
  }, [get, invalidate, interaction]);
  return null;
}
