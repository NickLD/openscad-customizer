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
