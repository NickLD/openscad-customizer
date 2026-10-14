import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../../src/app/controller';
import type { Job, JobResult } from '../../src/engine/core';
import { AbortedError, type Engine } from '../../src/engine/engine';
import { LoadError, type LoadedRepo, type LoadProgress } from '../../src/repo/repoLoader';
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
  const cfg: { params: () => JobResult; hold: boolean } = {
    params: () => ({ exitCode: 0, output: encodeText(JSON.stringify(SET)), log: [], ms: 1 }),
    hold: false,
  };
  const engine: Engine = {
    run(job, signal) {
      return new Promise((resolve, reject) => {
        const call = { job, signal, resolve, reject };
        calls.push(call);
        signal?.addEventListener('abort', () => reject(new AbortedError()));
        if (job.kind === 'params' && !cfg.hold) resolve(cfg.params());
      });
    },
  };
  return { engine, calls, cfg, params: () => calls.filter((c) => c.job.kind === 'params'), renders: () => calls.filter((c) => c.job.kind === 'render') };
}
const ok = (): JobResult => ({ exitCode: 0, output: encodeText(OFF), log: [{ level: 'echo', text: 'hi' }], ms: 5 });

function make(files: Record<string, string> = { 'g.scad': '/* [Cables] */\ncable_count = 1; // [1:8]', 'g.json': JSON.stringify({ parameterSets: { Three: { cable_count: '3' } } }) }, extra: { now?: () => number } = {}) {
  const fe = fakeEngine();
  const setHash = vi.fn();
  const ctl = new AppController({
    net: { getJson: vi.fn(), getBytes: vi.fn() }, engine: fe.engine, setHash, debounceMs: 500,
    loadRepo: vi.fn(async () => repo(files)),
    loadLibraries: vi.fn(async () => ({ files: new Map(), warnings: [] })),
    ...extra,
  });
  return { ctl, fe, setHash };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AppController', () => {
  it('reports wall-clock render seconds and when the engine is warm', async () => {
    let t = 1000;
    const { ctl, fe } = make(undefined, { now: () => t });
    expect(ctl.engineReady.value).toBe(false);
    await ctl.open('#/gh/o/r/g.scad');
    expect(ctl.engineReady.value).toBe(true); // the params job came back
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.render.value).toMatchObject({ status: 'rendering', startedAt: 1000 });
    t = 6300;
    fe.renders()[0].resolve(ok());
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.render.value).toMatchObject({ status: 'ready', seconds: 5.3 });
  });

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

  it('describes the current view for sharing', async () => {
    const { ctl } = make();
    await ctl.open('#/gh/o/r/g.scad?preset=Three');
    expect(ctl.shareState()).toEqual({
      owner: 'o', repo: 'r', sha: 'a'.repeat(40), entry: 'g.scad', title: 'g',
      multipleModels: false, preset: 'Three', presetExact: true, changed: { cable_count: '3' },
    });
    ctl.setValue('cable_count', 5);
    expect(ctl.shareState()).toMatchObject({ preset: 'Three', presetExact: false, changed: { cable_count: '5' } });
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

  const ORIG_SRC = ['/* [Cables] */', 'cable_count = 1; // [1:8]'].join('\n');
  const dec = (b?: Uint8Array) => new TextDecoder().decode(b);
  const SET2: ParamSet = { title: 'g', parameters: [
    { name: 'cable_count', group: 'Cables', type: 'number', initial: 1, min: 1, max: 8, step: 1 },
    { name: 'wall', group: 'Cables', type: 'number', initial: 2, min: 1, max: 5, step: 1 },
  ] };

  it('source edit updates params, keeps surviving values and renders the edited source', async () => {
    const { ctl, fe } = make();
    await ctl.open('#/gh/o/r/g.scad?cable_count=4');
    await vi.advanceTimersByTimeAsync(0);
    fe.cfg.params = () => ({ exitCode: 0, output: encodeText(JSON.stringify(SET2)), log: [], ms: 1 });
    ctl.setSource('edited');
    await vi.advanceTimersByTimeAsync(500);
    expect(ctl.params.value.map((p) => p.name)).toEqual(['cable_count', 'wall']);
    expect(ctl.values.value).toEqual({ cable_count: 4, wall: 2 });
    const r = fe.renders().at(-1)!;
    expect(dec(r.job.files.get('/repo/g.scad'))).toBe('edited');
    expect(r.job).toMatchObject({ values: { cable_count: 4, wall: 2 } });
  });

  it('setValue during the source debounce still re-extracts and renders once with the latest value', async () => {
    const { ctl, fe } = make();
    await ctl.open('#/gh/o/r/g.scad');
    await vi.advanceTimersByTimeAsync(0);
    const before = fe.renders().length;
    ctl.setSource('edited');
    ctl.setValue('cable_count', 6);
    await vi.advanceTimersByTimeAsync(500);
    expect(fe.params()).toHaveLength(2);
    expect(fe.renders()).toHaveLength(before + 1);
    expect(fe.renders().at(-1)!.job).toMatchObject({ values: { cable_count: 6 } });
  });

  it('failed extraction during an edit keeps params, values and the link', async () => {
    const { ctl, fe, setHash } = make();
    await ctl.open('#/gh/o/r/g.scad?cable_count=4');
    await vi.advanceTimersByTimeAsync(0);
    fe.cfg.params = () => ({ exitCode: 1, output: null, log: [{ level: 'error', text: 'syntax error' }], ms: 1 });
    ctl.setSource('broken(');
    await vi.advanceTimersByTimeAsync(500);
    expect(ctl.params.value.map((p) => p.name)).toEqual(['cable_count', 'part']);
    expect(ctl.values.value).toEqual({ cable_count: 4, part: 'all' });
    expect(ctl.hash()).toContain('cable_count=4');
    expect(setHash).toHaveBeenLastCalledWith(expect.stringContaining('cable_count=4'));
    expect(fe.renders().at(-1)!.job.files.get('/repo/g.scad')).toBeDefined(); // still renders so the Console shows the error
  });

  it('setSource(null) discards edits', async () => {
    const { ctl, fe } = make();
    await ctl.open('#/gh/o/r/g.scad');
    await vi.advanceTimersByTimeAsync(0);
    ctl.setSource('edited');
    await vi.advanceTimersByTimeAsync(500);
    ctl.setSource(null);
    await vi.advanceTimersByTimeAsync(500);
    expect(dec(fe.renders().at(-1)!.job.files.get('/repo/g.scad'))).toBe(ORIG_SRC);
    expect(ctl.entrySource()).toBe(ORIG_SRC);
  });

  it('a superseded open does not flip the phase, rewrite the hash or render', async () => {
    const { ctl, fe, setHash } = make();
    fe.cfg.hold = true;
    const first = ctl.open('#/gh/o/r/g.scad');
    await vi.advanceTimersByTimeAsync(0);
    await ctl.open('#/');
    expect(ctl.phase.value).toBe('landing');
    fe.cfg.hold = false;
    fe.params()[0].resolve({ exitCode: 0, output: encodeText(JSON.stringify(SET)), log: [], ms: 1 });
    await first;
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctl.phase.value).toBe('landing');
    expect(setHash).not.toHaveBeenCalled();
    expect(fe.renders()).toHaveLength(0);
  });

  it('shows only the render pass output, not echoes from reading parameters with default values', async () => {
    const { ctl, fe } = make();
    fe.cfg.params = () => ({
      exitCode: 0, output: encodeText(JSON.stringify(SET)), ms: 1,
      log: [{ level: 'echo', text: '"Cables: 1"' }, { level: 'warning', text: 'from defaults' }, { level: 'error', text: 'Parser error', file: '/repo/g.scad', line: 2 }],
    });
    await ctl.open('#/gh/o/r/g.scad?cable_count=4');
    await vi.advanceTimersByTimeAsync(0);
    fe.renders()[0].resolve({ ...ok(), log: [{ level: 'echo', text: '"Cables: 4"' }] });
    await vi.advanceTimersByTimeAsync(0);
    const texts = ctl.log.value.map((l) => l.text);
    expect(texts).toContain('"Cables: 4"');
    expect(texts).not.toContain('"Cables: 1"');
    expect(texts).not.toContain('from defaults');
    expect(texts).toContain('Parser error'); // errors from reading the script still matter
  });

  it('logs the render time after a successful render', async () => {
    const { ctl, fe } = make();
    await ctl.open('#/gh/o/r/g.scad');
    await vi.advanceTimersByTimeAsync(0);
    fe.renders()[0].resolve(ok());
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.log.value).toContainEqual({ level: 'info', text: 'Rendered in 5 ms' });
  });

  describe('URL hash writes', () => {
    it('debounces hash writes from rapid value changes and writes the last value once', async () => {
      const { ctl, setHash } = make();
      await ctl.open('#/gh/o/r/g.scad');
      setHash.mockClear();
      for (let i = 0; i < 50; i++) ctl.setValue('cable_count', (i % 8) + 1);
      expect(setHash).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(setHash).toHaveBeenCalledTimes(1);
      expect(setHash).toHaveBeenLastCalledWith('#/gh/o/r/g.scad?cable_count=2');
    });

    it('a throwing setHash does not stop renders from being scheduled', async () => {
      const { ctl, fe, setHash } = make();
      setHash.mockImplementation(() => { throw new DOMException('too many calls', 'SecurityError'); });
      await ctl.open('#/gh/o/r/g.scad');
      await vi.advanceTimersByTimeAsync(0);
      expect(fe.renders()).toHaveLength(1);
      ctl.setValue('cable_count', 5);
      await vi.advanceTimersByTimeAsync(500);
      expect(fe.renders()).toHaveLength(2);
      expect(fe.renders()[1].job).toMatchObject({ values: { cable_count: 5 } });
    });

    it('flushHash writes a pending hash immediately, once', async () => {
      const { ctl, setHash } = make();
      await ctl.open('#/gh/o/r/g.scad');
      setHash.mockClear();
      ctl.setValue('cable_count', 7);
      ctl.flushHash();
      expect(setHash).toHaveBeenCalledTimes(1);
      expect(setHash).toHaveBeenLastCalledWith('#/gh/o/r/g.scad?cable_count=7');
      await vi.advanceTimersByTimeAsync(1000);
      expect(setHash).toHaveBeenCalledTimes(1);
      ctl.flushHash();
      expect(setHash).toHaveBeenCalledTimes(1);
    });

    it('a pending hash write is dropped when another route opens', async () => {
      const { ctl, setHash } = make();
      await ctl.open('#/gh/o/r/g.scad');
      ctl.setValue('cable_count', 7);
      setHash.mockClear();
      await ctl.open('#/');
      await vi.advanceTimersByTimeAsync(1000);
      expect(setHash).not.toHaveBeenCalled();
    });
  });

  describe('repo reuse', () => {
    const two = { 'a.scad': 'x = 1; // [1:2]', 'b.scad': 'y = 1; // [1:2]' };
    const loader = (ctl: AppController) => (ctl as unknown as { deps: { loadRepo: ReturnType<typeof vi.fn> } }).deps.loadRepo;

    it('switching models under a pinned tag reuses the loaded repo', async () => {
      const { ctl } = make(two);
      await ctl.open('#/gh/o/r@v1.2/a.scad');
      await ctl.open('#/gh/o/r@v1.2/b.scad');
      expect(ctl.entry.value).toBe('b.scad');
      expect(loader(ctl)).toHaveBeenCalledTimes(1);
      expect(loader(ctl)).toHaveBeenCalledWith(expect.anything(), 'o', 'r', 'v1.2', undefined, expect.objectContaining({ dir: undefined }));
    });

    it('reuses for the resolved sha, reloads for a different ref', async () => {
      const { ctl } = make(two);
      await ctl.open('#/gh/o/r/a.scad');
      await ctl.open(`#/gh/o/r@${'a'.repeat(40)}/b.scad`);
      expect(loader(ctl)).toHaveBeenCalledTimes(1);
      await ctl.open('#/gh/o/r@v2/b.scad');
      expect(loader(ctl)).toHaveBeenCalledTimes(2);
    });

    it('a failed load of another repo clears the previous repo', async () => {
      const { ctl } = make(two);
      await ctl.open('#/gh/o/r');
      expect(ctl.candidates.value).toHaveLength(2);
      loader(ctl).mockImplementation(async () => { throw new LoadError('not-found', "Couldn't find o/other."); });
      await ctl.open('#/gh/o/other');
      expect(ctl.phase.value).toBe('error');
      expect(ctl.repo.value).toBeNull();
      expect(ctl.candidates.value).toEqual([]);
      expect(ctl.notices.value).toEqual([]);
    });
  });

  it('loads fonts once when a render reports a missing font, and re-renders with them', async () => {
    const { ctl, fe } = make();
    const loadFonts = vi.fn(async () => ({ files: new Map([['/fonts/LiberationSans-Regular.ttf', encodeText('ttf')]]), warnings: [] }));
    (ctl as unknown as { deps: { loadFonts: unknown } }).deps.loadFonts = loadFonts;
    const noFont = (): JobResult => ({ ...ok(), log: [{ level: 'warning', text: "Can't get font Liberation Sans for text()" }] });
    await ctl.open('#/gh/o/r/g.scad');
    await vi.advanceTimersByTimeAsync(0);
    expect(fe.renders()[0].job.files.has('/fonts/LiberationSans-Regular.ttf')).toBe(false);
    fe.renders()[0].resolve(noFont());
    await vi.advanceTimersByTimeAsync(0);
    expect(loadFonts).toHaveBeenCalledTimes(1);
    expect(fe.renders()).toHaveLength(2);
    expect(fe.renders()[1].job.files.has('/fonts/LiberationSans-Regular.ttf')).toBe(true);
    fe.renders()[1].resolve(noFont());
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadFonts).toHaveBeenCalledTimes(1);
    expect(fe.renders()).toHaveLength(2);
    expect(ctl.render.value.status).toBe('ready');
  });
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
});
