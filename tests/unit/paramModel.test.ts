import { describe, expect, it } from 'vitest';
import { defaultsOf, toGroups } from '../../src/paramModel';
import type { Param } from '../../src/types';

const params: Param[] = [
  { name: 'part', group: 'What', type: 'string', initial: 'all', options: [{ name: 'All', value: 'all' }] },
  { name: 'count', group: 'Cables', type: 'number', initial: 1, min: 1, max: 8, step: 1 },
  { name: 'free', group: 'Cables', type: 'number', initial: 2 },
  { name: 'flag', group: 'What', type: 'boolean', initial: true },
  { name: 'label', group: 'Cables', type: 'string', initial: 'x' },
  { name: 'vec', group: 'Cables', type: 'number', initial: [1, 2] },
  { name: 'secret', group: 'Hidden', type: 'number', initial: 0 },
];

describe('toGroups', () => {
  it('groups in first-appearance order, maps kinds, hides Hidden', () => {
    const groups = toGroups(params);
    expect(groups.map((g) => g.name)).toEqual(['What', 'Cables']);
    expect(groups[0].controls.map((c) => [c.param.name, c.kind])).toEqual([['part', 'dropdown'], ['flag', 'toggle']]);
    expect(groups[1].controls.map((c) => [c.param.name, c.kind])).toEqual([
      ['count', 'slider'], ['free', 'number'], ['label', 'text'], ['vec', 'vector'],
    ]);
  });
});

describe('defaultsOf', () => {
  it('collects initial values, including hidden ones', () => {
    expect(defaultsOf(params)).toMatchObject({ part: 'all', count: 1, vec: [1, 2], secret: 0 });
  });
});
