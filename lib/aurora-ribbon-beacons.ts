/** CSS pixel layout: every real surface anchor remains connected to its displaced
 * accessible marker. HTML markers deliberately stay visible through transparent
 * geometry; depth is used to choose a candidate, never to hide an active ribbon. */
export interface AuroraBeaconPlacement { anchorX: number; anchorY: number; x: number; y: number }
export function placeAuroraBeacon(item: AuroraBeaconPlacement, prior: readonly AuroraBeaconPlacement[], width: number, height: number): void {
  const left = 30, right = Math.max(left, width - 30), top = Math.min(145, height * .23), bottom = Math.max(top, height - 205);
  let best = Infinity, bx = left, by = top;
  const columns = Math.max(1, Math.floor((right - left) / 62) + 1), rows = Math.max(1, Math.floor((bottom - top) / 62) + 1);
  for (let step = 0; step < 121 + columns * rows; step++) {
    const ring = Math.ceil(step / 12), angle = step * 2.399963229728653;
    const x = step < 121 ? Math.max(left, Math.min(right, item.anchorX + Math.cos(angle) * ring * 29))
      : left + ((step - 121) % columns) * 62;
    const y = step < 121 ? Math.max(top, Math.min(bottom, item.anchorY + Math.sin(angle) * ring * 29))
      : top + Math.floor((step - 121) / columns) * 62;
    let penalty = Math.hypot(x - item.anchorX, y - item.anchorY);
    for (const other of prior) penalty += Math.max(0, 62 - Math.hypot(x - other.x, y - other.y)) * 10000;
    if (penalty < best) { best = penalty; bx = x; by = y; }
  }
  item.x = bx; item.y = by;
}

export interface AuroraBeaconCandidate { u: number; x: number; y: number; depth: number; valid: boolean; exposed: boolean }
export interface AuroraBeaconAnchorState {
  u: number; targetU: number; fromU: number; age: number; outside: number; transition: number; initialized: boolean; switches: number;
}
const wrap = (u: number) => ((u % 1) + 1) % 1;
const arc = (a: number, b: number) => wrap(b - a + .5) - .5;
export function createAuroraBeaconAnchor(): AuroraBeaconAnchorState {
  return { u: .2, targetU: .2, fromU: .2, age: 0, outside: 0, transition: 1, initialized: false, switches: 0 };
}
/** Screen score can choose the first/fallback anchor, never replace a healthy
 * physical segment just because another ribbon or the camera moved slightly. */
export function advanceAuroraBeaconAnchor(state: AuroraBeaconAnchorState, candidates: readonly AuroraBeaconCandidate[], delta: number, pinned: boolean, immediate = false): boolean {
  const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, .1)) : 0;
  state.age += dt;
  const current = candidates.find(c => Math.abs(arc(c.u, state.targetU)) < .0001);
  state.outside = current?.valid && current.exposed ? 0 : state.outside + dt;
  if (!pinned && (!state.initialized || (!current?.valid || state.outside >= .22) && state.age >= 1.2 && state.transition >= 1)) {
    let best: AuroraBeaconCandidate | undefined, score = Infinity;
    for (const c of candidates) {
      if (!c.valid) continue;
      const cost = (c.exposed ? 0 : 10000) + c.depth * 10 + Math.abs(arc(state.u, c.u)) * 20;
      if (cost < score) { score = cost; best = c; }
    }
    if (best && (!state.initialized || Math.abs(arc(best.u, state.targetU)) > .0001)) {
      state.fromU = state.u; state.targetU = best.u; state.age = 0; state.outside = 0;
      if (state.initialized) { state.transition = 0; state.switches++; }
      else { state.u = best.u; state.initialized = true; }
    }
  }
  if (!state.initialized) return false;
  if (immediate) { state.u = state.targetU; state.transition = 1; }
  if (!pinned && state.transition < 1) {
    state.transition = Math.min(1, state.transition + dt / .65);
    const t = state.transition, ease = t * t * t * (t * (t * 6 - 15) + 10);
    state.u = wrap(state.fromU + arc(state.fromU, state.targetU) * ease);
  }
  return true;
}

export interface AuroraStableBeacon extends AuroraBeaconPlacement {
  offsetX: number; offsetY: number; lastAnchorX: number; lastAnchorY: number; initialized: boolean; release: number;
  goal: AuroraBeaconPlacement;
}
export function createAuroraStableBeacon(): AuroraStableBeacon {
  return { anchorX: 0, anchorY: 0, x: 0, y: 0, offsetX: 0, offsetY: 0, lastAnchorX: 0, lastAnchorY: 0, initialized: false, release: 0,
    goal: { anchorX: 0, anchorY: 0, x: 0, y: 0 } };
}
/** Camera translation follows the exact projection without lag; damping acts on
 * while collision offsets retain their side until separation is safely clear.
 * Stable ID order owns collision priority. Caller reserves hovered targets first. */
export function advanceAuroraBeaconPlacement(item: AuroraStableBeacon, prior: readonly AuroraBeaconPlacement[], width: number, height: number,
  delta: number, pinned = false, resync = false): void {
  const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, .1)) : 0;
  const left = 30, right = Math.max(left, width - 30), top = Math.min(145, height * .23), bottom = Math.max(top, height - 205);
  const goal = item.goal;
  goal.anchorX = Math.max(left, Math.min(right, item.anchorX)); goal.anchorY = Math.max(top, Math.min(bottom, item.anchorY));
  if (pinned && item.initialized) { item.lastAnchorX = goal.anchorX; item.lastAnchorY = goal.anchorY; return; }
  goal.x = Math.max(left, Math.min(right, goal.anchorX + item.offsetX)); goal.y = Math.max(top, Math.min(bottom, goal.anchorY + item.offsetY));
  let blocked = false, clear = true;
  for (const other of prior) {
    if (Math.hypot(goal.x - other.x, goal.y - other.y) < 58) blocked = true;
    if (Math.hypot(goal.anchorX - other.x, goal.anchorY - other.y) < 92) clear = false;
  }
  item.release = clear ? item.release + dt : 0;
  if (blocked) {
    // Search around the stable offset, not around a fresh physical point each frame.
    const ax = goal.anchorX, ay = goal.anchorY;
    goal.anchorX = goal.x; goal.anchorY = goal.y;
    placeAuroraBeacon(goal, prior, width, height);
    goal.anchorX = ax; goal.anchorY = ay;
    item.offsetX = goal.x - ax; item.offsetY = goal.y - ay;
  } else if (item.release > .8) {
    const fade = Math.exp(-dt * 3);
    item.offsetX *= fade; item.offsetY *= fade;
    goal.x = goal.anchorX + item.offsetX; goal.y = goal.anchorY + item.offsetY;
  }
  // At most 144px of intentional displacement within the viewport. Offscreen
  // physical anchors retain an honest clipped leader to this reachable marker.
  const extent = Math.hypot(item.offsetX, item.offsetY);
  if (extent > 144 && !blocked) {
    item.offsetX *= 144 / extent; item.offsetY *= 144 / extent;
    goal.x = goal.anchorX + item.offsetX; goal.y = goal.anchorY + item.offsetY;
  }
  if (!item.initialized || resync) { item.x = goal.x; item.y = goal.y; item.initialized = true; }
  else {
    // Apply the exact camera/physical-anchor translation without lag. Smooth
    // ONLY the intentional collision offset, so a 60px layout goal never invokes
    // the old absolute 10px-lag clamp and becomes an artificial 50px jump.
    item.x += goal.anchorX - item.lastAnchorX; item.y += goal.anchorY - item.lastAnchorY;
    const response = 1 - Math.exp(-dt * 10);
    item.x += (goal.x - item.x) * response; item.y += (goal.y - item.y) * response;
  }
  item.lastAnchorX = Math.max(left, Math.min(right, item.anchorX)); item.lastAnchorY = Math.max(top, Math.min(bottom, item.anchorY));
  // Minimal continuous projection onto the reachable circles, not a fresh
  // spiral/grid jump for a one-pixel penetration during a transition.
  let constrained = false;
  for (let iteration = 0; iteration < 4; iteration++) {
    let conflict = false;
    for (const other of prior) {
      const dx = item.x - other.x, dy = item.y - other.y, d = Math.hypot(dx, dy);
      if (d >= 52) continue;
      if (d < .001) {
        goal.anchorX = item.x; goal.anchorY = item.y;
        placeAuroraBeacon(goal, prior, width, height); item.x = goal.x; item.y = goal.y;
      } else {
        item.x = other.x + dx / d * 52; item.y = other.y + dy / d * 52;
        item.x = Math.max(left, Math.min(right, item.x)); item.y = Math.max(top, Math.min(bottom, item.y));
      }
      constrained = true; conflict = true;
    }
    if (!conflict) break;
  }
  if (constrained) {
    item.offsetX = item.x - item.lastAnchorX; item.offsetY = item.y - item.lastAnchorY;
  }
}
