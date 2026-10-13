import { useRef, useState } from 'preact/hooks';
import type { AppController } from '../app/controller';
import { buildShare, type ShareOptions } from '../share';

const KEY = 'osc-share-options';
const DEFAULTS: ShareOptions = { settings: true, pin: false, model: true };

function loadOptions(): ShareOptions {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (o && typeof o === 'object') return { settings: o.settings !== false, pin: o.pin === true, model: o.model !== false };
  } catch {
    /* storage unavailable or corrupt */
  }
  return DEFAULTS;
}

function saveOptions(o: ShareOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* storage unavailable */
  }
}

/** Popover that spells out what a share link carries before copying it. */
export function SharePanel({ ctl }: { ctl: AppController }) {
  const [opts, setOpts] = useState(loadOptions);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const state = ctl.shareState();
  if (!state) return null;

  const { hash, summary } = buildShare(state, opts);
  const url = location.origin + location.pathname + hash;
  const changed = Object.keys(state.changed).length;
  const modelOn = opts.model || !state.multipleModels;
  const set = (key: keyof ShareOptions, value: boolean) => {
    const next = { ...opts, [key]: value };
    setOpts(next);
    saveOptions(next);
    setCopied(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      field.current?.select(); // let the user copy by hand
    }
  };

  return (
    <div class="share-panel" role="dialog" aria-label="Share this model">
      <h2>Share this model</h2>
      <label>
        <input type="checkbox" checked={opts.settings && modelOn && changed > 0} disabled={!modelOn || changed === 0}
          onChange={(e) => set('settings', e.currentTarget.checked)} />
        {changed > 0 ? `Include my settings (${changed} changed)` : 'Include my settings (no changes)'}
      </label>
      <label>
        <input type="checkbox" checked={opts.pin && !!state.sha} disabled={!state.sha} onChange={(e) => set('pin', e.currentTarget.checked)} />
        {state.sha ? `Pin to this exact version (${state.sha.slice(0, 7)})` : 'Pin to this exact version (unavailable)'}
      </label>
      {state.multipleModels && (
        <label>
          <input type="checkbox" checked={opts.model} onChange={(e) => set('model', e.currentTarget.checked)} />
          Open this model directly
        </label>
      )}
      <p class="share-summary" data-testid="share-summary">{summary}</p>
      <div class="share-copy">
        <input ref={field} type="text" readOnly value={url} aria-label="Share link" data-testid="share-url" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" class="primary" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
      </div>
    </div>
  );
}
