import { runJob, type OpenSCADFactory, type OpenSCADInstance, type OpenSCADOptions } from './core';
import type { WorkerReply, WorkerRequest } from './protocol';

// The project compiles against the DOM lib (adding the WebWorker lib alongside it causes duplicate
// declarations), so describe the worker scope minimally.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(m: WorkerReply, transfer?: Transferable[]): void;
};
const base = import.meta.env.BASE_URL;
let factory: Promise<OpenSCADFactory> | null = null;

// compileStreaming needs the server to send Content-Type: application/wasm; fall back to a buffered compile.
async function compileWasm(url: string): Promise<WebAssembly.Module> {
  try {
    return await WebAssembly.compileStreaming(fetch(url));
  } catch {
    return WebAssembly.compile(await (await fetch(url)).arrayBuffer());
  }
}

function loadFactory(): Promise<OpenSCADFactory> {
  if (!factory) {
    factory = (async (): Promise<OpenSCADFactory> => {
      const [mod, wasmModule] = await Promise.all([
        import(/* @vite-ignore */ `${base}wasm/openscad.js`),
        compileWasm(`${base}wasm/openscad.wasm`),
      ]);
      // Compile once, instantiate per job: each OpenSCAD run needs a fresh instance.
      return (opts: OpenSCADOptions) => new Promise<OpenSCADInstance>((resolve, reject) => {
        mod.default({
          ...opts,
          instantiateWasm(imports: WebAssembly.Imports, done: (i: WebAssembly.Instance) => void) {
            WebAssembly.instantiate(wasmModule, imports).then(done, reject);
            return {};
          },
        }).then(resolve, reject);
      });
    })().catch((e) => {
      // Drop the failed load so the next job retries instead of inheriting the rejection.
      factory = null;
      throw e;
    });
  }
  return factory;
}

let chain: Promise<void> = Promise.resolve();
scope.onmessage = (e) => {
  const { id, job } = e.data;
  chain = chain.then(async () => {
    try {
      const result = await runJob(await loadFactory(), job);
      scope.postMessage({ id, result }, result.output ? [result.output.buffer as ArrayBuffer] : []);
    } catch (err) {
      scope.postMessage({ id, error: String(err) });
    }
  });
};
