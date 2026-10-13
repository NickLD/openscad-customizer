import { describe, expect, it } from 'vitest';
import { decodeValue, encodeValue, overrides, roundToStep, sameValue, toScadLiteral } from '../../src/paramCodec';
import type { Param } from '../../src/types';

const num: Param = { name: 'n', group: 'G', type: 'number', initial: 1, min: 0, max: 10, step: 0.1 };
const str: Param = { name: 's', group: 'G', type: 'string', initial: 'a' };
const opt: Param = { name: 'o', group: 'G', type: 'string', initial: 'a', options: [{ name: 'A', value: 'a' }, { name: 'B', value: 'b' }] };
const numOpt: Param = { name: 'k', group: 'G', type: 'number', initial: 1, options: [{ name: 'one', value: 1 }, { name: 'two', value: 2 }] };
const bool: Param = { name: 'b', group: 'G', type: 'boolean', initial: false };
const vec: Param = { name: 'v', group: 'G', type: 'number', initial: [1, 2, 3] };

describe('encode/decode', () => {
  it('round-trips each type', () => {
    expect(decodeValue(encodeValue(2.5), num)).toBe(2.5);
    expect(decodeValue(encodeValue('he said "hi" \\ ü'), str)).toBe('he said "hi" \\ ü');
    expect(decodeValue(encodeValue(true), bool)).toBe(true);
    expect(decodeValue(encodeValue([4, 5.5, -6]), vec)).toEqual([4, 5.5, -6]);
    expect(decodeValue('2', numOpt)).toBe(2);
  });

  it('rejects invalid values', () => {
    expect(decodeValue('abc', num)).toBeUndefined();
    expect(decodeValue('', num)).toBeUndefined();
    expect(decodeValue('Infinity', num)).toBeUndefined();
    expect(decodeValue('yes', bool)).toBeUndefined();
    expect(decodeValue('[1,2]', vec)).toBeUndefined();
    expect(decodeValue('[1,"x",3]', vec)).toBeUndefined();
    expect(decodeValue('c', opt)).toBeUndefined();
    expect(decodeValue('3', numOpt)).toBeUndefined();
  });
});

describe('toScadLiteral', () => {
  it('formats values as OpenSCAD source', () => {
    expect(toScadLiteral(3)).toBe('3');
    expect(toScadLiteral(true)).toBe('true');
    expect(toScadLiteral('he said "hi" \\')).toBe('"he said \\"hi\\" \\\\"');
    expect(toScadLiteral([1, 2.5])).toBe('[1,2.5]');
  });
  it('throws on non-finite numbers', () => {
    expect(() => toScadLiteral(NaN)).toThrow();
  });
});

describe('roundToStep', () => {
  it('removes float noise', () => {
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundToStep(0.30000000000000004, 0.05)).toBe(0.3);
    expect(roundToStep(1.234, 0.1, 0.8)).toBe(1.2);
    expect(roundToStep(7, 1, 1)).toBe(7);
  });
  it('passes through when there is no step', () => {
    expect(roundToStep(1.2345)).toBe(1.2345);
  });
});

describe('overrides', () => {
  it('encodes only changed values', () => {
    expect(overrides({ n: 1, s: 'x', v: [1, 2, 3] }, { n: 1, s: 'a', v: [1, 2, 3] })).toEqual({ s: 'x' });
    expect(sameValue([1, 2], [1, 2])).toBe(true);
    expect(sameValue([1, 2], [1, 3])).toBe(false);
  });
});
