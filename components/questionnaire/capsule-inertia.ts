export interface PointerSample { x: number; y: number; time: number }

/** Recent motion only: holding still before release must not produce an old fling. */
export function samplePointer(samples: PointerSample[], x: number, y: number, time: number) {
  const previous = samples[samples.length - 1];
  if (previous?.time === time) { previous.x = x; previous.y = y; }
  else samples.push({ x, y, time });
  // Keep one point before the window so sparse/coalesced input can be interpolated.
  while (samples.length > 2 && time - samples[1].time > 120) samples.shift();
  while (samples.length > 24) samples.shift();
}

export function releaseVelocity(samples: PointerSample[]) {
  const first = samples[0], last = samples[samples.length - 1];
  if (!first || !last || last.time - first.time < 16) return { x: 0, y: 0 };
  const startTime = Math.max(first.time, last.time - 120);
  const next = samples[1];
  const blend = next && first.time < startTime ? (startTime - first.time) / (next.time - first.time) : 0;
  const x = first.x + ((next?.x ?? first.x) - first.x) * blend;
  const y = first.y + ((next?.y ?? first.y) - first.y) * blend;
  const seconds = (last.time - startTime) / 1000;
  return { x: (last.x - x) / seconds, y: (last.y - y) / seconds };
}
