import { strToU8, zipSync } from 'fflate';
import type { Mesh } from './off';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

const num = (x: number) => String(Number(x.toFixed(6)));
const hex = (b: number) => b.toString(16).padStart(2, '0').toUpperCase();

export function meshToThreeMF(mesh: Mesh): Uint8Array {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<resources>\n');

  let colorIndex: number[] | null = null;
  if (mesh.colors) {
    const keys = new Map<string, number>();
    colorIndex = [];
    const bases: string[] = [];
    for (let t = 0; t < mesh.colors.length / 4; t++) {
      const c = mesh.colors.subarray(4 * t, 4 * t + 4);
      const key = `#${hex(c[0])}${hex(c[1])}${hex(c[2])}${hex(c[3])}`;
      if (!keys.has(key)) {
        keys.set(key, keys.size);
        bases.push(`<base name="color${keys.size}" displaycolor="${key}"/>`);
      }
      colorIndex.push(keys.get(key)!);
    }
    parts.push(`<basematerials id="1">${bases.join('')}</basematerials>\n`);
  }

  parts.push(`<object id="2" type="model"${colorIndex ? ' pid="1" pindex="0"' : ''}><mesh><vertices>\n`);
  const P = mesh.positions;
  for (let i = 0; i < P.length; i += 3) parts.push(`<vertex x="${num(P[i])}" y="${num(P[i + 1])}" z="${num(P[i + 2])}"/>\n`);
  parts.push('</vertices><triangles>\n');
  const T = mesh.triangles;
  for (let t = 0; t < T.length / 3; t++) {
    parts.push(`<triangle v1="${T[3 * t]}" v2="${T[3 * t + 1]}" v3="${T[3 * t + 2]}"${colorIndex ? ` pid="1" p1="${colorIndex[t]}"` : ''}/>\n`);
  }
  parts.push('</triangles></mesh></object>\n</resources>\n<build><item objectid="2"/></build>\n</model>\n');

  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(parts.join('')),
  }, { level: 6 });
}
