import { parseRoute, serializeRoute } from '../router';

/** Hash for opening `path` in owner/repo, keeping an explicitly pinned ref from the current URL. */
export function modelHash(owner: string, repo: string, path: string): string {
  const cur = parseRoute(location.hash);
  const ref = cur.kind === 'repo' && cur.owner === owner && cur.repo === repo ? cur.ref : undefined;
  return serializeRoute({ kind: 'repo', owner, repo, ref, path, values: {} });
}
