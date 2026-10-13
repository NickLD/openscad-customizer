import { useState } from 'preact/hooks';
import { roundToStep, sameValue } from '../paramCodec';
import type { Control, Group } from '../paramModel';
import type { ParamValue } from '../types';

type Props = {
  groups: Group[];
  values: Record<string, ParamValue>;
  defaults: Record<string, ParamValue>;
  onChange(name: string, v: ParamValue): void;
  onReset(name: string): void;
};

const pretty = (name: string) => name.replace(/_/g, ' ');

function Field({ control, value, modified, onChange, onReset }: { control: Control; value: ParamValue; modified: boolean; onChange(v: ParamValue): void; onReset(): void }) {
  const p = control.param;
  const num = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) onChange(roundToStep(n, p.step, p.min));
  };
  let input;
  switch (control.kind) {
    case 'slider':
      input = (
        <div class="slider">
          <input type="range" aria-label={p.name} min={p.min} max={p.max} step={p.step ?? 'any'} value={value as number} onInput={(e) => num(e.currentTarget.value)} />
          <input type="number" aria-label={`${p.name} value`} min={p.min} max={p.max} step={p.step ?? 'any'} value={value as number} onChange={(e) => num(e.currentTarget.value)} />
        </div>
      );
      break;
    case 'number':
      input = <input type="number" aria-label={p.name} step={p.step ?? 'any'} value={value as number} onChange={(e) => num(e.currentTarget.value)} />;
      break;
    case 'dropdown': {
      const opts = p.options!;
      input = (
        <select aria-label={p.name} value={String(opts.findIndex((o) => o.value === value))} onChange={(e) => onChange(opts[Number(e.currentTarget.value)].value)}>
          {opts.map((o, i) => <option key={i} value={String(i)}>{o.name}</option>)}
        </select>
      );
      break;
    }
    case 'toggle':
      input = <input type="checkbox" aria-label={p.name} checked={value as boolean} onClick={(e) => onChange(e.currentTarget.checked)} />;
      break;
    case 'text':
      input = <input type="text" aria-label={p.name} value={value as string} onInput={(e) => onChange(e.currentTarget.value)} />;
      break;
    case 'vector': {
      const arr = value as number[];
      input = (
        <div class="vector">
          {arr.map((x, i) => (
            <input key={i} type="number" aria-label={`${p.name}[${i}]`} step={p.step ?? 'any'} value={x}
              onChange={(e) => {
                const raw = e.currentTarget.value;
                const n = Number(raw);
                if (raw.trim() !== '' && Number.isFinite(n)) onChange(arr.map((y, j) => (j === i ? roundToStep(n, p.step) : y)));
              }} />
          ))}
        </div>
      );
      break;
    }
  }
  return (
    <div class={`field${modified ? ' modified' : ''}`} data-testid={`param-${p.name}`}>
      <div class="field-head">
        <span class="field-name">{pretty(p.name)}</span>
        {modified && <span class="dot" aria-hidden="true" />}
        {modified && <button type="button" class="reset" aria-label={`Reset ${p.name}`} title="Reset to default" onClick={onReset}>↺</button>}
      </div>
      {p.caption && <p class="caption">{p.caption}</p>}
      {input}
    </div>
  );
}

export function ParamForm({ groups, values, defaults, onChange, onReset }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => (groups[0] ? { [groups[0].name]: true } : {}));
  return (
    <div class="param-form">
      {groups.map((g) => (
        <details key={g.name} open={open[g.name] ?? false} onToggle={(e) => setOpen((o) => ({ ...o, [g.name]: (e.currentTarget as HTMLDetailsElement).open }))}>
          <summary>{g.name}</summary>
          {g.controls.map((c) => {
            const v = values[c.param.name] ?? c.param.initial;
            return (
              <Field key={c.param.name} control={c} value={v}
                modified={!sameValue(v, defaults[c.param.name] ?? c.param.initial)}
                onChange={(nv) => onChange(c.param.name, nv)} onReset={() => onReset(c.param.name)} />
            );
          })}
        </details>
      ))}
    </div>
  );
}
