import type { AppController } from '../app/controller';
import { meshBounds } from '../mesh/bounds';
import { downloadBytes } from './download';

export function ExportBar({ ctl }: { ctl: AppController }) {
  const r = ctl.render.value;
  const ready = r.status === 'ready' && !r.outdated;
  const waiting = ready ? undefined : 'Waiting for render…';
  const size = r.mesh ? meshBounds(r.mesh).size.map((s) => s.toFixed(1)).join(' × ') + ' mm' : null;
  const go = (format: 'stl' | '3mf') => {
    const out = ctl.exportModel(format);
    if (out) downloadBytes(out.name, out.bytes);
  };
  return (
    <div class="export-bar">
      <button type="button" class="primary download" data-testid="export-stl" disabled={!ready} title={waiting} onClick={() => go('stl')}>⬇ Download STL</button>
      <button type="button" class="secondary" data-testid="export-3mf" disabled={!ready} title={waiting} onClick={() => go('3mf')}>3MF</button>
      {size && <span class="size" data-testid="model-size">{size}</span>}
    </div>
  );
}
