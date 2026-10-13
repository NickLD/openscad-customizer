const decoder = new TextDecoder();
const encoder = new TextEncoder();

export const decodeText = (b: Uint8Array): string => decoder.decode(b);
export const encodeText = (s: string): Uint8Array => encoder.encode(s);

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  if (i < 0) return '';
  return i === 0 ? '/' : p.slice(0, i);
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

export function normalizePath(p: string): string {
  const abs = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/');
}

export function joinPath(a: string, b: string): string {
  return normalizePath(a ? `${a}/${b}` : b);
}

/** Repo-relative, no absolute paths, no `..`, no backslashes. */
export function isSafeRelPath(p: string): boolean {
  return p.length > 0 && !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..') && !/^[a-z]+:/i.test(p);
}
