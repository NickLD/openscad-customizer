import { describe, expect, it } from 'vitest';
import { parsePresets, resolveValues } from '../../src/presets';
import type { Param } from '../../src/types';

const params: Param[] = [
  { name: 'cable_count', group: 'C', type: 'number', initial: 1, min: 1, max: 8, step: 1 },
  { name: 'layout', group: 'C', type: 'string', initial: 'radial', options: [{ name: 'radial', value: 'radial' }, { name: 'inline', value: 'inline' }] },
  { name: 'taper', group: 'C', type: 'boolean', initial: false },
  { name: 'v', group: 'C', type: 'number', initial: [0, 0] },
];

describe('parsePresets', () => {
  it('reads OpenSCAD parameterSets, stringifying values', () => {
    const text = JSON.stringify({
      fileFormatVersion: '1',
      parameterSets: { 'M20 inline': { cable_count: '3', layout: 'inline', taper: 'true', v: '[1, 2]' }, Num: { cable_count: 2 } },
    });
    expect(parsePresets(text)).toEqual({
      'M20 inline': { cable_count: '3', layout: 'inline', taper: 'true', v: '[1, 2]' },
      Num: { cable_count: '2' },
    });
  });
  it('returns {} for invalid input', () => {
    expect(parsePresets('not json')).toEqual({});
    expect(parsePresets('{"other":1}')).toEqual({});
  });
});

describe('resolveValues', () => {
  it('decodes known values and rejects unknown/invalid ones', () => {
    const r = resolveValues(params, { cable_count: '3', layout: 'inline', taper: 'true', v: '[1, 2]', nope: '1', layout2: 'x', cable_count2: '' });
    expect(r.values).toEqual({ cable_count: 3, layout: 'inline', taper: true, v: [1, 2] });
    expect(r.rejected.sort()).toEqual(['cable_count2', 'layout2', 'nope']);
  });
  it('rejects values not in the options list', () => {
    expect(resolveValues(params, { layout: 'zigzag' }).rejected).toEqual(['layout']);
  });
});
