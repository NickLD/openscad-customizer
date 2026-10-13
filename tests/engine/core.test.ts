import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runJob, type OpenSCADFactory } from '../../src/engine/core';
import type { FileMap, ParamSet } from '../../src/types';
import { decodeText, encodeText } from '../../src/util';
import { nodeFactory } from './wasm';

let factory: OpenSCADFactory;
beforeAll(async () => {
  factory = await nodeFactory();
});

const gland = readFileSync(new URL('../fixtures/repos/demo/gland/cable_gland.scad', import.meta.url));
const fm = (e: Record<string, string | Uint8Array>): FileMap =>
  new Map(Object.entries(e).map(([k, v]) => [k, typeof v === 'string' ? encodeText(v) : v]));

async function params(files: FileMap, entry: string): Promise<ParamSet> {
  const r = await runJob(factory, { kind: 'params', files, entry });
  expect(r.exitCode).toBe(0);
  return JSON.parse(decodeText(r.output!));
}

describe('runJob params', () => {
  it('extracts the cable gland customizer', async () => {
    const set = await params(fm({ '/repo/cable_gland.scad': gland }), '/repo/cable_gland.scad');
    const byName = Object.fromEntries(set.parameters.map((p) => [p.name, p]));
    expect(byName.cable_count).toMatchObject({ group: 'Cables', min: 1, max: 8, step: 1, initial: 1, caption: 'Number of cables passing through' });
    expect(byName.part.options).toHaveLength(4);
    expect(byName.cable_layout.options?.map((o) => o.value)).toEqual(['radial', 'inline']);
  });

  it('CRLF source still yields annotations', async () => {
    const set = await params(fm({ '/repo/m.scad': '/* [G] */\r\n// A number\r\nn = 3; // [1:1:8]\r\n' }), '/repo/m.scad');
    expect(set.parameters[0]).toMatchObject({ name: 'n', caption: 'A number', min: 1, max: 8 });
  });
});

describe('runJob render', () => {
  it('renders the gland nut with overrides to OFF', async () => {
    const r = await runJob(factory, { kind: 'render', files: fm({ '/repo/cable_gland.scad': gland }), entry: '/repo/cable_gland.scad', values: { part: 'nut', cable_count: 3 } });
    expect(r.exitCode).toBe(0);
    expect(decodeText(r.output!.subarray(0, 3))).toBe('OFF');
    expect(r.log.some((l) => l.level === 'echo' && l.text.includes('Cables: 3'))).toBe(true);
  });

  it('passes strings with quotes and backslashes unchanged', async () => {
    const r = await runJob(factory, { kind: 'render', files: fm({ '/repo/m.scad': 's = "";\necho(str("[", s, "]"));\ncube(1);' }), entry: '/repo/m.scad', values: { s: 'he said "hi" \\ ü & #' } });
    expect(r.log.find((l) => l.level === 'echo')?.text).toBe('"[he said "hi" \\ ü & #]"');
  });

  it('resolves includes relative to the file and from /libraries', async () => {
    const r = await runJob(factory, {
      kind: 'render',
      files: fm({ '/repo/m.scad': 'include <sub/a.scad>\nuse <mylib/b.scad>\na();\nb();', '/repo/sub/a.scad': 'module a() cube(1);', '/libraries/mylib/b.scad': 'module b() translate([2,0,0]) cube(1);' }),
      entry: '/repo/m.scad', values: {},
    });
    expect(r.exitCode).toBe(0);
    expect(r.output).not.toBeNull();
  });

  it('reports syntax errors with file and line', async () => {
    const r = await runJob(factory, { kind: 'render', files: fm({ '/repo/bad.scad': 'cube(1);\nfoo(;\n' }), entry: '/repo/bad.scad', values: {} });
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toBeNull();
    expect(r.log.find((l) => l.level === 'error')).toMatchObject({ file: '/repo/bad.scad', line: 2 });
  });

  it('flags empty geometry', async () => {
    const r = await runJob(factory, { kind: 'render', files: fm({ '/repo/e.scad': 'echo(1);' }), entry: '/repo/e.scad', values: {} });
    expect(r.output).toBeNull();
    expect(r.log.some((l) => l.text.includes('top level object is empty'))).toBe(true);
  });
});
