import type { CapsuleMotion } from "./useCapsulePhysics";
import type { ContactEvent } from "./capsule-physics";

interface Particle { node: HTMLElement | SVGGElement; animation: Animation | null }
let maskSequence = 0;

/** Fixed DOM pools: effects never add React renders or an unbounded particle list. */
export function createCapsuleEffects(sparkLayer: HTMLElement, trailLayer: HTMLElement, dustClass: string, trailClass: string, flashClass: string) {
  const createPool = (layer: HTMLElement, className: string, count: number): Particle[] => Array.from({ length: count }, () => {
    const node = document.createElement("i");
    node.className = className;
    node.style.opacity = "0";
    layer.appendChild(node);
    return { node, animation: null };
  });
  const sparks = createPool(sparkLayer, dustClass, 80);
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
  const defs = document.createElementNS(svgNS, "defs"), mask = document.createElementNS(svgNS, "mask");
  const maskId = `capsule-trail-${Date.now()}-${++maskSequence}`;
  mask.id = maskId; mask.setAttribute("maskUnits", "userSpaceOnUse");
  const background = document.createElementNS(svgNS, "rect");
  background.setAttribute("width", "100%"); background.setAttribute("height", "100%"); background.setAttribute("fill", "white");
  mask.appendChild(background);
  const holes = Array.from({ length: 8 }, () => {
    const node = document.createElementNS(svgNS, "rect"); node.setAttribute("fill", "black"); node.setAttribute("width", "0"); mask.appendChild(node); return node;
  });
  defs.appendChild(mask); svg.appendChild(defs);
  const ribbons = document.createElementNS(svgNS, "g"); ribbons.setAttribute("mask", `url(#${maskId})`); svg.appendChild(ribbons); trailLayer.appendChild(svg);
  const trails: Particle[] = Array.from({ length: 48 }, () => {
    const node = document.createElementNS(svgNS, "g"); node.classList.add(trailClass); node.style.opacity = "0";
    for (const role of ["halo", "ribbon", "core"]) {
      const path = document.createElementNS(svgNS, "path"); path.dataset.role = role; node.appendChild(path);
    }
    const grain = document.createElementNS(svgNS, "circle"); grain.dataset.role = "grain"; grain.setAttribute("r", "1"); node.appendChild(grain);
    ribbons.appendChild(node); return { node, animation: null };
  });
  const masks = new Map<string, number>();
  const maskSeen = new Map<string, number>();
  const flashes = createPool(sparkLayer, flashClass, 3);
  let lite = navigator.hardwareConcurrency <= 4;
  let slowFrames = 0;
  const cooldowns = new Map<string, number>();
  let lastBurst = -Infinity;
  const paths = new Map<string, { x: number; y: number; endX: number; endY: number; time: number }>();
  let trailIndex = 0;
  let trailCount = 0;
  let emitted = 0;
  const positionLayer = () => {
    const box = sparkLayer.parentElement!.getBoundingClientRect();
    sparkLayer.style.setProperty("--dust-left", `${box.left}px`);
    sparkLayer.style.setProperty("--dust-top", `${box.top}px`);
    sparkLayer.style.setProperty("--dust-width", `${box.width}px`);
    sparkLayer.style.setProperty("--dust-height", `${box.height}px`);
  };

  const spark = (event: ContactEvent, colors: string[]) => {
    const now = performance.now();
    const key = `${event.kind}:${[...event.ids].sort().join(":")}`;
    if (now - lastBurst < 300 || now - (cooldowns.get(key) ?? -Infinity) < 850) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const strength = Math.min(1, event.strength / 150);
    const count = reduced ? 8 : Math.min(lite ? 14 : 20, 12 + Math.floor(strength * 8));
    const free = sparks.slice(0, reduced ? 32 : lite ? 48 : 80).filter(p => !p.animation || p.animation.playState === "finished" || p.animation.playState === "idle");
    if (free.length < count || document.hidden) return;
    if (typeof sparkLayer.showPopover === "function") {
      positionLayer();
      sparkLayer.setAttribute("popover", "manual");
      if (sparkLayer.matches(":popover-open")) sparkLayer.hidePopover();
      sparkLayer.showPopover();
    }
    lastBurst = now;
    cooldowns.set(key, now);
    emitted++;
    sparkLayer.dataset.bursts = String(emitted);
    sparkLayer.dataset.lastKind = event.kind;
    sparkLayer.dataset.contact = JSON.stringify({ ...event, count });
    if (cooldowns.size > 100) for (const [id, time] of cooldowns) if (now - time > 2000) cooldowns.delete(id);
    let seed = emitted * 7919;
    const random = () => { seed = Math.imul(seed ^ (seed >>> 13), 1597334677); return (seed >>> 0) / 4294967296; };
    const normalAngle = Math.atan2(event.ny, event.nx);
    const flash = flashes.find(p => !p.animation || ["finished", "idle"].includes(p.animation.playState));
    if (flash && !reduced) {
      flash.node.style.setProperty("--fx-rgb", colors[0]);
      const size = 24 + strength * 36;
      flash.node.style.width = flash.node.style.height = `${size}px`;
      flash.animation = flash.node.animate([
        { transform: `translate3d(${event.x - size / 2}px, ${event.y - size / 2}px, 0) scale(.4)`, opacity: .65 },
        { transform: `translate3d(${event.x - size / 2}px, ${event.y - size / 2}px, 0) scale(1.2)`, opacity: 0 },
      ], { duration: 160, easing: "ease-out" });
    }
    free.slice(0, count).forEach((particle, index) => {
      const side = event.kind === "boundary" || index % 2 === 0 ? 1 : -1;
      const angle = normalAngle + (side < 0 ? Math.PI : 0) + (random() - .5) * 1.45;
      const radius = (28 + strength * 75 + random() * 25) * (reduced ? .3 : lite ? .8 : 1);
      const dx = Math.cos(angle) * radius, dy = Math.sin(angle) * radius;
      const spin = (random() - .5) * 100;
      const duration = reduced ? 500 : 700 + random() * (lite ? 180 : 300);
      particle.node.style.setProperty("--fx-rgb", colors[index % colors.length]);
      particle.node.dataset.shape = ["grain", "sliver", "shard", "glow"][index % 4];
      const size = 2 + random() * 4;
      particle.node.style.width = `${size}px`;
      particle.node.style.height = `${index % 4 === 1 ? 2 : size}px`;
      particle.node.dataset.travel = radius.toFixed(2);
      particle.node.dataset.effectKind = event.kind;
      particle.node.dataset.side = String(side);
      const transform = (distance: number, scale: number) => `translate3d(${event.x + dx * distance}px, ${event.y + dy * distance}px, 0) rotate(${spin * distance}deg) scale(${scale})`;
      particle.animation = particle.node.animate([
        { transform: transform(0, .45), opacity: 0 },
        { transform: transform(.28, 1), opacity: reduced ? .65 : .96, offset: .07 },
        { transform: transform(.8, .9), opacity: .65, offset: .38 },
        { transform: transform(1, .3), opacity: 0 },
      // Position keyframes already decelerate; linear time keeps the light alive.
      ], { duration, easing: "linear" });
    });
  };

  const trail = (sample: CapsuleMotion, color: string) => {
    const now = performance.now(), reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (sample.frameMs > 45) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames >= 16) lite = true;
    trailLayer.dataset.density = reduced ? "reduced" : lite ? "lite" : "full";
    for (const [id, index] of masks) if (now - (maskSeen.get(id) ?? 0) > 1000) {
      holes[index].setAttribute("width", "0"); masks.delete(id); maskSeen.delete(id);
    }
    let holeIndex = masks.get(sample.id);
    if (holeIndex === undefined) {
      const index = holes.findIndex((_, i) => ![...masks.values()].includes(i));
      if (index >= 0) { holeIndex = index; masks.set(sample.id, index); }
    }
    if (holeIndex !== undefined) {
      maskSeen.set(sample.id, now);
      const hole = holes[holeIndex], scale = sample.source === "drag" ? 1.055 : 1;
      const width = sample.width * scale + 4, height = sample.height * scale + 4;
      hole.setAttribute("x", String(sample.x - width / 2)); hole.setAttribute("y", String(sample.y - height / 2));
      hole.setAttribute("width", String(width)); hole.setAttribute("height", String(height)); hole.setAttribute("rx", String(height / 2));
    }
    const speed = Math.hypot(sample.vx, sample.vy);
    if (speed < (reduced ? 32 : 22) || document.hidden) { paths.delete(sample.id); return; }
    const point = paths.get(sample.id);
    const angle = Math.atan2(sample.vy, sample.vx), dx = Math.cos(angle), dy = Math.sin(angle);
    const edge = Math.min(sample.width / 2 / Math.max(Math.abs(dx), .001), sample.height / 2 / Math.max(Math.abs(dy), .001)) + 5;
    const x = sample.x - dx * edge, y = sample.y - dy * edge;
    const current = { x, y, endX: x, endY: y, time: now };
    if (!point || now - point.time > 1000) { paths.set(sample.id, current); return; }
    const distance = Math.hypot(x - point.x, y - point.y);
    if (now - point.time < (reduced ? 65 : lite ? 45 : 32) || distance < 2.5) return;
    const particle = trails[trailIndex++ % (reduced ? 16 : lite ? 28 : 48)];
    particle.animation?.cancel();
    const strength = Math.min(1, speed / (sample.source === "drag" ? 550 : 210));
    const thickness = reduced ? 2 : 3.5 + strength * 5;
    particle.node.style.setProperty("--fx-rgb", color);
    particle.node.style.strokeWidth = `${thickness}px`;
    particle.node.dataset.source = sample.source;
    particle.node.dataset.capsuleId = sample.id;
    particle.node.dataset.angle = angle.toFixed(4);
    const endX = (point.x + x) / 2, endY = (point.y + y) / 2;
    const pathData = `M ${point.endX} ${point.endY} Q ${point.x} ${point.y} ${endX} ${endY}`;
    particle.node.querySelectorAll("path").forEach(path => path.setAttribute("d", pathData));
    particle.node.querySelector("[data-role='halo']")!.setAttribute("stroke-width", String(thickness * 2));
    const grain = particle.node.querySelector("circle")!;
    grain.setAttribute("cx", String((point.endX + endX) / 2)); grain.setAttribute("cy", String((point.endY + endY) / 2));
    particle.animation = particle.node.animate([
      { opacity: reduced ? .3 : .4 + strength * .45, strokeWidth: `${thickness}px` },
      { opacity: .32, strokeWidth: `${thickness * .55}px`, offset: .65 },
      { opacity: 0, strokeWidth: ".2px" },
    ], { duration: reduced ? 400 : lite ? 700 : 900, easing: "linear" });
    current.endX = endX; current.endY = endY;
    paths.set(sample.id, current);
    trailLayer.dataset.samples = String(++trailCount);
    // Only recent streams are retained, even with many custom capsules.
    if (paths.size > 8) for (const [id, old] of paths) if (now - old.time > 1000) paths.delete(id);
  };

  const suspended = new Set<Animation>();
  const visibility = () => {
    if (document.hidden) {
      [...sparks, ...trails, ...flashes].forEach(p => { if (p.animation?.playState === "running") { suspended.add(p.animation); p.animation.pause(); } });
    } else { positionLayer(); suspended.forEach(animation => animation.play()); suspended.clear(); }
  };
  const motion = (event: Event) => {
    if ((event as CustomEvent<{ paused: boolean }>).detail.paused) {
      [...sparks, ...trails, ...flashes].forEach(p => p.animation?.cancel()); suspended.clear(); paths.clear();
    }
  };
  document.addEventListener("visibilitychange", visibility);
  const scroll = () => { if (sparks.some(p => p.animation?.playState === "running")) positionLayer(); };
  window.addEventListener("scroll", scroll, true);
  window.addEventListener("mind-capsule-motion", motion);
  return {
    spark, trail,
    resetTrail: (id: string) => { paths.delete(id); },
    destroy: () => {
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("scroll", scroll, true); window.removeEventListener("mind-capsule-motion", motion);
      if (typeof sparkLayer.showPopover === "function" && sparkLayer.matches(":popover-open")) sparkLayer.hidePopover();
      sparkLayer.removeAttribute("popover");
      suspended.clear(); [...sparks, ...trails, ...flashes].forEach(p => { p.animation?.cancel(); p.node.remove(); }); cooldowns.clear(); paths.clear(); svg.remove();
    },
  };
}

export type CapsuleEffects = ReturnType<typeof createCapsuleEffects>;
