import { describe, expect, it } from 'vitest';
import { formatBytes } from '../../src/util';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1536, '1.5 KB'],
    [419_840, '410 KB'],
    [3_565_158, '3.4 MB'],
  ])('%d bytes is %s', (n, s) => {
    expect(formatBytes(n)).toBe(s);
  });
});
