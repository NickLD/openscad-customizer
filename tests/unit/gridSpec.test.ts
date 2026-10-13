import { describe, expect, it } from 'vitest';
import type { Bounds } from '../../src/mesh/bounds';
import { gridFor, gridLines } from '../../src/ui/viewer/gridSpec';

const b = (min: [number, number, number], max: [number, number, number]): Bounds => ({ min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] });
const covers = (g: NonNullable<ReturnType<typeof gridFor>>, bounds: Bounds) =>
  g.minX <= bounds.min[0] && g.maxX >= bounds.max[0] && g.minY <= bounds.min[1] && g.maxY >= bounds.max[1];

describe('gridFor', () => {
  it('sizes a 20 mm grid for the 360 mm wide gland layout and covers it', () => {
    const bounds = b([0, -26, 0], [360, 26, 15]);
    const g = gridFor(bounds)!;
    expect(g.step).toBe(20);
    expect(covers(g, bounds)).toBe(true);
    expect(g.z).toBe(0);
  });

  it('uses a 2 mm grid for a 20 mm keychain', () => {
    const g = gridFor(b([-10, -5, 0], [10, 5, 3]))!;
    expect(g.step).toBe(2);
  });

  it('keeps grid lines on multiples of the step, so one runs through the origin', () => {
    const g = gridFor(b([3, 7, 0], [41, 29, 5]))!;
    expect(Math.abs(g.minX % g.step)).toBe(0);
    expect(Math.abs(g.minY % g.step)).toBe(0);
  });

  it('follows models placed far from the origin', () => {
    const bounds = b([1000, 500, -4], [1050, 530, 0]);
    const g = gridFor(bounds)!;
    expect(covers(g, bounds)).toBe(true);
    expect(g.z).toBe(-4);
  });

  it('has a sensible minimum and handles empty meshes', () => {
    expect(gridFor(b([0, 0, 0], [0.5, 0.5, 0.5]))!.step).toBe(1);
    expect(gridFor({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], size: [-Infinity, -Infinity, -Infinity] })).toBeNull();
  });
});

describe('gridLines', () => {
  it('splits lines into minor and major (every 5th step from the origin)', () => {
    const g = { step: 10, minX: -20, maxX: 20, minY: 0, maxY: 10, z: 0 };
    const { minor, major } = gridLines(g);
    // x lines at -20,-10,0,10,20 (majors: 0) and y lines at 0,10 (major: 0); 2 points × 3 coords each
    expect(major.length / 6).toBe(2);
    expect(minor.length / 6).toBe(5);
  });
});
