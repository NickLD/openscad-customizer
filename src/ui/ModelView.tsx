import type { ComponentChildren } from 'preact';
import type { AppController } from '../app/controller';
import { meshBounds } from '../mesh/bounds';
import { ConsolePanel } from './ConsolePanel';
import { ExportBar } from './ExportBar';
import { ParamForm } from './ParamForm';
import { isDark } from './theme';
import { Viewer } from './viewer/Viewer';

export function ModelView({ ctl, drawer, onJumpToLine }: { ctl: AppController; drawer: ComponentChildren; onJumpToLine(line: number): void }) {
  const r = ctl.render.value;
  const presets = Object.keys(ctl.presets.value);
  const size = r.mesh ? meshBounds(r.mesh).size.map((s) => s.toFixed(1)).join(' × ') + ' mm' : null;
  const status = r.status === 'rendering' ? 'Rendering…' : r.status === 'error' ? r.message ?? 'Error' : r.status === 'ready' ? (r.outdated ? 'Outdated' : 'Ready') : 'Waiting';
  return (
    <main class="model-view">
      <aside class="params">
        {presets.length > 0 && (
          <label class="preset">Preset{' '}
            <select value={ctl.preset.value ?? ''} onChange={(e) => e.currentTarget.value && ctl.applyPreset(e.currentTarget.value)}>
              <option value="">(custom)</option>
              {presets.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
        {ctl.params.value.length === 0 && <p class="hint">This script has no customizer parameters.</p>}
        <ParamForm groups={ctl.groups.value} values={ctl.values.value} defaults={ctl.defaults.value}
          onChange={(n, v) => ctl.setValue(n, v)} onReset={(n) => ctl.resetValue(n)} />
        <button type="button" class="reset-all" onClick={() => ctl.resetAll()}>Reset to defaults</button>
      </aside>
      <section class="viewer">
        <Viewer mesh={r.mesh} fitKey={ctl.meshVersion.value} dark={isDark.value} />
        {r.outdated && r.mesh && <span class="badge outdated">outdated</span>}
        {size && <span class="size" data-testid="model-size">{size}</span>}
        <span class={`status ${r.status}`} data-testid="render-status">
          {status}
          {r.status === 'rendering' && <button type="button" onClick={() => ctl.cancelRender()}>Cancel</button>}
        </span>
        {drawer}
        <ExportBar ctl={ctl} />
      </section>
      <ConsolePanel ctl={ctl} onJumpToLine={onJumpToLine} />
    </main>
  );
}
