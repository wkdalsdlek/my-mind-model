"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./CapsuleQuestionnaire.module.css";
import { skyAt } from "./sky-model";

export function questionAtmosphere(step: number) {
  if (step < 2) return "morning";
  if (step === 2) return "morning-noon";
  if (step < 5) return "noon";
  if (step === 5) return "noon-evening";
  return step < 8 ? "evening" : "night";
}

const lightTransform = (light: { x: number; y: number; scale: number }) =>
  `translate3d(calc(var(--sky-width) * ${light.x / 100}), calc(var(--sky-height) * ${light.y / 100}), 0) translate(-50%, -50%) scale(${light.scale})`;

/** All light nodes survive question remounts; only a target time changes. */
export default function QuestionAtmosphere({ step, children }: { step: number; children: ReactNode }) {
  const [initial] = useState(() => skyAt(step / 9));
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const progress = useRef(step / 9);
  const target = useRef(step / 9);
  const wake = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    target.current = step / 9;
    wake.current?.();
  }, [step]);

  useLayoutEffect(() => {
    const root = host.current!, scene = viewport.current!;
    const sun = scene.querySelector<HTMLElement>("[data-luminary='sun']")!;
    const moon = scene.querySelector<HTMLElement>("[data-luminary='moon']")!;
    const layers = [...root.querySelectorAll<HTMLElement>("[data-atmosphere]")];
    const stars = [...scene.querySelectorAll<HTMLElement>("[data-star-group]")];
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = media.matches, paused = false, frame: number | null = null, lastTime = 0, velocity = 0;
    try { paused = sessionStorage.getItem("mind-capsule-motion") === "paused"; } catch { /* Optional preference. */ }
    const paint = () => {
      const sky = skyAt(progress.current);
      layers.forEach((node, i) => { node.style.opacity = String(sky.weights[i]); });
      sun.style.transform = lightTransform(sky.sun);
      sun.style.opacity = String(sky.sun.opacity);
      sun.style.setProperty("--luminary-rgb", sky.sun.color.map(value => value.toFixed(2)).join(","));
      moon.style.transform = lightTransform(sky.moon);
      moon.style.opacity = String(sky.moon.opacity);
      stars.forEach((node, i) => { node.style.opacity = String(sky.stars[i]); });
      root.dataset.skyProgress = progress.current.toFixed(5);
    };
    const measure = () => {
      const panel = root.querySelector<HTMLElement>("[aria-labelledby='keyword-title']");
      if (!panel) return;
      const box = panel.getBoundingClientRect(), parent = root.getBoundingClientRect();
      scene.style.inset = `${box.top - parent.top}px ${parent.right - box.right}px auto ${box.left - parent.left}px`;
      scene.style.height = `${box.height}px`;
      scene.style.setProperty("--sky-width", `${box.width}px`);
      scene.style.setProperty("--sky-height", `${box.height}px`);
    };
    const tick = (now: number) => {
      frame = null;
      if (document.hidden || paused) { lastTime = 0; return; }
      const dt = lastTime ? Math.min((now - lastTime) / 1000, .05) : 0;
      lastTime = now;
      const steps = Math.ceil(dt * 120);
      for (let i = 0; i < steps; i++) {
        const slice = dt / steps, rate = reduced ? 3.5 : 5;
        velocity += ((target.current - progress.current) * rate * rate - 2 * rate * velocity) * slice;
        const limit = reduced ? .12 : .18;
        velocity = Math.max(-limit, Math.min(limit, velocity));
        progress.current = Math.max(0, Math.min(1, progress.current + velocity * slice));
      }
      if (Math.abs(target.current - progress.current) < .00005 && Math.abs(velocity) < .0002) { progress.current = target.current; velocity = 0; }
      paint();
      if (progress.current !== target.current) frame = requestAnimationFrame(tick);
      else lastTime = 0;
    };
    const schedule = () => {
      measure();
      if (document.hidden || paused) {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null; lastTime = 0;
      } else if (frame === null) frame = requestAnimationFrame(tick);
    };
    const motion = (event: Event) => { paused = (event as CustomEvent<{ paused: boolean }>).detail.paused; schedule(); };
    const preference = () => { reduced = media.matches; schedule(); };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    // Question nodes are replaced; observing the host catches their size changes.
    wake.current = schedule;
    window.addEventListener("mind-capsule-motion", motion);
    document.addEventListener("visibilitychange", schedule);
    media.addEventListener("change", preference);
    measure(); paint(); schedule();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      wake.current = null;
      window.removeEventListener("mind-capsule-motion", motion);
      document.removeEventListener("visibilitychange", schedule);
      media.removeEventListener("change", preference);
    };
  }, []);

  const layers = [styles.morning, styles.noon, styles.evening, styles.night];
  return (
    <div ref={host} className={styles.atmosphereHost} data-time-of-day={questionAtmosphere(step)}>
      <div className={styles.atmosphereLayers} aria-hidden="true">
        {layers.map((layer, index) => <div key={layer} className={`${styles.atmosphereLayer} ${layer}`} data-atmosphere={index} style={{ opacity: initial.weights[index] }} />)}
        <div ref={viewport} className={styles.skyViewport}>
          <div data-luminary="sun" className={`${styles.luminary} ${styles.sun}`} style={{ transform: lightTransform(initial.sun), opacity: initial.sun.opacity, "--luminary-rgb": initial.sun.color.join(",") } as CSSProperties} />
          <div data-luminary="moon" className={`${styles.luminary} ${styles.moon}`} style={{ transform: lightTransform(initial.moon), opacity: initial.moon.opacity }} />
          {[0, 1, 2].map(group => <div className={styles.starGroup} data-star-group={group} key={group} style={{ opacity: initial.stars[group] }}>
            {Array.from({ length: 8 + group * 4 }, (_, index) => <i key={index} className={styles.skyStar} style={{ left: `${5 + ((index * 43 + group * 29) % 91)}%`, top: `${5 + ((index * 31 + group * 17) % 84)}%`, width: index % 3 ? "1px" : "1.6px", height: index % 3 ? "1px" : "1.6px" }} />)}
          </div>)}
        </div>
      </div>
      {children}
    </div>
  );
}
