# OpenSCAD Customizer — Design

Date: 2026-10-13
Status: Draft for review

## 1. Purpose

A modern, browser-based replacement for the Thingiverse Customizer, hosted on
GitHub Pages. It runs OpenSCAD (WASM) entirely client-side, shows a fast 3D
preview, and presents a script's customizer parameters as a clean form.

Audience (both equally):

- **Makers** who want to print a configurable model (first flagship model:
  the split cable gland, `cable_gland.scad`). They should never need to see code.
- **OpenSCAD authors** who want to link their own GitHub repo
  (`…/#/gh/owner/repo`) and get the same experience for their models, with no
  setup required and optional polish via a manifest.

Success criteria:

1. Opening a link to a public repo / `.scad` file renders a parameter form and
   3D preview with no install, no login, no server.
2. The form matches desktop OpenSCAD's customizer (same tabs, ranges, dropdowns,
   descriptions) because OpenSCAD itself extracts the parameters.
3. Changing a parameter updates the preview; STL and 3MF download works.
4. A copied link reproduces the exact configuration.
5. `cable_gland.scad` works unmodified.

Prior art: [openscad/openscad-playground](https://github.com/openscad/openscad-playground)
already runs OpenSCAD WASM with a customizer, but it is editor-centric. We reuse
its engine (the OpenSCAD WASM build) and its idea of lazily loaded library
bundles, not its UI.

## 2. Decisions

| Topic | Decision |
|---|---|
| Approach | New app; reuse OpenSCAD WASM build, not the playground UI |
| Code access | Customizer-first; source view/edit is an optional, lazily loaded drawer |
| Multi-file repos | Auto-discover + optional manifest; URL may name a file directly |
| Presets | OpenSCAD's native sidecar preset JSON (`<name>.json`) |
| Libraries | Bundled common libs (lazy) + manifest-declared GitHub repos |
| Export | STL and 3MF. Per-part zip export is deferred (non-goal for v1) |
| Hosting | New repo `openscad-customizer`, deployed to `<user>.github.io/openscad-customizer/` |

## 3. Non-goals (v1)

- Private repos / GitHub login.
- Per-part zip export ("export every value of the `part` parameter").
- Saving edits back to GitHub.
- Non-GitHub hosts (GitLab, Gists, arbitrary URLs).
- Server-side rendering or any backend.
- Local folder / drag-and-drop loading (possible later addition).

## 4. Architecture

```
GitHub Pages (static)
├─ index.html + app bundle (Vite + TypeScript)
├─ openscad.wasm + js          (fetched once, browser-cached)
├─ coi-serviceworker.js        (enables cross-origin isolation for threads)
└─ libs/*.zip                  (BOSL2, MCAD, NopSCADlib, … lazy)

Browser
 Router ─────── parses #/gh/owner/repo[@ref][/path.scad][?params]
   │
 RepoLoader ─── resolves ref → commit SHA, lists + fetches files,
   │            mounts manifest-declared library repos
   │
 LibraryResolver ─ maps include/use roots to bundled zips or manifest libs
   │
 Engine (Web Worker, OpenSCAD WASM)
   │  · extractParams(files, entry) → ParamSet JSON
   │  · render(files, entry, values, format, quality) → bytes + log
   │
 UI: Header · FilePicker · ParamForm · Viewer (three.js) · Export · Console · SourceDrawer
```

### 4.1 Units

Each unit has one purpose and a narrow interface; UI depends on the others,
never the reverse.

- **router** — `parse(hash) → Route` and `serialize(Route) → hash`. Pure.
  `Route = { kind: 'landing' } | { kind: 'repo', owner, repo, ref?, path?, preset?, values: Record<string, ParamValue> }`.
- **paramCodec** — encodes/decodes parameter overrides to/from URL query
  (`name=value`; numbers/booleans/strings as text, vectors as JSON). Only values
  differing from defaults are written. Pure.
- **repoLoader** — `load(owner, repo, ref?) → { sha, refIsPinned, files: Map<path, Uint8Array>, skipped: string[], manifest? }`.
  Uses the network adapter below; no UI knowledge.
- **net** — thin fetch wrappers for GitHub API, jsDelivr data API, jsDelivr CDN,
  raw.githubusercontent.com. Injected into repoLoader so tests can fake it.
- **manifest** — `parseManifest(json) → Manifest | ValidationError[]`. Pure.
- **libraryResolver** — given files + manifest, scans `include`/`use` statements
  for top-level roots and returns which bundled zips / manifest libs to mount.
- **engine** — main-thread proxy to a Web Worker hosting OpenSCAD WASM.
  Requests are cancellable; cancel terminates and respawns the worker. A fresh
  WASM instance is used per invocation (OpenSCAD's `callMain` is not reliably
  re-entrant).
- **paramModel** — converts OpenSCAD's parameter JSON into form-control
  descriptors (`slider | number | dropdown | toggle | text | vector`) grouped by
  tab. Pure.
- **presets** — reads `<entry>.json` (OpenSCAD `parameterSets` format) into
  named value sets.
- **UI components** — Header, FilePicker, ParamForm, Viewer, ExportBar,
  Console, SourceDrawer (lazy CodeMirror 6), Landing.

UI framework: Preact with signals (small, component model, fast). Viewer:
three.js with OrbitControls, STL loader, bed grid, bounding-box readout.

### 4.2 Data flow

1. Router parses the hash.
2. repoLoader resolves the ref, fetches files and the optional manifest.
3. libraryResolver mounts needed bundled zips and manifest library repos.
4. If no file is chosen: show FilePicker (manifest `files`, else every `.scad`
   with customizer parameters). If the repo has exactly one candidate, open it.
5. engine.extractParams → paramModel → ParamForm. Presets loaded if present.
   Initial values = defaults ← preset (if `?preset=`) ← URL overrides.
6. On value change (debounced ~500 ms; in-flight render cancelled): engine.render
   preview (Manifold backend, current `$fn` etc. as authored) → STL → Viewer.
7. URL is updated (`history.replaceState`) with current overrides.
8. Export: full render to STL or 3MF → browser download named
   `<model>-<short-hash-of-values>.<ext>`.

## 5. URLs

Hash routing (GitHub Pages cannot serve SPA deep paths without a 404 hack):

```
/                                                         landing
#/gh/owner/repo                                           repo picker
#/gh/owner/repo@v1.2                                      pinned tag/branch/commit
#/gh/owner/repo/models/cable_gland.scad                   direct file
#/gh/owner/repo/cable_gland.scad?cable_count=3&cable_1_d=5.5
#/gh/owner/repo/cable_gland.scad?preset=M20%20inline
```

Path parsing: segment after `repo[@ref]` up to the end (before `?`) is the
file path. Ref may contain `/` only if URL-encoded (`%2F`).

## 6. Repo loading

1. **Resolve ref.** No `@ref`: `GET api.github.com/repos/{o}/{r}` for
   `default_branch`, then `GET …/commits/{branch}` for the SHA (2 requests).
   `@ref` given: resolve to SHA via `…/commits/{ref}`. On rate-limit (403/429)
   or network failure, fall back to using the ref/branch name directly with
   jsDelivr (default branch fallback: `main`, then `master`) and show a
   "may be up to ~12 h stale" notice.
2. **List files.** `data.jsdelivr.com/v1/packages/gh/{o}/{r}@{sha}?structure=flat`.
   Fallback: GitHub git trees API (`…/git/trees/{sha}?recursive=1`).
3. **Fetch files.** From `cdn.jsdelivr.net/gh/{o}/{r}@{sha}/{path}`, fallback
   `raw.githubusercontent.com/{o}/{r}/{sha}/{path}`. Extensions fetched:
   `.scad .json .svg .dxf .stl .off .3mf .png .dat .csv .txt`. Caps: 300 files,
   25 MB total, 10 MB per file. Skipped files are listed in a warning.
   Concurrency: 8 parallel fetches.
4. Files are written into the WASM virtual FS under `/repo/` preserving paths;
   the entry file runs with `/repo/<dir>` as working directory.

## 7. Manifest

Optional `openscad-customizer.json` at the repo root:

```json
{
  "title": "Split Cable Gland",
  "description": "Threaded pass-through for pre-terminated cables",
  "files": [
    { "path": "cable_gland.scad", "title": "Cable gland",
      "description": "1–8 cables", "thumbnail": "showcase/hero.png" }
  ],
  "libraries": {
    "fancythreads": "gh:someone/fancythreads@v2"
  }
}
```

- All fields optional. Unknown fields are ignored (forward compatible).
- `thumbnail` must be a repo-relative path; it is shown via the jsDelivr URL.
- `libraries` key = include root name; value = `gh:owner/repo[@ref][/subdir]`.
  Mounted at `/libraries/<key>/` (on OpenSCAD's library path), using the same
  repoLoader and caps. Libraries do not load their own manifests' libraries
  (no transitive resolution in v1).
- Invalid manifest: ignored with a console warning; the repo still loads in
  auto-discovery mode.

## 8. Libraries

Bundled set (zips under `libs/`, mounted on demand when an `include`/`use`
root matches): BOSL2, BOSL, MCAD, NopSCADlib, threads (rcolyer), Round-Anything,
dotSCAD, UB.scad, smooth-prim, plus fonts (Liberation) for `text()`. Final list
and licenses are verified during implementation; each bundle ships with its
license file. Manifest libraries override bundled ones with the same key.

## 9. Parameters and presets

- Extraction uses OpenSCAD's own customizer parser (parameter JSON export from
  the WASM build). **Verification spike, first task of implementation:** confirm
  the current OpenSCAD WASM build exports parameters as JSON for
  `cable_gland.scad` with groups, ranges, option labels and descriptions. If it
  does not, fall back to porting the playground's parameter parsing.
- Control mapping:
  - number with `[min:step:max]` or `[max]` → slider + number box
  - `[a, b, c]` / `[val:Label, …]` → dropdown
  - boolean → toggle
  - string → text box
  - vector → row of number boxes
  - `/* [Hidden] */` group → not shown
- Description comment → help text under the label.
- Modified parameters show a dot and a per-parameter reset; "Reset to defaults"
  resets all.
- Presets: `<entry-basename>.json` beside the entry file, OpenSCAD
  `parameterSets` format. Shown as a dropdown; selecting one sets all its values.

## 10. UI

Desktop: header (title, file dropdown if >1 model, `owner/repo @shortsha`,
Share link, `</> Src`), left parameter panel (collapsible groups per tab,
first open; preset dropdown; reset), right 3D viewer (orbit/pan/zoom, bed grid,
bounding-box mm readout, rendering indicator), export buttons (STL, 3MF).

Mobile (<768 px): viewer pinned to the top ~45 % of the screen, form scrolls
beneath, sticky bottom export bar.

Source drawer: lazily loads CodeMirror 6 with OpenSCAD highlighting. Edits
re-render live; banner "Edited locally – not saved to repo" with "Download
.scad". Edits are kept in memory only.

Repo picker: card grid (thumbnail or placeholder, title, description).

Landing: featured cable gland card, "paste a GitHub URL" box (accepts
`https://github.com/o/r[/blob/ref/path]` and normalizes it), and a copyable
README badge snippet for authors.

Theme: follows `prefers-color-scheme` with a manual toggle (stored in
localStorage, guarded).

## 11. Rendering

- Engine runs in a Web Worker. Preview and export both use OpenSCAD's Manifold
  backend; preview uses the script's own detail settings (no `$fn` override) so
  what you see is what you download. Preview and export differ only in format
  (preview STL for the viewer; export STL or 3MF).
- If the last preview render matches current values, STL export reuses its
  bytes instead of re-rendering.
- Cross-origin isolation via `coi-serviceworker` to allow a threaded WASM build;
  if isolation is unavailable, use the single-threaded build.
- Each render reports duration in the Console.

## 12. Error handling

| Situation | Behavior |
|---|---|
| Repo missing / private / typo | "Couldn't find owner/repo. Private repos aren't supported." |
| GitHub API rate-limited | Fall back to ref name via jsDelivr; stale notice |
| OpenSCAD errors / warnings | Console panel with ECHO/WARNING/ERROR; line numbers open the source drawer; viewer keeps last good model with "outdated" badge |
| Unknown include root | "Library X isn't bundled. Authors can add it to openscad-customizer.json → libraries" |
| Long render / OOM | Cancel button terminates and respawns the worker |
| Empty geometry | "Render produced no geometry (check the `part` setting?)" |
| Caps exceeded | Warning listing skipped files |
| URL override for unknown param / bad value | Ignored, listed in Console |

## 13. Security

- Untrusted `.scad` runs inside WASM with no network access and an FS containing
  only fetched repo/library files.
- Manifest strings are rendered as text, never HTML.
- Thumbnails restricted to repo-relative paths served from jsDelivr.
- No data leaves the browser; network requests go only to the app origin,
  api.github.com, data.jsdelivr.com, cdn.jsdelivr.net, raw.githubusercontent.com.

## 14. Testing

- **Unit (Vitest):** router parse/serialize round trip; paramCodec round trip
  incl. vectors and special characters; manifest validation; paramModel mapping;
  libraryResolver include scanning; repoLoader with a fake `net` (ref
  resolution, fallbacks, caps).
- **Engine integration (Vitest, real WASM):** fixtures including
  `cable_gland.scad` — parameter extraction yields expected groups/ranges;
  render with non-default values produces non-empty STL and 3MF; a broken
  script yields an error with the correct line.
- **E2E (Playwright):** local fixture repo served via a faked jsDelivr/GitHub;
  load URL → form appears → change slider → preview updates → download STL →
  share link round trip restores values; mobile viewport layout smoke test.
- **CI (GitHub Actions):** build + all tests on push/PR; deploy to Pages on
  green `main`.

## 15. Repo layout (planned)

```
openscad-customizer/
├─ index.html
├─ public/            coi-serviceworker.js, openscad wasm, libs/*.zip
├─ src/
│  ├─ router.ts  paramCodec.ts  manifest.ts  paramModel.ts  presets.ts
│  ├─ repo/      net.ts  repoLoader.ts  libraryResolver.ts
│  ├─ engine/    engine.ts  worker.ts
│  └─ ui/        App.tsx  Header.tsx  ParamForm.tsx  Viewer.tsx  ExportBar.tsx
│                Console.tsx  SourceDrawer.tsx  FilePicker.tsx  Landing.tsx
├─ scripts/       fetch-wasm.ts  build-libs.ts
├─ tests/         unit/  engine/  e2e/  fixtures/
└─ .github/workflows/  ci.yml  deploy.yml
```

## 16. Licensing

OpenSCAD and its WASM build are GPL-2.0-or-later; the app is distributed as
GPL-2.0-or-later as well. Bundled libraries keep their own licenses, shipped in
each zip and listed on an About page.
