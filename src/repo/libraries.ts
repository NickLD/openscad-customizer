import type { Manifest } from '../manifest';
import type { FileMap } from '../types';
import { decodeText, dirname, joinPath } from '../util';
import { fetchFiles, LIB_CAPS, listFiles, resolveRef, type DownloadCounts, type LoadProgress, type Net } from './repoLoader';

export type LibSource = {
  owner: string; repo: string; ref: string; subdir?: string; mount: string;
  /** Only these repo-relative paths (after subdir). */
  only?: string[];
  /** Skip paths starting with these prefixes (after subdir). */
  exclude?: string[];
  /** Default: `.scad` only (libraries' images and meshes are documentation, not inputs). */
  extensions?: string[];
};

const SKIP = ['examples/', 'tests/', 'test/', '.github/', 'docs/', 'tutorials/', 'gallery/'];

/** Key = first path segment of the include (`BOSL2/std.scad` -> `BOSL2`) or a top-level file name. Pinned 2026-10-13. */
export const REGISTRY: Record<string, LibSource> = {
  BOSL2: { owner: 'BelfrySCAD', repo: 'BOSL2', ref: '7b3728f9c994b8f5dad16aea14bdb73a94971780', mount: '/libraries/BOSL2', exclude: SKIP },
  BOSL: { owner: 'revarbat', repo: 'BOSL', ref: '4ce427a8a38786e5f74b728c1e33d9fe7d4904d2', mount: '/libraries/BOSL', exclude: SKIP },
  MCAD: { owner: 'openscad', repo: 'MCAD', ref: 'bd0a7ba3f042bfbced5ca1894b236cea08904e26', mount: '/libraries/MCAD', exclude: SKIP },
  NopSCADlib: { owner: 'nophead', repo: 'NopSCADlib', ref: '00ec2898c0a2cdebd446f0175671b633d5ae7d5f', mount: '/libraries/NopSCADlib', exclude: SKIP },
  'Round-Anything': { owner: 'Irev-Dev', repo: 'Round-Anything', ref: '061fef7c429628808e847696bb345a9b0ec6e279', mount: '/libraries/Round-Anything', exclude: SKIP },
  funcutils: { owner: 'thehans', repo: 'funcutils', ref: 'fac6ac1269d3578b839ece088c03f404a76fb43b', mount: '/libraries/funcutils', exclude: SKIP },
  'threads.scad': { owner: 'rcolyer', repo: 'threads-scad', ref: '4ae9aeb3b136f9858200f77a304b909a000ce3b4', mount: '/libraries', only: ['threads.scad'] },
  'smooth_prim.scad': { owner: 'rcolyer', repo: 'smooth-prim', ref: '0d0038f984465f3eb0f6026a4d5de2f79d2dcea8', mount: '/libraries', only: ['smooth_prim.scad'] },
};

export const FONTS: LibSource = {
  owner: 'shantigilbert', repo: 'liberation-fonts-ttf', ref: 'ef7161f03e305982b0b247e9a0b7cc472376dd83', mount: '/fonts', extensions: ['.ttf'],
};

const INCLUDE = /^[ \t]*(?:include|use)[ \t]*<([^>]+)>/gm;

export function scanIncludes(text: string): string[] {
  return [...text.matchAll(INCLUDE)].map((m) => m[1].trim());
}

export type LibraryPlan = { libs: Record<string, LibSource>; missing: string[]; needsFonts: boolean };

export function missingLibraryMessage(include: string): string {
  const root = include.split('/')[0];
  return `Library ${root} isn't bundled (needed by include <${include}>). Authors can add it to openscad-customizer.json → libraries.`;
}

export function planLibraries(files: Map<string, Uint8Array>, manifest: Manifest | null): LibraryPlan {
  const libs: Record<string, LibSource> = {};
  const missing = new Set<string>();
  let needsFonts = false;
  for (const [path, data] of files) {
    if (!path.toLowerCase().endsWith('.scad')) continue;
    const text = decodeText(data);
    if (/\btext\s*\(/.test(text)) needsFonts = true;
    for (const inc of scanIncludes(text)) {
      if (files.has(joinPath(dirname(path), inc))) continue;
      const root = inc.split('/')[0];
      // Own-property lookups only: `<constructor/x.scad>` must not resolve to Object.prototype members.
      const own = <T,>(o: Record<string, T> | undefined): T | undefined => (o && Object.hasOwn(o, root) ? o[root] : undefined);
      const fromManifest = own(manifest?.libraries);
      if (fromManifest) {
        libs[root] = { ...fromManifest, ref: fromManifest.ref ?? 'HEAD', mount: `/libraries/${root}` };
      } else if (own(REGISTRY)) {
        libs[root] = REGISTRY[root];
      } else {
        missing.add(inc);
      }
    }
  }
  return { libs, missing: [...missing], needsFonts };
}

const LIB_EXTENSIONS = ['.scad'];

async function loadSource(net: Net, src: LibSource, signal?: AbortSignal, onFile?: (c: DownloadCounts) => void): Promise<{ files: FileMap; skipped: string[] }> {
  // Manifest libraries without @ref use 'HEAD', which jsDelivr does not understand: resolve it to a commit.
  const ref = src.ref === 'HEAD' ? (await resolveRef(net, src.owner, src.repo)).ref : src.ref;
  const prefix = src.subdir ? src.subdir + '/' : '';
  const listed = (await listFiles(net, src.owner, src.repo, ref))
    .filter((f) => f.path.startsWith(prefix))
    .filter((f) => {
      const rel = f.path.slice(prefix.length);
      if (src.only && !src.only.includes(rel)) return false;
      return !(src.exclude ?? []).some((x) => rel.startsWith(x));
    });
  const { files, skipped } = await fetchFiles(net, src.owner, src.repo, ref, listed, LIB_CAPS, { extensions: src.extensions ?? LIB_EXTENSIONS, concurrency: 16, signal, onFile });
  const out: FileMap = new Map();
  for (const [p, d] of files) out.set(`${src.mount}/${p.slice(prefix.length)}`, d);
  return { files: out, skipped };
}

export type LibrarySize = { name: string; files: number; bytes: number };
export type LibraryOptions = { signal?: AbortSignal; onProgress?(p: LoadProgress): void };
type Loaded = { files: FileMap; warnings: string[]; sizes: LibrarySize[] };

async function loadAll(net: Net, sources: Array<[string, LibSource]>, out: Loaded, opts: LibraryOptions): Promise<void> {
  const { files, warnings } = out;
  // Libraries download side by side: progress is the sum of each one's counts so far.
  const counts = new Map<string, DownloadCounts>();
  const report = (name: string, c: DownloadCounts) => {
    counts.set(name, c);
    const sum = { done: 0, total: 0, bytes: 0, totalBytes: 0 };
    for (const x of counts.values()) {
      sum.done += x.done;
      sum.total += x.total;
      sum.bytes += x.bytes;
      sum.totalBytes += x.totalBytes;
    }
    opts.onProgress?.({ step: 'libraries', ...sum, path: `${name}/${c.path?.split('/').pop()}` });
  };
  await Promise.all(sources.map(async ([name, src]) => {
    try {
      const r = await loadSource(net, src, opts.signal, (c) => report(name, c));
      for (const [p, d] of r.files) files.set(p, d);
      out.sizes.push({ name, files: r.files.size, bytes: [...r.files.values()].reduce((n, d) => n + d.length, 0) });
      if (r.skipped.length) warnings.push(`Library ${name}: skipped ${r.skipped.length} file(s).`);
    } catch (e) {
      warnings.push(`Couldn't load library ${name} (${src.owner}/${src.repo}): ${(e as Error).message}`);
    }
  }));
}

/** Bundled libraries that loaded library files include but the plan does not have yet. */
function transitiveLibs(files: FileMap, planned: Record<string, LibSource>): Record<string, LibSource> {
  const extra: Record<string, LibSource> = {};
  for (const [path, data] of files) {
    if (!path.toLowerCase().endsWith('.scad')) continue;
    for (const inc of scanIncludes(decodeText(data))) {
      if (files.has(joinPath(dirname(path), inc)) || files.has(`/libraries/${inc}`)) continue;
      const root = inc.split('/')[0];
      if (!Object.hasOwn(planned, root) && Object.hasOwn(REGISTRY, root)) extra[root] = REGISTRY[root];
    }
  }
  return extra;
}

/** Aborting `opts.signal` stops further downloads (a cancelled load). `sizes`: what each library came to. */
export async function loadLibraries(net: Net, plan: LibraryPlan, opts: LibraryOptions = {}): Promise<Loaded> {
  const sources: Array<[string, LibSource]> = Object.entries(plan.libs);
  if (plan.needsFonts) sources.push(['fonts', FONTS]);
  const out: Loaded = { files: new Map(), warnings: [], sizes: [] };
  await loadAll(net, sources, out, opts);
  // One transitive pass (no further recursion): e.g. a manifest library that includes BOSL2.
  await loadAll(net, Object.entries(transitiveLibs(out.files, plan.libs)), out, opts);
  return out;
}

/** Liberation fonts, for when text() turns out to be needed after all (e.g. called inside a library). */
export async function loadFonts(net: Net): Promise<Loaded> {
  const out: Loaded = { files: new Map(), warnings: [], sizes: [] };
  await loadAll(net, [['fonts', FONTS]], out, {});
  return out;
}
