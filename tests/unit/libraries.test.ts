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
