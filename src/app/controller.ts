import { computed, signal } from '@preact/signals';
import { findCandidates, type Candidate } from '../candidates';
import type { Job, JobResult } from '../engine/core';
import { AbortedError, type Engine } from '../engine/engine';
import { isEmptyGeometry, type LogLine } from '../engine/log';
import { parseOff, type Mesh } from '../mesh/off';
import { meshToStl } from '../mesh/stl';
import { meshToThreeMF } from '../mesh/threemf';
import { overrides, sameValue } from '../paramCodec';
import { defaultsOf, toGroups } from '../paramModel';
import { parsePresets, resolveValues, type PresetFile } from '../presets';
import { loadFonts, loadLibraries, missingLibraryMessage, planLibraries } from '../repo/libraries';
import { loadRepo, LoadError, type FolderChoice, type LoadedRepo, type LoadProgress, type Net } from '../repo/repoLoader';
import { parseRoute, serializeRoute } from '../router';
import type { ShareState } from '../share';
import type { FileMap, Param, ParamSet, ParamValue } from '../types';
import { basename, decodeText, encodeText } from '../util';

export type Phase = 'landing' | 'help' | 'loading' | 'folders' | 'picker' | 'model' | 'error';
export type RenderState = {
  status: 'idle' | 'rendering' | 'ready' | 'error';
  mesh: Mesh | null;
  outdated: boolean;
  /** OpenSCAD's own run time, as reported by the engine. */
  ms?: number;
  /** When the current render started, on the `now()` clock. */
  startedAt?: number;
  /** Wall-clock seconds from render start until the model was ready (includes engine startup). */
  seconds?: number;
  message?: string;
};
export type ControllerDeps = {
  net: Net;
  engine: Engine;
  setHash(hash: string): void;
  debounceMs?: number;
  /** Clock in milliseconds; injectable for tests. */
  now?: () => number;
  loadRepo?: typeof loadRepo;
  loadLibraries?: typeof loadLibraries;
  loadFonts?: typeof loadFonts;
};

const REPO_ROOT = '/repo/';
/** Trailing debounce for URL writes from value changes (Safari allows ~100 replaceState calls per 10 s). */
const HASH_DEBOUNCE_MS = 300;
const MISSING_FONT = /Can't get font/;
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
  /** True once the engine has answered a job, i.e. OpenSCAD is downloaded and compiled. */
  engineReady = signal(false);
  /** What the repo loader is doing, while the phase is 'loading'. */
  loading = signal<LoadProgress | null>(null);
  /** The repo was too big to load whole: the folders offered instead (phase 'folders'). */
  tooBig = signal<{ owner: string; repo: string; ref?: string; message: string; folders: FolderChoice[] } | null>(null);

  private deps: Required<ControllerDeps>;
  private libFiles: FileMap = new Map();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hashTimer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private seq = 0;
  private openSeq = 0;
  private gen = 0;
  private sourceDirty = false;
  private paramLog: LogLine[] = [];
  private pinnedRef: string | undefined;
  /** The ref the current repo was requested with (undefined = default branch). */
  private loadedRef: string | undefined;
  /** The folder the current repo was loaded from (undefined = whole repo). */
  private loadedDir: string | undefined;
  /** Stops the downloads of a repo load that is no longer wanted. */
  private loadAbort: AbortController | null = null;
  /** Fonts were loaded (or attempted) for the current repo, so a missing-font warning won't load them again. */
  private fontsTried = false;

  constructor(deps: ControllerDeps) {
    this.deps = { debounceMs: 500, now: () => performance.now(), loadRepo, loadLibraries, loadFonts, ...deps };
  }

  async open(hash: string): Promise<void> {
    const route = parseRoute(hash);
    this.pinnedRef = route.kind === 'repo' ? route.ref : undefined;
    const mySeq = ++this.openSeq;
    this.loadAbort?.abort();
    this.loadAbort = null;
    this.cancelRender();
    this.dropPendingHash(); // the URL already shows the route being opened
    if (route.kind === 'landing' || route.kind === 'help') {
      this.phase.value = route.kind;
      return;
    }
    this.phase.value = 'loading';
    this.error.value = null;
    try {
      const current = this.repo.value;
      let repo = current;
      const reuse = current && current.owner === route.owner && current.repo === route.repo
        && (route.ref === this.loadedRef || (route.ref !== undefined && (route.ref === current.ref || route.ref === current.sha)))
        && route.dir === this.loadedDir;
      if (!reuse) {
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
      if (e instanceof LoadError && e.code === 'too-many-files') {
        this.tooBig.value = { owner: route.owner, repo: route.repo, ref: route.ref, message: e.message, folders: e.folders };
        this.phase.value = 'folders';
        return;
      }
      this.error.value = e instanceof LoadError || e instanceof Error ? e.message : String(e);
      this.phase.value = 'error';
    }
  }

  async openFile(path: string, init: { preset?: string; values?: Record<string, string> } = {}): Promise<void> {
    const token = this.openSeq;
    this.cancelRender();
    this.sourceDirty = false;
    this.entry.value = path;
    this.editedSource.value = null;
    this.meshVersion.value++;
    this.render.value = { status: 'idle', mesh: null, outdated: false };
    const presetFile = this.repo.value?.files.get(path.replace(/\.scad$/i, '.json'));
    this.presets.value = presetFile ? parsePresets(decodeText(presetFile)) : {};
    const extracted = await this.extractParams(false);
    if (token !== this.openSeq) return;

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
    if (!extracted) this.paramLog = [...this.paramLog, { level: 'error', text: "Couldn't read parameters. See the messages above." }];
    this.log.value = this.paramLog;
    this.phase.value = 'model';
    this.scheduleRender(0);
    this.syncHash();
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
    this.sourceDirty = true;
    this.markOutdated();
    this.scheduleRender(this.deps.debounceMs);
  }

  cancelRender(): void {
    this.clearTimer();
    this.gen++;
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

  /** Writes a debounced URL update now (e.g. before the URL is shared). */
  flushHash(): void {
    if (!this.hashTimer) return;
    this.syncHash();
  }

  hash(): string {
    const repo = this.repo.value;
    if (!repo) return '';
    return serializeRoute({
      // Pinned links stay pinned; unpinned links stay unpinned.
      kind: 'repo', owner: repo.owner, repo: repo.repo, ref: this.pinnedRef, dir: this.loadedDir,
      path: this.entry.value ?? undefined, preset: this.preset.value ?? undefined,
      values: overrides(this.values.value, this.defaults.value),
    });
  }

  /** What a share link could carry right now. Null when no repo is open. */
  shareState(): ShareState | null {
    const repo = this.repo.value;
    if (!repo) return null;
    const entry = this.entry.value;
    const preset = this.preset.value;
    let presetExact = false;
    if (preset && this.presets.value[preset]) {
      const expected = { ...this.defaults.value, ...resolveValues(this.params.value, this.presets.value[preset]).values };
      presetExact = Object.entries(this.values.value).every(([k, v]) => k in expected && sameValue(v, expected[k]));
    }
    const candidate = this.candidates.value.find((c) => c.path === entry);
    return {
      owner: repo.owner, repo: repo.repo, sha: repo.sha, dir: this.loadedDir, entry,
      title: candidate?.title ?? repo.manifest?.title ?? (entry ? basename(entry).replace(/\.scad$/i, '') : `${repo.owner}/${repo.repo}`),
      multipleModels: this.candidates.value.length > 1,
      preset, presetExact, changed: overrides(this.values.value, this.defaults.value),
    };
  }

  // --- internals ---

  private clearRepo(): void {
    this.repo.value = null;
    this.loadedRef = undefined;
    this.loadedDir = undefined;
    this.candidates.value = [];
    this.notices.value = [];
    this.libFiles = new Map();
    this.fontsTried = false;
  }

  /** text() can be called from inside a library (BOSL2 text3d, path_text): load fonts on first complaint, once per repo. */
  private async loadMissingFonts(): Promise<void> {
    this.fontsTried = true;
    const repo = this.repo.value;
    let fonts: Awaited<ReturnType<typeof loadFonts>>;
    try {
      fonts = await this.deps.loadFonts(this.deps.net);
    } catch {
      return;
    }
    if (repo !== this.repo.value) return;
    this.libFiles = new Map([...this.libFiles, ...fonts.files]);
    if (fonts.warnings.length) this.notices.value = [...this.notices.value, ...fonts.warnings];
    if (fonts.files.size && this.phase.value === 'model' && this.entry.value) {
      this.markOutdated();
      this.scheduleRender(0);
    }
  }

  private files(): FileMap {
    const files: FileMap = new Map(this.libFiles);
    for (const [p, d] of this.repo.value?.files ?? []) files.set(REPO_ROOT + p, d);
    const entry = this.entry.value;
    if (entry && this.editedSource.value !== null) files.set(REPO_ROOT + entry, encodeText(this.editedSource.value));
    return files;
  }

  /** Returns true when parameters were read. With `keepOnFail`, a failure leaves params untouched. */
  private async extractParams(keepOnFail: boolean): Promise<boolean> {
    const entry = this.entry.value!;
    const job: Job = { kind: 'params', files: this.files(), entry: REPO_ROOT + entry };
    let result: JobResult;
    try {
      result = await this.deps.engine.run(job);
      this.engineReady.value = true;
    } catch (e) {
      this.paramLog = [{ level: 'error', text: `Couldn't read parameters: ${e instanceof Error ? e.message : String(e)}` }];
      if (!keepOnFail) this.params.value = [];
      return false;
    }
    // Reading parameters evaluates the script with default values, so its echoes & warnings would
    // contradict the render's. Keep only errors: those mean the script itself is broken.
    this.paramLog = result.log.filter((l) => l.level === 'error');
    let set: ParamSet | null = null;
    if (result.exitCode === 0 && result.output) {
      try {
        set = JSON.parse(decodeText(result.output)) as ParamSet;
      } catch {
        set = null;
      }
    }
    if (!set || !Array.isArray(set.parameters)) {
      if (!keepOnFail) this.params.value = [];
      return false;
    }
    this.params.value = set.parameters;
    return true;
  }

  private async runScheduled(): Promise<void> {
    const gen = this.gen;
    if (this.sourceDirty) {
      this.sourceDirty = false;
      const token = this.openSeq;
      const entry = this.entry.value;
      const ok = await this.extractParams(true);
      if (token !== this.openSeq || entry !== this.entry.value) return;
      if (ok) {
        // Keep values for parameters that still exist; new ones get their defaults.
        const current = this.values.value;
        this.values.value = Object.fromEntries(Object.entries(this.defaults.value).map(([k, d]) => [k, k in current ? current[k] : d]));
      }
      this.syncHash();
      if (gen !== this.gen) return; // a newer schedule or a cancel took over
    }
    await this.doRender();
  }

  private changed(): void {
    this.markOutdated();
    this.scheduleRender(this.deps.debounceMs);
    this.dropPendingHash();
    this.hashTimer = setTimeout(() => this.syncHash(), HASH_DEBOUNCE_MS);
  }

  private markOutdated(): void {
    if (this.render.value.mesh) this.render.value = { ...this.render.value, outdated: true };
  }

  /** Writes the URL now, replacing any pending debounced write. Never throws. */
  private syncHash(): void {
    this.dropPendingHash();
    try {
      this.deps.setHash(this.hash());
    } catch {
      /* e.g. Safari's replaceState rate limit: the next write catches up */
    }
  }

  private dropPendingHash(): void {
    if (this.hashTimer) clearTimeout(this.hashTimer);
    this.hashTimer = null;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleRender(delay: number): void {
    this.clearTimer();
    this.gen++;
    this.abort?.abort();
    this.abort = null;
    this.timer = setTimeout(() => void this.runScheduled(), delay);
  }

  private async doRender(): Promise<void> {
    const entry = this.entry.value;
    if (!entry) return;
    this.abort?.abort();
    const seq = ++this.seq;
    const abort = new AbortController();
    this.abort = abort;
    const startedAt = this.deps.now();
    this.render.value = { ...this.render.value, status: 'rendering', startedAt };
    let result: JobResult;
    try {
      result = await this.deps.engine.run({ kind: 'render', files: this.files(), entry: REPO_ROOT + entry, values: this.values.value }, abort.signal);
      this.engineReady.value = true;
    } catch (e) {
      if (e instanceof AbortedError || seq !== this.seq) return;
      this.render.value = { ...this.render.value, status: 'error', outdated: true, message: e instanceof Error ? e.message : String(e) };
      return;
    }
    if (seq !== this.seq) return;
    this.abort = null;
    this.log.value = [...this.paramLog, ...result.log, { level: 'info', text: `Rendered in ${result.ms} ms` }];
    if (!this.fontsTried && result.log.some((l) => MISSING_FONT.test(l.text))) void this.loadMissingFonts();
    if (result.exitCode === 0 && result.output) {
      try {
        const mesh = parseOff(decodeText(result.output));
        const seconds = Math.round((this.deps.now() - startedAt) / 100) / 10;
        this.render.value = { status: 'ready', mesh, outdated: false, ms: result.ms, seconds };
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
