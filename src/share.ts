import { serializeRoute } from './router';

export type ShareOptions = { settings: boolean; pin: boolean; model: boolean };

/** What the share panel needs to know about the current view. */
export type ShareState = {
  owner: string;
  repo: string;
  /** Resolved commit, when known; pinning needs it. */
  sha?: string;
  entry: string | null;
  title: string;
  multipleModels: boolean;
  preset: string | null;
  /** The current values are exactly the preset's, so the preset name can stand in for them. */
  presetExact: boolean;
  /** Encoded values that differ from the defaults. */
  changed: Record<string, string>;
};

export function buildShare(s: ShareState, o: ShareOptions): { hash: string; summary: string } {
  const toModel = (o.model || !s.multipleModels) && s.entry !== null;
  const pin = o.pin && s.sha !== undefined;
  const count = Object.keys(s.changed).length;
  const usePreset = toModel && o.settings && s.preset !== null && s.presetExact;
  const values = toModel && o.settings && !usePreset ? s.changed : {};

  const hash = serializeRoute({
    kind: 'repo', owner: s.owner, repo: s.repo, ref: pin ? s.sha : undefined,
    path: toModel ? s.entry! : undefined, preset: usePreset ? s.preset! : undefined, values,
  });

  let summary = toModel ? `Opens ${s.title}` : `Opens the model list of ${s.owner}/${s.repo}`;
  if (toModel) {
    if (usePreset) summary += ` with the "${s.preset}" preset`;
    else if (o.settings && count > 0) summary += ` with your ${count} changed setting${count === 1 ? '' : 's'}`;
    else summary += ' with its default settings';
  }
  summary += pin ? `, pinned to version ${s.sha!.slice(0, 7)}.` : ', always using the latest version.';
  return { hash, summary };
}
