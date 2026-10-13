import { describe, expect, it } from 'vitest';
import { isEmptyGeometry, parseLog } from '../../src/engine/log';

describe('parseLog', () => {
  it('classifies lines, extracts locations, drops noise', () => {
    const log = parseLog([
      "Could not initialize localization (application path is '/').",
      'ECHO: "Cables: 1"',
      'WARNING: Ignoring unknown variable "x" in file /repo/m.scad, line 7',
      'ERROR: Parser error: syntax error in file /repo/m.scad, line 2',
      'DEPRECATED: something',
      'Total rendering time: 0:00:00.179',
    ]);
    expect(log).toEqual([
      { level: 'echo', text: '"Cables: 1"' },
      { level: 'warning', text: 'Ignoring unknown variable "x" in file /repo/m.scad, line 7', file: '/repo/m.scad', line: 7 },
      { level: 'error', text: 'Parser error: syntax error in file /repo/m.scad, line 2', file: '/repo/m.scad', line: 2 },
      { level: 'warning', text: 'DEPRECATED: something' },
      { level: 'info', text: 'Total rendering time: 0:00:00.179' },
    ]);
  });

  it('detects empty geometry', () => {
    expect(isEmptyGeometry(parseLog(['Current top level object is empty.']))).toBe(true);
    expect(isEmptyGeometry(parseLog(['ECHO: 1']))).toBe(false);
  });
});
