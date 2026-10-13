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

describe('echoed warnings and errors', () => {
  it('treats echo("WARNING: …") / echo("ERROR: …") / echo("DEPRECATED …") as warnings and errors', () => {
    const log = parseLog([
      'ECHO: "WARNING: Only -1.17 mm between cable holes and thread root."',
      'ECHO: "ERROR: thread_d must be positive"',
      'ECHO: "Deprecated: use new_param instead"',
      'ECHO: "warning: lowercase with colon"',
      'ECHO: "Cables: 4"',
      'ECHO: "No warnings here, ERROR is mid-sentence"',
      'ECHO: 42',
    ]);
    expect(log.map((l) => l.level)).toEqual(['warning', 'error', 'warning', 'warning', 'echo', 'echo', 'echo']);
    expect(log[0].text).toBe('"WARNING: Only -1.17 mm between cable holes and thread root."');
    expect(log[0].echoed).toBe(true);
    expect(log[4].echoed).toBeUndefined();
  });
});
