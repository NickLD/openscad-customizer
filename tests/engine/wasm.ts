import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { OpenSCADFactory } from '../../src/engine/core';

const dir = fileURLToPath(new URL('../../public/wasm/', import.meta.url));

/** Factory backed by the real WASM build, for Node. */
export async function nodeFactory(): Promise<OpenSCADFactory> {
  if (!existsSync(dir + 'openscad.wasm')) throw new Error('OpenSCAD WASM missing: run `npm run fetch-wasm` first');
  const mod = await import(/* @vite-ignore */ pathToFileURL(dir + 'openscad.js').href);
  const wasmBinary = readFileSync(dir + 'openscad.wasm');
  return (opts) => mod.default({ ...opts, wasmBinary });
}
