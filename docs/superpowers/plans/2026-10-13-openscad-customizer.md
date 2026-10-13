# OpenSCAD Customizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static GitHub Pages web app that loads OpenSCAD scripts from any public GitHub repo, shows their customizer parameters as a clean form with a live 3D preview, and exports STL/3MF — all in the browser via OpenSCAD WASM.

**Architecture:** Vite + TypeScript + Preact single-page app with hash routing. Pure modules (router, codec, manifest, param model, repo loader, library planner, mesh writers) are unit-tested in Node. The OpenSCAD engine core is a pure function over an injected WASM factory, tested in Node against the real WASM build, and run in the browser inside a Web Worker behind a cancellable proxy. An `AppController` (Preact signals) orchestrates route → load → params → render; UI components only read its signals and call its methods.

**Tech Stack:** Node 22, Vite 6, TypeScript 5, Preact 10 + @preact/signals, three.js, fflate, CodeMirror 6, Vitest 3, @testing-library/preact, Playwright, GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-10-13-openscad-customizer-design.md`

## Pre-flight findings (verified 2026-10-13 against the real WASM build)

These change implementation details of the spec; they are deliberate and the executor must follow them:

1. **WASM build:** only `https://files.openscad.org/playground/OpenSCAD-2025.03.25.wasm24456-WebAssembly-web.zip` (SHA-256 `0968af31b9c9b3bba68d9031de1695ccae51c32231a1aab4ef27b18c86379f3b`) exists. It is **single-threaded** (no pthreads), so `coi-serviceworker` is dropped (spec §11 fallback path is the only path). It also runs in Node, which is what makes the engine tests possible.
2. **Parameter export works:** `openscad in.scad -o out.json --export-format=param` emits `{"parameters":[{name, group, type, initial, caption?, min?, max?, step?, options?}], "title"}`. Full `cable_gland.scad` extracts 43 parameters in ~270 ms; a full render takes <1 s.
3. **CRLF breaks annotations:** with `\r\n` line endings, OpenSCAD drops every caption/range/option. The engine must normalize `.scad` files to `\n` before writing them to the virtual FS. (`cable_gland.scad` on disk is CRLF.)
4. **3MF export is broken in this build** (exit 0, 0-byte file). The app renders **OFF** once and derives the viewer mesh, STL and 3MF from it (spec §11 "export reuses preview" becomes "every export reuses the one render"). OFF faces are `n i1..in [r g b [a]]` with 0–255 integer colors; when any `color()` is used, uncoloured faces get OpenSCAD's default `249 215 44`. Faces may be polygons (n > 3) and must be triangulated.
5. **Libraries come from pinned commits on jsDelivr**, fetched with the same repo loader, instead of prebuilt zips (spec §8). No build step, and nothing to re-host.
6. **Library path & fonts:** set `ENV.OPENSCADPATH = '/libraries'` and `ENV.FONTCONFIG_FILE = '/etc/fonts.conf'` in `preRun`; a fonts.conf with `<dir>/fonts</dir>` makes `text()` work with fonts placed in `/fonts`.
7. **Empty geometry** yields exit code 1 and the log line `Current top level object is empty.` A parse error yields `ERROR: Parser error: syntax error in file /repo/m.scad, line 2`. String `-D` values with embedded quotes work when written as `-Ds="he said \"hi\""` (JSON string syntax).

## Global Constraints

- App served at `https://<user>.github.io/openscad-customizer/` → Vite `base: '/openscad-customizer/'`.
- Hash routes only: `#/gh/owner/repo[@ref][/path.scad][?name=value&preset=Name]`.
- Manifest file name: `openscad-customizer.json` at the repo root.
- Repo fetch caps: 300 files, 25 MB total, 10 MB per file. Library caps: 1000 files, 25 MB total, 10 MB per file.
- Fetched extensions: `.scad .json .svg .dxf .stl .off .3mf .png .dat .csv .txt`.
- Parameter-change render debounce: 500 ms; an in-flight render is cancelled when a new one starts.
- Network hosts allowed: the app origin, `api.github.com`, `data.jsdelivr.com`, `cdn.jsdelivr.net`, `raw.githubusercontent.com`, `files.openscad.org` (build-time only).
- Manifest strings are rendered as text, never HTML (no `dangerouslySetInnerHTML` anywhere).
- License: GPL-2.0-or-later.
- Mobile breakpoint: 768 px.
- Every `localStorage` access wrapped in try/catch.
- Dependency versions: use the versions given in Task 1; if one is unavailable, use the newest release in the same major version.

## Review Focus

1. **CRLF scripts** (authors on Windows) → captions, ranges and dropdowns still appear. Pinned by `tests/engine/core.test.ts` "CRLF source still yields annotations" (Task 6).
2. **String parameters containing quotes, backslashes, `&`, `#`, spaces or non-ASCII** → survive URL round trip and reach OpenSCAD unchanged. Pinned by `tests/unit/paramCodec.test.ts` + `tests/unit/router.test.ts` round-trip cases (Tasks 1–2) and the engine echo test (Task 6).
3. **Pasted GitHub URLs in any common form** (`github.com/o/r`, trailing `/`, `.git`, `/tree/branch`, `/blob/ref/file.scad`, `o/r`) → open the right repo/file. Pinned by `githubInputToRoute` tests (Task 1).
4. **Rapid slider drags** → only the latest values are displayed; an older render finishing late never replaces a newer one. Pinned by controller test "stale render result is discarded" (Task 9).
5. **Decimal steps (0.1, 0.05)** → values like `0.30000000000000004` never appear in the form, URL or `-D`. Pinned by `roundToStep` tests (Task 2) and ParamForm slider test (Task 10).

---

## File Structure

```
openscad-customizer/
├─ package.json  tsconfig.json  vite.config.ts  playwright.config.ts  index.html
├─ .gitignore  LICENSE  README.md
├─ scripts/fetch-wasm.mjs           download + verify OpenSCAD WASM into public/wasm/
├─ public/wasm/                     (gitignored) openscad.js, openscad.wasm, VERSION
├─ src/
│  ├─ main.tsx                      mounts <App/>
│  ├─ config.ts                     featured model
│  ├─ types.ts                      shared types (ParamValue, Param, ParamSet, Route, FileMap)
│  ├─ util.ts                       path + text helpers
│  ├─ router.ts                     hash <-> Route, GitHub URL normalizer
│  ├─ paramCodec.ts                 URL value encoding, OpenSCAD literals, step rounding
│  ├─ paramModel.ts                 ParamSet -> grouped form controls
│  ├─ presets.ts                    OpenSCAD parameterSets JSON + value resolution
│  ├─ manifest.ts                   openscad-customizer.json parsing
│  ├─ candidates.ts                 which .scad files the picker offers
│  ├─ repo/net.ts                   fetch adapter (injectable)
│  ├─ repo/repoLoader.ts            ref resolution, listing, fetching with caps
│  ├─ repo/libraries.ts             registry, include scanning, library/font loading
│  ├─ engine/log.ts                 OpenSCAD log parsing
│  ├─ engine/core.ts                runJob(factory, job) — pure, Node-testable
│  ├─ engine/protocol.ts            worker message types
│  ├─ engine/worker.ts              Web Worker hosting the WASM
│  ├─ engine/engine.ts              main-thread cancellable proxy
│  ├─ mesh/off.ts                   OFF -> Mesh
│  ├─ mesh/triangulate.ts           polygon -> triangles
│  ├─ mesh/stl.ts  mesh/threemf.ts  mesh/bounds.ts
│  ├─ app/controller.ts             AppController (signals)
│  └─ ui/
│     ├─ App.tsx  Header.tsx  Landing.tsx  FilePicker.tsx  ModelView.tsx
│     ├─ ParamForm.tsx  ExportBar.tsx  ConsolePanel.tsx  SourceDrawer.tsx
│     ├─ viewer/meshGeometry.ts  viewer/ThreeViewer.ts  viewer/Viewer.tsx
│     ├─ theme.ts  download.ts  styles.css
├─ tests/
│  ├─ unit/*.test.ts(x)
│  ├─ engine/wasm.ts  engine/core.test.ts
│  ├─ e2e/fixtures.ts  e2e/app.spec.ts
│  └─ fixtures/repos/demo/gland/…  fixtures/repos/demo/multi/…
└─ .github/workflows/ci.yml
```

---

### Task 1: Project scaffold, shared types, router

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `LICENSE`, `src/main.tsx`, `src/types.ts`, `src/router.ts`
- Test: `tests/unit/router.test.ts`

**Interfaces:**
- Produces:
  - `src/types.ts`: `ParamValue`, `ParamOption`, `Param`, `ParamSet`, `FileMap`, `Route` (exact definitions below; every later task imports them from here).
  - `parseRoute(hash: string): Route`
  - `serializeRoute(route: Route): string` (returns `''` for landing, else a string starting with `#/gh/`)
  - `githubInputToRoute(input: string): Route | null`

- [ ] **Step 1: Create scaffold files**

`package.json`:
```json
{
  "name": "openscad-customizer",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "license": "GPL-2.0-or-later",
  "scripts": {
    "fetch-wasm": "node scripts/fetch-wasm.mjs",
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@codemirror/language": "^6.11.0",
    "@codemirror/state": "^6.5.2",
    "@codemirror/view": "^6.36.8",
    "@preact/signals": "^2.2.0",
    "codemirror": "^6.0.1",
    "fflate": "^0.8.2",
    "preact": "^10.26.9",
    "three": "^0.177.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.53.0",
    "@preact/preset-vite": "^2.10.1",
    "@testing-library/preact": "^3.2.4",
    "@types/node": "^22.15.30",
    "@types/three": "^0.177.0",
    "jsdom": "^26.1.0",
    "typescript": "^5.8.3",
    "vite": "^6.3.5",
    "vitest": "^3.2.4"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "types": ["vite/client", "node"],
    "noEmit": true
  },
  "include": ["src", "tests", "vite.config.ts", "playwright.config.ts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: '/openscad-customizer/',
  plugins: [preact()],
  worker: { format: 'es' },
  test: {
    // globals: true lets @testing-library/preact register its automatic DOM cleanup between tests
    globals: true,
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/engine/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenSCAD Customizer</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`.gitignore`:
```
node_modules/
dist/
public/wasm/
test-results/
playwright-report/
```

`LICENSE`: the full GPL-2.0 text, downloaded verbatim:
```bash
curl -sL https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt -o LICENSE
```

`src/main.tsx` (placeholder until Task 12 replaces it):
```tsx
import { render } from 'preact';

render(<p>OpenSCAD Customizer</p>, document.getElementById('app')!);
```

`src/types.ts`:
```ts
export type ParamValue = number | string | boolean | number[];

export type ParamOption = { name: string; value: number | string };

/** One entry of OpenSCAD's `--export-format=param` output. Vectors have type 'number' and an array `initial`. */
export type Param = {
  name: string;
  group: string;
  caption?: string;
  type: 'number' | 'string' | 'boolean';
  initial: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: ParamOption[];
};

export type ParamSet = { title: string; parameters: Param[] };

/** Absolute virtual-FS path -> file bytes. */
export type FileMap = Map<string, Uint8Array>;

export type Route =
  | { kind: 'landing' }
  | {
      kind: 'repo';
      owner: string;
      repo: string;
      ref?: string;
      path?: string;
      preset?: string;
      /** Raw URL values, decoded later against the parameter list. */
      values: Record<string, string>;
    };
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: completes without errors, `package-lock.json` created.

- [ ] **Step 3: Write the failing router tests**

`tests/unit/router.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { githubInputToRoute, parseRoute, serializeRoute } from '../../src/router';

describe('parseRoute', () => {
  it('treats empty and unknown hashes as landing', () => {
    expect(parseRoute('')).toEqual({ kind: 'landing' });
    expect(parseRoute('#/nope')).toEqual({ kind: 'landing' });
    expect(parseRoute('#/gh/onlyowner')).toEqual({ kind: 'landing' });
  });

  it('parses owner/repo', () => {
    expect(parseRoute('#/gh/NickLD/gland')).toEqual({ kind: 'repo', owner: 'NickLD', repo: 'gland', ref: undefined, path: undefined, preset: undefined, values: {} });
  });

  it('parses ref, nested path, preset and values', () => {
    const r = parseRoute('#/gh/o/r@v1.2/models/sub/cable_gland.scad?preset=M20+inline&cable_count=3&s=a%26b');
    expect(r).toEqual({ kind: 'repo', owner: 'o', repo: 'r', ref: 'v1.2', path: 'models/sub/cable_gland.scad', preset: 'M20 inline', values: { cable_count: '3', s: 'a&b' } });
  });

  it('decodes refs containing slashes', () => {
    const r = parseRoute('#/gh/o/r@feature%2Fx');
    expect(r.kind === 'repo' && r.ref).toBe('feature/x');
  });

  it('maps param.X keys to X (escape for a parameter literally named preset)', () => {
    const r = parseRoute('#/gh/o/r/a.scad?param.preset=7');
    expect(r.kind === 'repo' && r.values).toEqual({ preset: '7' });
  });

  it('rejects invalid owner/repo characters and malformed escapes', () => {
    expect(parseRoute('#/gh/o<x>/r')).toEqual({ kind: 'landing' });
    expect(parseRoute('#/gh/o/r/%E0%A4%A.scad')).toEqual({ kind: 'landing' });
  });
});

describe('serializeRoute', () => {
  it('round-trips tricky values', () => {
    const route = {
      kind: 'repo' as const, owner: 'o', repo: 'r', ref: 'feature/x', path: 'dir/my file.scad', preset: 'M20 inline',
      values: { s: 'he said "hi" \\ & # ?=', u: 'ünïcødé ✓', preset: '5', n: '0.3' },
    };
    const hash = serializeRoute(route);
    expect(hash.startsWith('#/gh/o/r@feature%2Fx/dir/my%20file.scad?')).toBe(true);
    expect(parseRoute(hash)).toEqual(route);
  });

  it('omits empty query and returns empty string for landing', () => {
    expect(serializeRoute({ kind: 'repo', owner: 'o', repo: 'r', values: {} })).toBe('#/gh/o/r');
    expect(serializeRoute({ kind: 'landing' })).toBe('');
  });
});

describe('githubInputToRoute', () => {
  const base = { kind: 'repo', owner: 'NickLD', repo: 'gland', values: {} };
  it.each([
    'https://github.com/NickLD/gland',
    'https://github.com/NickLD/gland/',
    'https://github.com/NickLD/gland.git',
    'github.com/NickLD/gland',
    'www.github.com/NickLD/gland?tab=readme',
    'NickLD/gland',
  ])('accepts %s', (input) => {
    expect(githubInputToRoute(input)).toEqual(base);
  });

  it('accepts tree and blob URLs', () => {
    expect(githubInputToRoute('https://github.com/NickLD/gland/tree/dev')).toEqual({ ...base, ref: 'dev' });
    expect(githubInputToRoute('https://github.com/NickLD/gland/tree/dev/models')).toEqual({ ...base, ref: 'dev' });
    expect(githubInputToRoute('https://github.com/NickLD/gland/blob/main/models/cable_gland.scad')).toEqual({ ...base, ref: 'main', path: 'models/cable_gland.scad' });
  });

  it('rejects garbage', () => {
    expect(githubInputToRoute('')).toBeNull();
    expect(githubInputToRoute('hello')).toBeNull();
    expect(githubInputToRoute('https://example.com/a b/c')).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/unit/router.test.ts`
Expected: FAIL — cannot resolve `../../src/router`.

- [ ] **Step 5: Implement `src/router.ts`**

```ts
import type { Route } from './types';

const SEG = /^[A-Za-z0-9_.-]+$/;
const PARAM_ESCAPE = 'param.';

export function parseRoute(hash: string): Route {
  try {
    return parseRouteUnsafe(hash);
  } catch {
    return { kind: 'landing' }; // malformed percent-escapes
  }
}

function parseRouteUnsafe(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (!h.startsWith('/gh/')) return { kind: 'landing' };
  const q = h.indexOf('?');
  const pathPart = q >= 0 ? h.slice(0, q) : h;
  const query = new URLSearchParams(q >= 0 ? h.slice(q + 1) : '');
  const segs = pathPart.slice('/gh/'.length).split('/').filter((s) => s.length > 0);
  if (segs.length < 2) return { kind: 'landing' };

  const owner = segs[0];
  let repo = segs[1];
  let ref: string | undefined;
  const at = repo.indexOf('@');
  if (at >= 0) {
    ref = decodeURIComponent(repo.slice(at + 1)) || undefined;
    repo = repo.slice(0, at);
  }
  if (!SEG.test(owner) || !SEG.test(repo)) return { kind: 'landing' };
  const path = segs.length > 2 ? segs.slice(2).map(decodeURIComponent).join('/') : undefined;

  let preset: string | undefined;
  const values: Record<string, string> = {};
  for (const [k, v] of query) {
    if (k === 'preset') preset = v;
    else if (k.startsWith(PARAM_ESCAPE)) values[k.slice(PARAM_ESCAPE.length)] = v;
    else values[k] = v;
  }
  return { kind: 'repo', owner, repo, ref, path, preset, values };
}

export function serializeRoute(r: Route): string {
  if (r.kind === 'landing') return '';
  let s = `#/gh/${r.owner}/${r.repo}`;
  if (r.ref) s += '@' + encodeURIComponent(r.ref);
  if (r.path) s += '/' + r.path.split('/').map(encodeURIComponent).join('/');
  const q = new URLSearchParams();
  if (r.preset) q.set('preset', r.preset);
  for (const [k, v] of Object.entries(r.values)) {
    q.set(k === 'preset' || k.startsWith(PARAM_ESCAPE) ? PARAM_ESCAPE + k : k, v);
  }
  const qs = q.toString();
  return qs ? `${s}?${qs}` : s;
}

/** Accepts the ways people paste a GitHub location and turns it into a route. */
export function githubInputToRoute(input: string): Route | null {
  let s = input.trim().replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (s.startsWith('github.com/')) s = s.slice('github.com/'.length);
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const segs = s.split('/');
  if (segs.length < 2) return null;
  const owner = segs[0];
  const repo = segs[1].replace(/\.git$/, '');
  if (!SEG.test(owner) || !SEG.test(repo)) return null;
  const base = { kind: 'repo' as const, owner, repo, values: {} };
  if ((segs[2] === 'blob' || segs[2] === 'tree') && segs[3]) {
    try {
      const ref = decodeURIComponent(segs[3]);
      const rest = segs.slice(4).map(decodeURIComponent).join('/');
      if (segs[2] === 'blob' && rest.endsWith('.scad')) return { ...base, ref, path: rest };
      return { ...base, ref };
    } catch {
      return null;
    }
  }
  return segs.length === 2 ? base : null;
}
```

Note: `'https://example.com/a b/c'` → after stripping becomes `example.com/a b/c`, `segs.length === 3` and not blob/tree → `null`. `www.github.com/NickLD/gland?tab=readme` → query stripped → 2 segments → base.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/router.test.ts`
Expected: PASS (all tests).

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck` — Expected: no errors.
```bash
git add -A
git commit -m "feat: scaffold Vite/Preact app with hash router"
```

---

### Task 2: Parameter codec, parameter model, presets

**Files:**
- Create: `src/paramCodec.ts`, `src/paramModel.ts`, `src/presets.ts`
- Test: `tests/unit/paramCodec.test.ts`, `tests/unit/paramModel.test.ts`, `tests/unit/presets.test.ts`

**Interfaces:**
- Consumes: `Param`, `ParamSet`, `ParamValue` from `src/types.ts`.
- Produces:
  - `encodeValue(v: ParamValue): string`
  - `decodeValue(raw: string, p: Param): ParamValue | undefined`
  - `toScadLiteral(v: ParamValue): string`
  - `roundToStep(n: number, step?: number, min?: number): number`
  - `sameValue(a: ParamValue, b: ParamValue): boolean`
  - `overrides(values: Record<string, ParamValue>, defaults: Record<string, ParamValue>): Record<string, string>` (encoded, only differing keys, in parameter insertion order of `values`)
  - `type ControlKind = 'slider' | 'number' | 'dropdown' | 'toggle' | 'text' | 'vector'`
  - `type Control = { param: Param; kind: ControlKind }`, `type Group = { name: string; controls: Control[] }`
  - `toGroups(params: Param[]): Group[]`
  - `defaultsOf(params: Param[]): Record<string, ParamValue>`
  - `type PresetFile = Record<string, Record<string, string>>`
  - `parsePresets(text: string): PresetFile`
  - `resolveValues(params: Param[], raw: Record<string, string>): { values: Record<string, ParamValue>; rejected: string[] }`

- [ ] **Step 1: Write the failing tests**

`tests/unit/paramCodec.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decodeValue, encodeValue, overrides, roundToStep, sameValue, toScadLiteral } from '../../src/paramCodec';
import type { Param } from '../../src/types';

const num: Param = { name: 'n', group: 'G', type: 'number', initial: 1, min: 0, max: 10, step: 0.1 };
const str: Param = { name: 's', group: 'G', type: 'string', initial: 'a' };
const opt: Param = { name: 'o', group: 'G', type: 'string', initial: 'a', options: [{ name: 'A', value: 'a' }, { name: 'B', value: 'b' }] };
const numOpt: Param = { name: 'k', group: 'G', type: 'number', initial: 1, options: [{ name: 'one', value: 1 }, { name: 'two', value: 2 }] };
const bool: Param = { name: 'b', group: 'G', type: 'boolean', initial: false };
const vec: Param = { name: 'v', group: 'G', type: 'number', initial: [1, 2, 3] };

describe('encode/decode', () => {
  it('round-trips each type', () => {
    expect(decodeValue(encodeValue(2.5), num)).toBe(2.5);
    expect(decodeValue(encodeValue('he said "hi" \\ ü'), str)).toBe('he said "hi" \\ ü');
    expect(decodeValue(encodeValue(true), bool)).toBe(true);
    expect(decodeValue(encodeValue([4, 5.5, -6]), vec)).toEqual([4, 5.5, -6]);
    expect(decodeValue('2', numOpt)).toBe(2);
  });

  it('rejects invalid values', () => {
    expect(decodeValue('abc', num)).toBeUndefined();
    expect(decodeValue('', num)).toBeUndefined();
    expect(decodeValue('Infinity', num)).toBeUndefined();
    expect(decodeValue('yes', bool)).toBeUndefined();
    expect(decodeValue('[1,2]', vec)).toBeUndefined();
    expect(decodeValue('[1,"x",3]', vec)).toBeUndefined();
    expect(decodeValue('c', opt)).toBeUndefined();
    expect(decodeValue('3', numOpt)).toBeUndefined();
  });
});

describe('toScadLiteral', () => {
  it('formats values as OpenSCAD source', () => {
    expect(toScadLiteral(3)).toBe('3');
    expect(toScadLiteral(true)).toBe('true');
    expect(toScadLiteral('he said "hi" \\')).toBe('"he said \\"hi\\" \\\\"');
    expect(toScadLiteral([1, 2.5])).toBe('[1,2.5]');
  });
  it('throws on non-finite numbers', () => {
    expect(() => toScadLiteral(NaN)).toThrow();
  });
});

describe('roundToStep', () => {
  it('removes float noise', () => {
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundToStep(0.30000000000000004, 0.05)).toBe(0.3);
    expect(roundToStep(1.234, 0.1, 0.8)).toBe(1.2);
    expect(roundToStep(7, 1, 1)).toBe(7);
  });
  it('passes through when there is no step', () => {
    expect(roundToStep(1.2345)).toBe(1.2345);
  });
});

describe('overrides', () => {
  it('encodes only changed values', () => {
    expect(overrides({ n: 1, s: 'x', v: [1, 2, 3] }, { n: 1, s: 'a', v: [1, 2, 3] })).toEqual({ s: 'x' });
    expect(sameValue([1, 2], [1, 2])).toBe(true);
    expect(sameValue([1, 2], [1, 3])).toBe(false);
  });
});
```

`tests/unit/paramModel.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { defaultsOf, toGroups } from '../../src/paramModel';
import type { Param } from '../../src/types';

const params: Param[] = [
  { name: 'part', group: 'What', type: 'string', initial: 'all', options: [{ name: 'All', value: 'all' }] },
  { name: 'count', group: 'Cables', type: 'number', initial: 1, min: 1, max: 8, step: 1 },
  { name: 'free', group: 'Cables', type: 'number', initial: 2 },
  { name: 'flag', group: 'What', type: 'boolean', initial: true },
  { name: 'label', group: 'Cables', type: 'string', initial: 'x' },
  { name: 'vec', group: 'Cables', type: 'number', initial: [1, 2] },
  { name: 'secret', group: 'Hidden', type: 'number', initial: 0 },
];

describe('toGroups', () => {
  it('groups in first-appearance order, maps kinds, hides Hidden', () => {
    const groups = toGroups(params);
    expect(groups.map((g) => g.name)).toEqual(['What', 'Cables']);
    expect(groups[0].controls.map((c) => [c.param.name, c.kind])).toEqual([['part', 'dropdown'], ['flag', 'toggle']]);
    expect(groups[1].controls.map((c) => [c.param.name, c.kind])).toEqual([
      ['count', 'slider'], ['free', 'number'], ['label', 'text'], ['vec', 'vector'],
    ]);
  });
});

describe('defaultsOf', () => {
  it('collects initial values, including hidden ones', () => {
    expect(defaultsOf(params)).toMatchObject({ part: 'all', count: 1, vec: [1, 2], secret: 0 });
  });
});
```

`tests/unit/presets.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parsePresets, resolveValues } from '../../src/presets';
import type { Param } from '../../src/types';

const params: Param[] = [
  { name: 'cable_count', group: 'C', type: 'number', initial: 1, min: 1, max: 8, step: 1 },
  { name: 'layout', group: 'C', type: 'string', initial: 'radial', options: [{ name: 'radial', value: 'radial' }, { name: 'inline', value: 'inline' }] },
  { name: 'taper', group: 'C', type: 'boolean', initial: false },
  { name: 'v', group: 'C', type: 'number', initial: [0, 0] },
];

describe('parsePresets', () => {
  it('reads OpenSCAD parameterSets, stringifying values', () => {
    const text = JSON.stringify({
      fileFormatVersion: '1',
      parameterSets: { 'M20 inline': { cable_count: '3', layout: 'inline', taper: 'true', v: '[1, 2]' }, Num: { cable_count: 2 } },
    });
    expect(parsePresets(text)).toEqual({
      'M20 inline': { cable_count: '3', layout: 'inline', taper: 'true', v: '[1, 2]' },
      Num: { cable_count: '2' },
    });
  });
  it('returns {} for invalid input', () => {
    expect(parsePresets('not json')).toEqual({});
    expect(parsePresets('{"other":1}')).toEqual({});
  });
});

describe('resolveValues', () => {
  it('decodes known values and rejects unknown/invalid ones', () => {
    const r = resolveValues(params, { cable_count: '3', layout: 'inline', taper: 'true', v: '[1, 2]', nope: '1', layout2: 'x', cable_count2: '' });
    expect(r.values).toEqual({ cable_count: 3, layout: 'inline', taper: true, v: [1, 2] });
    expect(r.rejected.sort()).toEqual(['cable_count2', 'layout2', 'nope']);
  });
  it('rejects values not in the options list', () => {
    expect(resolveValues(params, { layout: 'zigzag' }).rejected).toEqual(['layout']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/paramCodec.test.ts tests/unit/paramModel.test.ts tests/unit/presets.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/paramCodec.ts`**

```ts
import type { Param, ParamValue } from './types';

export function encodeValue(v: ParamValue): string {
  return Array.isArray(v) ? JSON.stringify(v) : String(v);
}

export function decodeValue(raw: string, p: Param): ParamValue | undefined {
  if (Array.isArray(p.initial)) {
    try {
      const a: unknown = JSON.parse(raw);
      if (Array.isArray(a) && a.length === p.initial.length && a.every((x) => typeof x === 'number' && Number.isFinite(x))) return a as number[];
    } catch {
      /* fall through */
    }
    return undefined;
  }
  let v: ParamValue | undefined;
  if (p.type === 'boolean') v = raw === 'true' ? true : raw === 'false' ? false : undefined;
  else if (p.type === 'number') {
    const n = raw.trim() === '' ? NaN : Number(raw);
    v = Number.isFinite(n) ? n : undefined;
  } else v = raw;
  if (v !== undefined && p.options && !p.options.some((o) => o.value === v)) return undefined;
  return v;
}

/** OpenSCAD source literal for `-Dname=<literal>`. JSON string syntax matches OpenSCAD's escapes. */
export function toScadLiteral(v: ParamValue): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(toScadLiteral).join(',') + ']';
  if (!Number.isFinite(v)) throw new Error(`Not a finite number: ${v}`);
  return String(v);
}

function decimals(n: number): number {
  const s = String(n);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  return (s.split('.')[1] ?? '').length;
}

export function roundToStep(n: number, step?: number, min?: number): number {
  if (!step || step <= 0) return n;
  const base = min ?? 0;
  const k = Math.round((n - base) / step);
  return Number((base + k * step).toFixed(Math.max(decimals(step), decimals(base))));
}

export function sameValue(a: ParamValue, b: ParamValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

export function overrides(values: Record<string, ParamValue>, defaults: Record<string, ParamValue>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!(k in defaults) || !sameValue(v, defaults[k])) out[k] = encodeValue(v);
  }
  return out;
}
```

- [ ] **Step 4: Implement `src/paramModel.ts`**

```ts
import type { Param, ParamValue } from './types';

export type ControlKind = 'slider' | 'number' | 'dropdown' | 'toggle' | 'text' | 'vector';
export type Control = { param: Param; kind: ControlKind };
export type Group = { name: string; controls: Control[] };

function kindOf(p: Param): ControlKind {
  if (Array.isArray(p.initial)) return 'vector';
  if (p.options && p.options.length > 0) return 'dropdown';
  if (p.type === 'boolean') return 'toggle';
  if (p.type === 'string') return 'text';
  return p.min !== undefined && p.max !== undefined ? 'slider' : 'number';
}

export function toGroups(params: Param[]): Group[] {
  const groups = new Map<string, Group>();
  for (const p of params) {
    if (p.group.toLowerCase() === 'hidden') continue;
    let g = groups.get(p.group);
    if (!g) groups.set(p.group, (g = { name: p.group, controls: [] }));
    g.controls.push({ param: p, kind: kindOf(p) });
  }
  return [...groups.values()];
}

export function defaultsOf(params: Param[]): Record<string, ParamValue> {
  return Object.fromEntries(params.map((p) => [p.name, p.initial]));
}
```

- [ ] **Step 5: Implement `src/presets.ts`**

```ts
import { decodeValue } from './paramCodec';
import type { Param, ParamValue } from './types';

export type PresetFile = Record<string, Record<string, string>>;

/** Reads OpenSCAD's customizer preset file (`<model>.json`, `parameterSets`). */
export function parsePresets(text: string): PresetFile {
  try {
    const sets: unknown = JSON.parse(text)?.parameterSets;
    if (!sets || typeof sets !== 'object') return {};
    const out: PresetFile = {};
    for (const [name, vals] of Object.entries(sets as Record<string, unknown>)) {
      if (vals && typeof vals === 'object') {
        out[name] = Object.fromEntries(Object.entries(vals as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function resolveValues(params: Param[], raw: Record<string, string>): { values: Record<string, ParamValue>; rejected: string[] } {
  const byName = new Map(params.map((p) => [p.name, p]));
  const values: Record<string, ParamValue> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    const p = byName.get(k);
    const decoded = p ? decodeValue(v, p) : undefined;
    if (decoded === undefined) rejected.push(k);
    else values[k] = decoded;
  }
  return { values, rejected };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/paramCodec.test.ts tests/unit/paramModel.test.ts tests/unit/presets.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: parameter codec, form model and preset parsing"
```

---

### Task 3: Manifest parsing and model discovery

**Files:**
- Create: `src/util.ts`, `src/manifest.ts`, `src/candidates.ts`
- Test: `tests/unit/manifest.test.ts`, `tests/unit/candidates.test.ts`

**Interfaces:**
- Produces:
  - `src/util.ts`: `decodeText(b: Uint8Array): string`, `encodeText(s: string): Uint8Array`, `dirname(p: string): string` (`'a/b.scad'→'a'`, `'b.scad'→''`, `'/repo/b.scad'→'/repo'`), `normalizePath(p: string): string` (resolves `.`/`..`, keeps a leading `/`), `joinPath(a: string, b: string): string`, `basename(p: string): string`, `isSafeRelPath(p: string): boolean`
  - `MANIFEST_NAME = 'openscad-customizer.json'`
  - `type LibraryRef = { owner: string; repo: string; ref?: string; subdir?: string }`
  - `type ManifestFile = { path: string; title?: string; description?: string; thumbnail?: string }`
  - `type Manifest = { title?: string; description?: string; files?: ManifestFile[]; libraries: Record<string, LibraryRef> }`
  - `parseLibraryRef(s: string): LibraryRef | null`
  - `parseManifest(text: string): { manifest: Manifest | null; errors: string[] }`
  - `type Candidate = { path: string; title: string; description?: string; thumbnail?: string }`
  - `findCandidates(files: Map<string, Uint8Array>, manifest: Manifest | null): { candidates: Candidate[]; warnings: string[] }` — `files` keys are repo-relative paths.

- [ ] **Step 1: Write the failing tests**

`tests/unit/manifest.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseLibraryRef, parseManifest } from '../../src/manifest';

describe('parseLibraryRef', () => {
  it('parses gh: references', () => {
    expect(parseLibraryRef('gh:someone/lib')).toEqual({ owner: 'someone', repo: 'lib' });
    expect(parseLibraryRef('gh:someone/lib@v2')).toEqual({ owner: 'someone', repo: 'lib', ref: 'v2' });
    expect(parseLibraryRef('gh:someone/lib@v2/src/scad')).toEqual({ owner: 'someone', repo: 'lib', ref: 'v2', subdir: 'src/scad' });
    expect(parseLibraryRef('gh:someone/lib/src')).toEqual({ owner: 'someone', repo: 'lib', subdir: 'src' });
  });
  it('rejects anything else', () => {
    expect(parseLibraryRef('npm:x')).toBeNull();
    expect(parseLibraryRef('gh:onlyowner')).toBeNull();
    expect(parseLibraryRef('gh:o/r/../x')).toBeNull();
  });
});

describe('parseManifest', () => {
  it('parses a full manifest', () => {
    const { manifest, errors } = parseManifest(JSON.stringify({
      title: 'Split Cable Gland', description: 'd',
      files: [{ path: 'cable_gland.scad', title: 'Cable gland', thumbnail: 'showcase/hero.png' }],
      libraries: { fancythreads: 'gh:someone/fancythreads@v2' },
      futureField: 1,
    }));
    expect(errors).toEqual([]);
    expect(manifest).toEqual({
      title: 'Split Cable Gland', description: 'd',
      files: [{ path: 'cable_gland.scad', title: 'Cable gland', thumbnail: 'showcase/hero.png' }],
      libraries: { fancythreads: { owner: 'someone', repo: 'fancythreads', ref: 'v2' } },
    });
  });

  it('drops invalid parts with errors but keeps the rest', () => {
    const { manifest, errors } = parseManifest(JSON.stringify({
      title: 5,
      files: [{ path: '../etc/passwd' }, { path: 'ok.scad', thumbnail: 'https://evil/x.png' }, 'nope'],
      libraries: { good: 'gh:a/b', bad: 'nope' },
    }));
    expect(manifest).toEqual({ files: [{ path: 'ok.scad' }], libraries: { good: { owner: 'a', repo: 'b' } } });
    expect(errors.length).toBe(5);
  });

  it('returns null for non-objects and bad JSON', () => {
    expect(parseManifest('[]').manifest).toBeNull();
    expect(parseManifest('{').manifest).toBeNull();
    expect(parseManifest('{').errors.length).toBe(1);
  });
});
```

`tests/unit/candidates.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { findCandidates } from '../../src/candidates';
import { encodeText } from '../../src/util';

const files = (entries: Record<string, string>) => new Map(Object.entries(entries).map(([k, v]) => [k, encodeText(v)]));

describe('findCandidates', () => {
  it('lists files with customizer annotations, sorted, titled by basename', () => {
    const { candidates } = findCandidates(files({
      'models/b.scad': '/* [Size] */\nx = 1;',
      'a.scad': 'w = 3; // [1:10]\ncube(w);',
      'lib/util.scad': 'module u() {}',
      'README.md': '# hi',
    }), null);
    expect(candidates).toEqual([{ path: 'a.scad', title: 'a' }, { path: 'models/b.scad', title: 'b' }]);
  });

  it('falls back to files not included by others when none are annotated', () => {
    const { candidates } = findCandidates(files({
      'main.scad': 'include <lib/util.scad>\nu();',
      'lib/util.scad': 'use <../other.scad>\nmodule u() {}',
      'other.scad': 'module o() {}',
    }), null);
    expect(candidates.map((c) => c.path)).toEqual(['main.scad']);
  });

  it('uses the manifest file list, warning about missing files', () => {
    const { candidates, warnings } = findCandidates(files({ 'g.scad': 'cube(1);' }), {
      libraries: {},
      files: [{ path: 'g.scad', title: 'Gland', description: 'd', thumbnail: 't.png' }, { path: 'missing.scad' }],
    });
    expect(candidates).toEqual([{ path: 'g.scad', title: 'Gland', description: 'd', thumbnail: 't.png' }]);
    expect(warnings).toEqual(['openscad-customizer.json lists missing.scad, which is not in the repo.']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/manifest.test.ts tests/unit/candidates.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/util.ts`**

```ts
const decoder = new TextDecoder();
const encoder = new TextEncoder();

export const decodeText = (b: Uint8Array): string => decoder.decode(b);
export const encodeText = (s: string): Uint8Array => encoder.encode(s);

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  if (i < 0) return '';
  return i === 0 ? '/' : p.slice(0, i);
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

export function normalizePath(p: string): string {
  const abs = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/');
}

export function joinPath(a: string, b: string): string {
  return normalizePath(a ? `${a}/${b}` : b);
}

/** Repo-relative, no absolute paths, no `..`, no backslashes. */
export function isSafeRelPath(p: string): boolean {
  return p.length > 0 && !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..') && !/^[a-z]+:/i.test(p);
}
```

- [ ] **Step 4: Implement `src/manifest.ts`**

```ts
import { isSafeRelPath } from './util';

export const MANIFEST_NAME = 'openscad-customizer.json';

export type LibraryRef = { owner: string; repo: string; ref?: string; subdir?: string };
export type ManifestFile = { path: string; title?: string; description?: string; thumbnail?: string };
export type Manifest = { title?: string; description?: string; files?: ManifestFile[]; libraries: Record<string, LibraryRef> };

const SEG = /^[A-Za-z0-9_.-]+$/;

export function parseLibraryRef(s: string): LibraryRef | null {
  const m = /^gh:([^/@]+)\/([^/@]+)(?:@([^/]+))?(?:\/(.+))?$/.exec(s);
  if (!m) return null;
  const [, owner, repo, ref, subdir] = m;
  if (!SEG.test(owner) || !SEG.test(repo)) return null;
  if (subdir !== undefined && !isSafeRelPath(subdir)) return null;
  const out: LibraryRef = { owner, repo };
  if (ref) out.ref = ref;
  if (subdir) out.subdir = subdir.replace(/\/+$/, '');
  return out;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function parseManifest(text: string): { manifest: Manifest | null; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { manifest: null, errors: [`${MANIFEST_NAME} is not valid JSON: ${(e as Error).message}`] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { manifest: null, errors: [`${MANIFEST_NAME} must be a JSON object.`] };
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];
  const manifest: Manifest = { libraries: {} };

  for (const key of ['title', 'description'] as const) {
    if (o[key] === undefined) continue;
    if (typeof o[key] === 'string') manifest[key] = o[key] as string;
    else errors.push(`${MANIFEST_NAME}: "${key}" must be a string.`);
  }

  if (o.files !== undefined) {
    if (!Array.isArray(o.files)) errors.push(`${MANIFEST_NAME}: "files" must be an array.`);
    else {
      manifest.files = [];
      for (const f of o.files) {
        const path = f && typeof f === 'object' ? str((f as Record<string, unknown>).path) : undefined;
        if (!path || !isSafeRelPath(path)) {
          errors.push(`${MANIFEST_NAME}: skipped a "files" entry without a valid repo-relative "path".`);
          continue;
        }
        const e = f as Record<string, unknown>;
        const file: ManifestFile = { path };
        if (str(e.title)) file.title = str(e.title);
        if (str(e.description)) file.description = str(e.description);
        const thumb = str(e.thumbnail);
        if (thumb !== undefined) {
          if (isSafeRelPath(thumb)) file.thumbnail = thumb;
          else errors.push(`${MANIFEST_NAME}: thumbnail "${thumb}" must be a repo-relative path.`);
        }
        manifest.files.push(file);
      }
    }
  }

  if (o.libraries !== undefined) {
    if (!o.libraries || typeof o.libraries !== 'object' || Array.isArray(o.libraries)) errors.push(`${MANIFEST_NAME}: "libraries" must be an object.`);
    else {
      for (const [name, value] of Object.entries(o.libraries as Record<string, unknown>)) {
        const ref = typeof value === 'string' && SEG.test(name) ? parseLibraryRef(value) : null;
        if (ref) manifest.libraries[name] = ref;
        else errors.push(`${MANIFEST_NAME}: library "${name}" must look like "gh:owner/repo[@ref][/subdir]".`);
      }
    }
  }
  return { manifest, errors };
}
```

Error count in the test: `title` (1), `../etc/passwd` (1), thumbnail URL (1), `'nope'` file entry (1), `bad` library (1) = 5.

- [ ] **Step 5: Implement `src/candidates.ts`**

```ts
import type { Manifest } from './manifest';
import { MANIFEST_NAME } from './manifest';
import { basename, decodeText, dirname, joinPath } from './util';

export type Candidate = { path: string; title: string; description?: string; thumbnail?: string };

const ANNOTATION = /\/\*\s*\[[^\]]*\]\s*\*\/|^[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*=[^;\n]*;[ \t]*\/\/[ \t]*\[/m;
const INCLUDE = /^\s*(?:include|use)\s*<([^>]+)>/gm;

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
      for (const m of decodeText(files.get(p)!).matchAll(INCLUDE)) included.add(joinPath(dirname(p), m[1]));
    }
    chosen = scad.filter((p) => !included.has(p));
  }
  return { candidates: chosen.map((path) => ({ path, title: titleOf(path) })), warnings };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/manifest.test.ts tests/unit/candidates.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: manifest parsing and model discovery"
```

---

### Task 4: Network adapter and repo loader

**Files:**
- Create: `src/repo/net.ts`, `src/repo/repoLoader.ts`
- Test: `tests/unit/repoLoader.test.ts`

**Interfaces:**
- Consumes: `parseManifest`, `Manifest`, `MANIFEST_NAME` (Task 3).
- Produces:
  - `type Net = { getJson(url: string): Promise<{ status: number; data: unknown }>; getBytes(url: string): Promise<Uint8Array | null> }` — `getJson` throws only on network failure; `getBytes` returns `null` for non-2xx and throws on network failure.
  - `browserNet: Net`
  - `type Caps = { maxFiles: number; maxBytes: number; maxFileBytes: number }`, `REPO_CAPS`, `LIB_CAPS`, `FETCH_EXTENSIONS: string[]`
  - `class LoadError extends Error { code: 'not-found' | 'ref-not-found' | 'network' }`
  - `type ResolvedRef = { ref: string; sha?: string; stale: boolean }`
  - `resolveRef(net: Net, owner: string, repo: string, ref?: string): Promise<ResolvedRef>`
  - `type ListedFile = { path: string; size: number }`
  - `listFiles(net: Net, owner: string, repo: string, ref: string): Promise<ListedFile[]>`
  - `fetchFiles(net: Net, owner: string, repo: string, ref: string, list: ListedFile[], caps: Caps, opts?: { extensions?: string[]; concurrency?: number }): Promise<{ files: Map<string, Uint8Array>; skipped: string[] }>`
  - `type LoadedRepo = { owner: string; repo: string; ref: string; sha?: string; stale: boolean; files: Map<string, Uint8Array>; manifest: Manifest | null; warnings: string[] }` — `files` keys are repo-relative.
  - `loadRepo(net: Net, owner: string, repo: string, ref?: string): Promise<LoadedRepo>`
  - `cdnUrl(owner: string, repo: string, ref: string, path: string): string`

- [ ] **Step 1: Write the failing tests**

`tests/unit/repoLoader.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { cdnUrl, fetchFiles, LoadError, loadRepo, REPO_CAPS, resolveRef, type Net } from '../../src/repo/repoLoader';
import { decodeText, encodeText } from '../../src/util';

const SHA = 'a'.repeat(40);

type Routes = Record<string, { status: number; data?: unknown } | Uint8Array | 'network-error'>;
function fakeNet(routes: Routes): Net & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getJson(url) {
      calls.push(url);
      const r = routes[url];
      if (r === 'network-error') throw new TypeError('Failed to fetch');
      if (!r || r instanceof Uint8Array) return { status: 404, data: null };
      return { status: r.status, data: r.data ?? null };
    },
    async getBytes(url) {
      calls.push(url);
      const r = routes[url];
      if (r === 'network-error') throw new TypeError('Failed to fetch');
      return r instanceof Uint8Array ? r : null;
    },
  };
}

const API = 'https://api.github.com/repos/o/r';
const listing = (ref: string, files: Array<[string, number]>) => ({
  [`https://data.jsdelivr.com/v1/packages/gh/o/r@${ref}?structure=flat`]: { status: 200, data: { files: files.map(([name, size]) => ({ name: '/' + name, size })) } },
});

describe('resolveRef', () => {
  it('resolves the default branch to a commit SHA', async () => {
    const net = fakeNet({ [API]: { status: 200, data: { default_branch: 'main' } }, [`${API}/commits/main`]: { status: 200, data: { sha: SHA } } });
    expect(await resolveRef(net, 'o', 'r')).toEqual({ ref: SHA, sha: SHA, stale: false });
  });

  it('uses a 40-hex ref without any request', async () => {
    const net = fakeNet({});
    expect(await resolveRef(net, 'o', 'r', SHA)).toEqual({ ref: SHA, sha: SHA, stale: false });
    expect(net.calls).toEqual([]);
  });

  it('reports a missing repo', async () => {
    await expect(resolveRef(fakeNet({}), 'o', 'r')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('reports a missing ref', async () => {
    const net = fakeNet({ [`${API}/commits/nope`]: { status: 404 } });
    await expect(resolveRef(net, 'o', 'r', 'nope')).rejects.toMatchObject({ code: 'ref-not-found' });
  });

  it('falls back to jsDelivr branch names when rate-limited', async () => {
    const net = fakeNet({ [API]: { status: 403 }, ...listing('master', []) });
    expect(await resolveRef(net, 'o', 'r')).toEqual({ ref: 'master', stale: true });
  });

  it('falls back on network errors for an explicit ref', async () => {
    const net = fakeNet({ [`${API}/commits/dev`]: 'network-error', ...listing('dev', []) });
    expect(await resolveRef(net, 'o', 'r', 'dev')).toEqual({ ref: 'dev', stale: true });
  });
});

describe('fetchFiles', () => {
  it('filters by extension, applies caps, falls back to raw.githubusercontent.com', async () => {
    const net = fakeNet({
      [cdnUrl('o', 'r', SHA, 'a.scad')]: encodeText('a'),
      [`https://raw.githubusercontent.com/o/r/${SHA}/my%20b.scad`]: encodeText('b'),
    });
    const list = [
      { path: 'a.scad', size: 1 },
      { path: 'my b.scad', size: 1 },
      { path: 'huge.stl', size: 11e6 },
      { path: 'pic.jpg', size: 1 },
      { path: 'gone.scad', size: 1 },
    ];
    const { files, skipped } = await fetchFiles(net, 'o', 'r', SHA, list, REPO_CAPS);
    expect([...files.keys()].sort()).toEqual(['a.scad', 'my b.scad']);
    expect(decodeText(files.get('my b.scad')!)).toBe('b');
    expect(skipped).toEqual(['huge.stl (over 10 MB)', 'gone.scad (download failed)']);
  });

  it('stops at the file-count cap', async () => {
    const list = Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.scad`, size: 1 }));
    const routes: Routes = Object.fromEntries(list.map((f) => [cdnUrl('o', 'r', SHA, f.path), encodeText('x')]));
    const { files, skipped } = await fetchFiles(fakeNet(routes), 'o', 'r', SHA, list, { maxFiles: 3, maxBytes: 1e9, maxFileBytes: 1e9 });
    expect(files.size).toBe(3);
    expect(skipped).toEqual(['f3.scad (repo file limit reached)', 'f4.scad (repo file limit reached)']);
  });
});

describe('loadRepo', () => {
  it('loads files and the manifest, collecting warnings', async () => {
    const manifest = JSON.stringify({ title: 'T', libraries: { bad: 'x' } });
    const net = fakeNet({
      [API]: { status: 403 },
      ...listing('main', [['m.scad', 3], ['openscad-customizer.json', manifest.length]]),
      [cdnUrl('o', 'r', 'main', 'm.scad')]: encodeText('x=1'),
      [cdnUrl('o', 'r', 'main', 'openscad-customizer.json')]: encodeText(manifest),
    });
    const repo = await loadRepo(net, 'o', 'r');
    expect(repo.ref).toBe('main');
    expect(repo.stale).toBe(true);
    expect([...repo.files.keys()].sort()).toEqual(['m.scad', 'openscad-customizer.json']);
    expect(repo.manifest).toEqual({ title: 'T', libraries: {} });
    expect(repo.warnings).toHaveLength(2);
    expect(repo.warnings[0]).toMatch(/hours/);
  });

  it('throws LoadError for an unreachable repo', async () => {
    await expect(loadRepo(fakeNet({}), 'o', 'r')).rejects.toBeInstanceOf(LoadError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/repoLoader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/repo/net.ts`**

```ts
export type Net = {
  /** Throws only on network failure. */
  getJson(url: string): Promise<{ status: number; data: unknown }>;
  /** Null for non-2xx; throws on network failure. */
  getBytes(url: string): Promise<Uint8Array | null>;
};

export const browserNet: Net = {
  async getJson(url) {
    const r = await fetch(url);
    let data: unknown = null;
    try {
      data = await r.json();
    } catch {
      /* non-JSON body */
    }
    return { status: r.status, data };
  },
  async getBytes(url) {
    const r = await fetch(url);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  },
};
```

- [ ] **Step 4: Implement `src/repo/repoLoader.ts`**

```ts
import { MANIFEST_NAME, parseManifest, type Manifest } from '../manifest';
import { decodeText } from '../util';
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

export async function resolveRef(net: Net, owner: string, repo: string, ref?: string): Promise<ResolvedRef> {
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
    }
    const c = await net.getJson(`${API}/${owner}/${repo}/commits/${encodeURIComponent(branch)}`);
    if (c.status === 404 || c.status === 422) {
      throw ref ? new LoadError('ref-not-found', `Couldn't find "${ref}" in ${owner}/${repo}.`) : notFound(owner, repo);
    }
    if (c.status !== 200) return await fallback();
    const sha = String((c.data as { sha?: string })?.sha);
    return { ref: sha, sha, stale: false };
  } catch (e) {
    if (e instanceof LoadError) throw e;
    return fallback();
  }
}

export async function listFiles(net: Net, owner: string, repo: string, ref: string): Promise<ListedFile[]> {
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

export async function loadRepo(net: Net, owner: string, repo: string, ref?: string): Promise<LoadedRepo> {
  const resolved = await resolveRef(net, owner, repo, ref);
  const list = await listFiles(net, owner, repo, resolved.ref);
  const { files, skipped } = await fetchFiles(net, owner, repo, resolved.ref, list, REPO_CAPS);
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
```

Check against the test: `fetchFiles` with `gone.scad` — both CDN and raw return `null` → `skipped` gets `gone.scad (download failed)` after `huge.stl (over 10 MB)`. ✓. In `loadRepo` test, the manifest has one bad library → one manifest error + the stale warning = 2 warnings ✓.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/repoLoader.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: GitHub/jsDelivr repo loader with ref pinning, fallbacks and caps"
```

---

### Task 5: Library and font resolution

**Files:**
- Create: `src/repo/libraries.ts`
- Test: `tests/unit/libraries.test.ts`

**Interfaces:**
- Consumes: `Net`, `listFiles`, `fetchFiles`, `LIB_CAPS` (Task 4); `Manifest`, `LibraryRef` (Task 3); `dirname`, `joinPath`, `decodeText` (Task 3); `FileMap` (Task 1).
- Produces:
  - `type LibSource = { owner: string; repo: string; ref: string; subdir?: string; mount: string; only?: string[]; exclude?: string[]; extensions?: string[] }`
  - `REGISTRY: Record<string, LibSource>`, `FONTS: LibSource`
  - `scanIncludes(text: string): string[]`
  - `type LibraryPlan = { libs: Record<string, LibSource>; missing: string[]; needsFonts: boolean }`
  - `planLibraries(files: Map<string, Uint8Array>, manifest: Manifest | null): LibraryPlan` (repo-relative `files`)
  - `missingLibraryMessage(include: string): string`
  - `loadLibraries(net: Net, plan: LibraryPlan): Promise<{ files: FileMap; warnings: string[] }>` (absolute paths under `/libraries/…` and `/fonts/…`)

- [ ] **Step 1: Write the failing tests**

`tests/unit/libraries.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { FONTS, loadLibraries, planLibraries, REGISTRY, scanIncludes } from '../../src/repo/libraries';
import { cdnUrl, type Net } from '../../src/repo/repoLoader';
import { encodeText } from '../../src/util';

const files = (e: Record<string, string>) => new Map(Object.entries(e).map(([k, v]) => [k, encodeText(v)]));

describe('scanIncludes', () => {
  it('finds include and use targets', () => {
    expect(scanIncludes('include <BOSL2/std.scad>\n  use <lib/a.scad> // c\n// include <commented.scad>\nx=1;')).toEqual(['BOSL2/std.scad', 'lib/a.scad']);
  });
});

describe('planLibraries', () => {
  it('ignores repo-local includes, picks registry and manifest libraries, reports missing ones, detects text()', () => {
    const plan = planLibraries(files({
      'main.scad': 'include <BOSL2/std.scad>\nuse <lib/a.scad>\nuse <fancy/x.scad>\nuse <nope/y.scad>\nuse <threads.scad>\ntext("hi");',
      'lib/a.scad': 'include <../shared.scad>',
      'shared.scad': '',
    }), { libraries: { fancy: { owner: 'f', repo: 'fancy', ref: 'v2', subdir: 'src' } } });
    expect(Object.keys(plan.libs).sort()).toEqual(['BOSL2', 'fancy', 'threads.scad']);
    expect(plan.libs.fancy).toEqual({ owner: 'f', repo: 'fancy', ref: 'v2', subdir: 'src', mount: '/libraries/fancy' });
    expect(plan.missing).toEqual(['nope/y.scad']);
    expect(plan.needsFonts).toBe(true);
  });

  it('lets a manifest library override a bundled one', () => {
    const plan = planLibraries(files({ 'm.scad': 'include <BOSL2/std.scad>' }), { libraries: { BOSL2: { owner: 'me', repo: 'fork' } } });
    expect(plan.libs.BOSL2).toEqual({ owner: 'me', repo: 'fork', ref: 'HEAD', mount: '/libraries/BOSL2' });
  });

  it('has pinned registry entries', () => {
    for (const src of [...Object.values(REGISTRY), FONTS]) expect(src.ref).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('loadLibraries', () => {
  it('mounts library files under their mount point, honouring subdir', async () => {
    const listingUrl = 'https://data.jsdelivr.com/v1/packages/gh/f/fancy@v2?structure=flat';
    const net: Net = {
      async getJson(url) {
        return url === listingUrl
          ? { status: 200, data: { files: [{ name: '/src/x.scad', size: 1 }, { name: '/examples/e.scad', size: 1 }, { name: '/README.md', size: 1 }] } }
          : { status: 404, data: null };
      },
      async getBytes(url) {
        return url === cdnUrl('f', 'fancy', 'v2', 'src/x.scad') ? encodeText('module x(){}') : null;
      },
    };
    const { files, warnings } = await loadLibraries(net, {
      libs: { fancy: { owner: 'f', repo: 'fancy', ref: 'v2', subdir: 'src', mount: '/libraries/fancy' } },
      missing: [], needsFonts: false,
    });
    expect([...files.keys()]).toEqual(['/libraries/fancy/x.scad']);
    expect(warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/libraries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/repo/libraries.ts`**

```ts
import type { Manifest } from '../manifest';
import type { FileMap } from '../types';
import { decodeText, dirname, joinPath } from '../util';
import { fetchFiles, LIB_CAPS, listFiles, resolveRef, type Net } from './repoLoader';

export type LibSource = {
  owner: string; repo: string; ref: string; subdir?: string; mount: string;
  /** Only these repo-relative paths (after subdir). */
  only?: string[];
  /** Skip paths starting with these prefixes (after subdir). */
  exclude?: string[];
  extensions?: string[];
};

const SKIP = ['examples/', 'tests/', 'test/', '.github/', 'docs/', 'tutorials/'];

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
      const fromManifest = manifest?.libraries[root];
      if (fromManifest) {
        libs[root] = { ...fromManifest, ref: fromManifest.ref ?? 'HEAD', mount: `/libraries/${root}` };
      } else if (REGISTRY[root]) {
        libs[root] = REGISTRY[root];
      } else {
        missing.add(inc);
      }
    }
  }
  return { libs, missing: [...missing], needsFonts };
}

async function loadSource(net: Net, src: LibSource): Promise<{ files: FileMap; skipped: string[] }> {
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
  const { files, skipped } = await fetchFiles(net, src.owner, src.repo, ref, listed, LIB_CAPS, { extensions: src.extensions, concurrency: 16 });
  const out: FileMap = new Map();
  for (const [p, d] of files) out.set(`${src.mount}/${p.slice(prefix.length)}`, d);
  return { files: out, skipped };
}

export async function loadLibraries(net: Net, plan: LibraryPlan): Promise<{ files: FileMap; warnings: string[] }> {
  const sources: Array<[string, LibSource]> = Object.entries(plan.libs);
  if (plan.needsFonts) sources.push(['fonts', FONTS]);
  const files: FileMap = new Map();
  const warnings: string[] = [];
  await Promise.all(sources.map(async ([name, src]) => {
    try {
      const r = await loadSource(net, src);
      for (const [p, d] of r.files) files.set(p, d);
      if (r.skipped.length) warnings.push(`Library ${name}: skipped ${r.skipped.length} file(s).`);
    } catch (e) {
      warnings.push(`Couldn't load library ${name} (${src.owner}/${src.repo}): ${(e as Error).message}`);
    }
  }));
  return { files, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/libraries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: bundled/manifest library resolution and lazy fonts"
```

---

### Task 6: Engine core with real-WASM tests

**Files:**
- Create: `scripts/fetch-wasm.mjs`, `src/engine/log.ts`, `src/engine/core.ts`, `tests/engine/wasm.ts`, `tests/engine/core.test.ts`, `tests/unit/log.test.ts`, `tests/fixtures/repos/demo/gland/cable_gland.scad` (copy)
- Modify: `package.json` (add `pretest`/`predev`/`prebuild` scripts)

**Interfaces:**
- Consumes: `FileMap`, `ParamValue` (Task 1); `toScadLiteral` (Task 2); `dirname`, `decodeText`, `encodeText` (Task 3).
- Produces:
  - `src/engine/log.ts`: `type LogLevel = 'echo' | 'warning' | 'error' | 'info'`, `type LogLine = { level: LogLevel; text: string; file?: string; line?: number }`, `parseLog(lines: string[]): LogLine[]`, `isEmptyGeometry(log: LogLine[]): boolean`
  - `src/engine/core.ts`:
    - `type EmFS = { writeFile(p: string, d: Uint8Array | string): void; readFile(p: string): Uint8Array; mkdirTree(p: string): void; chdir(p: string): void }`
    - `type OpenSCADInstance = { FS: EmFS; callMain(args: string[]): number }`
    - `type OpenSCADOptions = { noInitialRun: true; print(s: string): void; printErr(s: string): void; preRun: Array<(m: { ENV: Record<string, string> }) => void> }`
    - `type OpenSCADFactory = (o: OpenSCADOptions) => Promise<OpenSCADInstance>`
    - `type Job = { kind: 'params'; files: FileMap; entry: string } | { kind: 'render'; files: FileMap; entry: string; values: Record<string, ParamValue> }` — `entry` is an absolute FS path (e.g. `/repo/cable_gland.scad`).
    - `type JobResult = { exitCode: number; output: Uint8Array | null; log: LogLine[]; ms: number }`
    - `buildArgs(job: Job, out: string): string[]`
    - `runJob(factory: OpenSCADFactory, job: Job): Promise<JobResult>`

- [ ] **Step 1: Write `scripts/fetch-wasm.mjs`**

```js
// Downloads the official OpenSCAD WebAssembly build into public/wasm/ and verifies its checksum.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

const ZIP_URL = 'https://files.openscad.org/playground/OpenSCAD-2025.03.25.wasm24456-WebAssembly-web.zip';
const SHA256 = '0968af31b9c9b3bba68d9031de1695ccae51c32231a1aab4ef27b18c86379f3b';
const outDir = new URL('../public/wasm/', import.meta.url);
const stamp = new URL('VERSION', outDir);

try {
  if ((await readFile(stamp, 'utf8')).trim() === SHA256) process.exit(0);
} catch {
  /* not downloaded yet */
}

console.log(`Downloading ${ZIP_URL}`);
const res = await fetch(ZIP_URL);
if (!res.ok) throw new Error(`HTTP ${res.status} for ${ZIP_URL}`);
const zip = new Uint8Array(await res.arrayBuffer());
const got = createHash('sha256').update(zip).digest('hex');
if (got !== SHA256) throw new Error(`SHA-256 mismatch: expected ${SHA256}, got ${got}`);

const entries = unzipSync(zip);
await mkdir(outDir, { recursive: true });
for (const name of ['openscad.js', 'openscad.wasm']) {
  if (!entries[name]) throw new Error(`${name} missing from ${ZIP_URL}`);
  await writeFile(new URL(name, outDir), entries[name]);
}
await writeFile(stamp, SHA256 + '\n');
console.log('OpenSCAD WASM ready in public/wasm/');
```

Add `"pretest": "node scripts/fetch-wasm.mjs"` and `"predev": "node scripts/fetch-wasm.mjs"` and `"prebuild": "node scripts/fetch-wasm.mjs"` to `package.json` scripts.

Run: `npm run fetch-wasm`
Expected: `OpenSCAD WASM ready in public/wasm/`; `public/wasm/openscad.wasm` is ~9.6 MB. Running it again prints nothing and exits 0.

- [ ] **Step 2: Copy the gland fixture**

```bash
mkdir -p tests/fixtures/repos/demo/gland
cp ../claudecablepassthroughglandopenscad/cable_gland.scad tests/fixtures/repos/demo/gland/cable_gland.scad
```

- [ ] **Step 3: Write the failing log tests**

`tests/unit/log.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isEmptyGeometry, parseLog } from '../../src/engine/log';

describe('parseLog', () => {
  it('classifies lines, extracts locations, drops noise', () => {
    const log = parseLog([
      "Could not initialize localization (application path is '/').",
      'ECHO: "Cables: 1"',
      'WARNING: Ignoring unknown variable "x" in file /repo/m.scad, line 7',
      'ERROR: Parser error: syntax error in file /repo/m.scad, line 2',
      'DEPRECATED: something',
      'Total rendering time: 0:00:00.179',
    ]);
    expect(log).toEqual([
      { level: 'echo', text: '"Cables: 1"' },
      { level: 'warning', text: 'Ignoring unknown variable "x" in file /repo/m.scad, line 7', file: '/repo/m.scad', line: 7 },
      { level: 'error', text: 'Parser error: syntax error in file /repo/m.scad, line 2', file: '/repo/m.scad', line: 2 },
      { level: 'warning', text: 'DEPRECATED: something' },
      { level: 'info', text: 'Total rendering time: 0:00:00.179' },
    ]);
  });

  it('detects empty geometry', () => {
    expect(isEmptyGeometry(parseLog(['Current top level object is empty.']))).toBe(true);
    expect(isEmptyGeometry(parseLog(['ECHO: 1']))).toBe(false);
  });
});
```

- [ ] **Step 4: Write the failing engine tests**

`tests/engine/wasm.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { OpenSCADFactory } from '../../src/engine/core';

const dir = fileURLToPath(new URL('../../public/wasm/', import.meta.url));

/** Factory backed by the real WASM build, for Node. */
export async function nodeFactory(): Promise<OpenSCADFactory> {
  if (!existsSync(dir + 'openscad.wasm')) throw new Error('OpenSCAD WASM missing: run `npm run fetch-wasm` first');
  const mod = await import(/* @vite-ignore */ pathToFileURL(dir + 'openscad.js').href);
  const wasmBinary = readFileSync(dir + 'openscad.wasm');
  return (opts) => mod.default({ ...opts, wasmBinary });
}
```

`tests/engine/core.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runJob, type OpenSCADFactory } from '../../src/engine/core';
import type { FileMap, ParamSet } from '../../src/types';
import { decodeText, encodeText } from '../../src/util';
import { nodeFactory } from './wasm';

let factory: OpenSCADFactory;
beforeAll(async () => {
  factory = await nodeFactory();
});

const gland = readFileSync(new URL('../fixtures/repos/demo/gland/cable_gland.scad', import.meta.url));
const fm = (e: Record<string, string | Uint8Array>): FileMap =>
  new Map(Object.entries(e).map(([k, v]) => [k, typeof v === 'string' ? encodeText(v) : v]));

async function params(files: FileMap, entry: string): Promise<ParamSet> {
  const r = await runJob(factory, { kind: 'params', files, entry });
  expect(r.exitCode).toBe(0);
  return JSON.parse(decodeText(r.output!));
}

describe('runJob params', () => {
  it('extracts the cable gland customizer', async () => {
    const set = await params(fm({ '/repo/cable_gland.scad': gland }), '/repo/cable_gland.scad');
    const byName = Object.fromEntries(set.parameters.map((p) => [p.name, p]));
    expect(byName.cable_count).toMatchObject({ group: 'Cables', min: 1, max: 8, step: 1, initial: 1, caption: 'Number of cables passing through' });
    expect(byName.part.options).toHaveLength(4);
    expect(byName.cable_layout.options?.map((o) => o.value)).toEqual(['radial', 'inline']);
  });

  it('CRLF source still yields annotations', async () => {
    const set = await params(fm({ '/repo/m.scad': '/* [G] */\r\n// A number\r\nn = 3; // [1:1:8]\r\n' }), '/repo/m.scad');
    expect(set.parameters[0]).toMatchObject({ name: 'n', caption: 'A number', min: 1, max: 8 });
  });
});

describe('runJob render', () => {
  it('renders the gland nut with overrides to OFF', async () => {
    const r = await runJob(factory, { kind: 'render', files: fm({ '/repo/cable_gland.scad': gland }), entry: '/repo/cable_gland.scad', values: { part: 'nut', cable_count: 3 } });
    expect(r.exitCode).toBe(0);
    expect(decodeText(r.output!.subarray(0, 3))).toBe('OFF');
    expect(r.log.some((l) => l.level === 'echo' && l.text.includes('Cables: 3'))).toBe(true);
  });

  it('passes strings with quotes and backslashes unchanged', async () => {
    const r = await runJob(factory, { kind: 'render', files: fm({ '/repo/m.scad': 's = "";\necho(str("[", s, "]"));\ncube(1);' }), entry: '/repo/m.scad', values: { s: 'he said "hi" \\ ü & #' } });
    expect(r.log.find((l) => l.level === 'echo')?.text).toBe('"[he said "hi" \\ ü & #]"');
  });

  it('resolves includes relative to the file and from /libraries', async () => {
    const r = await runJob(factory, {
      kind: 'render',
      files: fm({ '/repo/m.scad': 'include <sub/a.scad>\nuse <mylib/b.scad>\na();\nb();', '/repo/sub/a.scad': 'module a() cube(1);', '/libraries/mylib/b.scad': 'module b() translate([2,0,0]) cube(1);' }),
      entry: '/repo/m.scad', values: {},
    });
    expect(r.exitCode).toBe(0);
    expect(r.output).not.toBeNull();
  });

  it('reports syntax errors with file and line', async () => {
    const r = await runJob(factory, { kind: 'render', files: fm({ '/repo/bad.scad': 'cube(1);\nfoo(;\n' }), entry: '/repo/bad.scad', values: {} });
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toBeNull();
    expect(r.log.find((l) => l.level === 'error')).toMatchObject({ file: '/repo/bad.scad', line: 2 });
  });

  it('flags empty geometry', async () => {
    const r = await runJob(factory, { kind: 'render', files: fm({ '/repo/e.scad': 'echo(1);' }), entry: '/repo/e.scad', values: {} });
    expect(r.output).toBeNull();
    expect(r.log.some((l) => l.text.includes('top level object is empty'))).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run tests/unit/log.test.ts tests/engine/core.test.ts`
Expected: FAIL — `src/engine/log` and `src/engine/core` not found.

- [ ] **Step 6: Implement `src/engine/log.ts`**

```ts
export type LogLevel = 'echo' | 'warning' | 'error' | 'info';
export type LogLine = { level: LogLevel; text: string; file?: string; line?: number };

const NOISE = [/^Could not initialize localization/, /^Fontconfig (error|warning)/];
const TAGGED = /^(ECHO|WARNING|ERROR|TRACE):\s?(.*)$/;
const LOCATION = /in file ([^,]+), line (\d+)/;
const EMPTY = 'Current top level object is empty.';

export function parseLog(lines: string[]): LogLine[] {
  const out: LogLine[] = [];
  for (const raw of lines) {
    if (!raw.trim() || NOISE.some((r) => r.test(raw))) continue;
    let level: LogLevel = 'info';
    let text = raw;
    const m = TAGGED.exec(raw);
    if (m) {
      level = m[1] === 'ECHO' ? 'echo' : m[1] === 'ERROR' ? 'error' : m[1] === 'WARNING' ? 'warning' : 'info';
      text = m[2];
    } else if (raw.startsWith('DEPRECATED:')) {
      level = 'warning';
    }
    const entry: LogLine = { level, text };
    const loc = LOCATION.exec(text);
    if (loc) {
      entry.file = loc[1];
      entry.line = Number(loc[2]);
    }
    out.push(entry);
  }
  return out;
}

export function isEmptyGeometry(log: LogLine[]): boolean {
  return log.some((l) => l.text === EMPTY);
}
```

- [ ] **Step 7: Implement `src/engine/core.ts`**

```ts
import { toScadLiteral } from '../paramCodec';
import type { FileMap, ParamValue } from '../types';
import { decodeText, dirname, encodeText } from '../util';
import { parseLog, type LogLine } from './log';

export type EmFS = {
  writeFile(p: string, d: Uint8Array | string): void;
  readFile(p: string): Uint8Array;
  mkdirTree(p: string): void;
  chdir(p: string): void;
};
export type OpenSCADInstance = { FS: EmFS; callMain(args: string[]): number };
export type OpenSCADOptions = {
  noInitialRun: true;
  print(s: string): void;
  printErr(s: string): void;
  preRun: Array<(m: { ENV: Record<string, string> }) => void>;
};
export type OpenSCADFactory = (o: OpenSCADOptions) => Promise<OpenSCADInstance>;

export type Job =
  | { kind: 'params'; files: FileMap; entry: string }
  | { kind: 'render'; files: FileMap; entry: string; values: Record<string, ParamValue> };
export type JobResult = { exitCode: number; output: Uint8Array | null; log: LogLine[]; ms: number };

const FONTS_CONF = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><dir>/fonts</dir><cachedir>/tmp/fontcache</cachedir></fontconfig>
`;

export function buildArgs(job: Job, out: string): string[] {
  if (job.kind === 'params') return [job.entry, '-o', out, '--export-format=param'];
  return [
    job.entry, '-o', out, '--backend=manifold', '--export-format=off',
    ...Object.entries(job.values).map(([k, v]) => `-D${k}=${toScadLiteral(v)}`),
  ];
}

/** OpenSCAD ignores every customizer annotation in CRLF files, so normalize. */
const normalizeNewlines = (d: Uint8Array) => encodeText(decodeText(d).replace(/\r\n?/g, '\n'));

/** Runs one OpenSCAD invocation on a fresh WASM instance (callMain is not re-entrant). */
export async function runJob(factory: OpenSCADFactory, job: Job): Promise<JobResult> {
  const lines: string[] = [];
  const inst = await factory({
    noInitialRun: true,
    print: (l) => lines.push(l),
    printErr: (l) => lines.push(l),
    preRun: [(m) => {
      m.ENV.OPENSCADPATH = '/libraries';
      m.ENV.FONTCONFIG_FILE = '/etc/fonts.conf';
    }],
  });
  const { FS } = inst;
  for (const dir of ['/etc', '/fonts', '/libraries', '/tmp/fontcache', '/out']) FS.mkdirTree(dir);
  FS.writeFile('/etc/fonts.conf', FONTS_CONF);
  for (const [path, data] of job.files) {
    FS.mkdirTree(dirname(path));
    FS.writeFile(path, path.toLowerCase().endsWith('.scad') ? normalizeNewlines(data) : data);
  }
  FS.chdir(dirname(job.entry));

  const out = job.kind === 'params' ? '/out/params.json' : '/out/model.off';
  const t0 = performance.now();
  let exitCode: number;
  try {
    exitCode = inst.callMain(buildArgs(job, out));
  } catch (e) {
    lines.push(`ERROR: OpenSCAD crashed: ${String(e)}`);
    exitCode = -1;
  }
  const ms = Math.round(performance.now() - t0);
  let output: Uint8Array | null = null;
  try {
    output = FS.readFile(out);
  } catch {
    /* no output written */
  }
  if (output && output.length === 0) output = null;
  return { exitCode, output, log: parseLog(lines), ms };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/unit/log.test.ts tests/engine/core.test.ts`
Expected: PASS. If the dynamic import of `public/wasm/openscad.js` fails under Vitest's transform, add `server: { deps: { external: [/public\/wasm/] } }` inside `test` in `vite.config.ts` and re-run.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: OpenSCAD engine core with log parsing, tested against real WASM"
```

---

### Task 7: Mesh: OFF parsing, triangulation, STL and 3MF writers

**Files:**
- Create: `src/mesh/off.ts`, `src/mesh/triangulate.ts`, `src/mesh/stl.ts`, `src/mesh/threemf.ts`, `src/mesh/bounds.ts`
- Test: `tests/unit/mesh.test.ts`

**Interfaces:**
- Produces:
  - `type Mesh = { positions: Float32Array; triangles: Uint32Array; colors: Uint8Array | null }` (`colors` is RGBA per triangle, `4 * triangleCount` bytes)
  - `parseOff(text: string): Mesh`
  - `triangulateFace(positions: Float32Array, idx: number[]): number[][]`
  - `meshToStl(mesh: Mesh): Uint8Array` (binary STL)
  - `meshToThreeMF(mesh: Mesh): Uint8Array` (zip)
  - `type Bounds = { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] }`
  - `meshBounds(mesh: Mesh): Bounds`

- [ ] **Step 1: Write the failing tests**

`tests/unit/mesh.test.ts`:
```ts
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { meshBounds } from '../../src/mesh/bounds';
import { parseOff } from '../../src/mesh/off';
import { meshToStl } from '../../src/mesh/stl';
import { meshToThreeMF } from '../../src/mesh/threemf';
import { triangulateFace } from '../../src/mesh/triangulate';
import { decodeText } from '../../src/util';

const CUBE_QUADS = `OFF 8 6 0
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
4 4 5 7 6
4 2 3 1 0
4 0 1 5 4
4 1 3 7 5
4 3 2 6 7
4 2 0 4 6
`;

const COLORED = `OFF
3 2 0
0 0 0
1 0 0
0 1 0
3 0 1 2 255 0 0
3 0 2 1 249 215 44
`;

function normal(m: ReturnType<typeof parseOff>, t: number) {
  const p = (i: number) => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
  const [a, b, c] = [p(m.triangles[3 * t]), p(m.triangles[3 * t + 1]), p(m.triangles[3 * t + 2])];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

describe('parseOff', () => {
  it('triangulates quads keeping outward winding', () => {
    const m = parseOff(CUBE_QUADS);
    expect(m.positions.length).toBe(24);
    expect(m.triangles.length / 3).toBe(12);
    expect(m.colors).toBeNull();
    // Face "4 4 5 7 6" is the top (z=1): its triangles must point +Z.
    expect(normal(m, 0)[2]).toBeGreaterThan(0);
    expect(normal(m, 1)[2]).toBeGreaterThan(0);
  });

  it('reads per-face colors (header counts on their own line)', () => {
    const m = parseOff(COLORED);
    expect(Array.from(m.colors!)).toEqual([255, 0, 0, 255, 249, 215, 44, 255]);
  });

  it('rejects non-OFF input', () => {
    expect(() => parseOff('solid x')).toThrow(/OFF/);
  });
});

describe('triangulateFace', () => {
  it('handles a concave L-shaped polygon', () => {
    // L shape in the XY plane, counter-clockwise
    const pts = [0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0];
    const tris = triangulateFace(new Float32Array(pts), [0, 1, 2, 3, 4, 5]);
    expect(tris).toHaveLength(4);
    const area = tris.reduce((s, [a, b, c]) => {
      const [ax, ay, bx, by, cx, cy] = [pts[3 * a], pts[3 * a + 1], pts[3 * b], pts[3 * b + 1], pts[3 * c], pts[3 * c + 1]];
      return s + ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
    }, 0);
    expect(area).toBeCloseTo(3); // all positive (CCW) and summing to the L's area
  });
});

describe('writers', () => {
  it('writes binary STL', () => {
    const stl = meshToStl(parseOff(CUBE_QUADS));
    expect(stl.length).toBe(84 + 12 * 50);
    expect(new DataView(stl.buffer).getUint32(80, true)).toBe(12);
  });

  it('writes a 3MF package with colors as base materials', () => {
    const files = unzipSync(meshToThreeMF(parseOff(COLORED)));
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = decodeText(files['3D/3dmodel.model']);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('displaycolor="#FF0000FF"');
    expect(model).toContain('displaycolor="#F9D72CFF"');
    expect(model.match(/<triangle /g)).toHaveLength(2);
    expect(model).toContain('p1="1"');
  });

  it('writes a 3MF without materials when uncoloured', () => {
    const model = decodeText(unzipSync(meshToThreeMF(parseOff(CUBE_QUADS)))['3D/3dmodel.model']);
    expect(model).not.toContain('basematerials');
    expect(model.match(/<vertex /g)).toHaveLength(8);
  });

  it('computes bounds', () => {
    expect(meshBounds(parseOff(CUBE_QUADS))).toEqual({ min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/mesh.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/mesh/triangulate.ts`**

```ts
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
```

- [ ] **Step 4: Implement `src/mesh/off.ts`**

```ts
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
```

- [ ] **Step 5: Implement `src/mesh/stl.ts`, `src/mesh/bounds.ts`, `src/mesh/threemf.ts`**

`src/mesh/stl.ts`:
```ts
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
```

`src/mesh/bounds.ts`:
```ts
import type { Mesh } from './off';

export type Bounds = { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] };

export function meshBounds(mesh: Mesh): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = mesh.positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
```

`src/mesh/threemf.ts`:
```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/mesh.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: OFF mesh parsing with STL and 3MF writers"
```

---

### Task 8: Engine worker and cancellable proxy

**Files:**
- Create: `src/engine/protocol.ts`, `src/engine/worker.ts`, `src/engine/engine.ts`
- Test: `tests/unit/engine.test.ts`

**Interfaces:**
- Consumes: `Job`, `JobResult`, `runJob`, `OpenSCADFactory` (Task 6).
- Produces:
  - `protocol.ts`: `type WorkerRequest = { id: number; job: Job }`, `type WorkerReply = { id: number; result?: JobResult; error?: string }`
  - `engine.ts`: `type WorkerLike = { postMessage(m: WorkerRequest): void; terminate(): void; onmessage: ((e: { data: WorkerReply }) => void) | null; onerror: ((e: unknown) => void) | null }`, `type Engine = { run(job: Job, signal?: AbortSignal): Promise<JobResult> }`, `class AbortedError extends Error`, `createEngine(makeWorker: () => WorkerLike): Engine`, `createBrowserEngine(): Engine`

- [ ] **Step 1: Write the failing tests**

`tests/unit/engine.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Job, JobResult } from '../../src/engine/core';
import { AbortedError, createEngine, type WorkerLike } from '../../src/engine/engine';
import type { WorkerReply, WorkerRequest } from '../../src/engine/protocol';

class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  onmessage: ((e: { data: WorkerReply }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  received: WorkerRequest[] = [];
  terminated = false;
  constructor() { FakeWorker.all.push(this); }
  postMessage(m: WorkerRequest) { this.received.push(m); }
  terminate() { this.terminated = true; }
  reply(id: number, result: JobResult) { this.onmessage?.({ data: { id, result } }); }
}

const job: Job = { kind: 'params', files: new Map(), entry: '/repo/a.scad' };
const result: JobResult = { exitCode: 0, output: null, log: [], ms: 1 };

describe('createEngine', () => {
  it('routes replies to the matching request and reuses the worker', async () => {
    FakeWorker.all = [];
    const engine = createEngine(() => new FakeWorker());
    const p1 = engine.run(job);
    const p2 = engine.run(job);
    const w = FakeWorker.all[0];
    w.reply(w.received[1].id, { ...result, ms: 2 });
    w.reply(w.received[0].id, result);
    expect((await p1).ms).toBe(1);
    expect((await p2).ms).toBe(2);
    expect(FakeWorker.all).toHaveLength(1);
  });

  it('abort terminates the worker, rejects pending jobs and respawns lazily', async () => {
    FakeWorker.all = [];
    const engine = createEngine(() => new FakeWorker());
    const ac = new AbortController();
    const p = engine.run(job, ac.signal);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(AbortedError);
    expect(FakeWorker.all[0].terminated).toBe(true);
    const p2 = engine.run(job);
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1].reply(FakeWorker.all[1].received[0].id, result);
    await expect(p2).resolves.toEqual(result);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(createEngine(() => new FakeWorker()).run(job, ac.signal)).rejects.toBeInstanceOf(AbortedError);
  });

  it('rejects pending jobs when the worker crashes', async () => {
    FakeWorker.all = [];
    const engine = createEngine(() => new FakeWorker());
    const p = engine.run(job);
    FakeWorker.all[0].onerror?.({ message: 'out of memory' });
    await expect(p).rejects.toThrow(/out of memory/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/engine.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/engine/protocol.ts` and `src/engine/engine.ts`**

`src/engine/protocol.ts`:
```ts
import type { Job, JobResult } from './core';

export type WorkerRequest = { id: number; job: Job };
export type WorkerReply = { id: number; result?: JobResult; error?: string };
```

`src/engine/engine.ts`:
```ts
import type { Job, JobResult } from './core';
import type { WorkerReply, WorkerRequest } from './protocol';

export type WorkerLike = {
  postMessage(m: WorkerRequest): void;
  terminate(): void;
  onmessage: ((e: { data: WorkerReply }) => void) | null;
  onerror: ((e: unknown) => void) | null;
};
export type Engine = { run(job: Job, signal?: AbortSignal): Promise<JobResult> };

export class AbortedError extends Error {
  constructor() {
    super('Render cancelled');
    this.name = 'AbortError';
  }
}

type Pending = { resolve(r: JobResult): void; reject(e: Error): void };

export function createEngine(makeWorker: () => WorkerLike): Engine {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const failAll = (err: Error) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  const reset = () => {
    worker?.terminate();
    worker = null;
  };
  const get = (): WorkerLike => {
    if (worker) return worker;
    const w = makeWorker();
    w.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.result) p.resolve(data.result);
      else p.reject(new Error(data.error ?? 'Engine error'));
    };
    w.onerror = (e) => {
      const msg = (e as { message?: string })?.message ?? String(e);
      failAll(new Error(`Engine crashed: ${msg}`));
      if (worker === w) reset();
    };
    return (worker = w);
  };

  return {
    run(job, signal) {
      return new Promise<JobResult>((resolve, reject) => {
        if (signal?.aborted) return reject(new AbortedError());
        const id = nextId++;
        pending.set(id, { resolve, reject });
        get().postMessage({ id, job });
        signal?.addEventListener('abort', () => {
          if (!pending.has(id)) return;
          // A single-threaded worker cannot be interrupted: kill it and everything queued on it.
          failAll(new AbortedError());
          reset();
        }, { once: true });
      });
    },
  };
}

export function createBrowserEngine(): Engine {
  return createEngine(() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike);
}
```

- [ ] **Step 4: Implement `src/engine/worker.ts`**

```ts
import { runJob, type OpenSCADFactory } from './core';
import type { WorkerReply, WorkerRequest } from './protocol';

// The project compiles against the DOM lib (adding the WebWorker lib alongside it causes duplicate
// declarations), so describe the worker scope minimally.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(m: WorkerReply, transfer?: Transferable[]): void;
};
const base = import.meta.env.BASE_URL;
let factory: Promise<OpenSCADFactory> | null = null;

function loadFactory(): Promise<OpenSCADFactory> {
  factory ??= (async () => {
    const [mod, wasmModule] = await Promise.all([
      import(/* @vite-ignore */ `${base}wasm/openscad.js`),
      WebAssembly.compileStreaming(fetch(`${base}wasm/openscad.wasm`)),
    ]);
    // Compile once, instantiate per job: each OpenSCAD run needs a fresh instance.
    return (opts) => mod.default({
      ...opts,
      instantiateWasm(imports: WebAssembly.Imports, done: (i: WebAssembly.Instance) => void) {
        WebAssembly.instantiate(wasmModule, imports).then(done);
        return {};
      },
    });
  })();
  return factory;
}

let chain: Promise<void> = Promise.resolve();
scope.onmessage = (e) => {
  const { id, job } = e.data;
  chain = chain.then(async () => {
    try {
      const result = await runJob(await loadFactory(), job);
      scope.postMessage({ id, result }, result.output ? [result.output.buffer as ArrayBuffer] : []);
    } catch (err) {
      scope.postMessage({ id, error: String(err) });
    }
  });
};
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/unit/engine.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Web Worker engine with cancellable main-thread proxy"
```

---

### Task 9: App controller

**Files:**
- Create: `src/app/controller.ts`
- Test: `tests/unit/controller.test.ts`

**Interfaces:**
- Consumes: everything above: `parseRoute`, `serializeRoute` (T1); `overrides`, `sameValue` (T2); `toGroups`, `defaultsOf`, `Group` (T2); `parsePresets`, `resolveValues`, `PresetFile` (T2); `findCandidates`, `Candidate` (T3); `loadRepo`, `LoadedRepo`, `LoadError`, `Net` (T4); `planLibraries`, `loadLibraries`, `missingLibraryMessage` (T5); `Engine`, `AbortedError` (T8); `isEmptyGeometry`, `LogLine` (T6); `parseOff`, `Mesh`, `meshToStl`, `meshToThreeMF` (T7).
- Produces:
  - `type Phase = 'landing' | 'loading' | 'picker' | 'model' | 'error'`
  - `type RenderState = { status: 'idle' | 'rendering' | 'ready' | 'error'; mesh: Mesh | null; outdated: boolean; ms?: number; message?: string }`
  - `type ControllerDeps = { net: Net; engine: Engine; setHash(hash: string): void; debounceMs?: number; loadRepo?: typeof loadRepo; loadLibraries?: typeof loadLibraries }`
  - `class AppController` with signals `phase, error, repo, candidates, entry, params, groups (computed), defaults (computed), values, presets, preset, render, log, notices, editedSource, meshVersion` and methods:
    - `open(hash: string): Promise<void>`
    - `openFile(path: string, init?: { preset?: string; values?: Record<string, string> }): Promise<void>`
    - `setValue(name: string, v: ParamValue): void`, `resetValue(name: string): void`, `resetAll(): void`, `applyPreset(name: string): void`
    - `setSource(text: string | null): void`
    - `cancelRender(): void`
    - `exportModel(format: 'stl' | '3mf'): { name: string; bytes: Uint8Array } | null`
    - `entrySource(): string` (current text of the entry file, edited or original)
    - `hash(): string` (current serialized route)

- [ ] **Step 1: Write the failing tests**

`tests/unit/controller.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../../src/app/controller';
import type { Job, JobResult } from '../../src/engine/core';
import { AbortedError, type Engine } from '../../src/engine/engine';
import { LoadError, type LoadedRepo } from '../../src/repo/repoLoader';
import type { ParamSet } from '../../src/types';
import { encodeText } from '../../src/util';

const SET: ParamSet = {
  title: 'g',
  parameters: [
    { name: 'cable_count', group: 'Cables', type: 'number', initial: 1, min: 1, max: 8, step: 1 },
    { name: 'part', group: 'What', type: 'string', initial: 'all', options: [{ name: 'All', value: 'all' }, { name: 'Nut', value: 'nut' }] },
  ],
};
const OFF = 'OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n';

function repo(files: Record<string, string>): LoadedRepo {
  return { owner: 'o', repo: 'r', ref: 'a'.repeat(40), sha: 'a'.repeat(40), stale: false, manifest: null, warnings: [], files: new Map(Object.entries(files).map(([k, v]) => [k, encodeText(v)])) };
}

type Call = { job: Job; signal?: AbortSignal; resolve(r: JobResult): void; reject(e: Error): void };
function fakeEngine() {
  const calls: Call[] = [];
  const engine: Engine = {
    run(job, signal) {
      return new Promise((resolve, reject) => {
        const call = { job, signal, resolve, reject };
        calls.push(call);
        signal?.addEventListener('abort', () => reject(new AbortedError()));
        if (job.kind === 'params') resolve({ exitCode: 0, output: encodeText(JSON.stringify(SET)), log: [], ms: 1 });
      });
    },
  };
  return { engine, calls, renders: () => calls.filter((c) => c.job.kind === 'render') };
}
const ok = (): JobResult => ({ exitCode: 0, output: encodeText(OFF), log: [{ level: 'echo', text: 'hi' }], ms: 5 });

function make(files = { 'g.scad': '/* [Cables] */\ncable_count = 1; // [1:8]', 'g.json': JSON.stringify({ parameterSets: { Three: { cable_count: '3' } } }) }) {
  const fe = fakeEngine();
  const setHash = vi.fn();
  const ctl = new AppController({
    net: { getJson: vi.fn(), getBytes: vi.fn() }, engine: fe.engine, setHash, debounceMs: 500,
    loadRepo: vi.fn(async () => repo(files)),
    loadLibraries: vi.fn(async () => ({ files: new Map(), warnings: [] })),
  });
  return { ctl, fe, setHash };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AppController', () => {
  it('opens a file route, applies URL values, renders and keeps the URL in sync', async () => {
    const { ctl, fe, setHash } = make();
    await ctl.open('#/gh/o/r/g.scad?cable_count=4&bogus=1');
    expect(ctl.phase.value).toBe('model');
    expect(ctl.values.value).toEqual({ cable_count: 4, part: 'all' });
    expect(ctl.log.value.some((l) => l.text.includes('bogus'))).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    const [r] = fe.renders();
    expect(r.job).toMatchObject({ kind: 'render', entry: '/repo/g.scad', values: { cable_count: 4, part: 'all' } });
    r.resolve(ok());
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.render.value.status).toBe('ready');
    expect(ctl.render.value.mesh?.triangles.length).toBe(3);
    expect(setHash).toHaveBeenLastCalledWith('#/gh/o/r/g.scad?cable_count=4');
  });

  it('applies a preset from the route and from applyPreset', async () => {
    const { ctl } = make();
    await ctl.open('#/gh/o/r/g.scad?preset=Three');
    expect(ctl.values.value.cable_count).toBe(3);
    ctl.resetAll();
    expect(ctl.values.value.cable_count).toBe(1);
    ctl.applyPreset('Three');
    expect(ctl.values.value.cable_count).toBe(3);
    expect(ctl.hash()).toBe('#/gh/o/r/g.scad?preset=Three&cable_count=3');
  });

  it('debounces changes and cancels the in-flight render', async () => {
    const { ctl, fe } = make();
    await ctl.open('#/gh/o/r/g.scad');
    await vi.advanceTimersByTimeAsync(0);
    const first = fe.renders()[0];
    ctl.setValue('cable_count', 2);
    ctl.setValue('cable_count', 3);
    expect(first.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(499);
    expect(fe.renders()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fe.renders()).toHaveLength(2);
    expect(fe.renders()[1].job).toMatchObject({ values: { cable_count: 3 } });
  });

  it('stale render result is discarded', async () => {
    const { ctl, fe } = make();
    await ctl.open('#/gh/o/r/g.scad');
    await vi.advanceTimersByTimeAsync(0);
    const first = fe.renders()[0];
    ctl.setValue('cable_count', 5);
    await vi.advanceTimersByTimeAsync(500);
    const second = fe.renders()[1];
    second.resolve({ ...ok(), ms: 22 });
    await vi.advanceTimersByTimeAsync(0);
    first.resolve({ ...ok(), ms: 11 }); // late, already aborted: must be ignored
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.render.value.ms).toBe(22);
  });

  it('marks failures and empty geometry as outdated with a message', async () => {
    const { ctl, fe } = make();
    await ctl.open('#/gh/o/r/g.scad');
    await vi.advanceTimersByTimeAsync(0);
    fe.renders()[0].resolve({ exitCode: 1, output: null, log: [{ level: 'info', text: 'Current top level object is empty.' }], ms: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.render.value).toMatchObject({ status: 'error', outdated: true, message: 'Render produced no geometry (check the `part` setting?)' });
  });

  it('shows the picker for repos with several models, and opens the only one directly', async () => {
    const many = make({ 'a.scad': 'x = 1; // [1:2]', 'b.scad': 'y = 1; // [1:2]' });
    await many.ctl.open('#/gh/o/r');
    expect(many.ctl.phase.value).toBe('picker');
    expect(many.ctl.candidates.value.map((c) => c.path)).toEqual(['a.scad', 'b.scad']);
    const one = make();
    await one.ctl.open('#/gh/o/r');
    expect(one.ctl.phase.value).toBe('model');
    expect(one.ctl.entry.value).toBe('g.scad');
  });

  it('reports load errors and missing files', async () => {
    const { ctl } = make();
    (ctl as unknown as { deps: { loadRepo: unknown } }).deps.loadRepo = vi.fn(async () => { throw new LoadError('not-found', "Couldn't find o/r. Private repos aren't supported."); });
    await ctl.open('#/gh/o/r');
    expect(ctl.phase.value).toBe('error');
    expect(ctl.error.value).toMatch(/Couldn't find o\/r/);
    const m = make();
    await m.ctl.open('#/gh/o/r/nope.scad');
    expect(m.ctl.phase.value).toBe('error');
    expect(m.ctl.error.value).toBe('nope.scad is not in o/r.');
  });

  it('exports from the current mesh with a values-based file name', async () => {
    const { ctl, fe } = make();
    await ctl.open('#/gh/o/r/g.scad');
    expect(ctl.exportModel('stl')).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    fe.renders()[0].resolve(ok());
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.exportModel('stl')?.name).toBe('g.stl');
    ctl.setValue('cable_count', 2);
    expect(ctl.exportModel('stl')).toBeNull(); // outdated until re-rendered
    await vi.advanceTimersByTimeAsync(500);
    fe.renders()[1].resolve(ok());
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.exportModel('3mf')?.name).toMatch(/^g-[0-9a-f]{8}\.3mf$/);
  });

  it('re-extracts parameters when the source is edited', async () => {
    const { ctl, fe } = make();
    await ctl.open('#/gh/o/r/g.scad');
    ctl.setSource('cable_count = 2; // [1:8]');
    await vi.advanceTimersByTimeAsync(500);
    const paramsJobs = fe.calls.filter((c) => c.job.kind === 'params');
    expect(paramsJobs).toHaveLength(2);
    expect(new TextDecoder().decode(paramsJobs[1].job.files.get('/repo/g.scad'))).toBe('cable_count = 2; // [1:8]');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/controller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/controller.ts`**

```ts
import { computed, signal } from '@preact/signals';
import { findCandidates, type Candidate } from '../candidates';
import type { Job, JobResult } from '../engine/core';
import { AbortedError, type Engine } from '../engine/engine';
import { isEmptyGeometry, type LogLine } from '../engine/log';
import { parseOff, type Mesh } from '../mesh/off';
import { meshToStl } from '../mesh/stl';
import { meshToThreeMF } from '../mesh/threemf';
import { overrides } from '../paramCodec';
import { defaultsOf, toGroups } from '../paramModel';
import { parsePresets, resolveValues, type PresetFile } from '../presets';
import { loadLibraries, missingLibraryMessage, planLibraries } from '../repo/libraries';
import { loadRepo, LoadError, type LoadedRepo, type Net } from '../repo/repoLoader';
import { parseRoute, serializeRoute } from '../router';
import type { FileMap, Param, ParamSet, ParamValue } from '../types';
import { basename, decodeText, encodeText } from '../util';

export type Phase = 'landing' | 'loading' | 'picker' | 'model' | 'error';
export type RenderState = { status: 'idle' | 'rendering' | 'ready' | 'error'; mesh: Mesh | null; outdated: boolean; ms?: number; message?: string };
export type ControllerDeps = {
  net: Net;
  engine: Engine;
  setHash(hash: string): void;
  debounceMs?: number;
  loadRepo?: typeof loadRepo;
  loadLibraries?: typeof loadLibraries;
};

const REPO_ROOT = '/repo/';
const EMPTY_MSG = 'Render produced no geometry (check the `part` setting?)';

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class AppController {
  phase = signal<Phase>('landing');
  error = signal<string | null>(null);
  repo = signal<LoadedRepo | null>(null);
  candidates = signal<Candidate[]>([]);
  entry = signal<string | null>(null);
  params = signal<Param[]>([]);
  groups = computed(() => toGroups(this.params.value));
  defaults = computed(() => defaultsOf(this.params.value));
  values = signal<Record<string, ParamValue>>({});
  presets = signal<PresetFile>({});
  preset = signal<string | null>(null);
  render = signal<RenderState>({ status: 'idle', mesh: null, outdated: false });
  /** Increments whenever a different file is opened, so the viewer knows to re-fit the camera. */
  meshVersion = signal(0);
  log = signal<LogLine[]>([]);
  notices = signal<string[]>([]);
  editedSource = signal<string | null>(null);

  private deps: Required<ControllerDeps>;
  private libFiles: FileMap = new Map();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private seq = 0;
  private openSeq = 0;
  private paramLog: LogLine[] = [];
  private pinnedRef: string | undefined;

  constructor(deps: ControllerDeps) {
    this.deps = { debounceMs: 500, loadRepo, loadLibraries, ...deps };
  }

  async open(hash: string): Promise<void> {
    const route = parseRoute(hash);
    this.pinnedRef = route.kind === 'repo' ? route.ref : undefined;
    const mySeq = ++this.openSeq;
    this.cancelRender();
    if (route.kind === 'landing') {
      this.phase.value = 'landing';
      return;
    }
    this.phase.value = 'loading';
    this.error.value = null;
    try {
      const current = this.repo.value;
      let repo = current;
      if (!current || current.owner !== route.owner || current.repo !== route.repo || (route.ref && route.ref !== current.ref && route.ref !== current.sha)) {
        repo = await this.deps.loadRepo(this.deps.net, route.owner, route.repo, route.ref);
        if (mySeq !== this.openSeq) return;
        const plan = planLibraries(repo.files, repo.manifest);
        const libs = await this.deps.loadLibraries(this.deps.net, plan);
        if (mySeq !== this.openSeq) return;
        this.libFiles = libs.files;
        const found = findCandidates(repo.files, repo.manifest);
        this.repo.value = repo;
        this.candidates.value = found.candidates;
        this.notices.value = [...repo.warnings, ...found.warnings, ...libs.warnings, ...plan.missing.map(missingLibraryMessage)];
      }
      if (route.path) {
        if (!repo!.files.has(route.path)) throw new Error(`${route.path} is not in ${route.owner}/${route.repo}.`);
        await this.openFile(route.path, { preset: route.preset, values: route.values });
      } else if (this.candidates.value.length === 1) {
        await this.openFile(this.candidates.value[0].path);
      } else {
        this.entry.value = null;
        this.phase.value = 'picker';
      }
    } catch (e) {
      if (mySeq !== this.openSeq) return;
      this.error.value = e instanceof LoadError || e instanceof Error ? e.message : String(e);
      this.phase.value = 'error';
    }
  }

  async openFile(path: string, init: { preset?: string; values?: Record<string, string> } = {}): Promise<void> {
    this.cancelRender();
    this.entry.value = path;
    this.editedSource.value = null;
    this.meshVersion.value++;
    this.render.value = { status: 'idle', mesh: null, outdated: false };
    const presetFile = this.repo.value?.files.get(path.replace(/\.scad$/i, '.json'));
    this.presets.value = presetFile ? parsePresets(decodeText(presetFile)) : {};
    await this.extractParams();

    const params = this.params.value;
    let values = { ...this.defaults.value };
    const rejected: string[] = [];
    this.preset.value = null;
    if (init.preset) {
      const p = this.presets.value[init.preset];
      if (p) {
        values = { ...values, ...resolveValues(params, p).values };
        this.preset.value = init.preset;
      } else rejected.push(`preset "${init.preset}"`);
    }
    const fromUrl = resolveValues(params, init.values ?? {});
    values = { ...values, ...fromUrl.values };
    rejected.push(...fromUrl.rejected);
    this.values.value = values;
    if (rejected.length) this.paramLog = [...this.paramLog, { level: 'warning', text: `Ignored from the link: ${rejected.join(', ')}` }];
    this.log.value = this.paramLog;
    this.phase.value = 'model';
    this.syncHash();
    this.scheduleRender(0);
  }

  setValue(name: string, v: ParamValue): void {
    this.values.value = { ...this.values.value, [name]: v };
    this.changed();
  }

  resetValue(name: string): void {
    if (name in this.defaults.value) this.setValue(name, this.defaults.value[name]);
  }

  resetAll(): void {
    this.values.value = { ...this.defaults.value };
    this.preset.value = null;
    this.changed();
  }

  applyPreset(name: string): void {
    const p = this.presets.value[name];
    if (!p) return;
    this.values.value = { ...this.defaults.value, ...resolveValues(this.params.value, p).values };
    this.preset.value = name;
    this.changed();
  }

  /** `null` discards local edits. */
  setSource(text: string | null): void {
    this.editedSource.value = text;
    this.markOutdated();
    this.clearTimer();
    this.abort?.abort();
    this.timer = setTimeout(async () => {
      await this.extractParams();
      // Keep values for parameters that still exist; new ones get their defaults.
      const defaults = this.defaults.value;
      this.values.value = Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, k in this.values.value ? this.values.value[k] : d]));
      this.syncHash();
      this.doRender();
    }, this.deps.debounceMs);
  }

  cancelRender(): void {
    this.clearTimer();
    this.abort?.abort();
    this.abort = null;
    this.seq++;
    if (this.render.value.status === 'rendering') this.render.value = { ...this.render.value, status: 'error', outdated: true, message: 'Render cancelled' };
  }

  exportModel(format: 'stl' | '3mf'): { name: string; bytes: Uint8Array } | null {
    const r = this.render.value;
    const entry = this.entry.value;
    if (!entry || r.status !== 'ready' || r.outdated || !r.mesh) return null;
    const changed = overrides(this.values.value, this.defaults.value);
    const keys = Object.keys(changed).sort();
    const suffix = keys.length ? '-' + fnv1a(keys.map((k) => `${k}=${changed[k]}`).join('&')) : '';
    const stem = basename(entry).replace(/\.scad$/i, '');
    return { name: `${stem}${suffix}.${format}`, bytes: format === 'stl' ? meshToStl(r.mesh) : meshToThreeMF(r.mesh) };
  }

  entrySource(): string {
    const entry = this.entry.value;
    if (this.editedSource.value !== null) return this.editedSource.value;
    const data = entry ? this.repo.value?.files.get(entry) : undefined;
    return data ? decodeText(data) : '';
  }

  hash(): string {
    const repo = this.repo.value;
    if (!repo) return '';
    return serializeRoute({
      // Pinned links stay pinned; unpinned links stay unpinned.
      kind: 'repo', owner: repo.owner, repo: repo.repo, ref: this.pinnedRef,
      path: this.entry.value ?? undefined, preset: this.preset.value ?? undefined,
      values: overrides(this.values.value, this.defaults.value),
    });
  }

  // --- internals ---

  private files(): FileMap {
    const files: FileMap = new Map(this.libFiles);
    for (const [p, d] of this.repo.value?.files ?? []) files.set(REPO_ROOT + p, d);
    const entry = this.entry.value;
    if (entry && this.editedSource.value !== null) files.set(REPO_ROOT + entry, encodeText(this.editedSource.value));
    return files;
  }

  private async extractParams(): Promise<void> {
    const entry = this.entry.value!;
    const job: Job = { kind: 'params', files: this.files(), entry: REPO_ROOT + entry };
    let result: JobResult;
    try {
      result = await this.deps.engine.run(job);
    } catch (e) {
      this.paramLog = [{ level: 'error', text: `Couldn't read parameters: ${String(e)}` }];
      this.params.value = [];
      return;
    }
    this.paramLog = result.log.filter((l) => l.level !== 'info');
    let set: ParamSet | null = null;
    try {
      set = result.output ? (JSON.parse(decodeText(result.output)) as ParamSet) : null;
    } catch {
      set = null;
    }
    this.params.value = set?.parameters ?? [];
  }

  private changed(): void {
    this.markOutdated();
    this.syncHash();
    this.scheduleRender(this.deps.debounceMs);
  }

  private markOutdated(): void {
    if (this.render.value.mesh) this.render.value = { ...this.render.value, outdated: true };
  }

  private syncHash(): void {
    this.deps.setHash(this.hash());
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleRender(delay: number): void {
    this.clearTimer();
    this.abort?.abort();
    this.abort = null;
    this.timer = setTimeout(() => this.doRender(), delay);
  }

  private async doRender(): Promise<void> {
    const entry = this.entry.value;
    if (!entry) return;
    const seq = ++this.seq;
    const abort = new AbortController();
    this.abort = abort;
    this.render.value = { ...this.render.value, status: 'rendering' };
    let result: JobResult;
    try {
      result = await this.deps.engine.run({ kind: 'render', files: this.files(), entry: REPO_ROOT + entry, values: this.values.value }, abort.signal);
    } catch (e) {
      if (e instanceof AbortedError || seq !== this.seq) return;
      this.render.value = { ...this.render.value, status: 'error', outdated: true, message: String(e) };
      return;
    }
    if (seq !== this.seq) return;
    this.abort = null;
    this.log.value = [...this.paramLog, ...result.log, { level: 'info', text: `Rendered in ${result.ms} ms` }];
    if (result.exitCode === 0 && result.output) {
      try {
        const mesh = parseOff(decodeText(result.output));
        this.render.value = { status: 'ready', mesh, outdated: false, ms: result.ms };
        return;
      } catch (e) {
        this.render.value = { ...this.render.value, status: 'error', outdated: true, message: `Couldn't read the rendered model: ${String(e)}` };
        return;
      }
    }
    const message = isEmptyGeometry(result.log) ? EMPTY_MSG : 'Render failed. See the Console for details.';
    this.render.value = { ...this.render.value, status: 'error', outdated: true, message };
  }
}
```

In the "stale render" test, `first` was aborted by `scheduleRender` so the fake engine already rejected it with `AbortedError`; the later `first.resolve(...)` is a no-op on a settled promise. The `seq` check is the second line of defence for real engines that resolve after abort.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/controller.test.ts`
Expected: PASS. Then `npm test` — all suites PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: app controller orchestrating load, params, debounced renders and export"
```

---

### Task 10: Parameter form UI

**Files:**
- Create: `src/ui/ParamForm.tsx`
- Test: `tests/unit/ParamForm.test.tsx`

**Interfaces:**
- Consumes: `Group`, `Control` (T2); `roundToStep`, `sameValue` (T2); `ParamValue` (T1).
- Produces: `ParamForm(props: { groups: Group[]; values: Record<string, ParamValue>; defaults: Record<string, ParamValue>; onChange(name: string, v: ParamValue): void; onReset(name: string): void }): JSX.Element`. Each control has `data-testid="param-<name>"` on its wrapper; the primary input has `aria-label` = parameter name.

- [ ] **Step 1: Write the failing tests**

`tests/unit/ParamForm.test.tsx`:
```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { toGroups } from '../../src/paramModel';
import type { Param } from '../../src/types';
import { ParamForm } from '../../src/ui/ParamForm';

const params: Param[] = [
  { name: 'clearance', group: 'Holes', caption: 'Extra diameter', type: 'number', initial: 0.3, min: 0, max: 1.5, step: 0.05 },
  { name: 'count', group: 'Holes', type: 'number', initial: 2, options: [{ name: 'Two', value: 2 }, { name: 'Three', value: 3 }] },
  { name: 'taper', group: 'Holes', type: 'boolean', initial: false },
  { name: 'label', group: 'Text', type: 'string', initial: 'hi' },
  { name: 'offset', group: 'Text', type: 'number', initial: [1, 2] },
];
const defaults = Object.fromEntries(params.map((p) => [p.name, p.initial]));

function setup(values = defaults) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(<ParamForm groups={toGroups(params)} values={values} defaults={defaults} onChange={onChange} onReset={onReset} />);
  return { onChange, onReset };
}

describe('ParamForm', () => {
  it('renders groups, captions and controls', () => {
    setup();
    expect(screen.getByText('Holes')).toBeTruthy();
    expect(screen.getByText('Extra diameter')).toBeTruthy();
    expect((screen.getByLabelText('clearance') as HTMLInputElement).type).toBe('range');
    expect(screen.getByLabelText('count').tagName).toBe('SELECT');
    expect((screen.getByLabelText('taper') as HTMLInputElement).type).toBe('checkbox');
  });

  it('rounds slider values to the step', () => {
    const { onChange } = setup();
    fireEvent.input(screen.getByLabelText('clearance'), { target: { value: '0.30000000000000004' } });
    expect(onChange).toHaveBeenCalledWith('clearance', 0.3);
  });

  it('emits typed values for dropdowns, toggles, text and vectors', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText('count'), { target: { value: '1' } }); // option index
    expect(onChange).toHaveBeenCalledWith('count', 3);
    fireEvent.click(screen.getByLabelText('taper'));
    expect(onChange).toHaveBeenCalledWith('taper', true);
    fireEvent.input(screen.getByLabelText('label'), { target: { value: 'yo' } });
    expect(onChange).toHaveBeenCalledWith('label', 'yo');
    fireEvent.input(screen.getByLabelText('offset[1]'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith('offset', [1, 5]);
  });

  it('marks modified values and resets them', () => {
    const { onReset } = setup({ ...defaults, taper: true });
    const reset = screen.getByRole('button', { name: 'Reset taper' });
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalledWith('taper');
    expect(screen.queryByRole('button', { name: 'Reset label' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ParamForm.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/ui/ParamForm.tsx`**

```tsx
import { useState } from 'preact/hooks';
import { roundToStep, sameValue } from '../paramCodec';
import type { Control, Group } from '../paramModel';
import type { ParamValue } from '../types';

type Props = {
  groups: Group[];
  values: Record<string, ParamValue>;
  defaults: Record<string, ParamValue>;
  onChange(name: string, v: ParamValue): void;
  onReset(name: string): void;
};

const pretty = (name: string) => name.replace(/_/g, ' ');

function Field({ control, value, modified, onChange, onReset }: { control: Control; value: ParamValue; modified: boolean; onChange(v: ParamValue): void; onReset(): void }) {
  const p = control.param;
  const num = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) onChange(roundToStep(n, p.step, p.min));
  };
  let input;
  switch (control.kind) {
    case 'slider':
      input = (
        <div class="slider">
          <input type="range" aria-label={p.name} min={p.min} max={p.max} step={p.step ?? 'any'} value={value as number} onInput={(e) => num(e.currentTarget.value)} />
          <input type="number" aria-label={`${p.name} value`} min={p.min} max={p.max} step={p.step ?? 'any'} value={value as number} onChange={(e) => num(e.currentTarget.value)} />
        </div>
      );
      break;
    case 'number':
      input = <input type="number" aria-label={p.name} step={p.step ?? 'any'} value={value as number} onChange={(e) => num(e.currentTarget.value)} />;
      break;
    case 'dropdown': {
      const opts = p.options!;
      input = (
        <select aria-label={p.name} value={String(opts.findIndex((o) => o.value === value))} onChange={(e) => onChange(opts[Number(e.currentTarget.value)].value)}>
          {opts.map((o, i) => <option key={i} value={String(i)}>{o.name}</option>)}
        </select>
      );
      break;
    }
    case 'toggle':
      input = <input type="checkbox" aria-label={p.name} checked={value as boolean} onClick={(e) => onChange(e.currentTarget.checked)} />;
      break;
    case 'text':
      input = <input type="text" aria-label={p.name} value={value as string} onInput={(e) => onChange(e.currentTarget.value)} />;
      break;
    case 'vector': {
      const arr = value as number[];
      input = (
        <div class="vector">
          {arr.map((x, i) => (
            <input key={i} type="number" aria-label={`${p.name}[${i}]`} step={p.step ?? 'any'} value={x}
              onInput={(e) => {
                const n = Number(e.currentTarget.value);
                if (Number.isFinite(n)) onChange(arr.map((y, j) => (j === i ? roundToStep(n, p.step) : y)));
              }} />
          ))}
        </div>
      );
      break;
    }
  }
  return (
    <div class={`field${modified ? ' modified' : ''}`} data-testid={`param-${p.name}`}>
      <div class="field-head">
        <span class="field-name">{pretty(p.name)}</span>
        {modified && <span class="dot" aria-hidden="true" />}
        {modified && <button type="button" class="reset" aria-label={`Reset ${p.name}`} title="Reset to default" onClick={onReset}>↺</button>}
      </div>
      {p.caption && <p class="caption">{p.caption}</p>}
      {input}
    </div>
  );
}

export function ParamForm({ groups, values, defaults, onChange, onReset }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => (groups[0] ? { [groups[0].name]: true } : {}));
  return (
    <div class="param-form">
      {groups.map((g) => (
        <details key={g.name} open={open[g.name] ?? false} onToggle={(e) => setOpen({ ...open, [g.name]: (e.currentTarget as HTMLDetailsElement).open })}>
          <summary>{g.name}</summary>
          {g.controls.map((c) => {
            const v = values[c.param.name] ?? c.param.initial;
            return (
              <Field key={c.param.name} control={c} value={v}
                modified={!sameValue(v, defaults[c.param.name] ?? c.param.initial)}
                onChange={(nv) => onChange(c.param.name, nv)} onReset={() => onReset(c.param.name)} />
            );
          })}
        </details>
      ))}
    </div>
  );
}
```

Captions and option names come from untrusted scripts; they are rendered as text children only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ParamForm.test.tsx`
Expected: PASS. (Elements inside a closed `<details>` are still in the DOM, so the label queries work.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: customizer parameter form"
```

---

### Task 11: 3D viewer

**Files:**
- Create: `src/ui/viewer/meshGeometry.ts`, `src/ui/viewer/ThreeViewer.ts`, `src/ui/viewer/Viewer.tsx`
- Test: `tests/unit/meshGeometry.test.ts`

**Interfaces:**
- Consumes: `Mesh`, `meshBounds` (T7).
- Produces:
  - `meshToGeometry(mesh: Mesh): BufferGeometry` (non-indexed, `position` + `normal`, plus `color` attribute when `mesh.colors`)
  - `class ThreeViewer { constructor(container: HTMLElement); setMesh(mesh: Mesh | null, refit: boolean): void; setDark(dark: boolean): void; dispose(): void }`
  - `Viewer(props: { mesh: Mesh | null; fitKey: number; dark: boolean }): JSX.Element`

- [ ] **Step 1: Write the failing test**

`tests/unit/meshGeometry.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseOff } from '../../src/mesh/off';
import { meshToGeometry } from '../../src/ui/viewer/meshGeometry';

describe('meshToGeometry', () => {
  it('expands triangles with normals, adding colours only when present', () => {
    const plain = meshToGeometry(parseOff('OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n'));
    expect(plain.getAttribute('position').count).toBe(3);
    expect(plain.getAttribute('normal').getZ(0)).toBeCloseTo(1);
    expect(plain.getAttribute('color')).toBeUndefined();

    const colored = meshToGeometry(parseOff('OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2 255 0 0\n'));
    const c = colored.getAttribute('color');
    expect([c.getX(0), c.getY(0), c.getZ(0)]).toEqual([1, 0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/meshGeometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/ui/viewer/meshGeometry.ts`**

```ts
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
```

- [ ] **Step 4: Implement `src/ui/viewer/ThreeViewer.ts`**

```ts
import {
  AmbientLight, Color, DirectionalLight, GridHelper, Mesh as ThreeMesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Mesh } from '../../mesh/off';
import { meshToGeometry } from './meshGeometry';

const MODEL_COLOR = 0xf9d72c; // OpenSCAD default

export class ThreeViewer {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(40, 1, 0.1, 10000);
  private controls: OrbitControls;
  private grid: GridHelper;
  private model: ThreeMesh | null = null;
  private observer: ResizeObserver;
  private frame = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    this.camera.up.set(0, 0, 1); // OpenSCAD is Z-up
    this.camera.position.set(80, -120, 90);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.requestRender());
    this.scene.add(new AmbientLight(0xffffff, 0.6));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(1, -1.5, 2);
    this.camera.add(key);
    this.scene.add(this.camera);
    this.grid = new GridHelper(200, 20);
    this.grid.rotation.x = Math.PI / 2; // XY plane
    this.scene.add(this.grid);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  setDark(dark: boolean): void {
    this.scene.background = new Color(dark ? 0x1b1d22 : 0xeef0f3);
    this.requestRender();
  }

  setMesh(mesh: Mesh | null, refit: boolean): void {
    if (this.model) {
      this.scene.remove(this.model);
      this.model.geometry.dispose();
      (this.model.material as MeshStandardMaterial).dispose();
      this.model = null;
    }
    if (mesh) {
      const geometry = meshToGeometry(mesh);
      const material = new MeshStandardMaterial({ color: mesh.colors ? 0xffffff : MODEL_COLOR, vertexColors: !!mesh.colors, roughness: 0.55, metalness: 0.05 });
      this.model = new ThreeMesh(geometry, material);
      this.scene.add(this.model);
      const box = geometry.boundingBox!;
      this.grid.position.z = box.min.z;
      if (refit) this.fit();
    }
    this.requestRender();
  }

  private fit(): void {
    const sphere = this.model!.geometry.boundingSphere!;
    const dist = sphere.radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.15;
    const dir = new Vector3(0.6, -1, 0.75).normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.near = dist / 100;
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.setMesh(null, false);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
```

- [ ] **Step 5: Implement `src/ui/viewer/Viewer.tsx`**

```tsx
import { useEffect, useRef } from 'preact/hooks';
import type { Mesh } from '../../mesh/off';
import { ThreeViewer } from './ThreeViewer';

export function Viewer({ mesh, fitKey, dark }: { mesh: Mesh | null; fitKey: number; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewer = useRef<ThreeViewer | null>(null);
  const fitted = useRef(-1);

  useEffect(() => {
    viewer.current = new ThreeViewer(ref.current!);
    return () => viewer.current?.dispose();
  }, []);
  useEffect(() => viewer.current?.setDark(dark), [dark]);
  useEffect(() => {
    const refit = mesh !== null && fitted.current !== fitKey;
    if (refit) fitted.current = fitKey;
    viewer.current?.setMesh(mesh, refit);
  }, [mesh, fitKey]);

  return <div class="viewer-canvas" ref={ref} data-testid="viewer" />;
}
```

- [ ] **Step 6: Run test and typecheck**

Run: `npx vitest run tests/unit/meshGeometry.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: three.js model viewer"
```

---

### Task 12: App shell (header, landing, picker, model view, export, console, theme, layout)

**Files:**
- Create: `src/config.ts`, `src/ui/theme.ts`, `src/ui/download.ts`, `src/ui/App.tsx`, `src/ui/Header.tsx`, `src/ui/Landing.tsx`, `src/ui/FilePicker.tsx`, `src/ui/ModelView.tsx`, `src/ui/ExportBar.tsx`, `src/ui/ConsolePanel.tsx`, `src/ui/styles.css`
- Modify: `src/main.tsx`
- Test: `tests/unit/App.test.tsx`

**Interfaces:**
- Consumes: `AppController` (T9), `ParamForm` (T10), `Viewer` (T11), `githubInputToRoute`, `serializeRoute` (T1), `meshBounds` (T7), `cdnUrl` (T4), `createBrowserEngine` (T8), `browserNet` (T4).
- Produces:
  - `FEATURED: { owner: string; repo: string; path: string; title: string; description: string }`
  - `theme.ts`: `isDark: Signal<boolean>`, `toggleTheme(): void`
  - `download.ts`: `downloadBytes(name: string, bytes: Uint8Array): void`
  - `App({ ctl }: { ctl: AppController })`
  - `ModelView` exposes a slot for the source drawer: `ModelView({ ctl, sourceOpen, onCloseSource })`
  - Test ids used by E2E: `render-status`, `export-stl`, `export-3mf`, `share-link`, `console-toggle`, `model-size`, `picker-card`, `github-input`, `source-toggle`, `notice`.

- [ ] **Step 1: Write the failing App test**

`tests/unit/App.test.tsx`:
```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { AppController } from '../../src/app/controller';
import { App } from '../../src/ui/App';

vi.mock('../../src/ui/viewer/Viewer', () => ({ Viewer: () => <div data-testid="viewer" /> }));

function ctl() {
  return new AppController({ net: { getJson: vi.fn(), getBytes: vi.fn() }, engine: { run: vi.fn() }, setHash: vi.fn() });
}

describe('App', () => {
  it('shows the landing page and navigates from a pasted GitHub URL', () => {
    const c = ctl();
    render(<App ctl={c} />);
    expect(screen.getByText(/Split Cable Gland/)).toBeTruthy();
    fireEvent.input(screen.getByTestId('github-input'), { target: { value: 'https://github.com/someone/thing/blob/main/a.scad' } });
    fireEvent.submit(screen.getByTestId('github-input').closest('form')!);
    expect(location.hash).toBe('#/gh/someone/thing@main/a.scad');
  });

  it('shows load errors', () => {
    const c = ctl();
    c.phase.value = 'error';
    c.error.value = "Couldn't find o/r. Private repos aren't supported.";
    render(<App ctl={c} />);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't find o/r");
  });

  it('renders manifest text as text, not HTML', () => {
    const c = ctl();
    c.phase.value = 'picker';
    c.repo.value = { owner: 'o', repo: 'r', ref: 'main', stale: false, files: new Map(), warnings: [], manifest: { title: '<img src=x onerror=alert(1)>', libraries: {} } };
    c.candidates.value = [{ path: 'a.scad', title: '<b>bold</b>' }, { path: 'b.scad', title: 'b' }];
    render(<App ctl={c} />);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('<b>bold</b>')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/App.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement small modules**

`src/config.ts`:
```ts
/** Featured model on the landing page. Update owner/repo once the gland repo is published. */
export const FEATURED = {
  owner: 'NickLD',
  repo: 'split-cable-gland',
  path: 'cable_gland.scad',
  title: 'Split Cable Gland',
  description: 'Threaded pass-through you can close around cables that already have connectors. 1–8 cables, any diameters.',
};
```

`src/ui/theme.ts`:
```ts
import { effect, signal } from '@preact/signals';

const KEY = 'osc-theme';
const stored = (() => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
})();
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export const isDark = signal(stored ? stored === 'dark' : !!media?.matches);
media?.addEventListener('change', (e) => {
  if (!stored) isDark.value = e.matches;
});

effect(() => {
  document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light';
});

export function toggleTheme(): void {
  isDark.value = !isDark.value;
  try {
    localStorage.setItem(KEY, isDark.value ? 'dark' : 'light');
  } catch {
    /* storage unavailable */
  }
}
```

`src/ui/download.ts`:
```ts
export function downloadBytes(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
```

- [ ] **Step 4: Implement components**

`src/ui/Header.tsx`:
```tsx
import { useState } from 'preact/hooks';
import type { AppController } from '../app/controller';
import { isDark, toggleTheme } from './theme';

export function Header({ ctl, onToggleSource }: { ctl: AppController; onToggleSource(): void }) {
  const repo = ctl.repo.value;
  const [copied, setCopied] = useState(false);
  const title = repo?.manifest?.title ?? (repo ? `${repo.owner}/${repo.repo}` : 'OpenSCAD Customizer');
  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Copy this link', location.href);
    }
  };
  return (
    <header class="app-header">
      <a class="brand" href="#">◧</a>
      <h1>{title}</h1>
      {ctl.phase.value === 'model' && ctl.candidates.value.length > 1 && (
        <select aria-label="Model" value={ctl.entry.value ?? ''} onChange={(e) => (location.hash = `#/gh/${repo!.owner}/${repo!.repo}/${e.currentTarget.value}`)}>
          {ctl.candidates.value.map((c) => <option key={c.path} value={c.path}>{c.title}</option>)}
        </select>
      )}
      {repo && (
        <a class="ref" href={`https://github.com/${repo.owner}/${repo.repo}/tree/${repo.ref}`} target="_blank" rel="noopener noreferrer">
          {repo.owner}/{repo.repo} @{repo.sha ? repo.sha.slice(0, 7) : repo.ref}
        </a>
      )}
      <span class="spacer" />
      {ctl.phase.value === 'model' && (
        <>
          <button type="button" data-testid="share-link" onClick={share}>{copied ? 'Copied!' : 'Share link'}</button>
          <button type="button" data-testid="source-toggle" onClick={onToggleSource}>&lt;/&gt; Src</button>
        </>
      )}
      <button type="button" aria-label="Toggle dark mode" onClick={toggleTheme}>{isDark.value ? '☀' : '☾'}</button>
    </header>
  );
}
```

`src/ui/Landing.tsx`:
```tsx
import { useState } from 'preact/hooks';
import { FEATURED } from '../config';
import { githubInputToRoute, serializeRoute } from '../router';

export function Landing() {
  const [input, setInput] = useState('');
  const [bad, setBad] = useState(false);
  const featured = `#/gh/${FEATURED.owner}/${FEATURED.repo}/${FEATURED.path}`;
  const appUrl = location.origin + location.pathname;
  const badge = `[![Open in OpenSCAD Customizer](https://img.shields.io/badge/Open%20in-OpenSCAD%20Customizer-f9d72c)](${appUrl}#/gh/OWNER/REPO)`;
  return (
    <main class="landing">
      <section class="featured">
        <h2>{FEATURED.title}</h2>
        <p>{FEATURED.description}</p>
        <a class="button primary" href={featured}>Customize it</a>
      </section>
      <section>
        <h2>Open any OpenSCAD repo</h2>
        <form onSubmit={(e) => {
          e.preventDefault();
          const route = githubInputToRoute(input);
          setBad(!route);
          if (route) location.hash = serializeRoute(route);
        }}>
          <input data-testid="github-input" type="text" placeholder="https://github.com/owner/repo" value={input} onInput={(e) => setInput(e.currentTarget.value)} />
          <button type="submit" class="primary">Open</button>
        </form>
        {bad && <p class="hint error">That doesn't look like a GitHub repository URL.</p>}
      </section>
      <section>
        <h2>For authors</h2>
        <p>Link people straight to your models by adding this badge to your README (replace OWNER/REPO):</p>
        <pre class="snippet">{badge}</pre>
        <p>Optionally add <code>openscad-customizer.json</code> to your repo root for titles, thumbnails and extra libraries. Presets saved by OpenSCAD's customizer (<code>model.json</code> next to <code>model.scad</code>) show up automatically.</p>
      </section>
      <footer class="about">
        Runs <a href="https://openscad.org" target="_blank" rel="noopener noreferrer">OpenSCAD</a> (GPL-2.0) in your browser. Bundled libraries are loaded from their GitHub repos under their own licenses: BOSL2, BOSL, MCAD, NopSCADlib, Round-Anything, funcutils, threads-scad, smooth-prim, Liberation fonts.
      </footer>
    </main>
  );
}
```

`src/ui/FilePicker.tsx`:
```tsx
import type { AppController } from '../app/controller';
import { cdnUrl } from '../repo/repoLoader';

export function FilePicker({ ctl }: { ctl: AppController }) {
  const repo = ctl.repo.value!;
  return (
    <main class="picker">
      {repo.manifest?.description && <p class="lead">{repo.manifest.description}</p>}
      {ctl.candidates.value.length === 0 && <p role="alert">No OpenSCAD models found in {repo.owner}/{repo.repo}.</p>}
      <div class="cards">
        {ctl.candidates.value.map((c) => (
          <a key={c.path} class="card" data-testid="picker-card" href={`#/gh/${repo.owner}/${repo.repo}/${c.path.split('/').map(encodeURIComponent).join('/')}`}>
            {c.thumbnail ? <img src={cdnUrl(repo.owner, repo.repo, repo.ref, c.thumbnail)} alt="" loading="lazy" /> : <div class="placeholder">◧</div>}
            <h3>{c.title}</h3>
            {c.description && <p>{c.description}</p>}
            <code>{c.path}</code>
          </a>
        ))}
      </div>
    </main>
  );
}
```

`src/ui/ExportBar.tsx`:
```tsx
import type { AppController } from '../app/controller';
import { downloadBytes } from './download';

export function ExportBar({ ctl }: { ctl: AppController }) {
  const r = ctl.render.value;
  const ready = r.status === 'ready' && !r.outdated;
  const go = (format: 'stl' | '3mf') => {
    const out = ctl.exportModel(format);
    if (out) downloadBytes(out.name, out.bytes);
  };
  return (
    <div class="export-bar">
      <button type="button" class="primary" data-testid="export-stl" disabled={!ready} onClick={() => go('stl')}>⬇ STL</button>
      <button type="button" class="primary" data-testid="export-3mf" disabled={!ready} onClick={() => go('3mf')}>⬇ 3MF</button>
    </div>
  );
}
```

`src/ui/ConsolePanel.tsx`:
```tsx
import { useState } from 'preact/hooks';
import type { AppController } from '../app/controller';

export function ConsolePanel({ ctl, onJumpToLine }: { ctl: AppController; onJumpToLine(line: number): void }) {
  const log = ctl.log.value;
  const errors = log.filter((l) => l.level === 'error').length;
  const warnings = log.filter((l) => l.level === 'warning').length;
  const [open, setOpen] = useState(false);
  const entry = ctl.entry.value;
  return (
    <section class={`console${open ? ' open' : ''}`}>
      <button type="button" data-testid="console-toggle" onClick={() => setOpen(!open)}>
        Console {errors > 0 && <span class="badge error">{errors}</span>} {warnings > 0 && <span class="badge warning">{warnings}</span>}
      </button>
      {open && (
        <ol>
          {log.map((l, i) => (
            <li key={i} class={l.level}>
              {l.line && l.file === `/repo/${entry}`
                ? <button type="button" class="link" onClick={() => onJumpToLine(l.line!)}>line {l.line}</button>
                : null}{' '}
              {l.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

`src/ui/ModelView.tsx`:
```tsx
import type { ComponentChildren } from 'preact';
import type { AppController } from '../app/controller';
import { meshBounds } from '../mesh/bounds';
import { ConsolePanel } from './ConsolePanel';
import { ExportBar } from './ExportBar';
import { ParamForm } from './ParamForm';
import { isDark } from './theme';
import { Viewer } from './viewer/Viewer';

export function ModelView({ ctl, drawer, onJumpToLine }: { ctl: AppController; drawer: ComponentChildren; onJumpToLine(line: number): void }) {
  const r = ctl.render.value;
  const presets = Object.keys(ctl.presets.value);
  const size = r.mesh ? meshBounds(r.mesh).size.map((s) => s.toFixed(1)).join(' × ') + ' mm' : null;
  const status = r.status === 'rendering' ? 'Rendering…' : r.status === 'error' ? r.message ?? 'Error' : r.status === 'ready' ? (r.outdated ? 'Outdated' : 'Ready') : 'Waiting';
  return (
    <main class="model-view">
      <aside class="params">
        {presets.length > 0 && (
          <label class="preset">Preset{' '}
            <select value={ctl.preset.value ?? ''} onChange={(e) => e.currentTarget.value && ctl.applyPreset(e.currentTarget.value)}>
              <option value="">(custom)</option>
              {presets.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
        {ctl.params.value.length === 0 && <p class="hint">This script has no customizer parameters.</p>}
        <ParamForm groups={ctl.groups.value} values={ctl.values.value} defaults={ctl.defaults.value}
          onChange={(n, v) => ctl.setValue(n, v)} onReset={(n) => ctl.resetValue(n)} />
        <button type="button" class="reset-all" onClick={() => ctl.resetAll()}>Reset to defaults</button>
      </aside>
      <section class="viewer">
        <Viewer mesh={r.mesh} fitKey={ctl.meshVersion.value} dark={isDark.value} />
        {r.outdated && r.mesh && <span class="badge outdated">outdated</span>}
        {size && <span class="size" data-testid="model-size">{size}</span>}
        <span class={`status ${r.status}`} data-testid="render-status">
          {status}
          {r.status === 'rendering' && <button type="button" onClick={() => ctl.cancelRender()}>Cancel</button>}
        </span>
        {drawer}
        <ExportBar ctl={ctl} />
      </section>
      <ConsolePanel ctl={ctl} onJumpToLine={onJumpToLine} />
    </main>
  );
}
```

`src/ui/App.tsx` (the source drawer is wired in Task 13; for now `drawer` is `null`):
```tsx
import { useState } from 'preact/hooks';
import type { AppController } from '../app/controller';
import { FilePicker } from './FilePicker';
import { Header } from './Header';
import { Landing } from './Landing';
import { ModelView } from './ModelView';

export function App({ ctl }: { ctl: AppController }) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const phase = ctl.phase.value;
  return (
    <div class="app">
      <Header ctl={ctl} onToggleSource={() => setSourceOpen(!sourceOpen)} />
      {ctl.notices.value.length > 0 && phase !== 'landing' && (
        <ul class="notices">{ctl.notices.value.map((n, i) => <li key={i} data-testid="notice">{n}</li>)}</ul>
      )}
      {phase === 'landing' && <Landing />}
      {phase === 'loading' && <main class="loading" aria-busy="true">Loading repository…</main>}
      {phase === 'error' && <main class="error-page"><p role="alert">{ctl.error.value}</p><a href="#">Back to start</a></main>}
      {phase === 'picker' && <FilePicker ctl={ctl} />}
      {phase === 'model' && <ModelView ctl={ctl} drawer={null} onJumpToLine={() => setSourceOpen(true)} />}
    </div>
  );
}
```

`src/main.tsx`:
```tsx
import { render } from 'preact';
import { AppController } from './app/controller';
import { createBrowserEngine } from './engine/engine';
import { browserNet } from './repo/net';
import { App } from './ui/App';
import './ui/styles.css';

const ctl = new AppController({
  net: browserNet,
  engine: createBrowserEngine(),
  setHash: (hash) => history.replaceState(null, '', hash || location.pathname),
});
window.addEventListener('hashchange', () => void ctl.open(location.hash));
void ctl.open(location.hash);
render(<App ctl={ctl} />, document.getElementById('app')!);
```

- [ ] **Step 5: Write `src/ui/styles.css`**

```css
:root {
  --bg: #f6f7f9; --panel: #ffffff; --text: #1d2026; --muted: #5d6470; --border: #dde1e6;
  --accent: #f9d72c; --accent-text: #1d2026; --error: #c62828; --warning: #a86500; --focus: #2b6cb0;
  color-scheme: light;
}
:root[data-theme='dark'] {
  --bg: #121418; --panel: #1b1d22; --text: #e6e8eb; --muted: #9aa1ab; --border: #2c3038;
  --accent: #f9d72c; --accent-text: #121418; --error: #ef7b7b; --warning: #e0a84a; --focus: #7fb3ff;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; }
a { color: var(--focus); }
button, select, input { font: inherit; color: inherit; }
button { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
button.primary, .button.primary { background: var(--accent); color: var(--accent-text); border-color: transparent; font-weight: 600; text-decoration: none; padding: 8px 16px; border-radius: 6px; display: inline-block; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

.app { display: flex; flex-direction: column; height: 100%; }
.app-header { display: flex; align-items: center; gap: 12px; padding: 8px 16px; background: var(--panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.app-header h1 { font-size: 17px; margin: 0; }
.app-header .brand { font-size: 22px; text-decoration: none; color: var(--text); }
.app-header .ref { color: var(--muted); font-size: 13px; font-family: ui-monospace, monospace; }
.app-header .spacer { flex: 1; }
.notices { margin: 0; padding: 8px 16px 8px 32px; background: color-mix(in srgb, var(--warning) 12%, var(--panel)); font-size: 13px; }

.landing, .picker, .error-page, .loading { max-width: 960px; margin: 0 auto; padding: 24px 16px; width: 100%; overflow: auto; }
.landing section { margin-bottom: 32px; }
.landing form { display: flex; gap: 8px; }
.landing input { flex: 1; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); min-width: 0; }
.snippet { background: var(--panel); border: 1px solid var(--border); padding: 12px; border-radius: 6px; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
.hint { color: var(--muted); }
.hint.error, [role='alert'] { color: var(--error); }
.about { color: var(--muted); font-size: 13px; }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px; color: var(--text); text-decoration: none; }
.card img, .card .placeholder { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; background: var(--bg); display: grid; place-items: center; font-size: 48px; color: var(--muted); }
.card h3 { margin: 8px 0 4px; font-size: 16px; }
.card code { color: var(--muted); font-size: 12px; }

.model-view { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(300px, 380px) 1fr; grid-template-rows: 1fr auto; grid-template-areas: 'params viewer' 'console console'; }
.params { grid-area: params; overflow: auto; padding: 12px 16px; background: var(--panel); border-right: 1px solid var(--border); }
.viewer { grid-area: viewer; position: relative; min-height: 0; }
.viewer-canvas { position: absolute; inset: 0; }
.viewer-canvas canvas { display: block; width: 100%; height: 100%; }
.viewer .size { position: absolute; left: 12px; bottom: 12px; background: var(--panel); padding: 4px 8px; border-radius: 6px; font-size: 13px; }
.viewer .status { position: absolute; right: 12px; top: 12px; background: var(--panel); padding: 4px 8px; border-radius: 6px; font-size: 13px; display: flex; gap: 8px; align-items: center; }
.viewer .status.error { color: var(--error); }
.viewer .badge.outdated { position: absolute; left: 12px; top: 12px; background: var(--warning); color: #fff; padding: 2px 8px; border-radius: 6px; font-size: 12px; }
.export-bar { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 8px; }
.console { grid-area: console; background: var(--panel); border-top: 1px solid var(--border); max-height: 35vh; overflow: auto; }
.console > button { border: 0; border-radius: 0; width: 100%; text-align: left; }
.console ol { list-style: none; margin: 0; padding: 4px 16px 12px; font: 12px/1.5 ui-monospace, monospace; }
.console li.error { color: var(--error); }
.console li.warning { color: var(--warning); }
.console li.info { color: var(--muted); }
.badge.error { background: var(--error); color: #fff; border-radius: 8px; padding: 0 6px; }
.badge.warning { background: var(--warning); color: #fff; border-radius: 8px; padding: 0 6px; }
button.link { border: 0; padding: 0; background: none; color: var(--focus); text-decoration: underline; }

.preset { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.param-form details { border-bottom: 1px solid var(--border); padding: 6px 0; }
.param-form summary { font-weight: 600; cursor: pointer; padding: 4px 0; }
.field { padding: 8px 0; }
.field-head { display: flex; align-items: center; gap: 6px; }
.field-name { font-weight: 500; }
.field .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.field .reset { padding: 0 6px; font-size: 13px; }
.caption { margin: 2px 0 6px; color: var(--muted); font-size: 13px; }
.field select, .field input[type='text'], .field input[type='number'] { padding: 4px 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); max-width: 100%; }
.slider { display: flex; gap: 8px; align-items: center; }
.slider input[type='range'] { flex: 1; min-width: 0; accent-color: var(--accent); }
.slider input[type='number'] { width: 80px; }
.vector { display: flex; gap: 6px; }
.vector input { width: 72px; }
.reset-all { margin-top: 12px; }

@media (max-width: 768px) {
  .model-view { grid-template-columns: 1fr; grid-template-rows: 45vh 1fr auto; grid-template-areas: 'viewer' 'params' 'console'; }
  .params { border-right: 0; padding-bottom: 72px; }
  .export-bar { position: fixed; left: 0; right: 0; bottom: 0; padding: 8px 16px; background: var(--panel); border-top: 1px solid var(--border); justify-content: center; z-index: 5; }
  .export-bar button { flex: 1; }
}
```

- [ ] **Step 6: Run tests and the dev server**

Run: `npx vitest run tests/unit/App.test.tsx && npm run typecheck`
Expected: PASS.

Run: `npm run dev`, open `http://localhost:5173/openscad-customizer/` → landing page renders; open `http://localhost:5173/openscad-customizer/#/gh/BelfrySCAD/BOSL2` → picker or model loads (network required). Stop the server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: app shell with landing, picker, model view, export and console"
```

---

### Task 13: Source drawer

**Files:**
- Create: `src/ui/SourceDrawer.tsx`, `src/ui/scadLanguage.ts`
- Modify: `src/ui/App.tsx` (wire the drawer), `src/ui/styles.css` (drawer styles)
- Test: `tests/unit/scadLanguage.test.ts`

**Interfaces:**
- Consumes: `AppController.entrySource()`, `setSource()`, `editedSource`, `entry` (T9); `downloadBytes` (T12).
- Produces:
  - `scadLanguage: StreamLanguage<unknown>`; `tokenizeLine(line: string): Array<[string, string | null]>` (testing helper: token text + style)
  - `SourceDrawer(props: { ctl: AppController; jumpTo: number | null; onClose(): void })` — default export is *not* used; App lazy-loads it with `import('./SourceDrawer')`.

- [ ] **Step 1: Write the failing test**

`tests/unit/scadLanguage.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { tokenizeLine } from '../../src/ui/scadLanguage';

describe('scad tokenizer', () => {
  it('styles keywords, numbers, strings, comments and specials', () => {
    const toks = tokenizeLine('module m($fn=32) { echo("a\\"b"); } // hi');
    const styled = toks.filter(([, s]) => s).map(([t, s]) => `${s}:${t}`);
    expect(styled).toEqual(['keyword:module', 'variableName.special:$fn', 'number:32', 'keyword:echo', 'string:"a\\"b"', 'comment:// hi']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scadLanguage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/ui/scadLanguage.ts`**

```ts
import { StreamLanguage, StringStream, type StreamParser } from '@codemirror/language';

const KEYWORDS = new Set([
  'module', 'function', 'include', 'use', 'if', 'else', 'for', 'let', 'each', 'assert', 'echo', 'intersection_for',
  'true', 'false', 'undef',
]);

type State = { inBlockComment: boolean };

const parser: StreamParser<State> = {
  startState: () => ({ inBlockComment: false }),
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.skipTo('*/')) {
        stream.next();
        stream.next();
        state.inBlockComment = false;
      } else stream.skipToEnd();
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.inBlockComment = true;
      return 'comment';
    }
    if (stream.peek() === '"') {
      stream.next();
      let escaped = false;
      let ch: string | void;
      while ((ch = stream.next()) != null) {
        if (ch === '"' && !escaped) break;
        escaped = !escaped && ch === '\\';
      }
      return 'string';
    }
    if (stream.match(/^\d+(\.\d*)?([eE][+-]?\d+)?/) || stream.match(/^\.\d+([eE][+-]?\d+)?/)) return 'number';
    if (stream.match(/^\$[A-Za-z_]\w*/)) return 'variableName.special';
    if (stream.match(/^[A-Za-z_]\w*/)) return KEYWORDS.has(stream.current()) ? 'keyword' : 'variableName';
    stream.next();
    return null;
  },
};

export const scadLanguage = StreamLanguage.define(parser);

/** Test helper: runs the tokenizer over one line. */
export function tokenizeLine(line: string): Array<[string, string | null]> {
  const state = parser.startState!(2);
  const stream = new StringStream(line, 2, 2);
  const out: Array<[string, string | null]> = [];
  while (!stream.eol()) {
    stream.start = stream.pos;
    const style = parser.token(stream, state);
    out.push([stream.current(), style ?? null]);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scadLanguage.test.ts`
Expected: PASS. (The `"a\\"b"` in the TS source is the text `"a\"b"`; the tokenizer treats `\"` as escaped.)

- [ ] **Step 5: Implement `src/ui/SourceDrawer.tsx`**

```tsx
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'preact/hooks';
import type { AppController } from '../app/controller';
import { encodeText } from '../util';
import { downloadBytes } from './download';
import { scadLanguage } from './scadLanguage';

export function SourceDrawer({ ctl, jumpTo, onClose }: { ctl: AppController; jumpTo: number | null; onClose(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const entry = ctl.entry.value;

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: ctl.entrySource(),
        extensions: [basicSetup, scadLanguage, EditorView.updateListener.of((u) => {
          if (u.docChanged) ctl.setSource(u.state.doc.toString());
        })],
      }),
    });
    return () => view.current?.destroy();
  }, [entry]);

  useEffect(() => {
    const v = view.current;
    if (!v || !jumpTo || jumpTo > v.state.doc.lines) return;
    const line = v.state.doc.line(jumpTo);
    v.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    v.focus();
  }, [jumpTo]);

  const edited = ctl.editedSource.value !== null;
  return (
    <div class="source-drawer" role="dialog" aria-label="Source">
      <div class="drawer-head">
        <strong>{entry}</strong>
        {edited && <span class="edited">Edited locally – not saved to repo</span>}
        <span class="spacer" />
        {edited && <button type="button" onClick={() => downloadBytes(entry!.split('/').pop()!, encodeText(ctl.entrySource()))}>Download .scad</button>}
        {edited && <button type="button" onClick={() => {
          ctl.setSource(null);
          view.current?.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: ctl.entrySource() } });
          ctl.setSource(null);
        }}>Revert</button>}
        <button type="button" aria-label="Close source" onClick={onClose}>✕</button>
      </div>
      <div class="editor" ref={host} />
    </div>
  );
}
```

The Revert handler calls `setSource(null)` again after the dispatch because the dispatch fires the update listener with the original text.

- [ ] **Step 6: Wire into `src/ui/App.tsx`**

Replace the file with:
```tsx
import { lazy, Suspense } from 'preact/compat';
import { useState } from 'preact/hooks';
import type { AppController } from '../app/controller';
import { FilePicker } from './FilePicker';
import { Header } from './Header';
import { Landing } from './Landing';
import { ModelView } from './ModelView';

const SourceDrawer = lazy(() => import('./SourceDrawer').then((m) => ({ default: m.SourceDrawer })));

export function App({ ctl }: { ctl: AppController }) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [jumpTo, setJumpTo] = useState<number | null>(null);
  const phase = ctl.phase.value;
  const drawer = sourceOpen ? (
    <Suspense fallback={<div class="source-drawer">Loading editor…</div>}>
      <SourceDrawer ctl={ctl} jumpTo={jumpTo} onClose={() => setSourceOpen(false)} />
    </Suspense>
  ) : null;
  return (
    <div class="app">
      <Header ctl={ctl} onToggleSource={() => setSourceOpen(!sourceOpen)} />
      {ctl.notices.value.length > 0 && phase !== 'landing' && (
        <ul class="notices">{ctl.notices.value.map((n, i) => <li key={i} data-testid="notice">{n}</li>)}</ul>
      )}
      {phase === 'landing' && <Landing />}
      {phase === 'loading' && <main class="loading" aria-busy="true">Loading repository…</main>}
      {phase === 'error' && <main class="error-page"><p role="alert">{ctl.error.value}</p><a href="#">Back to start</a></main>}
      {phase === 'picker' && <FilePicker ctl={ctl} />}
      {phase === 'model' && <ModelView ctl={ctl} drawer={drawer} onJumpToLine={(line) => { setJumpTo(line); setSourceOpen(true); }} />}
    </div>
  );
}
```

Append to `src/ui/styles.css`:
```css
.source-drawer { position: absolute; inset: 0 0 0 auto; width: min(640px, 100%); background: var(--panel); border-left: 1px solid var(--border); display: flex; flex-direction: column; z-index: 4; }
.drawer-head { display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.drawer-head .spacer { flex: 1; }
.drawer-head .edited { color: var(--warning); font-size: 13px; }
.editor { flex: 1; min-height: 0; overflow: auto; }
.editor .cm-editor { height: 100%; }
```

- [ ] **Step 7: Verify**

Run: `npm test && npm run build`
Expected: all tests PASS; build succeeds and emits a separate chunk for `SourceDrawer` (check `dist/assets/` for a `SourceDrawer-*.js`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: lazy-loaded source drawer with OpenSCAD highlighting"
```

---

### Task 14: End-to-end tests

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/fixtures.ts`, `tests/e2e/app.spec.ts`, `tests/fixtures/repos/demo/gland/openscad-customizer.json`, `tests/fixtures/repos/demo/gland/cable_gland.json`, `tests/fixtures/repos/demo/multi/a.scad`, `tests/fixtures/repos/demo/multi/b.scad`, `tests/fixtures/repos/demo/multi/lib/shape.scad`

**Interfaces:**
- Consumes: test ids from Task 12; built app via `vite preview`.
- Produces: `npm run e2e` green.

- [ ] **Step 1: Create fixtures**

`tests/fixtures/repos/demo/gland/openscad-customizer.json`:
```json
{ "title": "Split Cable Gland", "description": "Fixture copy of the gland", "files": [{ "path": "cable_gland.scad", "title": "Cable gland" }] }
```

`tests/fixtures/repos/demo/gland/cable_gland.json`:
```json
{ "fileFormatVersion": "1", "parameterSets": { "Three cables": { "cable_count": "3", "part": "nut" } } }
```

`tests/fixtures/repos/demo/multi/a.scad`:
```
/* [Size] */
size = 10; // [1:50]
include <lib/shape.scad>
shape(size);
```

`tests/fixtures/repos/demo/multi/b.scad`:
```
/* [Text] */
label = "hi";
use <nope/missing.scad>
cube(5);
```

`tests/fixtures/repos/demo/multi/lib/shape.scad`:
```
module shape(s) cube(s, center = true);
```

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173/openscad-customizer/', acceptDownloads: true },
  webServer: { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/openscad-customizer/', timeout: 180_000, reuseExistingServer: !process.env.CI },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 3: Write `tests/e2e/fixtures.ts`** (fakes GitHub + jsDelivr from `tests/fixtures/repos/<owner>/<repo>/`)

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../fixtures/repos/', import.meta.url));
export const FIXTURE_SHA = 'f'.repeat(40);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export async function fakeGitHub(page: Page): Promise<void> {
  await page.route('https://api.github.com/**', async (route) => {
    const m = /repos\/([^/]+)\/([^/?]+)(\/commits\/[^?]+)?/.exec(route.request().url());
    const dir = m && join(ROOT, m[1], m[2]);
    if (!m || !dir || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return route.fulfill({ status: 404, json: { message: 'Not Found' } });
    return route.fulfill({ json: m[3] ? { sha: FIXTURE_SHA } : { default_branch: 'main' } });
  });
  await page.route('https://data.jsdelivr.com/**', async (route) => {
    const m = /gh\/([^/]+)\/([^@]+)@/.exec(route.request().url())!;
    const dir = join(ROOT, m[1], m[2]);
    if (!statSync(dir, { throwIfNoEntry: false })) return route.fulfill({ status: 404, json: {} });
    const files = walk(dir).map((p) => ({ name: '/' + relative(dir, p).replace(/\\/g, '/'), size: statSync(p).size }));
    return route.fulfill({ json: { files } });
  });
  await page.route('https://cdn.jsdelivr.net/**', async (route) => {
    const m = /gh\/([^/]+)\/([^@]+)@[^/]+\/(.+)$/.exec(route.request().url())!;
    try {
      return route.fulfill({ body: readFileSync(join(ROOT, m[1], m[2], decodeURIComponent(m[3]))) });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
  await page.route('https://raw.githubusercontent.com/**', (route) => route.fulfill({ status: 404, body: '' }));
}
```

- [ ] **Step 4: Write `tests/e2e/app.spec.ts`**

```ts
import { expect, test } from '@playwright/test';
import { fakeGitHub } from './fixtures';

test.beforeEach(async ({ page }) => fakeGitHub(page));

test('customize the gland: form, live preview, export, share link', async ({ page }) => {
  await page.goto('#/gh/demo/gland/cable_gland.scad');
  await expect(page.getByText('Cables', { exact: true })).toBeVisible();
  await expect(page.getByTestId('render-status')).toHaveText('Ready', { timeout: 30_000 });
  const sizeBefore = await page.getByTestId('model-size').textContent();

  await page.getByText('Cables', { exact: true }).click(); // open the group if collapsed
  await page.getByLabel('cable_count value', { exact: true }).fill('3');
  await page.getByLabel('cable_count value', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/cable_count=3/);
  await expect(page.getByTestId('render-status')).toHaveText('Ready', { timeout: 30_000 });
  expect(await page.getByTestId('model-size').textContent()).not.toBe(sizeBefore);

  const download = page.waitForEvent('download');
  await page.getByTestId('export-stl').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^cable_gland-[0-9a-f]{8}\.stl$/);

  const url = page.url();
  const fresh = await page.context().newPage();
  await fakeGitHub(fresh);
  await fresh.goto(url);
  await expect(fresh.getByLabel('cable_count value', { exact: true })).toHaveValue('3');
});

test('presets from the OpenSCAD preset file', async ({ page }) => {
  await page.goto('#/gh/demo/gland/cable_gland.scad');
  await page.getByLabel('Preset').selectOption('Three cables');
  await expect(page).toHaveURL(/preset=Three\+cables/);
  await expect(page.getByLabel('part', { exact: true })).toHaveValue('2'); // index of "nut"
});

test('picker, includes, and missing library notice', async ({ page }) => {
  await page.goto('#/gh/demo/multi');
  await expect(page.getByTestId('picker-card')).toHaveCount(2);
  await expect(page.getByTestId('notice').filter({ hasText: "Library nope isn't bundled" })).toBeVisible();
  await page.getByTestId('picker-card').filter({ hasText: 'a.scad' }).click();
  await expect(page.getByTestId('render-status')).toHaveText('Ready', { timeout: 30_000 });
  await expect(page.getByTestId('model-size')).toHaveText('10.0 × 10.0 × 10.0 mm');
});

test('unknown repo shows an error', async ({ page }) => {
  await page.goto('#/gh/demo/does-not-exist');
  await expect(page.getByRole('alert')).toContainText("Couldn't find demo/does-not-exist");
});

test('source drawer edits re-render', async ({ page }) => {
  await page.goto('#/gh/demo/multi/a.scad');
  await expect(page.getByTestId('render-status')).toHaveText('Ready', { timeout: 30_000 });
  await page.getByTestId('source-toggle').click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\ntranslate([20,0,0]) cube(1);');
  await expect(page.getByText('Edited locally – not saved to repo')).toBeVisible();
  await expect(page.getByTestId('model-size')).not.toHaveText('10.0 × 10.0 × 10.0 mm', { timeout: 30_000 });
});

test('mobile layout puts the viewer above the form', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('#/gh/demo/multi/a.scad');
  await expect(page.getByTestId('render-status')).toHaveText('Ready', { timeout: 30_000 });
  const viewer = await page.getByTestId('viewer').boundingBox();
  const form = await page.locator('.params').boundingBox();
  expect(viewer!.y).toBeLessThan(form!.y);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
});
```

- [ ] **Step 5: Run E2E**

Run: `npx playwright install chromium && npm run e2e`
Expected: 6 passed. If the size assertion in "picker…" differs only by rounding, keep the assertion strict and inspect `meshBounds`: a centred 10 mm cube must be exactly 10.0 on every axis.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: end-to-end tests against fixture repos"
```

---

### Task 15: CI/deploy, README, gland manifest

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`
- Create (in the gland project, sibling folder): `../claudecablepassthroughglandopenscad/openscad-customizer.json`

**Interfaces:**
- Consumes: npm scripts from earlier tasks.
- Produces: CI that tests every push/PR and deploys `main` to GitHub Pages.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run fetch-wasm
      - run: npm run typecheck
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
        env:
          CI: '1'
      - uses: actions/upload-pages-artifact@v3
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        with:
          path: dist

  deploy:
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

(`npm run e2e` runs `npm run build` through Playwright's `webServer`, so `dist/` exists for the upload step.)

- [ ] **Step 2: Write `README.md`**

````markdown
# OpenSCAD Customizer

Customize OpenSCAD models from any public GitHub repo, right in the browser. OpenSCAD runs locally as WebAssembly: nothing is uploaded.

**App:** https://NickLD.github.io/openscad-customizer/

## Link to your own models

```
https://NickLD.github.io/openscad-customizer/#/gh/OWNER/REPO                     pick a model
https://NickLD.github.io/openscad-customizer/#/gh/OWNER/REPO/path/model.scad     open one model
https://NickLD.github.io/openscad-customizer/#/gh/OWNER/REPO@v1.2/model.scad     pin a tag/branch/commit
…/model.scad?width=40&label=Hello                                                with parameter values
…/model.scad?preset=Large                                                        with a saved preset
```

Badge for your README:

```markdown
[![Open in OpenSCAD Customizer](https://img.shields.io/badge/Open%20in-OpenSCAD%20Customizer-f9d72c)](https://NickLD.github.io/openscad-customizer/#/gh/OWNER/REPO)
```

Your script needs nothing special: standard customizer comments (`/* [Tab] */`, `// [min:step:max]`, `// [a, b, c]`) become the form. Presets saved by OpenSCAD's customizer (`model.json` next to `model.scad`) appear in the Preset dropdown.

### Optional `openscad-customizer.json`

```json
{
  "title": "My Models",
  "description": "Shown above the model list",
  "files": [
    { "path": "models/box.scad", "title": "Parametric box", "description": "…", "thumbnail": "img/box.png" }
  ],
  "libraries": {
    "mylib": "gh:someone/mylib@v2/src"
  }
}
```

- `files` limits and orders the model list. Without it, every `.scad` file with customizer annotations is listed.
- `libraries` maps an include root (`include <mylib/…>`) to another GitHub repo.

Bundled libraries (loaded on demand): BOSL2, BOSL, MCAD, NopSCADlib, Round-Anything, funcutils, `threads.scad`, `smooth_prim.scad`, and Liberation fonts for `text()`.

Limits: public repos only; 300 files / 25 MB per repo.

## Development

```bash
npm install
npm run dev        # downloads OpenSCAD WASM on first run
npm test           # unit + engine tests
npm run e2e        # Playwright
```

License: GPL-2.0-or-later (same as OpenSCAD).
````

- [ ] **Step 3: Add the gland manifest**

`../claudecablepassthroughglandopenscad/openscad-customizer.json`:
```json
{
  "title": "Split Cable Gland",
  "description": "Threaded pass-through gland that closes around cables with connectors already on them. 1–8 cables, radial or inline.",
  "files": [
    { "path": "cable_gland.scad", "title": "Cable gland", "description": "Print layout, body only, nut only or assembled preview" }
  ]
}
```

If `showcase/img/` contains a hero render, add `"thumbnail": "showcase/img/<file>.png"` to the file entry (check the folder for the actual name).

- [ ] **Step 4: Full verification**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: everything passes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ci: test and deploy to GitHub Pages; add README"
```

(The gland manifest lives in the other folder, which is not this repo; it is committed with the gland project when that is published.)

- [ ] **Step 6: Publishing (manual, needs the user)**

Creating the GitHub repo and enabling Pages are outward-facing actions; ask the user before running:

```bash
gh repo create NickLD/openscad-customizer --public --source . --push
gh api -X POST repos/NickLD/openscad-customizer/pages -f build_type=workflow
```
````

