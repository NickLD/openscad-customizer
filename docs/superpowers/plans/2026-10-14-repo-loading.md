# Repo Loading: Progress, Folders, Big Repos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show loading progress with a Cancel link, let a link load just one folder of a repo, and offer a folder picker instead of a blind capped download when a repo is too big.

**Architecture:**
- `Route` gains `dir`.
- `loadRepo` gains an options object `{ dir, onProgress, signal }`. It scopes downloads to the folder, follows includes out of it, and throws `LoadError('too-many-files', …, folders)` when the scope is over the cap and splittable.
- The controller exposes `loading` and `tooBig` signals and a new `'folders'` phase.
- Two small components render them: `LoadingView` and `FolderPicker`.

**Tech Stack:** TypeScript, Preact + @preact/signals, Vitest (+ @testing-library/preact, jsdom), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-14-repo-loading-design.md`

## Global Constraints

- Caps stay as they are: `REPO_CAPS = { maxFiles: 300, maxBytes: 25e6, maxFileBytes: 10e6 }`.
- URL form: `#/gh/<owner>/<repo>[@ref][/<path>]?dir=<folder>`. Existing links without `dir` must behave exactly as before.
- Query keys `preset` and `dir` are reserved. A parameter with either name is written as `param.<name>`.
- `dir` is repo-relative, without leading or trailing `/`, and must pass `isSafeRelPath`. Anything else is ignored.
- No new dependencies.
- Branch: `feat/repo-loading`, off `main`. Commit after each task. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AVPZxxFmThswkcv5xEyPW6
  ```
- Commands run from `C:\Users\NICKLD\openscad-customizer`. Unit tests: `npx vitest run <file>`. Typecheck: `npm run typecheck`.

## Review Focus

1. **Unsafe `dir` values** (`?dir=../x`, `?dir=/`, `?dir=a/../b`) must be ignored, never fetched. Covered in Task 1.
2. **A parameter named `dir`** must round-trip as a parameter, not become a folder. Covered in Task 1.
3. **Superseded loads.** A load that is superseded (Cancel, back button, new link) must stop downloading and must not overwrite the newer page. Covered in Tasks 2 and 4.
4. **Folders still over the cap.** A chosen folder that is itself over the cap shows its own subfolders. A scope over the cap with fewer than two subfolders loads capped, as today. Covered in Task 3.
5. **Repo-root manifest with a folder load.** A manifest listing models outside the loaded folder must not produce "not in the repo" warnings. Covered in Task 4.

---

### Task 1: Folder routes

**Files:**
- Modify: `src/types.ts` (Route)
- Modify: `src/router.ts`
- Test: `tests/unit/router.test.ts`

**Interfaces:**
- Produces: `Route` repo variant gains `dir?: string`.
- Produces: `cleanDir(d: string | undefined): string | undefined`, exported from `src/router.ts`.
- Produces: `githubInputToRoute` returns `{ …, ref, dir }` for `/tree/<ref>/<folder>` links.

- [ ] **Step 0: Branch**

```bash
git checkout main && git pull --ff-only && git checkout -b feat/repo-loading
```

- [ ] **Step 1: Write the failing tests**

In `tests/unit/router.test.ts`, change the tree-URL expectation in `'accepts tree and blob URLs'`:

```ts
    expect(githubInputToRoute('https://github.com/NickLD/gland/tree/dev/models')).toEqual({ ...base, ref: 'dev', dir: 'models' });
```

and append:

```ts
describe('folder routes', () => {
  it('parses and serializes dir', () => {
    const r = parseRoute('#/gh/o/r@main?dir=examples%2FBasics');
    expect(r).toMatchObject({ kind: 'repo', owner: 'o', repo: 'r', ref: 'main', dir: 'examples/Basics', values: {} });
    expect(serializeRoute(r)).toBe('#/gh/o/r@main?dir=examples%2FBasics');
  });

  it('keeps dir next to a model path, preset and values', () => {
    const h = '#/gh/o/r/examples/a.scad?dir=examples&preset=Big&n=2';
    expect(serializeRoute(parseRoute(h))).toBe(h);
  });

  it('strips slashes around dir and ignores unsafe or empty dirs', () => {
    expect(parseRoute('#/gh/o/r?dir=%2Fexamples%2F')).toMatchObject({ dir: 'examples' });
    for (const d of ['..%2Fx', '', '%2F', 'a%2F..%2Fb', 'a%5Cb']) {
      expect((parseRoute(`#/gh/o/r?dir=${d}`) as { dir?: string }).dir).toBeUndefined();
    }
  });

  it('escapes a parameter named dir', () => {
    const h = serializeRoute({ kind: 'repo', owner: 'o', repo: 'r', values: { dir: 'up' } });
    expect(h).toBe('#/gh/o/r?param.dir=up');
    const r = parseRoute(h) as { dir?: string; values: Record<string, string> };
    expect(r.dir).toBeUndefined();
    expect(r.values).toEqual({ dir: 'up' });
  });

  it('turns a pasted folder link into a dir route', () => {
    expect(githubInputToRoute('https://github.com/openscad/openscad/tree/master/examples/Basics/')).toEqual({
      kind: 'repo', owner: 'openscad', repo: 'openscad', ref: 'master', dir: 'examples/Basics', values: {},
    });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/router.test.ts`
Expected: FAIL on the `dir` expectations (`dir` is undefined, `param.dir` is not escaped).

- [ ] **Step 3: Implement**

In `src/types.ts`, add to the `kind: 'repo'` variant, after `path?: string;`:

```ts
      /** Load only this folder (plus files its scripts include). Repo-relative, no leading/trailing slash. */
      dir?: string;
```

In `src/router.ts`:
- Add `import { isSafeRelPath } from './util';`.
- Below `const PARAM_ESCAPE = 'param.';` add:

```ts
/** Query keys the app owns; a parameter with one of these names is written as `param.<name>`. */
const isReserved = (k: string) => k === 'preset' || k === 'dir' || k.startsWith(PARAM_ESCAPE);

/** A repo-relative folder without surrounding slashes, or undefined when empty or unsafe. */
export function cleanDir(d: string | undefined): string | undefined {
  const s = (d ?? '').replace(/^\/+|\/+$/g, '');
  return s && isSafeRelPath(s) ? s : undefined;
}
```

In `parseRouteUnsafe`, declare `let dir: string | undefined;` next to `let preset`. Change the loop to:

```ts
  for (const [k, v] of query) {
    if (k === 'preset') preset = v;
    else if (k === 'dir') dir = cleanDir(v);
    else if (k.startsWith(PARAM_ESCAPE)) values[k.slice(PARAM_ESCAPE.length)] = v;
    else values[k] = v;
  }
  return { kind: 'repo', owner, repo, ref, path, dir, preset, values };
```

In `serializeRoute`, set `dir` first and use `isReserved`:

```ts
  const q = new URLSearchParams();
  if (r.dir) q.set('dir', r.dir);
  if (r.preset) q.set('preset', r.preset);
  for (const [k, v] of Object.entries(r.values)) {
    q.set(isReserved(k) ? PARAM_ESCAPE + k : k, v);
  }
```

In `githubInputToRoute`, replace the two lines after `const rest = …` with:

```ts
      if (segs[2] === 'blob' && rest.endsWith('.scad')) return { ...base, ref, path: rest };
      const dir = segs[2] === 'tree' ? cleanDir(rest) : undefined;
      return dir ? { ...base, ref, dir } : { ...base, ref };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/router.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/router.ts tests/unit/router.test.ts
git commit -m "feat(router): ?dir= folder routes, and folder links from pasted tree URLs"
```

---

### Task 2: Loader progress and cancelling

**Files:**
- Modify: `src/repo/repoLoader.ts`
- Test: `tests/unit/repoLoader.test.ts`

**Interfaces:**
- Produces, exported from `src/repo/repoLoader.ts`:

```ts
export type LoadProgress =
  | { step: 'resolving' }
  | { step: 'listing' }
  | { step: 'downloading'; done: number; total: number; path?: string }
  | { step: 'libraries' };
export type FolderChoice = { path: string; models: number };
export type LoadOptions = { dir?: string; onProgress?(p: LoadProgress): void; signal?: AbortSignal };
// LoadError: code adds 'too-many-files' | 'cancelled'; new 3rd ctor arg `folders: FolderChoice[] = []`.
// loadRepo(net, owner, repo, ref?, caps = REPO_CAPS, opts: LoadOptions = {}): Promise<LoadedRepo>
// fetchFiles opts add: signal?: AbortSignal; onFile?(done: number, total: number, path: string): void
```

(`FolderChoice` and `dir` are declared here and used in Task 3.)

- [ ] **Step 1: Write the failing tests**

In `tests/unit/repoLoader.test.ts`, extend the import with `type LoadProgress`. Then append:

```ts
describe('loadRepo progress and cancelling', () => {
  const PINNED = { [API]: { status: 403 } };

  it('reports each step and every downloaded file', async () => {
    const net = fakeNet({
      ...PINNED,
      ...listing('main', [['a.scad', 1], ['b.scad', 1], ['p.stl', 1]]),
      [cdnUrl('o', 'r', 'main', 'a.scad')]: encodeText('import("p.stl");'),
      [cdnUrl('o', 'r', 'main', 'b.scad')]: encodeText('x=1;'),
      [cdnUrl('o', 'r', 'main', 'p.stl')]: encodeText('solid'),
    });
    const steps: LoadProgress[] = [];
    await loadRepo(net, 'o', 'r', undefined, REPO_CAPS, { onProgress: (p) => steps.push(p) });
    expect(steps.slice(0, 2)).toEqual([{ step: 'resolving' }, { step: 'listing' }]);
    expect(steps.slice(2).map((s) => (s.step === 'downloading' ? [s.done, s.total] : s.step))).toEqual([[1, 2], [2, 2], [3, 3]]);
    expect(steps.at(-1)).toMatchObject({ path: 'p.stl' });
  });

  it('stops downloading and throws when cancelled', async () => {
    const files = Array.from({ length: 20 }, (_, i): [string, number] => [`f${i}.scad`, 1]);
    const base = fakeNet({
      ...PINNED,
      ...listing('main', files),
      ...Object.fromEntries(files.map(([p]) => [cdnUrl('o', 'r', 'main', p), encodeText('x')])),
    });
    const ctrl = new AbortController();
    const net: Net = { ...base, async getBytes(u) { const r = await base.getBytes(u); ctrl.abort(); return r; } };
    await expect(loadRepo(net, 'o', 'r', undefined, REPO_CAPS, { signal: ctrl.signal })).rejects.toMatchObject({ code: 'cancelled' });
    // Only the first batch (one per worker, 8 workers) was requested.
    expect(base.calls.filter((u) => u.endsWith('.scad')).length).toBeLessThanOrEqual(8);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/repoLoader.test.ts`
Expected: FAIL. No progress is reported, and the cancelled load resolves instead of rejecting.

- [ ] **Step 3: Implement**

In `src/repo/repoLoader.ts`, replace the `LoadError` class:

```ts
export type FolderChoice = { path: string; models: number };

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

export type LoadProgress =
  | { step: 'resolving' }
  | { step: 'listing' }
  | { step: 'downloading'; done: number; total: number; path?: string }
  | { step: 'libraries' };
export type LoadOptions = {
  /** Load only this folder, plus scripts outside it that its scripts include or use. */
  dir?: string;
  onProgress?(p: LoadProgress): void;
  /** Aborting stops new downloads; loadRepo then rejects with LoadError('cancelled'). */
  signal?: AbortSignal;
};
```

In `fetchFiles`, widen `opts` to:

```ts
  opts: { extensions?: string[]; concurrency?: number; signal?: AbortSignal; onFile?(done: number, total: number, path: string): void } = {},
```

and change the worker to:

```ts
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < wanted.length && !opts.signal?.aborted) {
      const f = wanted[next++];
      let data: Uint8Array | null = null;
      try {
        data = (await net.getBytes(cdnUrl(owner, repo, ref, f.path))) ?? (await net.getBytes(rawUrl(owner, repo, ref, f.path)));
      } catch {
        data = null;
      }
      if (data) files.set(f.path, data);
      else failed.add(f.path);
      opts.onFile?.(++done, wanted.length, f.path);
    }
  };
```

Replace `loadRepo`'s signature and body up to the start of `const warnings` with:

```ts
export async function loadRepo(
  net: Net, owner: string, repo: string, ref?: string, caps: Caps = REPO_CAPS, opts: LoadOptions = {},
): Promise<LoadedRepo> {
  const report = opts.onProgress ?? (() => {});
  const check = () => {
    if (opts.signal?.aborted) throw new LoadError('cancelled', 'Loading was cancelled.');
  };
  // Download counts run across the fetch phases: `base` is what earlier phases finished.
  let base = 0;
  let last = 0;
  const onFile = (done: number, total: number, path: string) => {
    last = done;
    report({ step: 'downloading', done: base + done, total: base + total, path });
  };
  const nextPhase = () => {
    base += last;
    last = 0;
  };
  const fetchOpts = { signal: opts.signal, onFile };

  report({ step: 'resolving' });
  const resolved = await resolveRef(net, owner, repo, ref);
  check();
  report({ step: 'listing' });
  const list = await listFiles(net, owner, repo, resolved.ref);
  check();
  // Phase 1: .scad and .json files.
  const primary = await fetchFiles(net, owner, repo, resolved.ref, list.filter((f) => isPrimary(f.path)), caps, { extensions: PRIMARY_EXTENSIONS, ...fetchOpts });
  check();
  nextPhase();
  const files = primary.files;
  const skipped = [...primary.skipped];
  // What is left of the caps, budgeted by listed size as fetchFiles does.
  const remaining = (): Caps => {
    const used = list.reduce((n, f) => n + (files.has(f.path) ? f.size : 0), 0);
    return { ...caps, maxFiles: Math.max(0, caps.maxFiles - files.size), maxBytes: Math.max(0, caps.maxBytes - used) };
  };
  // Phase 2: other assets (STL, PNG, …), only when some script mentions them, within what is left of the caps.
  const texts = [...files].filter(([p]) => p.toLowerCase().endsWith('.scad')).map(([, d]) => decodeText(d));
  const referenced = list.filter((f) => !isPrimary(f.path) && texts.some((t) => t.includes(basename(f.path))));
  if (referenced.length) {
    const assets = await fetchFiles(net, owner, repo, resolved.ref, referenced, remaining(), fetchOpts);
    check();
    for (const [p, d] of assets.files) files.set(p, d);
    skipped.push(...assets.skipped);
  }
```

The rest of `loadRepo` (from `const warnings: string[] = [];`) stays as it is.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/repoLoader.test.ts && npm run typecheck`
Expected: PASS. The existing two-phase tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/repo/repoLoader.ts tests/unit/repoLoader.test.ts
git commit -m "feat(loader): report load progress per file; stop downloading when aborted"
```

---

### Task 3: Folder-scoped loading and folder choices

**Files:**
- Modify: `src/util.ts` (add `includedPaths`)
- Modify: `src/candidates.ts` (use `includedPaths`)
- Modify: `src/repo/repoLoader.ts`
- Test: `tests/unit/repoLoader.test.ts`

**Interfaces:**
- Consumes: `LoadOptions.dir`, `FolderChoice`, and `LoadError(code, message, folders)` from Task 2.
- Produces: `includedPaths(path: string, text: string): string[]` in `src/util.ts`.
- Produces: `folderChoices(list: ListedFile[], dir?: string): FolderChoice[]` exported from `src/repo/repoLoader.ts`.
- Produces: `loadRepo` with `opts.dir` throws `LoadError('not-found', …)` when the folder has no `.scad` files. It throws `LoadError('too-many-files', message, folders)` when the scope is over `caps.maxFiles` and `folders.length >= 2`.

- [ ] **Step 1: Write the failing tests**

Add `folderChoices` to the import in `tests/unit/repoLoader.test.ts`, then append:

```ts
describe('folder-scoped loading', () => {
  const PINNED = { [API]: { status: 403 } };
  const CAPS = { maxFiles: 100, maxBytes: 1e9, maxFileBytes: 1e9 };
  const src = (p: string, text: string) => ({ [cdnUrl('o', 'r', 'main', p)]: encodeText(text) });

  it('loads the folder, the root manifest and scripts it includes from outside, nothing else', async () => {
    const net = fakeNet({
      ...PINNED,
      ...listing('main', [['openscad-customizer.json', 2], ['lib/common.scad', 1], ['lib/deep.scad', 1], ['lib/unused.scad', 1],
        ['examples/a.scad', 1], ['examples/a.json', 1], ['tests/t.scad', 1]]),
      ...src('openscad-customizer.json', '{}'),
      ...src('examples/a.scad', 'use <../lib/common.scad>\nx = 1;'),
      ...src('examples/a.json', '{}'),
      ...src('lib/common.scad', 'include <deep.scad>'),
      ...src('lib/deep.scad', 'y = 2;'),
    });
    const repo = await loadRepo(net, 'o', 'r', undefined, CAPS, { dir: 'examples' });
    expect([...repo.files.keys()].sort()).toEqual(['examples/a.json', 'examples/a.scad', 'lib/common.scad', 'lib/deep.scad', 'openscad-customizer.json']);
    expect(net.calls.some((u) => u.includes('tests/') || u.includes('unused'))).toBe(false);
    expect(repo.warnings).toEqual([expect.stringMatching(/hours/)]);
  });

  it('offers subfolders instead of downloading when the repo is over the file cap', async () => {
    const net = fakeNet({
      ...PINNED,
      ...listing('main', [['root.scad', 1], ['examples/a.scad', 1], ['examples/b.scad', 1], ['tests/x/1.scad', 1], ['tests/2.scad', 1]]),
    });
    const err = await loadRepo(net, 'o', 'r', undefined, { ...CAPS, maxFiles: 3 }).catch((e) => e);
    expect(err).toMatchObject({ code: 'too-many-files', folders: [{ path: 'examples', models: 2 }, { path: 'tests', models: 2 }] });
    expect(err.message).toBe('o/r has 5 .scad and .json files, more than the 3 this app loads at once.');
    expect(net.calls.some((u) => u.startsWith('https://cdn.jsdelivr.net/'))).toBe(false);
  });

  it('offers the subfolders of a folder that is itself over the cap', async () => {
    const net = fakeNet({ ...PINNED, ...listing('main', [['tests/x/1.scad', 1], ['tests/y/2.scad', 1], ['tests/y/3.scad', 1]]) });
    await expect(loadRepo(net, 'o', 'r', undefined, { ...CAPS, maxFiles: 1 }, { dir: 'tests' })).rejects.toMatchObject({
      code: 'too-many-files', message: 'tests in o/r has 3 .scad and .json files, more than the 1 this app loads at once.',
      folders: [{ path: 'tests/x', models: 1 }, { path: 'tests/y', models: 2 }],
    });
  });

  it('loads up to the cap, as before, when the files cannot be split into folders', async () => {
    const net = fakeNet({ ...PINNED, ...listing('main', [['a.scad', 1], ['b.scad', 1], ['c.scad', 1]]), ...src('a.scad', 'x'), ...src('b.scad', 'x') });
    const repo = await loadRepo(net, 'o', 'r', undefined, { ...CAPS, maxFiles: 2 });
    expect([...repo.files.keys()]).toEqual(['a.scad', 'b.scad']);
    expect(repo.warnings.some((w) => w.includes('c.scad (repo file limit reached)'))).toBe(true);
  });

  it('reports a folder without models', async () => {
    const net = fakeNet({ ...PINNED, ...listing('main', [['a.scad', 1]]) });
    await expect(loadRepo(net, 'o', 'r', undefined, CAPS, { dir: 'nope' })).rejects.toMatchObject({ code: 'not-found', message: 'There are no .scad files in nope/ of o/r.' });
  });
});

describe('folderChoices', () => {
  it('counts .scad files per direct subfolder, at any depth, sorted', () => {
    const list = ['z/a.scad', 'a/b/c.scad', 'a/d.scad', 'a/e.json', 'top.scad', 'm/readme.md'].map((path) => ({ path, size: 1 }));
    expect(folderChoices(list)).toEqual([{ path: 'a', models: 2 }, { path: 'z', models: 1 }]);
    expect(folderChoices(list, 'a')).toEqual([{ path: 'a/b', models: 1 }]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/repoLoader.test.ts`
Expected: FAIL. `folderChoices` is not exported, and `dir` is ignored.

- [ ] **Step 3: Implement**

In `src/util.ts`, append:

```ts
const INCLUDE = /^\s*(?:include|use)\s*<([^>]+)>/gm;

/** Repo paths that the `include <…>` / `use <…>` lines of the file at `path` point at, resolved relative to that file. */
export function includedPaths(path: string, text: string): string[] {
  return [...text.matchAll(INCLUDE)].map((m) => joinPath(dirname(path), m[1]));
}
```

In `src/candidates.ts`:
- Delete the `INCLUDE` constant.
- Change the util import to `import { basename, decodeText, includedPaths } from './util';`.
- Replace the inner include loop with:

```ts
    for (const p of scad) {
      for (const inc of includedPaths(p, decodeText(files.get(p)!))) included.add(inc);
    }
```

Then run `npx vitest run tests/unit/candidates.test.ts`. Expected: PASS, since the behaviour is unchanged.

In `src/repo/repoLoader.ts`:
- Change the util import to `import { basename, decodeText, includedPaths } from '../util';`.
- Add below `isPrimary`:

```ts
const isScad = (p: string) => p.toLowerCase().endsWith('.scad');
const inDir = (p: string, dir?: string) => !dir || p.startsWith(dir + '/');

/** Direct subfolders of `dir` (or of the repo root) holding .scad files, with how many each holds at any depth. */
export function folderChoices(list: ListedFile[], dir?: string): FolderChoice[] {
  const prefix = dir ? dir + '/' : '';
  const counts = new Map<string, number>();
  for (const f of list) {
    if (!isScad(f.path) || !f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash < 0) continue;
    const sub = prefix + rest.slice(0, slash);
    counts.set(sub, (counts.get(sub) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([path, models]) => ({ path, models }));
}
```

In `loadRepo`, replace the Phase 1 block (from `// Phase 1` through `const skipped = [...primary.skipped];`) with the code below. Keep the `remaining` helper where Task 2 put it, which is directly after this block.

```ts
  // Phase 1: .scad and .json files in scope (the folder, or the whole repo).
  const scope = list.filter((f) => isPrimary(f.path) && inDir(f.path, opts.dir));
  if (opts.dir && !scope.some((f) => isScad(f.path))) {
    throw new LoadError('not-found', `There are no .scad files in ${opts.dir}/ of ${owner}/${repo}.`);
  }
  if (scope.length > caps.maxFiles) {
    const folders = folderChoices(list, opts.dir);
    const where = opts.dir ? `${opts.dir} in ${owner}/${repo}` : `${owner}/${repo}`;
    if (folders.length >= 2) {
      throw new LoadError('too-many-files', `${where} has ${scope.length} .scad and .json files, more than the ${caps.maxFiles} this app loads at once.`, folders);
    }
  }
  const manifestFile = opts.dir ? list.filter((f) => f.path === MANIFEST_NAME) : [];
  const primary = await fetchFiles(net, owner, repo, resolved.ref, [...scope, ...manifestFile], caps, { extensions: PRIMARY_EXTENSIONS, ...fetchOpts });
  check();
  nextPhase();
  const files = primary.files;
  const skipped = [...primary.skipped];
```

Directly after the `remaining` helper, before Phase 2, add:

```ts
  // Phase 1b (folder loads): scripts outside the folder that loaded scripts include or use, followed transitively.
  if (opts.dir) {
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/repoLoader.test.ts tests/unit/candidates.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/util.ts src/candidates.ts src/repo/repoLoader.ts tests/unit/repoLoader.test.ts
git commit -m "feat(loader): folder-scoped loads that follow includes; offer subfolders for repos over the cap"
```

---

### Task 4: Controller — folder, progress, abort, folders phase

**Files:**
- Modify: `src/app/controller.ts`
- Modify: `src/share.ts`
- Test: `tests/unit/controller.test.ts`, `tests/unit/share.test.ts`

**Interfaces:**
- Consumes: `loadRepo(net, owner, repo, ref, caps, { dir, onProgress, signal })`, plus `LoadProgress`, `FolderChoice` and `LoadError` from Tasks 2 and 3.
- Produces on `AppController`:
  - `Phase` gains `'folders'`.
  - `loading: Signal<LoadProgress | null>`.
  - `tooBig: Signal<{ owner: string; repo: string; ref?: string; message: string; folders: FolderChoice[] } | null>`.
  - `hash()` and `shareState()` carry the loaded `dir`.
- Produces: `ShareState` gains `dir?: string`, and `buildShare` keeps it in the link.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/controller.test.ts`:
- Add `import type { LoadProgress } from '../../src/repo/repoLoader';`.
- In `'switching models under a pinned tag reuses the loaded repo'`, change the last expectation to:

```ts
      expect(loader(ctl)).toHaveBeenCalledWith(expect.anything(), 'o', 'r', 'v1.2', undefined, expect.objectContaining({ dir: undefined }));
```

Append inside the top-level `describe('AppController', …)`:

```ts
  describe('folders and progress', () => {
    const loaderOf = (ctl: AppController) => (ctl as unknown as { deps: { loadRepo: ReturnType<typeof vi.fn> } }).deps.loadRepo;

    it('passes the folder to the loader, keeps it in the URL, and reloads when it changes', async () => {
      const { ctl } = make({ 'ex/a.scad': 'x = 1; // [1:2]', 'ex/b.scad': 'y = 1; // [1:2]' });
      await ctl.open('#/gh/o/r?dir=ex');
      expect(loaderOf(ctl)).toHaveBeenCalledWith(expect.anything(), 'o', 'r', undefined, undefined, expect.objectContaining({ dir: 'ex' }));
      expect(ctl.phase.value).toBe('picker');
      await ctl.open('#/gh/o/r/ex/a.scad?dir=ex');
      expect(loaderOf(ctl)).toHaveBeenCalledTimes(1);
      expect(ctl.hash()).toBe('#/gh/o/r/ex/a.scad?dir=ex');
      expect(ctl.shareState()!.dir).toBe('ex');
      await ctl.open('#/gh/o/r?dir=other');
      expect(loaderOf(ctl)).toHaveBeenCalledTimes(2);
    });

    it('drops manifest models outside the loaded folder without warnings', async () => {
      const { ctl } = make();
      loaderOf(ctl).mockResolvedValueOnce({
        ...repo({ 'ex/a.scad': 'x = 1; // [1:2]', 'ex/b.scad': 'y = 1; // [1:2]' }),
        manifest: { libraries: {}, files: [{ path: 'top.scad', title: 'Top' }] },
      });
      await ctl.open('#/gh/o/r?dir=ex');
      expect(ctl.candidates.value.map((c) => c.path)).toEqual(['ex/a.scad', 'ex/b.scad']);
      expect(ctl.notices.value).toEqual([]);
    });

    it('shows folder choices when the repo is too big', async () => {
      const { ctl } = make();
      const folders = [{ path: 'examples', models: 50 }, { path: 'tests', models: 579 }];
      loaderOf(ctl).mockRejectedValueOnce(new LoadError('too-many-files', 'o/r has 682 .scad and .json files, more than the 300 this app loads at once.', folders));
      await ctl.open('#/gh/o/r');
      expect(ctl.phase.value).toBe('folders');
      expect(ctl.tooBig.value).toEqual({ owner: 'o', repo: 'r', ref: undefined, message: 'o/r has 682 .scad and .json files, more than the 300 this app loads at once.', folders });
    });

    it('shows load progress, and aborts a load that is superseded', async () => {
      const { ctl } = make();
      let seen: { signal?: AbortSignal; onProgress?: (p: LoadProgress) => void } = {};
      let finish!: (r: LoadedRepo) => void;
      loaderOf(ctl).mockImplementationOnce((_n: unknown, _o: unknown, _r: unknown, _ref: unknown, _c: unknown, opts: typeof seen) => {
        seen = opts;
        return new Promise<LoadedRepo>((res) => { finish = res; });
      });
      const first = ctl.open('#/gh/o/r');
      expect(ctl.loading.value).toEqual({ step: 'resolving' });
      seen.onProgress!({ step: 'downloading', done: 3, total: 10, path: 'a.scad' });
      expect(ctl.phase.value).toBe('loading');
      expect(ctl.loading.value).toEqual({ step: 'downloading', done: 3, total: 10, path: 'a.scad' });
      await ctl.open('');
      expect(seen.signal!.aborted).toBe(true);
      expect(ctl.phase.value).toBe('landing');
      finish(repo({ 'g.scad': 'x = 1;' }));
      await first;
      expect(ctl.phase.value).toBe('landing');
    });
  });
```

In `tests/unit/share.test.ts`, inside `describe('buildShare', …)` (the file already defines `base` and `all`):

```ts
  it('keeps the loaded folder in the link', () => {
    const s = buildShare({ ...base, entry: 'ex/cable_gland.scad', dir: 'ex' }, { ...all, settings: false });
    expect(s.hash).toBe('#/gh/NickLD/split-cable-gland/ex/cable_gland.scad?dir=ex');
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/controller.test.ts tests/unit/share.test.ts`
Expected: FAIL. The loader is not called with options, `loading`/`tooBig` don't exist, and `dir` is missing from the hash and the share link.

- [ ] **Step 3: Implement**

In `src/share.ts`:
- Add to `ShareState`, after `sha?: string;`:

```ts
  /** The folder the repo was loaded from, if only one folder was loaded. */
  dir?: string;
```

- In `buildShare`'s `serializeRoute` call, add `dir: s.dir,` after `ref: …,`.

In `src/app/controller.ts`:
- Change the loader import to:

```ts
import { loadRepo, LoadError, type FolderChoice, type LoadedRepo, type LoadProgress, type Net } from '../repo/repoLoader';
```

- Change `Phase` to:

```ts
export type Phase = 'landing' | 'help' | 'loading' | 'folders' | 'picker' | 'model' | 'error';
```

- Add public signals after `engineReady`:

```ts
  /** What the repo loader is doing, while the phase is 'loading'. */
  loading = signal<LoadProgress | null>(null);
  /** The repo was too big to load whole: the folders offered instead (phase 'folders'). */
  tooBig = signal<{ owner: string; repo: string; ref?: string; message: string; folders: FolderChoice[] } | null>(null);
```

- Add private fields next to `loadedRef`:

```ts
  /** The folder the current repo was loaded from (undefined = whole repo). */
  private loadedDir: string | undefined;
  /** Stops the downloads of a repo load that is no longer wanted. */
  private loadAbort: AbortController | null = null;
```

- In `open()`, directly after `const mySeq = ++this.openSeq;`, add:

```ts
    this.loadAbort?.abort();
    this.loadAbort = null;
```

- Add `&& route.dir === this.loadedDir` to the end of the `reuse` condition.
- Replace the body of `if (!reuse) { … }` up to and including `this.notices.value = …` with:

```ts
        const abort = new AbortController();
        this.loadAbort = abort;
        this.loading.value = { step: 'resolving' };
        try {
          repo = await this.deps.loadRepo(this.deps.net, route.owner, route.repo, route.ref, undefined, {
            dir: route.dir,
            signal: abort.signal,
            onProgress: (p) => {
              if (mySeq === this.openSeq) this.loading.value = p;
            },
          });
        } catch (e) {
          // Don't leave the previous repo's title, ref and notices around the error.
          if (mySeq === this.openSeq) this.clearRepo();
          throw e;
        }
        if (mySeq !== this.openSeq) return;
        this.loading.value = { step: 'libraries' };
        const plan = planLibraries(repo.files, repo.manifest);
        const libs = await this.deps.loadLibraries(this.deps.net, plan);
        if (mySeq !== this.openSeq) return;
        this.loadAbort = null;
        this.libFiles = libs.files;
        this.fontsTried = plan.needsFonts;
        // In a folder load, the root manifest's models outside the folder simply aren't offered.
        const manifest = route.dir && repo.manifest?.files
          ? { ...repo.manifest, files: repo.manifest.files.filter((f) => f.path.startsWith(route.dir + '/')) }
          : repo.manifest;
        const found = findCandidates(repo.files, manifest);
        this.repo.value = repo;
        this.loadedRef = route.ref;
        this.loadedDir = route.dir;
        this.candidates.value = found.candidates;
        this.notices.value = [...repo.warnings, ...found.warnings, ...libs.warnings, ...plan.missing.map(missingLibraryMessage)];
```

- In the outer `catch (e)`, directly after `if (mySeq !== this.openSeq) return;`, add:

```ts
      if (e instanceof LoadError && e.code === 'too-many-files') {
        this.tooBig.value = { owner: route.owner, repo: route.repo, ref: route.ref, message: e.message, folders: e.folders };
        this.phase.value = 'folders';
        return;
      }
```

- In `hash()`, add `dir: this.loadedDir,` after `ref: this.pinnedRef,`.
- In `shareState()`'s returned object, add `dir: this.loadedDir,` after `sha: repo.sha,`.
- In `clearRepo()`, add `this.loadedDir = undefined;`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/controller.test.ts tests/unit/share.test.ts && npm run typecheck`
Expected: PASS. If TypeScript doesn't narrow `route` inside the outer `catch`, capture `const r = route;` (typed as the repo variant) before `try` and use `r` there.

- [ ] **Step 5: Commit**

```bash
git add src/app/controller.ts src/share.ts tests/unit/controller.test.ts tests/unit/share.test.ts
git commit -m "feat(controller): folder loads, load progress, abort superseded loads, folders phase"
```

---

### Task 5: Loading and folder-picker UI; model links keep the folder

**Files:**
- Create: `src/ui/LoadingView.tsx`
- Create: `src/ui/FolderPicker.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/links.ts`
- Modify: `src/ui/styles.css`
- Test: `tests/unit/App.test.tsx`, `tests/unit/links.test.ts`

**Interfaces:**
- Consumes: `ctl.loading`, `ctl.tooBig` and phase `'folders'` (Task 4), plus `Route.dir` and `serializeRoute` (Task 1).

- [ ] **Step 1: Write the failing tests**

In `tests/unit/App.test.tsx`, inside `describe('App', …)`:

```ts
  it('shows load progress with the current file and a cancel link', () => {
    const c = ctl();
    c.phase.value = 'loading';
    c.loading.value = { step: 'downloading', done: 3, total: 10, path: 'examples/a.scad' };
    render(<App ctl={c} />);
    expect(screen.getByTestId('load-status').textContent).toBe('Downloading files: 3 of 10');
    expect(screen.getByText('examples/a.scad')).toBeTruthy();
    expect((document.querySelector('progress') as HTMLProgressElement).value).toBe(3);
    expect(screen.getByText('Cancel').getAttribute('href')).toBe('#');
  });

  it('lists folders to load when the repo is too big', () => {
    const c = ctl();
    c.phase.value = 'folders';
    c.tooBig.value = {
      owner: 'openscad', repo: 'openscad', message: 'openscad/openscad has 682 .scad and .json files, more than the 300 this app loads at once.',
      folders: [{ path: 'examples', models: 50 }, { path: 'tests', models: 1 }],
    };
    render(<App ctl={c} />);
    const links = screen.getAllByTestId('folder-link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/gh/openscad/openscad?dir=examples', '#/gh/openscad/openscad?dir=tests']);
    expect(links[0].textContent).toContain('50 .scad files');
    expect(links[1].textContent).toContain('1 .scad file');
  });
```

In `tests/unit/links.test.ts`, follow the file's existing pattern for setting `location.hash`, and add:

```ts
  it('keeps the loaded folder when switching models', () => {
    location.hash = '#/gh/o/r@v1?dir=ex';
    expect(modelHash('o', 'r', 'ex/b.scad')).toBe('#/gh/o/r@v1/ex/b.scad?dir=ex');
    expect(modelHash('x', 'y', 'b.scad')).toBe('#/gh/x/y/b.scad');
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/App.test.tsx tests/unit/links.test.ts`
Expected: FAIL. `load-status` and `folder-link` are not found, and the model hash lacks `dir`.

- [ ] **Step 3: Implement**

Create `src/ui/LoadingView.tsx`:

```tsx
import type { AppController } from '../app/controller';
import type { LoadProgress } from '../repo/repoLoader';

function label(p: LoadProgress | null): string {
  if (p?.step === 'listing') return 'Listing files…';
  if (p?.step === 'downloading') return `Downloading files: ${p.done} of ${p.total}`;
  if (p?.step === 'libraries') return 'Downloading libraries…';
  return 'Finding the latest version…';
}

export function LoadingView({ ctl }: { ctl: AppController }) {
  const p = ctl.loading.value;
  return (
    <main class="loading" aria-busy="true">
      <p data-testid="load-status">{label(p)}</p>
      {p?.step === 'downloading' && <progress max={p.total} value={p.done} />}
      {p?.step === 'downloading' && p.path && <code class="load-file">{p.path}</code>}
      <a class="button" href="#">Cancel</a>
    </main>
  );
}
```

Create `src/ui/FolderPicker.tsx`:

```tsx
import type { AppController } from '../app/controller';
import { serializeRoute } from '../router';

export function FolderPicker({ ctl }: { ctl: AppController }) {
  const t = ctl.tooBig.value!;
  return (
    <main class="picker">
      <p class="lead">{t.message} Pick a folder to load:</p>
      <ul class="folders">
        {t.folders.map((f) => (
          <li key={f.path}>
            <a data-testid="folder-link" href={serializeRoute({ kind: 'repo', owner: t.owner, repo: t.repo, ref: t.ref, dir: f.path, values: {} })}>
              <code>{f.path}/</code>
              <span class="muted">{f.models} .scad file{f.models === 1 ? '' : 's'}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

In `src/ui/App.tsx`:
- Import both components: `import { FolderPicker } from './FolderPicker';` and `import { LoadingView } from './LoadingView';`.
- Replace the loading line with `{phase === 'loading' && <LoadingView ctl={ctl} />}`.
- Add `{phase === 'folders' && <FolderPicker ctl={ctl} />}` after it.

Replace the body of `modelHash` in `src/ui/links.ts`:

```ts
/** Hash for opening `path` in owner/repo, keeping the pinned ref and loaded folder from the current URL. */
export function modelHash(owner: string, repo: string, path: string): string {
  const cur = parseRoute(location.hash);
  const keep = cur.kind === 'repo' && cur.owner === owner && cur.repo === repo ? { ref: cur.ref, dir: cur.dir } : {};
  return serializeRoute({ kind: 'repo', owner, repo, ...keep, path, values: {} });
}
```

In `src/ui/styles.css`, after the `.landing, .picker, .error-page, .loading, .help { … }` rule, add:

```css
.loading progress { display: block; width: 100%; max-width: 480px; margin: 8px 0; accent-color: var(--accent); }
.loading .load-file { display: block; margin-bottom: 16px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.folders { list-style: none; padding: 0; display: grid; gap: 8px; }
.folders a { display: flex; gap: 12px; align-items: baseline; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); color: var(--text); text-decoration: none; }
.folders a:hover { border-color: var(--accent); }
.folders .muted { color: var(--muted); font-size: 13px; }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/App.test.tsx tests/unit/links.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/LoadingView.tsx src/ui/FolderPicker.tsx src/ui/App.tsx src/ui/links.ts src/ui/styles.css tests/unit/App.test.tsx tests/unit/links.test.ts
git commit -m "feat(ui): loading progress with Cancel, folder picker for big repos, model links keep the folder"
```

---

### Task 6: Full verification against a real big repo

**Files:** none, unless a defect is found. A fix goes in a new commit with a regression test.

- [ ] **Step 1: Full suite, build, e2e**

Run: `npm test && npm run build && npm run e2e`
Expected: all pass.

- [ ] **Step 2: Live check on the dev server** (`npm run dev -- --port 5173 --strictPort`, Playwright browser)

1. Paste `https://github.com/openscad/openscad` on the landing page. Expected:
   - The status moves through "Finding the latest version…" and "Listing files…".
   - The folder picker appears with `examples/`, `resources/` and `tests/` and their `.scad` counts.
   - No `cdn.jsdelivr.net/gh/openscad/openscad@…/….scad` requests are made.
2. Click `examples/`. Expected:
   - "Downloading files: N of M" with a moving bar and file paths.
   - Then the model picker with the example models. The URL contains `?dir=examples`.
3. Open one model (e.g. `examples/Basics/CSG.scad`). Expected: it renders, and the URL is `…/examples/Basics/CSG.scad?dir=examples`.
4. Click `tests/`. Expected: the subfolder picker for `tests` appears, since it is over 300.
5. Start a load of `examples`, then click Cancel during downloads. Expected: you're back on the landing page, and no further `.scad` requests appear in the network log.
6. Paste `https://github.com/openscad/openscad/tree/master/examples/Basics`. Expected: it loads that folder directly.
7. Open `#/gh/NickLD/split-cable-gland/cable_gland.scad`. Expected: it behaves as before (no `dir`; renders).

- [ ] **Step 3: Report.** Don't merge to main without your human partner's say-so; main deploys to openscad.app.
