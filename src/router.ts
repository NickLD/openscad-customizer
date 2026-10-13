import type { Route } from './types';

const SEG = /^[A-Za-z0-9_.-]+$/;
const PARAM_ESCAPE = 'param.';

export function parseRoute(hash: string): Route {
  try {
    return parseRouteUnsafe(hash);
  } catch {
    return { kind: 'landing' }; // malformed percent-escapes
  }
}

function parseRouteUnsafe(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (h === '/help') return { kind: 'help' };
  if (!h.startsWith('/gh/')) return { kind: 'landing' };
  const q = h.indexOf('?');
  const pathPart = q >= 0 ? h.slice(0, q) : h;
  const query = new URLSearchParams(q >= 0 ? h.slice(q + 1) : '');
  const segs = pathPart.slice('/gh/'.length).split('/').filter((s) => s.length > 0);
  if (segs.length < 2) return { kind: 'landing' };

  const owner = segs[0];
  let repo = segs[1];
  let ref: string | undefined;
  const at = repo.indexOf('@');
  if (at >= 0) {
    ref = decodeURIComponent(repo.slice(at + 1)) || undefined;
    repo = repo.slice(0, at);
  }
  if (!SEG.test(owner) || !SEG.test(repo)) return { kind: 'landing' };
  const path = segs.length > 2 ? segs.slice(2).map(decodeURIComponent).join('/') : undefined;

  let preset: string | undefined;
  const values: Record<string, string> = {};
  for (const [k, v] of query) {
    if (k === 'preset') preset = v;
    else if (k.startsWith(PARAM_ESCAPE)) values[k.slice(PARAM_ESCAPE.length)] = v;
    else values[k] = v;
  }
  return { kind: 'repo', owner, repo, ref, path, preset, values };
}

export function serializeRoute(r: Route): string {
  if (r.kind === 'landing') return '';
  if (r.kind === 'help') return '#/help';
  let s = `#/gh/${r.owner}/${r.repo}`;
  if (r.ref) s += '@' + encodeURIComponent(r.ref);
  if (r.path) s += '/' + r.path.split('/').map(encodeURIComponent).join('/');
  const q = new URLSearchParams();
  if (r.preset) q.set('preset', r.preset);
  for (const [k, v] of Object.entries(r.values)) {
    q.set(k === 'preset' || k.startsWith(PARAM_ESCAPE) ? PARAM_ESCAPE + k : k, v);
  }
  const qs = q.toString();
  return qs ? `${s}?${qs}` : s;
}

/** Accepts the ways people paste a GitHub location and turns it into a route. */
export function githubInputToRoute(input: string): Route | null {
  let s = input.trim().replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (s.startsWith('github.com/')) s = s.slice('github.com/'.length);
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const segs = s.split('/');
  if (segs.length < 2) return null;
  const owner = segs[0];
  const repo = segs[1].replace(/\.git$/, '');
  if (!SEG.test(owner) || !SEG.test(repo)) return null;
  const base = { kind: 'repo' as const, owner, repo, values: {} };
  if ((segs[2] === 'blob' || segs[2] === 'tree') && segs[3]) {
    try {
      const ref = decodeURIComponent(segs[3]);
      const rest = segs.slice(4).map(decodeURIComponent).join('/');
      if (segs[2] === 'blob' && rest.endsWith('.scad')) return { ...base, ref, path: rest };
      return { ...base, ref };
    } catch {
      return null;
    }
  }
  return segs.length === 2 ? base : null;
}
