import { decodeValue } from './paramCodec';
import type { Param, ParamValue } from './types';

export type PresetFile = Record<string, Record<string, string>>;

/** Reads OpenSCAD's customizer preset file (`<model>.json`, `parameterSets`). */
export function parsePresets(text: string): PresetFile {
  try {
    const sets: unknown = JSON.parse(text)?.parameterSets;
    if (!sets || typeof sets !== 'object') return {};
    const out: PresetFile = {};
    for (const [name, vals] of Object.entries(sets as Record<string, unknown>)) {
      if (vals && typeof vals === 'object') {
        out[name] = Object.fromEntries(Object.entries(vals as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function resolveValues(params: Param[], raw: Record<string, string>): { values: Record<string, ParamValue>; rejected: string[] } {
  const byName = new Map(params.map((p) => [p.name, p]));
  const values: Record<string, ParamValue> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    const p = byName.get(k);
    const decoded = p ? decodeValue(v, p) : undefined;
    if (decoded === undefined) rejected.push(k);
    else values[k] = decoded;
  }
  return { values, rejected };
}
