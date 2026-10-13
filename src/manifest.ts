import { isSafeRelPath } from './util';

export const MANIFEST_NAME = 'openscad-customizer.json';

export type LibraryRef = { owner: string; repo: string; ref?: string; subdir?: string };
export type ManifestFile = { path: string; title?: string; description?: string; thumbnail?: string };
export type Manifest = { title?: string; description?: string; files?: ManifestFile[]; libraries: Record<string, LibraryRef> };

const SEG = /^[A-Za-z0-9_.-]+$/;
const okSeg = (s: string) => SEG.test(s) && s !== '.' && s !== '..';

export function parseLibraryRef(s: string): LibraryRef | null {
  const m = /^gh:([^/@]+)\/([^/@]+)(?:@([^/]+))?(?:\/(.+))?$/.exec(s);
  if (!m) return null;
  const [, owner, repo, ref, subdir] = m;
  if (!okSeg(owner) || !okSeg(repo)) return null;
  if (subdir !== undefined && !isSafeRelPath(subdir)) return null;
  const out: LibraryRef = { owner, repo };
  if (ref) out.ref = ref;
  if (subdir) out.subdir = subdir.replace(/\/+$/, '');
  return out;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function parseManifest(text: string): { manifest: Manifest | null; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { manifest: null, errors: [`${MANIFEST_NAME} is not valid JSON: ${(e as Error).message}`] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { manifest: null, errors: [`${MANIFEST_NAME} must be a JSON object.`] };
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];
  const manifest: Manifest = { libraries: {} };

  for (const key of ['title', 'description'] as const) {
    if (o[key] === undefined) continue;
    if (typeof o[key] === 'string') manifest[key] = o[key] as string;
    else errors.push(`${MANIFEST_NAME}: "${key}" must be a string.`);
  }

  if (o.files !== undefined) {
    if (!Array.isArray(o.files)) errors.push(`${MANIFEST_NAME}: "files" must be an array.`);
    else {
      manifest.files = [];
      for (const f of o.files) {
        const path = f && typeof f === 'object' ? str((f as Record<string, unknown>).path) : undefined;
        if (!path || !isSafeRelPath(path)) {
          errors.push(`${MANIFEST_NAME}: skipped a "files" entry without a valid repo-relative "path".`);
          continue;
        }
        const e = f as Record<string, unknown>;
        const file: ManifestFile = { path };
        if (str(e.title)) file.title = str(e.title);
        if (str(e.description)) file.description = str(e.description);
        const thumb = str(e.thumbnail);
        if (thumb !== undefined) {
          if (isSafeRelPath(thumb)) file.thumbnail = thumb;
          else errors.push(`${MANIFEST_NAME}: thumbnail "${thumb}" must be a repo-relative path.`);
        }
        manifest.files.push(file);
      }
    }
  }

  if (o.libraries !== undefined) {
    if (!o.libraries || typeof o.libraries !== 'object' || Array.isArray(o.libraries)) errors.push(`${MANIFEST_NAME}: "libraries" must be an object.`);
    else {
      for (const [name, value] of Object.entries(o.libraries as Record<string, unknown>)) {
        const ref = typeof value === 'string' && okSeg(name) && name !== '__proto__' ? parseLibraryRef(value) : null;
        if (ref) manifest.libraries[name] = ref;
        else errors.push(`${MANIFEST_NAME}: library "${name}" must look like "gh:owner/repo[@ref][/subdir]".`);
      }
    }
  }
  return { manifest, errors };
}
