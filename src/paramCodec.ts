import type { Param, ParamValue } from './types';

export function encodeValue(v: ParamValue): string {
  return Array.isArray(v) ? JSON.stringify(v) : String(v);
}

export function decodeValue(raw: string, p: Param): ParamValue | undefined {
  if (Array.isArray(p.initial)) {
    try {
      const a: unknown = JSON.parse(raw);
      if (Array.isArray(a) && a.length === p.initial.length && a.every((x) => typeof x === 'number' && Number.isFinite(x))) return a as number[];
    } catch {
      /* fall through */
    }
    return undefined;
  }
  let v: ParamValue | undefined;
  if (p.type === 'boolean') v = raw === 'true' ? true : raw === 'false' ? false : undefined;
  else if (p.type === 'number') {
    const n = raw.trim() === '' ? NaN : Number(raw);
    v = Number.isFinite(n) ? n : undefined;
  } else v = raw;
  if (v !== undefined && p.options && !p.options.some((o) => o.value === v)) return undefined;
  return v;
}

/** OpenSCAD source literal for `-Dname=<literal>`. JSON string syntax matches OpenSCAD's escapes. */
export function toScadLiteral(v: ParamValue): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(toScadLiteral).join(',') + ']';
  if (!Number.isFinite(v)) throw new Error(`Not a finite number: ${v}`);
  return String(v);
}

function decimals(n: number): number {
  const s = String(n);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  return (s.split('.')[1] ?? '').length;
}

export function roundToStep(n: number, step?: number, min?: number): number {
  if (!step || step <= 0) return n;
  const base = min ?? 0;
  const k = Math.round((n - base) / step);
  return Number((base + k * step).toFixed(Math.max(decimals(step), decimals(base))));
}

export function sameValue(a: ParamValue, b: ParamValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

export function overrides(values: Record<string, ParamValue>, defaults: Record<string, ParamValue>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!(k in defaults) || !sameValue(v, defaults[k])) out[k] = encodeValue(v);
  }
  return out;
}
