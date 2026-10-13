import list from './featured.json';
import { serializeRoute } from './router';

/** One entry of featured.json. Anyone can propose one with a pull request (see the help page). */
export type FeaturedModel = {
  owner: string;
  repo: string;
  /** Repo-relative path of the .scad file. */
  path: string;
  title: string;
  description: string;
  /** Repo-relative image path. */
  thumbnail?: string;
};

export const FEATURED: FeaturedModel[] = list;

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export function featuredHash(m: FeaturedModel): string {
  return serializeRoute({ kind: 'repo', owner: m.owner, repo: m.repo, path: m.path, values: {} });
}

/** jsDelivr without a version serves the default branch, so thumbnails follow the repo. */
export function featuredThumbnail(m: FeaturedModel): string | null {
  return m.thumbnail ? `https://cdn.jsdelivr.net/gh/${m.owner}/${m.repo}/${encPath(m.thumbnail)}` : null;
}
