import { describe, expect, it } from 'vitest';
import { FEATURED, featuredHash, featuredThumbnail } from '../../src/featured';
import { isSafeRelPath } from '../../src/util';

const SEG = /^[A-Za-z0-9_.-]+$/;

describe('featured.json', () => {
  it('starts with the cable gland', () => {
    expect(FEATURED[0]).toMatchObject({ owner: 'NickLD', repo: 'split-cable-gland', path: 'cable_gland.scad', title: 'Split Cable Gland' });
  });

  it('has only well-formed, unique entries (checks community PRs)', () => {
    const seen = new Set<string>();
    for (const m of FEATURED) {
      expect(m.owner).toMatch(SEG);
      expect(m.repo).toMatch(SEG);
      expect(isSafeRelPath(m.path) && m.path.endsWith('.scad')).toBe(true);
      expect(m.title.trim().length).toBeGreaterThan(0);
      expect(m.description.trim().length).toBeGreaterThan(0);
      if (m.thumbnail !== undefined) expect(isSafeRelPath(m.thumbnail)).toBe(true);
      const key = `${m.owner}/${m.repo}/${m.path}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('builds links and thumbnail URLs', () => {
    const m = { owner: 'o', repo: 'r', path: 'dir/my model.scad', title: 't', description: 'd', thumbnail: 'img/a b.png' };
    expect(featuredHash(m)).toBe('#/gh/o/r/dir/my%20model.scad');
    expect(featuredThumbnail(m)).toBe('https://cdn.jsdelivr.net/gh/o/r/img/a%20b.png');
    expect(featuredThumbnail({ ...m, thumbnail: undefined })).toBeNull();
  });
});
