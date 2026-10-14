import { describe, expect, it } from 'vitest';
import { cdnUrl, fetchFiles, LoadError, loadRepo, REPO_CAPS, resolveRef, type LoadProgress, type Net } from '../../src/repo/repoLoader';
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

  it('rejects dot-segment refs before any request', async () => {
    for (const bad of ['..', '.']) {
      const net = fakeNet({});
      await expect(resolveRef(net, 'o', 'r', bad)).rejects.toMatchObject({ code: 'ref-not-found' });
      expect(net.calls).toEqual([]);
    }
  });

  it('falls back to jsDelivr when the commits response has no valid sha', async () => {
    const net = fakeNet({ [API]: { status: 200, data: { default_branch: 'main' } }, [`${API}/commits/main`]: { status: 200, data: {} }, ...listing('main', []) });
    expect(await resolveRef(net, 'o', 'r')).toEqual({ ref: 'main', stale: true });
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

describe('cdnUrl', () => {
  it('pins the encoding of ref and path', () => {
    expect(cdnUrl('o', 'r', 'a/b?c#d%e', 'x y/z.scad')).toBe('https://cdn.jsdelivr.net/gh/o/r@a%2Fb%3Fc%23d%25e/x%20y/z.scad');
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

describe('loadRepo two-phase fetching', () => {
  const PINNED = { [API]: { status: 403 } };

  it('loads .scad files even when many assets sort before them and the file cap is small', async () => {
    const stls = Array.from({ length: 10 }, (_, i): [string, number] => [`exports/p${i}.stl`, 100]);
    const routes: Routes = {
      ...PINNED,
      ...listing('main', [...stls, ['models/m.scad', 3]]),
      [cdnUrl('o', 'r', 'main', 'models/m.scad')]: encodeText('x=1'),
      ...Object.fromEntries(stls.map(([p]) => [cdnUrl('o', 'r', 'main', p), encodeText('solid')])),
    };
    const net = fakeNet(routes);
    const repo = await loadRepo(net, 'o', 'r', undefined, { maxFiles: 3, maxBytes: 1e9, maxFileBytes: 1e9 });
    expect([...repo.files.keys()]).toEqual(['models/m.scad']);
    expect(net.calls.some((u) => u.endsWith('.stl'))).toBe(false);
    expect(repo.warnings.some((w) => w.startsWith('Skipped'))).toBe(false);
  });

  it('fetches only assets referenced by some .scad text, and reports only wanted files as skipped', async () => {
    const net = fakeNet({
      ...PINNED,
      ...listing('main', [['exports/other.stl', 5], ['big.png', 50], ['m.scad', 30], ['exports/part.stl', 5]]),
      [cdnUrl('o', 'r', 'main', 'm.scad')]: encodeText('import("exports/part.stl"); surface(file = "big.png");'),
      [cdnUrl('o', 'r', 'main', 'exports/part.stl')]: encodeText('solid'),
      [cdnUrl('o', 'r', 'main', 'exports/other.stl')]: encodeText('solid'),
      [cdnUrl('o', 'r', 'main', 'big.png')]: encodeText('png'),
    });
    const repo = await loadRepo(net, 'o', 'r', undefined, { maxFiles: 100, maxBytes: 40, maxFileBytes: 1e9 });
    expect([...repo.files.keys()].sort()).toEqual(['exports/part.stl', 'm.scad']);
    expect(net.calls.some((u) => u.includes('other.stl'))).toBe(false);
    const skipped = repo.warnings.find((w) => w.startsWith('Skipped'));
    expect(skipped).toBe('Skipped 1 file(s): big.png (repo size limit reached)');
  });
});

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
