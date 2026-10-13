import type { SemanticGroup } from "@/lib/capsules";

export interface CapsuleBody {
  id: string;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  width: number;
  height: number;
  vx: number;
  vy: number;
  speed: number;
  phase: number;
  turn: number;
  bornAt: number;
  held: boolean;
  detached: boolean;
  recoilUntil: number;
  glideUntil: number;
  glideDuration: number;
  reentering: boolean;
}

export interface FieldBounds { width: number; height: number }
export interface ContactEvent { kind: "capsule" | "boundary"; ids: string[]; x: number; y: number; nx: number; ny: number; strength: number }
export type ContactEmitter = (event: ContactEvent) => void;

const EDGE = 8;
const GAP = 0.75;
const MAX_SPEED = 15;
const GLIDE_SECONDS = 3.2;
const MAX_GLIDE_SPEED = 210;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function createBody(id: string, group: SemanticGroup, geometry: Pick<CapsuleBody, "homeX" | "homeY" | "width" | "height">, time: number): CapsuleBody {
  let seed = 2166136261;
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const random = () => {
    seed = Math.imul(seed ^ (seed >>> 16), 2246822507);
    return (seed >>> 0) / 4294967296;
  };
  const speeds: Record<SemanticGroup, number> = { calm: 7, depth: 8, warm: 9, energy: 10 };
  return {
    ...geometry, id, x: geometry.homeX, y: geometry.homeY, vx: 0, vy: 0,
    speed: speeds[group] + random() * 2,
    phase: random() * Math.PI * 2,
    turn: (random() > 0.5 ? 1 : -1) * (0.055 + random() * 0.045),
    bornAt: time, held: false, detached: false, recoilUntil: 0, glideUntil: 0, glideDuration: GLIDE_SECONDS, reentering: false,
  };
}

/** A weak, capped release impulse decays in the same solver as collisions. */
export function startGlide(body: CapsuleBody, velocity: { x: number; y: number }, time: number, reduced: boolean) {
  const incoming = Math.hypot(velocity.x, velocity.y);
  if (!Number.isFinite(incoming) || incoming < 60) return;
  const speed = Math.min(reduced ? 45 : MAX_GLIDE_SPEED, (incoming - 60) * (reduced ? 0.112 : 0.48));
  body.vx = velocity.x / incoming * speed;
  body.vy = velocity.y / incoming * speed;
  body.glideDuration = reduced ? 0.9 : GLIDE_SECONDS;
  body.glideUntil = time + body.glideDuration;
  body.recoilUntil = 0;
}

function constrain(body: CapsuleBody, bounds: FieldBounds, emit?: ContactEmitter, time = 0) {
  const left = body.width / 2 + EDGE;
  const top = body.height / 2 + EDGE;
  const right = Math.max(left, bounds.width - left);
  const bottom = Math.max(top, bounds.height - top);
  const bounce = (axis: "x" | "y", sign: number, x: number, y: number) => {
    const speed = Math.abs(axis === "x" ? body.vx : body.vy);
    if (axis === "x") body.vx = sign * Math.max(1.3, speed * (time < body.glideUntil ? 0.68 : 0.46));
    else body.vy = sign * Math.max(1.3, speed * (time < body.glideUntil ? 0.68 : 0.46));
    body.recoilUntil = time + 0.55;
    if (speed > 0.8) emit?.({ kind: "boundary", ids: [body.id], x, y, nx: axis === "x" ? sign : 0, ny: axis === "y" ? sign : 0, strength: speed });
  };
  if (body.x < left) { body.x = left; bounce("x", 1, EDGE, body.y); }
  if (body.x > right) { body.x = right; bounce("x", -1, bounds.width - EDGE, body.y); }
  if (body.y < top) { body.y = top; bounce("y", 1, body.x, EDGE); }
  if (body.y > bottom) { body.y = bottom; bounce("y", -1, body.x, bounds.height - EDGE); }
}

/** Closest points of the two rounded-pill center segments, then their surfaces. */
export function capsuleContact(a: CapsuleBody, b: CapsuleBody, gap = GAP) {
  const ar = Math.min(a.width, a.height) / 2, br = Math.min(b.width, b.height) / 2;
  const ah = a.width >= a.height, bh = b.width >= b.height;
  const al = (Math.max(a.width, a.height) - 2 * ar) / 2;
  const bl = (Math.max(b.width, b.height) - 2 * br) / 2;
  let ax = a.x, ay = a.y, bx = b.x, by = b.y;
  if (ah && bh) {
    const low = Math.max(a.x - al, b.x - bl), high = Math.min(a.x + al, b.x + bl);
    if (low <= high) ax = bx = (low + high) / 2;
    else { ax = clamp(b.x, a.x - al, a.x + al); bx = clamp(ax, b.x - bl, b.x + bl); }
  } else if (!ah && !bh) {
    const low = Math.max(a.y - al, b.y - bl), high = Math.min(a.y + al, b.y + bl);
    if (low <= high) ay = by = (low + high) / 2;
    else { ay = clamp(b.y, a.y - al, a.y + al); by = clamp(ay, b.y - bl, b.y + bl); }
  } else if (ah) { ax = clamp(b.x, a.x - al, a.x + al); by = clamp(a.y, b.y - bl, b.y + bl); }
  else { ay = clamp(b.y, a.y - al, a.y + al); bx = clamp(a.x, b.x - bl, b.x + bl); }
  const dx = bx - ax, dy = by - ay, distance = Math.hypot(dx, dy);
  let nx = distance > 0.0001 ? dx / distance : 0;
  let ny = distance > 0.0001 ? dy / distance : (b.y >= a.y ? 1 : -1);
  if (distance < 0.0001 && !ah && !bh) { nx = b.x >= a.x ? 1 : -1; ny = 0; }
  return { nx, ny, penetration: ar + br + gap - distance,
    x: (ax + nx * ar + bx - nx * br) / 2,
    y: (ay + ny * ar + by - ny * br) / 2 };
}

/** Rounded capsule collision, with a subpixel safety margin. */
export function separateBodies(bodies: CapsuleBody[], bounds: FieldBounds, emit?: ContactEmitter, time = 0): number {
  let contacts = 0;
  for (const body of bodies) if (!body.held && !body.detached) constrain(body, bounds, emit, time);
  for (let pass = 0; pass < 8; pass++) {
    let corrected = false;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        if (a.detached || b.detached) continue;
        const massA = a.held ? 0 : 1, massB = b.held ? 0 : 1;
        const mass = massA + massB;
        if (!mass) continue;
        if (Math.abs(b.x - a.x) > (a.width + b.width) / 2 + GAP || Math.abs(b.y - a.y) > (a.height + b.height) / 2 + GAP) continue;
        const contact = capsuleContact(a, b);
        if (contact.penetration <= 0) continue;
        const { nx, ny } = contact;
        const amount = contact.penetration + 0.02;
        a.x -= nx * amount * massA / mass; a.y -= ny * amount * massA / mass;
        b.x += nx * amount * massB / mass; b.y += ny * amount * massB / mass;
        if (pass === 0) {
          const approach = ((b.held ? 0 : b.vx) - (a.held ? 0 : a.vx)) * nx + ((b.held ? 0 : b.vy) - (a.held ? 0 : a.vy)) * ny;
          if (approach < 0) {
            // More visible recoil, still bounded and strongly damped.
            const energetic = time < a.glideUntil || time < b.glideUntil;
            const separatingSpeed = Math.max(-approach * (energetic ? .64 : .42), approach < -1.2 ? 2.4 : 0);
            // An actively pushed capsule responds more lightly than a resting one.
            const responseA = massA * (energetic && time >= a.glideUntil ? .35 : 1);
            const responseB = massB * (energetic && time >= b.glideUntil ? .35 : 1);
            const impulse = (-approach + separatingSpeed) / (responseA + responseB);
            a.vx -= impulse * nx * responseA; a.vy -= impulse * ny * responseA;
            b.vx += impulse * nx * responseB; b.vy += impulse * ny * responseB;
            if (energetic && -approach > 35) for (const peer of [a, b]) {
              if (!peer.held && time >= peer.glideUntil) { peer.glideDuration = 2; peer.glideUntil = time + 2; }
            }
            contacts++;
            if (!a.held) a.recoilUntil = time + 0.5;
            if (!b.held) b.recoilUntil = time + 0.5;
            if (approach < -0.8) emit?.({ kind: "capsule", ids: [a.id, b.id], ...capsuleContact(a, b), strength: -approach });
          }
        }
        if (!a.held) constrain(a, bounds, emit, time);
        if (!b.held) constrain(b, bounds, emit, time);
        corrected = true;
      }
    }
    if (!corrected) break;
  }
  return contacts;
}

export function advanceBodies(bodies: CapsuleBody[], bounds: FieldBounds, dt: number, time: number, reduced: boolean, emit?: ContactEmitter): number {
  const ease = 1 - Math.exp(-dt * 0.75);
  for (const body of bodies) {
    if (body.reentering && !body.held) {
      // Outside releases stay in the top layer and physically steer back inside.
      const halfX = body.width / 2 + EDGE, halfY = body.height / 2 + EDGE;
      const x = clamp(body.x, halfX + 1, bounds.width - halfX - 1);
      const y = clamp(body.y, halfY + 1, bounds.height - halfY - 1);
      body.vx += ((x - body.x) * 22 - body.vx * 6) * dt;
      body.vy += ((y - body.y) * 22 - body.vy * 6) * dt;
      const speed = Math.hypot(body.vx, body.vy), limit = reduced ? 65 : MAX_GLIDE_SPEED;
      if (speed > limit) { body.vx *= limit / speed; body.vy *= limit / speed; }
      body.x += body.vx * dt; body.y += body.vy * dt;
      if (body.x >= halfX && body.x <= bounds.width - halfX && body.y >= halfY && body.y <= bounds.height - halfY) {
        body.reentering = false; body.detached = false;
      }
      continue;
    }
    if (body.held || body.detached) continue;
    const age = Math.max(0, time - body.bornAt - 0.9);
    const ramp = Math.min(1, age / 2.2);
    const speed = body.speed * (reduced ? 0.65 : 1) * ramp * ramp * (3 - 2 * ramp);
    const angle = body.phase + time * body.turn + Math.sin(time * 0.17 + body.phase) * 0.55;
    let aimX = Math.cos(angle) * speed;
    let aimY = Math.sin(angle) * speed * 0.85;
    const left = body.width / 2 + EDGE, top = body.height / 2 + EDGE;
    const right = bounds.width - left, bottom = bounds.height - top;
    const near = (distance: number) => Math.max(0, 1 - distance / 22) ** 2;
    // Anticipatory steering turns most capsules before the hard boundary.
    aimX += (near(body.x - left) - near(right - body.x)) * speed * 1.4;
    aimY += (near(body.y - top) - near(bottom - body.y)) * speed * 1.4;
    const gliding = time < body.glideUntil;
    const progress = clamp(1 - (body.glideUntil - time) / body.glideDuration, 0, 1);
    const flowBlend = gliding ? progress * progress * (3 - 2 * progress) : 1;
    if (gliding) { const damping = Math.exp(-dt * (reduced ? 3 : 1.05)); body.vx *= damping; body.vy *= damping; }
    const steering = (time < body.recoilUntil ? ease * 0.15 : ease) * flowBlend;
    body.vx += (aimX - body.vx) * steering;
    body.vy += (aimY - body.vy) * steering;
    const velocity = Math.hypot(body.vx, body.vy);
    const limit = gliding ? reduced ? 45 : MAX_GLIDE_SPEED : MAX_SPEED;
    if (velocity > limit) { body.vx *= limit / velocity; body.vy *= limit / velocity; }
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    constrain(body, bounds, emit, time);
  }
  return separateBodies(bodies, bounds, emit, time);
}

export function findOpenPosition(body: CapsuleBody, others: CapsuleBody[], bounds: FieldBounds) {
  const preferred = { x: body.x, y: body.y };
  const fits = (x: number, y: number) => x >= body.width / 2 + EDGE && x <= bounds.width - body.width / 2 - EDGE
    && y >= body.height / 2 + EDGE && y <= bounds.height - body.height / 2 - EDGE
    && others.every(other => Math.abs(x - other.x) >= (body.width + other.width) / 2 + GAP || Math.abs(y - other.y) >= (body.height + other.height) / 2 + GAP);
  if (fits(body.x, body.y)) return;
  let candidate: { x: number; y: number; distance: number } | null = null;
  for (let y = body.height / 2 + EDGE; y <= bounds.height - body.height / 2 - EDGE; y += 18) {
    for (let x = body.width / 2 + EDGE; x <= bounds.width - body.width / 2 - EDGE; x += 18) {
      const distance = Math.hypot(x - preferred.x, y - preferred.y);
      if (fits(x, y) && (!candidate || distance < candidate.distance)) candidate = { x, y, distance };
    }
  }
  if (candidate) { body.x = candidate.x; body.y = candidate.y; }
  else { body.x = clamp(body.x, body.width / 2 + EDGE, bounds.width - body.width / 2 - EDGE); body.y = clamp(body.y, body.height / 2 + EDGE, bounds.height - body.height / 2 - EDGE); }
}
