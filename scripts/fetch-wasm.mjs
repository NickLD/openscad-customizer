// Downloads the official OpenSCAD WebAssembly build into public/wasm/ and verifies its checksum.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

const ZIP_URL = 'https://files.openscad.org/playground/OpenSCAD-2025.03.25.wasm24456-WebAssembly-web.zip';
const SHA256 = '0968af31b9c9b3bba68d9031de1695ccae51c32231a1aab4ef27b18c86379f3b';
const outDir = new URL('../public/wasm/', import.meta.url);
const stamp = new URL('VERSION', outDir);

try {
  if ((await readFile(stamp, 'utf8')).trim() === SHA256) process.exit(0);
} catch {
  /* not downloaded yet */
}

console.log(`Downloading ${ZIP_URL}`);
const res = await fetch(ZIP_URL);
if (!res.ok) throw new Error(`HTTP ${res.status} for ${ZIP_URL}`);
const zip = new Uint8Array(await res.arrayBuffer());
const got = createHash('sha256').update(zip).digest('hex');
if (got !== SHA256) throw new Error(`SHA-256 mismatch: expected ${SHA256}, got ${got}`);

const entries = unzipSync(zip);
await mkdir(outDir, { recursive: true });
for (const name of ['openscad.js', 'openscad.wasm']) {
  if (!entries[name]) throw new Error(`${name} missing from ${ZIP_URL}`);
  await writeFile(new URL(name, outDir), entries[name]);
}
await writeFile(stamp, SHA256 + '\n');
console.log('OpenSCAD WASM ready in public/wasm/');
