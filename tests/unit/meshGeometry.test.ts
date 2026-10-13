import { describe, expect, it } from 'vitest';
import { parseOff } from '../../src/mesh/off';
import { meshToGeometry } from '../../src/ui/viewer/meshGeometry';

describe('meshToGeometry', () => {
  it('expands triangles with normals, adding colours only when present', () => {
    const plain = meshToGeometry(parseOff('OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n'));
    expect(plain.getAttribute('position').count).toBe(3);
    expect(plain.getAttribute('normal').getZ(0)).toBeCloseTo(1);
    expect(plain.getAttribute('color')).toBeUndefined();

    const colored = meshToGeometry(parseOff('OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2 255 0 0\n'));
    const c = colored.getAttribute('color');
    expect([c.getX(0), c.getY(0), c.getZ(0)]).toEqual([1, 0, 0]);
  });
});
