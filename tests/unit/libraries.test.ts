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

  it('treats inherited Object.prototype names as missing, not as libraries', () => {
    const plan = planLibraries(files({ 'm.scad': 'use <constructor/x.scad>\ninclude <__proto__/y.scad>\nuse <toString.scad>' }), null);
    expect(plan.libs).toEqual({});
    expect(plan.missing).toEqual(['constructor/x.scad', '__proto__/y.scad', 'toString.scad']);
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

describe('loadLibraries file selection', () => {
  function libNet(listings: Record<string, string[]>, bodies: Record<string, string>): Net & { fetched: string[] } {
    const fetched: string[] = [];
    return {
      fetched,
      async getJson(url) {
        for (const [key, names] of Object.entries(listings)) {
          if (url === `https://data.jsdelivr.com/v1/packages/gh/${key}?structure=flat`) return { status: 200, data: { files: names.map((name) => ({ name: '/' + name, size: 1 })) } };
        }
        return { status: 404, data: null };
      },
      async getBytes(url) {
        fetched.push(url);
        return url in bodies ? encodeText(bodies[url]) : encodeText('');
      },
    };
  }

  it('fetches only .scad files and skips gallery/', async () => {
    const lib = { owner: 'f', repo: 'fancy', ref: 'v2', mount: '/libraries/fancy', exclude: REGISTRY.BOSL2.exclude };
    const net = libNet({ 'f/fancy@v2': ['x.scad', 'gallery/g.scad', 'pic.png', 'part.stl', 'y.scad'] }, {});
    const { files } = await loadLibraries(net, { libs: { fancy: lib }, missing: [], needsFonts: false });
    expect([...files.keys()].sort()).toEqual(['/libraries/fancy/x.scad', '/libraries/fancy/y.scad']);
    expect(net.fetched.some((u) => /\.png|\.stl|gallery/.test(u))).toBe(false);
  });

  it('reports download progress and what each library came to', async () => {
    const lib = { owner: 'f', repo: 'fancy', ref: 'v2', mount: '/libraries/fancy' };
    const net = libNet({ 'f/fancy@v2': ['x.scad', 'y.scad'] }, { [cdnUrl('f', 'fancy', 'v2', 'x.scad')]: 'abc' });
    const steps: unknown[] = [];
    const { sizes } = await loadLibraries(net, { libs: { fancy: lib }, missing: [], needsFonts: false }, { onProgress: (p) => steps.push(p) });
    expect(steps.at(-1)).toMatchObject({ step: 'libraries', done: 2, total: 2, bytes: 2, totalBytes: 2 });
    expect(sizes).toEqual([{ name: 'fancy', files: 2, bytes: 3 }]);
  });

  it('downloads nothing more once cancelled', async () => {
    const lib = { owner: 'f', repo: 'fancy', ref: 'v2', mount: '/libraries/fancy' };
    const net = libNet({ 'f/fancy@v2': ['x.scad', 'y.scad'] }, {});
    const ctrl = new AbortController();
    ctrl.abort();
    const { files } = await loadLibraries(net, { libs: { fancy: lib }, missing: [], needsFonts: false }, { signal: ctrl.signal });
    expect(files.size).toBe(0);
    expect(net.fetched).toEqual([]);
  });

  it('loads registry libraries included by a loaded library (one transitive pass)', async () => {
    const bosl = REGISTRY.BOSL2;
    const mcad = REGISTRY.MCAD;
    const net = libNet(
      { [`f/fancy@v2`]: ['a.scad'], [`${bosl.owner}/${bosl.repo}@${bosl.ref}`]: ['std.scad'], [`${mcad.owner}/${mcad.repo}@${mcad.ref}`]: ['units.scad'] },
      {
        [cdnUrl('f', 'fancy', 'v2', 'a.scad')]: 'include <BOSL2/std.scad>\ninclude <local.scad>',
        [cdnUrl(bosl.owner, bosl.repo, bosl.ref, 'std.scad')]: 'use <MCAD/units.scad>',
      },
    );
    const { files } = await loadLibraries(net, { libs: { fancy: { owner: 'f', repo: 'fancy', ref: 'v2', mount: '/libraries/fancy' } }, missing: [], needsFonts: false });
    expect([...files.keys()].sort()).toEqual(['/libraries/BOSL2/std.scad', '/libraries/fancy/a.scad']);
  });
});
