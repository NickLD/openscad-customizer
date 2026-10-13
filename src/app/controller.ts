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
  private gen = 0;
  private sourceDirty = false;
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

  /** Returns true when parameters were read. With `keepOnFail`, a failure leaves params untouched. */
  private async extractParams(keepOnFail: boolean): Promise<boolean> {
    const entry = this.entry.value!;
    const job: Job = { kind: 'params', files: this.files(), entry: REPO_ROOT + entry };
    let result: JobResult;
    try {
      result = await this.deps.engine.run(job);
    } catch (e) {
      this.paramLog = [{ level: 'error', text: `Couldn't read parameters: ${e instanceof Error ? e.message : String(e)}` }];
      if (!keepOnFail) this.params.value = [];
      return false;
    }
    this.paramLog = result.log.filter((l) => l.level !== 'info');
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
    this.render.value = { ...this.render.value, status: 'rendering' };
    let result: JobResult;
    try {
      result = await this.deps.engine.run({ kind: 'render', files: this.files(), entry: REPO_ROOT + entry, values: this.values.value }, abort.signal);
    } catch (e) {
      if (e instanceof AbortedError || seq !== this.seq) return;
      this.render.value = { ...this.render.value, status: 'error', outdated: true, message: e instanceof Error ? e.message : String(e) };
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
