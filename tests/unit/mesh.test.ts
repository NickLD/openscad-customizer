import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { meshBounds } from '../../src/mesh/bounds';
import { parseOff } from '../../src/mesh/off';
import { meshToStl } from '../../src/mesh/stl';
import { meshToThreeMF } from '../../src/mesh/threemf';
import { triangulateFace } from '../../src/mesh/triangulate';
import { decodeText } from '../../src/util';

const CUBE_QUADS = `OFF 8 6 0
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
4 4 5 7 6
4 2 3 1 0
4 0 1 5 4
4 1 3 7 5
4 3 2 6 7
4 2 0 4 6
`;

const COLORED = `OFF
3 2 0
0 0 0
1 0 0
0 1 0
3 0 1 2 255 0 0
3 0 2 1 249 215 44
`;

function normal(m: ReturnType<typeof parseOff>, t: number) {
  const p = (i: number) => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
  const [a, b, c] = [p(m.triangles[3 * t]), p(m.triangles[3 * t + 1]), p(m.triangles[3 * t + 2])];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

describe('parseOff', () => {
  it('triangulates quads keeping outward winding', () => {
    const m = parseOff(CUBE_QUADS);
    expect(m.positions.length).toBe(24);
    expect(m.triangles.length / 3).toBe(12);
    expect(m.colors).toBeNull();
    // Face "4 4 5 7 6" is the top (z=1): its triangles must point +Z.
    expect(normal(m, 0)[2]).toBeGreaterThan(0);
    expect(normal(m, 1)[2]).toBeGreaterThan(0);
  });

  it('reads per-face colors (header counts on their own line)', () => {
    const m = parseOff(COLORED);
    expect(Array.from(m.colors!)).toEqual([255, 0, 0, 255, 249, 215, 44, 255]);
  });

  it('rejects non-OFF input', () => {
    expect(() => parseOff('solid x')).toThrow(/OFF/);
  });
});

describe('triangulateFace', () => {
  it('handles a concave L-shaped polygon', () => {
    // L shape in the XY plane, counter-clockwise
    const pts = [0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0];
    const tris = triangulateFace(new Float32Array(pts), [0, 1, 2, 3, 4, 5]);
    expect(tris).toHaveLength(4);
    const area = tris.reduce((s, [a, b, c]) => {
      const [ax, ay, bx, by, cx, cy] = [pts[3 * a], pts[3 * a + 1], pts[3 * b], pts[3 * b + 1], pts[3 * c], pts[3 * c + 1]];
      return s + ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
    }, 0);
    expect(area).toBeCloseTo(3); // all positive (CCW) and summing to the L's area
  });
});

describe('writers', () => {
  it('writes binary STL', () => {
    const stl = meshToStl(parseOff(CUBE_QUADS));
    expect(stl.length).toBe(84 + 12 * 50);
    expect(new DataView(stl.buffer).getUint32(80, true)).toBe(12);
  });

  it('writes a 3MF package with colors as base materials', () => {
    const files = unzipSync(meshToThreeMF(parseOff(COLORED)));
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = decodeText(files['3D/3dmodel.model']);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('displaycolor="#FF0000FF"');
    expect(model).toContain('displaycolor="#F9D72CFF"');
    expect(model.match(/<triangle /g)).toHaveLength(2);
    expect(model).toContain('p1="1"');
  });

  it('writes a 3MF without materials when uncoloured', () => {
    const model = decodeText(unzipSync(meshToThreeMF(parseOff(CUBE_QUADS)))['3D/3dmodel.model']);
    expect(model).not.toContain('basematerials');
    expect(model.match(/<vertex /g)).toHaveLength(8);
  });

  it('computes bounds', () => {
    expect(meshBounds(parseOff(CUBE_QUADS))).toEqual({ min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] });
  });
});
