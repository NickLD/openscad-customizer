import type { Manifest } from './manifest';
import { MANIFEST_NAME } from './manifest';
import { basename, decodeText, includedPaths } from './util';

export type Candidate = { path: string; title: string; description?: string; thumbnail?: string };

const ANNOTATION = /\/\*\s*\[[^\]]*\]\s*\*\/|^[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*=[^;\n]*;[ \t]*\/\/[ \t]*\[/m;

const titleOf = (path: string) => basename(path).replace(/\.scad$/i, '');

export function findCandidates(files: Map<string, Uint8Array>, manifest: Manifest | null): { candidates: Candidate[]; warnings: string[] } {
  const warnings: string[] = [];
  if (manifest?.files && manifest.files.length > 0) {
    const candidates: Candidate[] = [];
    for (const f of manifest.files) {
      if (!files.has(f.path)) {
        warnings.push(`${MANIFEST_NAME} lists ${f.path}, which is not in the repo.`);
        continue;
      }
      const c: Candidate = { path: f.path, title: f.title ?? titleOf(f.path) };
      if (f.description) c.description = f.description;
      if (f.thumbnail) c.thumbnail = f.thumbnail;
      candidates.push(c);
    }
    return { candidates, warnings };
  }

  const scad = [...files.keys()].filter((p) => p.toLowerCase().endsWith('.scad')).sort();
  let chosen = scad.filter((p) => ANNOTATION.test(decodeText(files.get(p)!)));
  if (chosen.length === 0) {
    const included = new Set<string>();
    for (const p of scad) {
      for (const inc of includedPaths(p, decodeText(files.get(p)!))) included.add(inc);
    }
    chosen = scad.filter((p) => !included.has(p));
  }
  return { candidates: chosen.map((path) => ({ path, title: titleOf(path) })), warnings };
}
