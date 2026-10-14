// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { modelHash } from '../../src/ui/links';

describe('modelHash', () => {
  beforeEach(() => {
    location.hash = '';
  });

  it('has no ref when none is pinned', () => {
    location.hash = '#/gh/o/r/a.scad';
    expect(modelHash('o', 'r', 'b.scad')).toBe('#/gh/o/r/b.scad');
  });

  it('keeps the loaded folder when switching models', () => {
    location.hash = '#/gh/o/r@v1?dir=ex';
    expect(modelHash('o', 'r', 'ex/b.scad')).toBe('#/gh/o/r@v1/ex/b.scad?dir=ex');
    expect(modelHash('x', 'y', 'b.scad')).toBe('#/gh/x/y/b.scad');
  });

  it('keeps an explicitly pinned ref', () => {
    location.hash = '#/gh/o/r@v1.2/a.scad';
    expect(modelHash('o', 'r', 'sub/b.scad')).toBe('#/gh/o/r@v1.2/sub/b.scad');
  });

  it('does not carry a ref from a different repo', () => {
    location.hash = '#/gh/x/y@v1/a.scad';
    expect(modelHash('o', 'r', 'b.scad')).toBe('#/gh/o/r/b.scad');
  });

  it('encodes awkward paths', () => {
    expect(modelHash('o', 'r', 'my dir/a#1.scad')).toBe('#/gh/o/r/my%20dir/a%231.scad');
  });
});
