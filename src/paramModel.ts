import type { Param, ParamValue } from './types';

export type ControlKind = 'slider' | 'number' | 'dropdown' | 'toggle' | 'text' | 'vector';
export type Control = { param: Param; kind: ControlKind };
export type Group = { name: string; controls: Control[] };

function kindOf(p: Param): ControlKind {
  if (Array.isArray(p.initial)) return 'vector';
  if (p.options && p.options.length > 0) return 'dropdown';
  if (p.type === 'boolean') return 'toggle';
  if (p.type === 'string') return 'text';
  return p.min !== undefined && p.max !== undefined ? 'slider' : 'number';
}

export function toGroups(params: Param[]): Group[] {
  const groups = new Map<string, Group>();
  for (const p of params) {
    if (p.group.toLowerCase() === 'hidden') continue;
    let g = groups.get(p.group);
    if (!g) groups.set(p.group, (g = { name: p.group, controls: [] }));
    g.controls.push({ param: p, kind: kindOf(p) });
  }
  return [...groups.values()];
}

export function defaultsOf(params: Param[]): Record<string, ParamValue> {
  return Object.fromEntries(params.map((p) => [p.name, p.initial]));
}
