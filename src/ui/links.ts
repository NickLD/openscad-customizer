import { parseRoute, serializeRoute } from '../router';

/** Hash for opening `path` in owner/repo, keeping the pinned ref and loaded folder from the current URL. */
export function modelHash(owner: string, repo: string, path: string): string {
  const cur = parseRoute(location.hash);
  const keep = cur.kind === 'repo' && cur.owner === owner && cur.repo === repo ? { ref: cur.ref, dir: cur.dir } : {};
  return serializeRoute({ kind: 'repo', owner, repo, ...keep, path, values: {} });
}
