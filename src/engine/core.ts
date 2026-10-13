import { toScadLiteral } from '../paramCodec';
import type { FileMap, ParamValue } from '../types';
import { decodeText, dirname, encodeText } from '../util';
import { parseLog, type LogLine } from './log';

export type EmFS = {
  writeFile(p: string, d: Uint8Array | string): void;
  readFile(p: string): Uint8Array;
  mkdirTree(p: string): void;
  chdir(p: string): void;
};
export type OpenSCADInstance = { FS: EmFS; callMain(args: string[]): number };
export type OpenSCADOptions = {
  noInitialRun: true;
  print(s: string): void;
  printErr(s: string): void;
  preRun: Array<(m: { ENV: Record<string, string> }) => void>;
};
export type OpenSCADFactory = (o: OpenSCADOptions) => Promise<OpenSCADInstance>;

export type Job =
  | { kind: 'params'; files: FileMap; entry: string }
  | { kind: 'render'; files: FileMap; entry: string; values: Record<string, ParamValue> };
export type JobResult = { exitCode: number; output: Uint8Array | null; log: LogLine[]; ms: number };

const FONTS_CONF = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><dir>/fonts</dir><cachedir>/tmp/fontcache</cachedir></fontconfig>
`;

export function buildArgs(job: Job, out: string): string[] {
  if (job.kind === 'params') return [job.entry, '-o', out, '--export-format=param'];
  return [
    job.entry, '-o', out, '--backend=manifold', '--export-format=off',
    ...Object.entries(job.values).map(([k, v]) => `-D${k}=${toScadLiteral(v)}`),
  ];
}

/** OpenSCAD ignores every customizer annotation in CRLF files, so normalize. */
const normalizeNewlines = (d: Uint8Array) => encodeText(decodeText(d).replace(/\r\n?/g, '\n'));

/** Runs one OpenSCAD invocation on a fresh WASM instance (callMain is not re-entrant). */
export async function runJob(factory: OpenSCADFactory, job: Job): Promise<JobResult> {
  const lines: string[] = [];
  const inst = await factory({
    noInitialRun: true,
    print: (l) => lines.push(l),
    printErr: (l) => lines.push(l),
    preRun: [(m) => {
      m.ENV.OPENSCADPATH = '/libraries';
      m.ENV.FONTCONFIG_FILE = '/etc/fonts.conf';
    }],
  });
  const { FS } = inst;
  for (const dir of ['/etc', '/fonts', '/libraries', '/tmp/fontcache', '/out']) FS.mkdirTree(dir);
  FS.writeFile('/etc/fonts.conf', FONTS_CONF);
  for (const [path, data] of job.files) {
    FS.mkdirTree(dirname(path));
    FS.writeFile(path, path.toLowerCase().endsWith('.scad') ? normalizeNewlines(data) : data);
  }
  FS.chdir(dirname(job.entry));

  const out = job.kind === 'params' ? '/out/params.json' : '/out/model.off';
  const t0 = performance.now();
  let exitCode: number;
  try {
    exitCode = inst.callMain(buildArgs(job, out));
  } catch (e) {
    lines.push(`ERROR: OpenSCAD crashed: ${String(e)}`);
    exitCode = -1;
  }
  const ms = Math.round(performance.now() - t0);
  let output: Uint8Array | null = null;
  try {
    output = FS.readFile(out);
  } catch {
    /* no output written */
  }
  if (output && output.length === 0) output = null;
  return { exitCode, output, log: parseLog(lines), ms };
}
