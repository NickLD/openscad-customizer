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
    expect(githubInputToRoute('https://github.com/NickLD/gland/tree/dev/models')).toEqual({ ...base, ref: 'dev', dir: 'models' });
    expect(githubInputToRoute('https://github.com/NickLD/gland/blob/main/models/cable_gland.scad')).toEqual({ ...base, ref: 'main', path: 'models/cable_gland.scad' });
  });

  it('rejects garbage', () => {
    expect(githubInputToRoute('')).toBeNull();
    expect(githubInputToRoute('hello')).toBeNull();
    expect(githubInputToRoute('https://example.com/a b/c')).toBeNull();
  });
});

describe('help route', () => {
  it('parses and serializes #/help', () => {
    expect(parseRoute('#/help')).toEqual({ kind: 'help' });
    expect(serializeRoute({ kind: 'help' })).toBe('#/help');
  });
});

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
