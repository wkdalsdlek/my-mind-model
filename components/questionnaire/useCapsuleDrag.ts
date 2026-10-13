"use client";

import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { type KeywordCapsule } from "@/lib/capsules";
import type { CapsuleEffects } from "./capsule-effects";
import type { useCapsulePhysics } from "./useCapsulePhysics";
import { samplePointer, releaseVelocity, type PointerSample } from "./capsule-inertia";

interface Options {
  physics: ReturnType<typeof useCapsulePhysics>;
  dropZone: RefObject<HTMLDivElement | null>;
  effects: RefObject<CapsuleEffects | null>;
  disabled: boolean;
  select: (keyword: KeywordCapsule) => void;
}
interface Session {
  keyword: KeywordCapsule; pointerId: number; button: HTMLButtonElement; node: HTMLElement;
  startX: number; startY: number; offsetX: number; offsetY: number;
  originX: number; originY: number; width: number; height: number;
  x: number; y: number; moved: boolean; placeholder: HTMLElement | null; fallback: boolean;
  samples: PointerSample[];
}

/** Move the source itself to the top layer; its grid anchor stays reserved. */
export function useCapsuleDrag(options: Options) {
  const latest = useRef(options);
  const session = useRef<Session | null>(null);
  const frame = useRef<number | null>(null);
  const recoveries = useRef(new Set<() => void>());
  const suppressClick = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overDropZone, setOverDropZone] = useState(false);
  useLayoutEffect(() => { latest.current = options; });

  useLayoutEffect(() => {
    const pendingRecoveries = recoveries.current;
    const over = (x: number, y: number) => {
      const box = latest.current.dropZone.current?.getBoundingClientRect();
      return !!box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    };
    const paint = (drag: Session) => {
      drag.node.style.transform = `translate3d(${drag.x}px, ${drag.y}px, 0)`;
      latest.current.physics.moveHeld(drag.keyword.id, drag.x + drag.width / 2, drag.y + drag.height / 2, releaseVelocity(drag.samples));
      setOverDropZone(over(drag.x + drag.offsetX, drag.y + drag.offsetY));
    };
    const finish = (cancelled: boolean, event?: PointerEvent, unmount = false) => {
      const drag = session.current;
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      if (event && drag.moved) {
        drag.x = event.clientX - drag.offsetX; drag.y = event.clientY - drag.offsetY;
        samplePointer(drag.samples, event.clientX, event.clientY, event.timeStamp);
      }
      const accepted = !cancelled && drag.moved && !latest.current.disabled && over(drag.x + drag.offsetX, drag.y + drag.offsetY);
      session.current = null;
      suppressClick.current = drag.moved || cancelled;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      if (drag.button.hasPointerCapture(drag.pointerId)) drag.button.releasePointerCapture(drag.pointerId);
      if (drag.moved) {
        // Successful drops retain a reusable source. Other drops keep the new location.
        const reentering = latest.current.physics.placeAtClient(drag.keyword.id,
          cancelled || accepted ? drag.originX : drag.x + drag.width / 2,
          cancelled || accepted ? drag.originY : drag.y + drag.height / 2, cancelled || accepted);
        const restore = () => {
          drag.node.removeEventListener("capsule-returned", restore);
          if (!drag.fallback) drag.node.hidePopover();
          else drag.placeholder?.parentNode?.insertBefore(drag.node, drag.placeholder);
          drag.node.removeAttribute("popover");
          delete drag.node.dataset.dragging; delete drag.node.dataset.returning;
          drag.node.style.removeProperty("width"); drag.node.style.removeProperty("height");
          drag.placeholder?.remove();
          pendingRecoveries.delete(restore);
          latest.current.physics.repaint();
        };
        if (reentering && !cancelled) {
          drag.node.dataset.returning = "true";
          drag.node.addEventListener("capsule-returned", restore);
          pendingRecoveries.add(restore);
        } else restore();
      }
      latest.current.physics.release(drag.keyword.id,
        !cancelled && !accepted && drag.moved ? releaseVelocity(drag.samples) : undefined);
      latest.current.physics.repaint();
      if (accepted || cancelled) latest.current.effects.current?.resetTrail(drag.keyword.id);
      if (!unmount) { setActiveId(null); setOverDropZone(false); }
      if (accepted) latest.current.select(drag.keyword);
    };
    const move = (event: PointerEvent) => {
      const drag = session.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const coalesced = event.getCoalescedEvents?.();
      for (const point of coalesced?.length ? coalesced : [event]) samplePointer(drag.samples, point.clientX, point.clientY, point.timeStamp);
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return;
      event.preventDefault();
      if (!drag.moved) {
        drag.moved = true;
        suppressClick.current = true;
        const placeholder = document.createElement("span");
        placeholder.style.cssText = `width:${drag.width}px;height:${drag.height}px;pointer-events:none`;
        placeholder.setAttribute("aria-hidden", "true");
        drag.node.before(placeholder);
        drag.placeholder = placeholder;
        drag.node.dataset.dragging = "true";
        drag.node.style.width = `${drag.width}px`;
        drag.node.style.height = `${drag.height}px`;
        drag.node.setAttribute("popover", "manual");
        try { drag.node.showPopover(); }
        catch {
          drag.node.removeAttribute("popover");
          document.body.appendChild(drag.node);
          drag.fallback = true;
        }
        drag.button.setPointerCapture(drag.pointerId);
        latest.current.effects.current?.resetTrail(drag.keyword.id);
      }
      drag.x = event.clientX - drag.offsetX;
      drag.y = event.clientY - drag.offsetY;
      if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; if (session.current) paint(session.current); });
    };
    const up = (event: PointerEvent) => finish(false, event);
    const cancel = (event: PointerEvent) => finish(true, event);
    const blur = () => finish(true);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") finish(true); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key);
    return () => {
      finish(true, undefined, true);
      pendingRecoveries.forEach(restore => restore());
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key);
    };
  }, []);

  const start = (event: ReactPointerEvent<HTMLButtonElement>, keyword: KeywordCapsule) => {
    if (latest.current.disabled || session.current || !event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    latest.current.physics.hold(keyword.id);
    const node = event.currentTarget.parentElement!;
    const box = node.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = {
      keyword, pointerId: event.pointerId, button: event.currentTarget, node,
      startX: event.clientX, startY: event.clientY, offsetX: event.clientX - box.left, offsetY: event.clientY - box.top,
      originX: box.left + box.width / 2, originY: box.top + box.height / 2,
      width: box.width, height: box.height, x: box.left, y: box.top,
      moved: false, placeholder: null, fallback: false,
      samples: [{ x: event.clientX, y: event.clientY, time: event.timeStamp }],
    };
    setActiveId(keyword.id);
  };
  const click = (detail: number, keyword: KeywordCapsule) => {
    if (detail === 0 || !suppressClick.current) latest.current.select(keyword);
    suppressClick.current = false;
  };
  return { start, click, activeId, overDropZone };
}
