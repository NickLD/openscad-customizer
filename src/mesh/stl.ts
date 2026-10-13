import type { Mesh } from './off';

export function meshToStl(mesh: Mesh): Uint8Array {
  const n = mesh.triangles.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  const P = mesh.positions;
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50;
    const [a, b, c] = [mesh.triangles[3 * t] * 3, mesh.triangles[3 * t + 1] * 3, mesh.triangles[3 * t + 2] * 3];
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
    for (let k = 0; k < 3; k++) dv.setFloat32(o + 4 * k, nrm[k] / len, true);
    [a, b, c].forEach((vi, j) => {
      for (let k = 0; k < 3; k++) dv.setFloat32(o + 12 + 12 * j + 4 * k, P[vi + k], true);
    });
  }
  return new Uint8Array(buf);
}
