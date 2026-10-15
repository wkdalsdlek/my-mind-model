"use client";

import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { PerspectiveCamera, Vector3 } from "three";
import { advanceAuroraBeaconAnchor, advanceAuroraBeaconPlacement, createAuroraBeaconAnchor, createAuroraStableBeacon,
  type AuroraBeaconAnchorState, type AuroraBeaconCandidate, type AuroraStableBeacon, type AuroraBeaconPlacement } from "@/lib/aurora-ribbon-beacons";
import type { AuroraRibbonInteraction } from "@/lib/aurora-ribbon-picking";
import type { AuroraRibbonId } from "@/lib/aurora-ribbon-layout";

interface Marker { button: HTMLButtonElement; line: SVGLineElement | null; point: Vector3; anchor: AuroraBeaconAnchorState;
  placement: AuroraStableBeacon; candidates: AuroraBeaconCandidate[]; pinned: boolean }
const candidateUs = [.08, .2, .32, .44, .56, .68, .8, .92];
/** Final camera matrix -> fixed physical segment -> persistent screen constraints.
 * No per-frame React state, DOM measurements, GPU readback or Three allocations. */
export default function AuroraRibbonBeacons({ interaction, host, hidden }: {
  interaction: AuroraRibbonInteraction; host: RefObject<HTMLDivElement | null>; hidden: boolean;
}) {
  const markers = useRef<Marker[]>([]), projected = useRef(new Vector3());
  const previous = useRef<AuroraBeaconPlacement[]>([]), viewport = useRef({ width: 0, height: 0, hidden: true });
  useFrame(({ camera, size, frameloop }, delta) => {
    const root = host.current;
    if (!root || !(camera instanceof PerspectiveCamera)) return;
    if (hidden || root.hidden) {
      if (!viewport.current.hidden) for (const marker of markers.current) marker.button.style.visibility = "hidden";
      viewport.current.hidden = true; return;
    }
    // OrbitControls/lookAt change transform before the render traversal refreshes
    // matrixWorldInverse. Explicit refresh prevents a one-frame projection lag.
    camera.updateMatrixWorld(true);
    const resync = viewport.current.hidden || viewport.current.width !== size.width || viewport.current.height !== size.height;
    viewport.current.width = size.width; viewport.current.height = size.height; viewport.current.hidden = false;
    if (markers.current.length !== root.childElementCount - 1 || markers.current.some(m => !m.button.isConnected)) {
      markers.current = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).map(button => ({ button,
        line: root.querySelector<SVGLineElement>(`[data-leader-id="${button.dataset.beaconId}"]`), point: new Vector3(),
        anchor: createAuroraBeaconAnchor(), placement: createAuroraStableBeacon(), pinned: false,
        candidates: candidateUs.map(u => ({ u, x: 0, y: 0, depth: 1, valid: false, exposed: false })) }));
    }
    previous.current.length = 0;
    for (const marker of markers.current) {
      const p = marker.placement;
      marker.pinned = !resync && p.initialized && p.x >= 24 && p.x <= size.width - 24 && p.y >= 24 && p.y <= size.height - 24
        && (marker.button.matches(":hover") || document.activeElement === marker.button);
      if (marker.pinned) previous.current.push(p);
    }
    for (const marker of markers.current) {
      const id = marker.button.dataset.beaconId as AuroraRibbonId;
      for (const candidate of marker.candidates) {
        candidate.valid = interaction.surfacePoint(id, candidate.u, .5, marker.point);
        if (!candidate.valid) continue;
        projected.current.copy(marker.point).project(camera);
        const p = projected.current;
        candidate.x = (p.x + 1) * size.width / 2; candidate.y = (1 - p.y) * size.height / 2; candidate.depth = p.z;
        candidate.valid = Number.isFinite(p.x + p.y + p.z) && p.z >= -1 && p.z < 1;
        candidate.exposed = candidate.valid && candidate.x >= 30 && candidate.x <= size.width - 30
          && candidate.y >= Math.min(145, size.height * .23) && candidate.y <= Math.max(145, size.height - 205);
      }
      if (resync && marker.anchor.initialized) { marker.anchor.age = 1.2; marker.anchor.outside = .22; }
      if (!advanceAuroraBeaconAnchor(marker.anchor, marker.candidates, delta, marker.pinned, frameloop === "demand")) continue;
      if (!interaction.surfacePoint(id, marker.anchor.u, .5, marker.point)) continue;
      projected.current.copy(marker.point).project(camera);
      const placement = marker.placement;
      placement.anchorX = (projected.current.x + 1) * size.width / 2; placement.anchorY = (1 - projected.current.y) * size.height / 2;
      if (!Number.isFinite(placement.anchorX + placement.anchorY)) continue;
      advanceAuroraBeaconPlacement(placement, previous.current, size.width, size.height, delta, marker.pinned, resync);
      if (!marker.pinned) previous.current.push(placement);
      marker.button.style.transform = `translate3d(${placement.x}px,${placement.y}px,0) translate(-50%,-50%)`;
      marker.button.dataset.segmentU = String(marker.anchor.u);
      marker.button.dataset.anchorSwitches = String(marker.anchor.switches);
      marker.button.dataset.anchorX = String(placement.anchorX); marker.button.dataset.anchorY = String(placement.anchorY);
      marker.button.style.visibility = "visible";
      if (marker.line) {
        marker.line.setAttribute("x1", String(placement.anchorX)); marker.line.setAttribute("y1", String(placement.anchorY));
        marker.line.setAttribute("x2", String(placement.x)); marker.line.setAttribute("y2", String(placement.y));
      }
    }
  }, .5);
  return null;
}
