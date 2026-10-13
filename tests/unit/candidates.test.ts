import { describe, expect, it } from 'vitest';
import { findCandidates } from '../../src/candidates';
import { encodeText } from '../../src/util';

const files = (entries: Record<string, string>) => new Map(Object.entries(entries).map(([k, v]) => [k, encodeText(v)]));

describe('findCandidates', () => {
  it('lists files with customizer annotations, sorted, titled by basename', () => {
    const { candidates } = findCandidates(files({
      'models/b.scad': '/* [Size] */\nx = 1;',
      'a.scad': 'w = 3; // [1:10]\ncube(w);',
      'lib/util.scad': 'module u() {}',
      'README.md': '# hi',
    }), null);
    expect(candidates).toEqual([{ path: 'a.scad', title: 'a' }, { path: 'models/b.scad', title: 'b' }]);
  });

  it('falls back to files not included by others when none are annotated', () => {
    const { candidates } = findCandidates(files({
      'main.scad': 'include <lib/util.scad>\nu();',
      'lib/util.scad': 'use <../other.scad>\nmodule u() {}',
      'other.scad': 'module o() {}',
    }), null);
    expect(candidates.map((c) => c.path)).toEqual(['main.scad']);
  });

  it('uses the manifest file list, warning about missing files', () => {
    const { candidates, warnings } = findCandidates(files({ 'g.scad': 'cube(1);' }), {
      libraries: {},
      files: [{ path: 'g.scad', title: 'Gland', description: 'd', thumbnail: 't.png' }, { path: 'missing.scad' }],
    });
    expect(candidates).toEqual([{ path: 'g.scad', title: 'Gland', description: 'd', thumbnail: 't.png' }]);
    expect(warnings).toEqual(['openscad-customizer.json lists missing.scad, which is not in the repo.']);
  });
});
