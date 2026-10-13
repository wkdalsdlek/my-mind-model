"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import type { KeywordCapsule } from "@/lib/capsules";
import { advanceBodies, createBody, findOpenPosition, separateBodies, startGlide, type CapsuleBody, type FieldBounds, type ContactEmitter } from "./capsule-physics";

export interface CapsuleMotion {
  id: string; x: number; y: number; vx: number; vy: number; width: number; height: number;
  source: "drag" | "glide"; frameMs: number;
}
export type MotionEmitter = (motion: CapsuleMotion) => void;

export function useCapsulePhysics(stage: RefObject<HTMLDivElement | null>, keywords: KeywordCapsule[], paused: boolean, emit?: ContactEmitter, emitMotion?: MotionEmitter) {
  const bodies = useRef(new Map<string, CapsuleBody>());
  const held = useRef<string | null>(null);
  const clock = useRef(0);
  const pausedRef = useRef(paused);
  const wake = useRef<(() => void) | null>(null);
  const geometry = useRef<FieldBounds>({ width: 0, height: 0 });
  const emitter = useRef(emit);
  const motionEmitter = useRef(emitMotion);

  useLayoutEffect(() => { emitter.current = emit; motionEmitter.current = emitMotion; }, [emit, emitMotion]);

  useLayoutEffect(() => {
    pausedRef.current = paused;
    wake.current?.();
  }, [paused]);

  const hold = useCallback((id: string) => {
    held.current = id;
    const body = bodies.current.get(id);
    if (body) { body.held = true; body.glideUntil = 0; }
  }, []);

  const release = useCallback((id: string, velocity?: { x: number; y: number }) => {
    if (held.current === id) held.current = null;
    const body = bodies.current.get(id);
    if (body) {
      body.held = false; body.detached = body.reentering;
      body.vx *= 0.65; body.vy *= 0.65;
      if (velocity) startGlide(body, velocity, clock.current, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    wake.current?.();
  }, []);

  const moveHeld = (id: string, clientX: number, clientY: number, velocity: { x: number; y: number }) => {
    const body = bodies.current.get(id), box = stage.current?.getBoundingClientRect();
    if (!body || !box) return;
    body.x = clientX - box.left;
    body.y = clientY - box.top;
    body.detached = body.x < 0 || body.x > box.width || body.y < 0 || body.y > box.height;
    motionEmitter.current?.({ id, x: body.x, y: body.y, vx: velocity.x, vy: velocity.y, width: body.width, height: body.height, source: "drag", frameMs: 0 });
  };

  const placeAtClient = (id: string, clientX: number, clientY: number, findSpace = true) => {
    const body = bodies.current.get(id), element = stage.current;
    if (!body || !element) return;
    const box = element.getBoundingClientRect(), viewport = element.parentElement!.getBoundingClientRect();
    const halfX = body.width / 2 + 8, halfY = body.height / 2 + 8;
    const minY = Math.max(halfY, Math.max(viewport.top, 0) - box.top + halfY);
    const maxY = Math.min(box.height - halfY, Math.min(viewport.bottom, innerHeight) - box.top - halfY);
    if (!findSpace) {
      body.x = clientX - box.left; body.y = clientY - box.top;
      body.reentering = body.x < halfX || body.x > box.width - halfX || body.y < halfY || body.y > box.height - halfY;
      body.detached = body.reentering;
      separateBodies([...bodies.current.values()], geometry.current);
      return body.reentering;
    }
    body.x = Math.max(halfX, Math.min(box.width - halfX, clientX - box.left));
    body.y = Math.max(halfY, Math.min(box.height - halfY, Math.max(minY, Math.min(Math.max(minY, maxY), clientY - box.top))));
    body.detached = false; body.reentering = false;
    if (findSpace) findOpenPosition(body, [...bodies.current.values()].filter(other => other.id !== id && !other.detached), geometry.current);
    else separateBodies([...bodies.current.values()], geometry.current);
  };

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const nodes = new Map<string, HTMLElement>();
    element.querySelectorAll<HTMLElement>("[data-floating-id]").forEach(node => nodes.set(node.dataset.floatingId!, node));
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = media.matches;
    let frame: number | null = null;
    let lastTime = 0;
    let contacts = Number(element.dataset.contacts ?? 0);
    let lastReport = 0;
    let simulation: CapsuleBody[] = [];

    const paint = (frameMs = 0) => {
      bodies.current.forEach(body => {
        const node = nodes.get(body.id);
        const gliding = !body.held && clock.current < body.glideUntil;
        if (node && node.dataset.gliding !== String(gliding)) node.dataset.gliding = String(gliding);
        if (node?.dataset.returning === "true") {
          const box = element.getBoundingClientRect();
          node.style.transform = `translate3d(${box.left + body.x - body.width / 2}px, ${box.top + body.y - body.height / 2}px, 0)`;
          if (!body.reentering) node.dispatchEvent(new Event("capsule-returned"));
        }
        if (!body.held && (clock.current < body.glideUntil || body.reentering)) {
          motionEmitter.current?.({ id: body.id, x: body.x, y: body.y, vx: body.vx, vy: body.vy, width: body.width, height: body.height, source: "glide", frameMs });
        }
        if (node && node.dataset.dragging !== "true") node.style.transform = `translate3d(${(body.x - body.homeX).toFixed(3)}px, ${(body.y - body.homeY).toFixed(3)}px, 0)`;
      });
    };

    const measure = () => {
      const box = element.getBoundingClientRect();
      const bounds = { width: box.width, height: box.height };
      const resized = Math.abs(bounds.width - geometry.current.width) > 1;
      const next = new Map<string, CapsuleBody>();
      for (const keyword of keywords) {
        const node = nodes.get(keyword.id);
        if (!node?.parentElement) continue;
        const previous = bodies.current.get(keyword.id);
        if (node.dataset.dragging === "true" && previous) { next.set(previous.id, previous); continue; }
        const anchor = node.parentElement.getBoundingClientRect();
        const layout = { homeX: anchor.left + anchor.width / 2 - box.left, homeY: anchor.top + anchor.height / 2 - box.top, width: node.offsetWidth, height: node.offsetHeight };
        const body = previous ?? createBody(keyword.id, keyword.group, layout, clock.current);
        Object.assign(body, layout);
        body.held = held.current === body.id;
        if (resized && previous) { body.x = layout.homeX; body.y = layout.homeY; body.vx *= 0.4; body.vy *= 0.4; }
        if (!previous) findOpenPosition(body, [...next.values()], bounds);
        next.set(body.id, body);
      }
      bodies.current = next;
      simulation = [...next.values()];
      geometry.current = bounds;
      separateBodies(simulation, bounds);
      paint();
    };

    const tick = (now: number) => {
      frame = null;
      if (pausedRef.current || document.hidden) { lastTime = 0; return; }
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.12) : 0;
      lastTime = now;
      // Preserve speed on slower displays while keeping collision steps small.
      const steps = Math.ceil(dt / (1 / 120));
      for (let step = 0; step < steps; step++) {
        const slice = dt / steps;
        clock.current += slice;
        contacts += advanceBodies(simulation, geometry.current, slice, clock.current, reduced, event => emitter.current?.(event));
      }
      paint(dt * 1000);
      if (now - lastReport > 250) {
        element.dataset.contacts = String(contacts);
        element.dataset.simSeconds = clock.current.toFixed(3);
        lastReport = now;
      }
      frame = requestAnimationFrame(tick);
    };

    const schedule = () => {
      if (pausedRef.current || document.hidden) {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        lastTime = 0;
      } else if (frame === null) frame = requestAnimationFrame(tick);
    };
    const preferenceChanged = () => { reduced = media.matches; };
    wake.current = schedule;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    nodes.forEach(node => observer.observe(node));
    media.addEventListener("change", preferenceChanged);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      media.removeEventListener("change", preferenceChanged);
      document.removeEventListener("visibilitychange", schedule);
      wake.current = null;
    };
  }, [keywords, stage]);

  const repaint = () => {
    stage.current?.querySelectorAll<HTMLElement>("[data-floating-id]").forEach(node => {
      const body = bodies.current.get(node.dataset.floatingId!);
      if (body && node.dataset.dragging !== "true") node.style.transform = `translate3d(${(body.x - body.homeX).toFixed(3)}px, ${(body.y - body.homeY).toFixed(3)}px, 0)`;
    });
  };

  return { hold, release, moveHeld, placeAtClient, repaint };
}
