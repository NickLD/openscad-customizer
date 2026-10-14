import { MANIFEST_NAME, parseManifest, type Manifest } from '../manifest';
import { basename, decodeText, dirname, includedPaths } from '../util';
import type { Net } from './net';

export type { Net } from './net';

export type Caps = { maxFiles: number; maxBytes: number; maxFileBytes: number };
export const REPO_CAPS: Caps = { maxFiles: 300, maxBytes: 25e6, maxFileBytes: 10e6 };
export const LIB_CAPS: Caps = { maxFiles: 1000, maxBytes: 25e6, maxFileBytes: 10e6 };
/** jsDelivr can take most of a minute to answer on a commit it hasn't cached; after this long without a response, raw.githubusercontent.com is asked instead. */
const CDN_TIMEOUT_MS = 5000;
export const FETCH_EXTENSIONS = ['.scad', '.json', '.svg', '.dxf', '.stl', '.off', '.3mf', '.png', '.dat', '.csv', '.txt'];

/** `bytes`: listed size of the folder's .scad and .json files, i.e. roughly what loading it downloads. */
export type FolderChoice = { path: string; models: number; bytes: number };

export class LoadError extends Error {
  constructor(
    public code: 'not-found' | 'ref-not-found' | 'network' | 'too-many-files' | 'cancelled',
    message: string,
    /** For 'too-many-files': subfolders that could be loaded instead. */
    public folders: FolderChoice[] = [],
  ) {
    super(message);
    this.name = 'LoadError';
  }
}

/** Files finished so far and in the whole download; bytes are listed sizes, so the totals are known up front. */
export type DownloadCounts = { done: number; total: number; bytes: number; totalBytes: number; path?: string };
export type LoadProgress =
  | { step: 'resolving' }
  | { step: 'listing' }
  | ({ step: 'downloading' } & DownloadCounts)
  | ({ step: 'libraries' } & Partial<DownloadCounts>);
export type LoadOptions = {
  /** Load only this folder, plus scripts outside it that its scripts include or use. */
  dir?: string;
  /** The model a link opens: always loaded. In a repo over the cap, its folder is loaded instead of offering folders. */
  entry?: string;
  onProgress?(p: LoadProgress): void;
  /** Aborting stops new downloads; loadRepo then rejects with LoadError('cancelled'). */
  signal?: AbortSignal;
};

export type ResolvedRef = { ref: string; sha?: string; stale: boolean };
export type ListedFile = { path: string; size: number };
export type LoadedRepo = {
  owner: string; repo: string; ref: string; sha?: string; stale: boolean;
  files: Map<string, Uint8Array>; manifest: Manifest | null; warnings: string[];
  /** The folder that was loaded, when not the whole repo. */
  dir?: string;
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
  opts: { extensions?: string[]; concurrency?: number; signal?: AbortSignal; onFile?(c: DownloadCounts): void } = {},
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
  // Null when jsDelivr fails, errors (its error pages lack CORS headers, so fetch throws) or doesn't answer in time.
  const fromCdn = async (path: string): Promise<Uint8Array | null> => {
    try {
      return await net.getBytes(cdnUrl(owner, repo, ref, path), { signal: opts.signal, timeoutMs: CDN_TIMEOUT_MS });
    } catch {
      return null;
    }
  };
  let next = 0;
  let done = 0;
  let doneBytes = 0;
  const totalBytes = wanted.reduce((n, f) => n + f.size, 0);
  const worker = async () => {
    while (next < wanted.length && !opts.signal?.aborted) {
      const f = wanted[next++];
      let data: Uint8Array | null = null;
      try {
        data = (await fromCdn(f.path)) ?? (await net.getBytes(rawUrl(owner, repo, ref, f.path), { signal: opts.signal }));
      } catch {
        data = null;
      }
      if (data) files.set(f.path, data);
      else failed.add(f.path);
      doneBytes += f.size;
      opts.onFile?.({ done: ++done, total: wanted.length, bytes: doneBytes, totalBytes, path: f.path });
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 8, wanted.length) }, worker));
  for (const f of wanted) if (failed.has(f.path)) skipped.push(`${f.path} (download failed)`);
  return { files, skipped };
}

/** Script and data files: fetched first, so assets can never crowd them out of the caps. */
const PRIMARY_EXTENSIONS = ['.scad', '.json'];
const isPrimary = (p: string) => PRIMARY_EXTENSIONS.some((e) => p.toLowerCase().endsWith(e));
const isScad = (p: string) => p.toLowerCase().endsWith('.scad');
const inDir = (p: string, dir?: string) => !dir || p.startsWith(dir + '/');

/** Direct subfolders of `dir` (or of the repo root) holding .scad files, with how many each holds at any depth. */
export function folderChoices(list: ListedFile[], dir?: string): FolderChoice[] {
  const prefix = dir ? dir + '/' : '';
  const subs = new Map<string, FolderChoice>();
  for (const f of list) {
    if (!isPrimary(f.path) || !f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash < 0) continue;
    const path = prefix + rest.slice(0, slash);
    const c = subs.get(path) ?? { path, models: 0, bytes: 0 };
    c.bytes += f.size;
    if (isScad(f.path)) c.models++;
    subs.set(path, c);
  }
  return [...subs.values()].filter((c) => c.models > 0).sort((a, b) => a.path.localeCompare(b.path));
}

export async function loadRepo(
  net: Net, owner: string, repo: string, ref?: string, caps: Caps = REPO_CAPS, opts: LoadOptions = {},
): Promise<LoadedRepo> {
  const report = opts.onProgress ?? (() => {});
  const check = () => {
    if (opts.signal?.aborted) throw new LoadError('cancelled', 'Loading was cancelled.');
  };
  // Download counts run across the fetch phases: `base` is what earlier phases finished.
  const base = { done: 0, bytes: 0 };
  let last = { done: 0, bytes: 0 };
  const onFile = (c: DownloadCounts) => {
    last = c;
    report({
      step: 'downloading', path: c.path,
      done: base.done + c.done, total: base.done + c.total, bytes: base.bytes + c.bytes, totalBytes: base.bytes + c.totalBytes,
    });
  };
  const nextPhase = () => {
    base.done += last.done;
    base.bytes += last.bytes;
    last = { done: 0, bytes: 0 };
  };
  const fetchOpts = { signal: opts.signal, onFile };

  report({ step: 'resolving' });
  const resolved = await resolveRef(net, owner, repo, ref);
  check();
  report({ step: 'listing' });
  const list = await listFiles(net, owner, repo, resolved.ref);
  check();
  // Phase 1: .scad and .json files in scope (the folder, or the whole repo).
  let dir = opts.dir;
  let scope = list.filter((f) => isPrimary(f.path) && inDir(f.path, dir));
  // A link to a model in a repo over the cap loads that model's folder.
  if (!dir && opts.entry && scope.length > caps.maxFiles && dirname(opts.entry)) {
    dir = dirname(opts.entry);
    scope = list.filter((f) => isPrimary(f.path) && inDir(f.path, dir));
  }
  if (dir && !scope.some((f) => isScad(f.path))) {
    throw new LoadError('not-found', `There are no .scad files in ${dir}/ of ${owner}/${repo}.`);
  }
  if (scope.length > caps.maxFiles && !opts.entry) {
    let folders = folderChoices(list, dir);
    // A level holding a single subfolder (tests/ → tests/data/) offers nothing to choose: look one level deeper.
    while (folders.length === 1) folders = folderChoices(list, folders[0].path);
    const where = dir ? `${dir} in ${owner}/${repo}` : `${owner}/${repo}`;
    if (folders.length >= 2) {
      throw new LoadError('too-many-files', `${where} has ${scope.length} .scad and .json files, more than the ${caps.maxFiles} this app loads at once.`, folders);
    }
  }
  // The linked model goes first, so the cap can't drop it.
  if (opts.entry) scope.sort((a, b) => Number(b.path === opts.entry) - Number(a.path === opts.entry));
  const manifestFile = dir ? list.filter((f) => f.path === MANIFEST_NAME) : [];
  const primary = await fetchFiles(net, owner, repo, resolved.ref, [...scope, ...manifestFile], caps, { extensions: PRIMARY_EXTENSIONS, ...fetchOpts });
  check();
  nextPhase();
  const files = primary.files;
  const skipped = [...primary.skipped];
  // What is left of the caps, budgeted by listed size as fetchFiles does.
  const remaining = (): Caps => {
    const used = list.reduce((n, f) => n + (files.has(f.path) ? f.size : 0), 0);
    return { ...caps, maxFiles: Math.max(0, caps.maxFiles - files.size), maxBytes: Math.max(0, caps.maxBytes - used) };
  };
  // Phase 1b (folder loads): scripts outside the folder that loaded scripts include or use, followed transitively.
  if (dir) {
    const byPath = new Map(list.map((f) => [f.path, f]));
    const tried = new Set<string>();
    for (;;) {
      const missing = new Set<string>();
      for (const [p, d] of files) {
        if (!isScad(p)) continue;
        for (const inc of includedPaths(p, decodeText(d))) if (!files.has(inc) && !tried.has(inc) && byPath.has(inc)) missing.add(inc);
      }
      if (!missing.size) break;
      for (const p of missing) tried.add(p);
      const more = await fetchFiles(net, owner, repo, resolved.ref, [...missing].map((p) => byPath.get(p)!), remaining(), { extensions: ['.scad'], ...fetchOpts });
      check();
      nextPhase();
      for (const [p, d] of more.files) files.set(p, d);
      skipped.push(...more.skipped);
    }
  }
  // Phase 2: other assets (STL, PNG, …), only when some script mentions them, within what is left of the caps.
  const texts = [...files].filter(([p]) => p.toLowerCase().endsWith('.scad')).map(([, d]) => decodeText(d));
  const referenced = list.filter((f) => !isPrimary(f.path) && texts.some((t) => t.includes(basename(f.path))));
  if (referenced.length) {
    const assets = await fetchFiles(net, owner, repo, resolved.ref, referenced, remaining(), fetchOpts);
    check();
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
  return { owner, repo, ref: resolved.ref, sha: resolved.sha, stale: resolved.stale, files, manifest, warnings, dir };
}
