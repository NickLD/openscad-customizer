import { MANIFEST_NAME, parseManifest, type Manifest } from '../manifest';
import { basename, decodeText } from '../util';
import type { Net } from './net';

export type { Net } from './net';

export type Caps = { maxFiles: number; maxBytes: number; maxFileBytes: number };
export const REPO_CAPS: Caps = { maxFiles: 300, maxBytes: 25e6, maxFileBytes: 10e6 };
export const LIB_CAPS: Caps = { maxFiles: 1000, maxBytes: 25e6, maxFileBytes: 10e6 };
export const FETCH_EXTENSIONS = ['.scad', '.json', '.svg', '.dxf', '.stl', '.off', '.3mf', '.png', '.dat', '.csv', '.txt'];

export class LoadError extends Error {
  constructor(public code: 'not-found' | 'ref-not-found' | 'network', message: string) {
    super(message);
    this.name = 'LoadError';
  }
}

export type ResolvedRef = { ref: string; sha?: string; stale: boolean };
export type ListedFile = { path: string; size: number };
export type LoadedRepo = {
  owner: string; repo: string; ref: string; sha?: string; stale: boolean;
  files: Map<string, Uint8Array>; manifest: Manifest | null; warnings: string[];
};

const API = 'https://api.github.com/repos';
const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const listingUrl = (o: string, r: string, ref: string) => `https://data.jsdelivr.com/v1/packages/gh/${o}/${r}@${encodeURIComponent(ref)}?structure=flat`;
export const cdnUrl = (o: string, r: string, ref: string, path: string) => `https://cdn.jsdelivr.net/gh/${o}/${r}@${encodeURIComponent(ref)}/${encPath(path)}`;
const rawUrl = (o: string, r: string, ref: string, path: string) => `https://raw.githubusercontent.com/${o}/${r}/${encodeURIComponent(ref)}/${encPath(path)}`;
const notFound = (o: string, r: string) => new LoadError('not-found', `Couldn't find ${o}/${r}. Private repos aren't supported.`);
// Refs go into URL path segments. Empty, dot-segment and control-character refs would rewrite the path.
const isSafeRef = (r: string) => r !== '' && !/[\x00-\x1f\x7f]/.test(r) && !r.split('/').some((s) => s === '.' || s === '..');
const assertSafeRef = (owner: string, repo: string, ref: string) => {
  if (!isSafeRef(ref)) throw new LoadError('ref-not-found', `Couldn't find "${ref}" in ${owner}/${repo}.`);
};

export async function resolveRef(net: Net, owner: string, repo: string, ref?: string): Promise<ResolvedRef> {
  if (ref !== undefined) assertSafeRef(owner, repo, ref);
  if (ref && /^[0-9a-f]{40}$/i.test(ref)) return { ref, sha: ref, stale: false };

  const fallback = async (): Promise<ResolvedRef> => {
    for (const name of ref ? [ref] : ['main', 'master']) {
      try {
        if ((await net.getJson(listingUrl(owner, repo, name))).status === 200) return { ref: name, stale: true };
      } catch {
        throw new LoadError('network', "Couldn't reach GitHub or jsDelivr. Check your connection.");
      }
    }
    throw ref ? new LoadError('ref-not-found', `Couldn't find "${ref}" in ${owner}/${repo}.`) : notFound(owner, repo);
  };

  try {
    let branch = ref;
    if (!branch) {
      const r = await net.getJson(`${API}/${owner}/${repo}`);
      if (r.status === 404) throw notFound(owner, repo);
      if (r.status !== 200) return await fallback();
      branch = String((r.data as { default_branch?: string })?.default_branch ?? 'main');
      if (!isSafeRef(branch)) return await fallback();
    }
    const c = await net.getJson(`${API}/${owner}/${repo}/commits/${encodeURIComponent(branch)}`);
    if (c.status === 404 || c.status === 422) {
      throw ref ? new LoadError('ref-not-found', `Couldn't find "${ref}" in ${owner}/${repo}.`) : notFound(owner, repo);
    }
    if (c.status !== 200) return await fallback();
    const sha = (c.data as { sha?: unknown })?.sha;
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) return await fallback();
    return { ref: sha, sha, stale: false };
  } catch (e) {
    if (e instanceof LoadError) throw e;
    return fallback();
  }
}

export async function listFiles(net: Net, owner: string, repo: string, ref: string): Promise<ListedFile[]> {
  assertSafeRef(owner, repo, ref);
  try {
    const j = await net.getJson(listingUrl(owner, repo, ref));
    if (j.status === 200) {
      const files = (j.data as { files?: Array<{ name: string; size: number }> })?.files ?? [];
      return files.map((f) => ({ path: f.name.replace(/^\//, ''), size: f.size }));
    }
    const t = await net.getJson(`${API}/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (t.status === 200) {
      const tree = (t.data as { tree?: Array<{ path: string; type: string; size?: number }> })?.tree ?? [];
      return tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, size: e.size ?? 0 }));
    }
  } catch {
    /* fall through */
  }
  throw new LoadError('network', `Couldn't list the files of ${owner}/${repo}.`);
}

export async function fetchFiles(
  net: Net, owner: string, repo: string, ref: string, list: ListedFile[], caps: Caps,
  opts: { extensions?: string[]; concurrency?: number } = {},
): Promise<{ files: Map<string, Uint8Array>; skipped: string[] }> {
  assertSafeRef(owner, repo, ref);
  const exts = opts.extensions ?? FETCH_EXTENSIONS;
  const skipped: string[] = [];
  const wanted: ListedFile[] = [];
  let bytes = 0;
  for (const f of list) {
    if (!exts.some((e) => f.path.toLowerCase().endsWith(e))) continue;
    if (f.size > caps.maxFileBytes) skipped.push(`${f.path} (over ${caps.maxFileBytes / 1e6} MB)`);
    else if (wanted.length >= caps.maxFiles) skipped.push(`${f.path} (repo file limit reached)`);
    else if (bytes + f.size > caps.maxBytes) skipped.push(`${f.path} (repo size limit reached)`);
    else {
      wanted.push(f);
      bytes += f.size;
    }
  }

  const files = new Map<string, Uint8Array>();
  const failed = new Set<string>();
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const f = wanted[next++];
      let data: Uint8Array | null = null;
      try {
        data = (await net.getBytes(cdnUrl(owner, repo, ref, f.path))) ?? (await net.getBytes(rawUrl(owner, repo, ref, f.path)));
      } catch {
        data = null;
      }
      if (data) files.set(f.path, data);
      else failed.add(f.path);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 8, wanted.length) }, worker));
  for (const f of wanted) if (failed.has(f.path)) skipped.push(`${f.path} (download failed)`);
  return { files, skipped };
}

/** Script and data files: fetched first, so assets can never crowd them out of the caps. */
const PRIMARY_EXTENSIONS = ['.scad', '.json'];
const isPrimary = (p: string) => PRIMARY_EXTENSIONS.some((e) => p.toLowerCase().endsWith(e));

export async function loadRepo(net: Net, owner: string, repo: string, ref?: string, caps: Caps = REPO_CAPS): Promise<LoadedRepo> {
  const resolved = await resolveRef(net, owner, repo, ref);
  const list = await listFiles(net, owner, repo, resolved.ref);
  // Phase 1: .scad and .json files.
  const primary = await fetchFiles(net, owner, repo, resolved.ref, list.filter((f) => isPrimary(f.path)), caps, { extensions: PRIMARY_EXTENSIONS });
  const files = primary.files;
  const skipped = [...primary.skipped];
  // Phase 2: other assets (STL, PNG, …), only when some script mentions them, within what is left of the caps.
  const texts = [...files].filter(([p]) => p.toLowerCase().endsWith('.scad')).map(([, d]) => decodeText(d));
  const referenced = list.filter((f) => !isPrimary(f.path) && texts.some((t) => t.includes(basename(f.path))));
  if (referenced.length) {
    // Budget by listed size, as fetchFiles does.
    const used = list.reduce((n, f) => n + (files.has(f.path) ? f.size : 0), 0);
    const rest = { ...caps, maxFiles: Math.max(0, caps.maxFiles - files.size), maxBytes: Math.max(0, caps.maxBytes - used) };
    const assets = await fetchFiles(net, owner, repo, resolved.ref, referenced, rest);
    for (const [p, d] of assets.files) files.set(p, d);
    skipped.push(...assets.skipped);
  }
  const warnings: string[] = [];
  if (resolved.stale) warnings.push(`GitHub's API is rate-limited, so this loaded "${resolved.ref}" by name. It may be a few hours out of date.`);
  if (skipped.length) warnings.push(`Skipped ${skipped.length} file(s): ${skipped.join(', ')}`);
  let manifest: Manifest | null = null;
  const m = files.get(MANIFEST_NAME);
  if (m) {
    const parsed = parseManifest(decodeText(m));
    manifest = parsed.manifest;
    warnings.push(...parsed.errors);
  }
  return { owner, repo, ref: resolved.ref, sha: resolved.sha, stale: resolved.stale, files, manifest, warnings };
}
