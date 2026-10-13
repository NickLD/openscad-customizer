import { triangulateFace } from './triangulate';

export type Mesh = { positions: Float32Array; triangles: Uint32Array; colors: Uint8Array | null };

const DEFAULT_RGBA = [249, 215, 44, 255]; // OpenSCAD's default face colour

export function parseOff(text: string): Mesh {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  let li = 0;
  let head = (lines[li++] ?? '').split(/\s+/);
  if (head[0] !== 'OFF') throw new Error('Not an OFF file');
  if (head.length === 1) head = ['OFF', ...(lines[li++] ?? '').split(/\s+/)];
  const nv = parseInt(head[1], 10);
  const nf = parseInt(head[2], 10);

  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const p = lines[li++].split(/\s+/);
    positions[3 * i] = +p[0];
    positions[3 * i + 1] = +p[1];
    positions[3 * i + 2] = +p[2];
  }

  const tris: number[] = [];
  const cols: number[] = [];
  let anyColor = false;
  for (let f = 0; f < nf; f++) {
    const p = lines[li++].split(/\s+/).map(Number);
    const n = p[0];
    const idx = p.slice(1, 1 + n);
    const c = p.slice(1 + n);
    let rgba = DEFAULT_RGBA;
    if (c.length >= 3) {
      anyColor = true;
      const scale = c.some((x) => !Number.isInteger(x)) ? 255 : 1;
      rgba = [c[0] * scale, c[1] * scale, c[2] * scale, c.length >= 4 ? c[3] * scale : 255].map((x) => Math.round(x));
    }
    for (const t of n === 3 ? [idx] : triangulateFace(positions, idx)) {
      tris.push(t[0], t[1], t[2]);
      cols.push(...rgba);
    }
  }
  return { positions, triangles: Uint32Array.from(tris), colors: anyColor ? Uint8Array.from(cols) : null };
}
