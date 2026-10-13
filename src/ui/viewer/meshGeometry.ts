import { BufferAttribute, BufferGeometry } from 'three';
import type { Mesh } from '../../mesh/off';

export function meshToGeometry(mesh: Mesh): BufferGeometry {
  const n = mesh.triangles.length;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = mesh.triangles[i] * 3;
    pos[3 * i] = mesh.positions[v];
    pos[3 * i + 1] = mesh.positions[v + 1];
    pos[3 * i + 2] = mesh.positions[v + 2];
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.computeVertexNormals(); // non-indexed => flat per-face normals
  if (mesh.colors) {
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = Math.floor(i / 3) * 4;
      col[3 * i] = mesh.colors[t] / 255;
      col[3 * i + 1] = mesh.colors[t + 1] / 255;
      col[3 * i + 2] = mesh.colors[t + 2] / 255;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
