import type { Bounds } from '../../mesh/bounds';

/** Square print-bed grid in the XY plane, with lines on multiples of `step` (so one passes through the origin). */
export type GridSpec = { step: number; minX: number; maxX: number; minY: number; maxY: number; z: number };

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
/** Pick the finest step that keeps the grid at or under this many cells across. */
const MAX_CELLS = 22;
const MARGIN = 1.2;
const MIN_SPAN = 10;
const MAJOR_EVERY = 5;

export function gridFor(b: Bounds): GridSpec | null {
  if (![...b.min, ...b.max].every(Number.isFinite)) return null;
  const span = Math.max(b.size[0] * MARGIN, b.size[1] * MARGIN, MIN_SPAN);
  const step = STEPS.find((s) => span / s <= MAX_CELLS) ?? STEPS[STEPS.length - 1];
  const half = span / 2;
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const down = (v: number) => Math.floor(v / step) * step;
  const up = (v: number) => Math.ceil(v / step) * step;
  return { step, minX: down(cx - half), maxX: up(cx + half), minY: down(cy - half), maxY: up(cy + half), z: b.min[2] };
}

/** Line segment endpoints (x, y, z pairs), split so every 5th line from the origin can be drawn darker. */
export function gridLines(g: GridSpec): { minor: number[]; major: number[] } {
  const minor: number[] = [];
  const major: number[] = [];
  const push = (k: number, a: number[]) => (k % MAJOR_EVERY === 0 ? major : minor).push(...a);
  for (let k = Math.round(g.minX / g.step); k <= Math.round(g.maxX / g.step); k++) {
    const x = k * g.step;
    push(k, [x, g.minY, g.z, x, g.maxY, g.z]);
  }
  for (let k = Math.round(g.minY / g.step); k <= Math.round(g.maxY / g.step); k++) {
    const y = k * g.step;
    push(k, [g.minX, y, g.z, g.maxX, y, g.z]);
  }
  return { minor, major };
}
