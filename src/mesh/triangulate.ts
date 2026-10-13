import { ShapeUtils, Vector2 } from 'three';

/** Triangulates a planar (possibly concave) polygon, preserving the polygon's winding. */
export function triangulateFace(pos: Float32Array, idx: number[]): number[][] {
  // Newell's method: polygon normal
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < idx.length; i++) {
    const a = idx[i] * 3, b = idx[(i + 1) % idx.length] * 3;
    nx += (pos[a + 1] - pos[b + 1]) * (pos[a + 2] + pos[b + 2]);
    ny += (pos[a + 2] - pos[b + 2]) * (pos[a] + pos[b]);
    nz += (pos[a] - pos[b]) * (pos[a + 1] + pos[b + 1]);
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const [u, v] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [2, 0];
  const contour = idx.map((i) => new Vector2(pos[i * 3 + u], pos[i * 3 + v]));
  return ShapeUtils.triangulateShape(contour, []).map(([a, b, c]) => {
    const t = [idx[a], idx[b], idx[c]];
    const [p, q, r] = t.map((i) => i * 3);
    const e1 = [pos[q] - pos[p], pos[q + 1] - pos[p + 1], pos[q + 2] - pos[p + 2]];
    const e2 = [pos[r] - pos[p], pos[r + 1] - pos[p + 1], pos[r + 2] - pos[p + 2]];
    const dot = (e1[1] * e2[2] - e1[2] * e2[1]) * nx + (e1[2] * e2[0] - e1[0] * e2[2]) * ny + (e1[0] * e2[1] - e1[1] * e2[0]) * nz;
    return dot < 0 ? [t[0], t[2], t[1]] : t;
  });
}
