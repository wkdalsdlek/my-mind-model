const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const p = clamp(value); return p * p * (3 - 2 * p); };

/** One reversible day, sampled at a continuous progress rather than a question key. */
export function skyAt(progress: number) {
  const p = clamp(progress), day = clamp(p / .82), rise = clamp((p - .71) / .29);
  const sunHeight = Math.sin(day * Math.PI);
  const noon = smooth(day * 2), sunset = smooth((day - .5) * 2);
  const sunColor = sunset > 0
    ? [245 - 8 * sunset, 240 - 75 * sunset, 224 - 89 * sunset]
    : [245 - 6 * noon, 209 + 31 * noon, 194 + 30 * noon];
  const stops = [0, .42, .72, 1];
  const weights = [0, 0, 0, 0];
  let index = 0;
  while (index < 2 && p > stops[index + 1]) index++;
  const mix = smooth((p - stops[index]) / (stops[index + 1] - stops[index]));
  weights[index] = 1 - mix; weights[index + 1] = mix;
  return {
    weights,
    sun: { x: 12 + 78 * day, y: 75 - 61 * sunHeight, scale: .85 + .28 * sunHeight, opacity: .9 * (1 - smooth((p - .7) / .16)), color: sunColor },
    moon: { x: 87 - 22 * rise, y: 85 - 56 * Math.sin(rise * Math.PI / 2), scale: .7 + .2 * rise, opacity: .85 * smooth((p - .75) / .2) },
    stars: [smooth((p - .69) / .2), smooth((p - .8) / .18), smooth((p - .89) / .11)],
  };
}
