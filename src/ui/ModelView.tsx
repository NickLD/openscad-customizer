import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { AppController, RenderState } from '../app/controller';
import { ConsolePanel } from './ConsolePanel';
import { ExportBar } from './ExportBar';
import { ParamForm } from './ParamForm';
import { ProblemsOverlay } from './ProblemsOverlay';
import { formatSeconds, RenderOverlay } from './RenderOverlay';
import { isDark } from './theme';
import { Viewer } from './viewer/Viewer';

function statusText(r: RenderState): string {
  if (r.status === 'rendering') return 'Rendering…';
  if (r.status === 'error') return 'Error';
  if (r.status === 'ready') {
    if (r.outdated) return 'Outdated';
    return r.seconds === undefined ? 'Ready' : `Ready · ${formatSeconds(r.seconds)}`;
  }
  return 'Waiting';
}

export function ModelView({ ctl, drawer, onJumpToLine }: { ctl: AppController; drawer: ComponentChildren; onJumpToLine(line: number): void }) {
  const r = ctl.render.value;
  const presets = Object.keys(ctl.presets.value);
  // Blur the shown model whenever it no longer matches the current values.
  const stale = r.mesh !== null && (r.outdated || r.status === 'rendering');
  const [consoleOpen, setConsoleOpen] = useState(false);
  // The log describes the last finished render; hide it while newer values are pending.
  const problemsVisible = r.status === 'error' || (r.status === 'ready' && !r.outdated);
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
      <section class={`viewer${stale ? ' stale' : ''}`}>
        <Viewer mesh={r.mesh} fitKey={ctl.meshVersion.value} dark={isDark.value} />
        <RenderOverlay render={r} engineReady={ctl.engineReady.value} onCancel={() => ctl.cancelRender()} />
        <ExportBar ctl={ctl} />
        <ProblemsOverlay log={ctl.log.value} visible={problemsVisible} onShowConsole={() => setConsoleOpen(true)} />
        <span class={`status ${r.status}`} data-testid="render-status">{statusText(r)}</span>
        {drawer}
      </section>
      <ConsolePanel ctl={ctl} open={consoleOpen} onToggle={() => setConsoleOpen(!consoleOpen)} onJumpToLine={onJumpToLine} />
    </main>
  );
}
