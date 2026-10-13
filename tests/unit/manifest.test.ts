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
    expect(parseLibraryRef('gh:../..')).toBeNull();
    expect(parseLibraryRef('gh:o/..')).toBeNull();
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

  it('rejects dot-segment and __proto__ library names', () => {
    const { manifest, errors } = parseManifest('{"libraries":{"..":"gh:a/b","__proto__":"gh:a/b","ok":"gh:a/b"}}');
    expect(manifest!.libraries).toEqual({ ok: { owner: 'a', repo: 'b' } });
    expect(Object.getPrototypeOf(manifest!.libraries)).toBe(Object.prototype);
    expect(errors.length).toBe(2);
  });

  it('returns null for non-objects and bad JSON', () => {
    expect(parseManifest('[]').manifest).toBeNull();
    expect(parseManifest('{').manifest).toBeNull();
    expect(parseManifest('{').errors.length).toBe(1);
  });
});
