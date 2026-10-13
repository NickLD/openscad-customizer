import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { FEATURED } from '../config';
import { FONTS, REGISTRY } from '../repo/libraries';
import { githubInputToRoute, serializeRoute } from '../router';

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;
const LIBRARIES = [
  ...Object.values(REGISTRY).map((l) => ({ name: l.repo, url: `https://github.com/${l.owner}/${l.repo}` })),
  { name: 'Liberation fonts', url: `https://github.com/${FONTS.owner}/${FONTS.repo}` },
];

export function Landing() {
  const [input, setInput] = useState('');
  const [bad, setBad] = useState(false);
  const featured = `#/gh/${FEATURED.owner}/${FEATURED.repo}/${FEATURED.path}`;
  const appUrl = location.origin + location.pathname;
  const badge = `[![Open in OpenSCAD Customizer](https://img.shields.io/badge/Open%20in-OpenSCAD%20Customizer-f9d72c)](${appUrl}#/gh/OWNER/REPO)`;
  return (
    <main class="landing">
      <section class="featured">
        <h2>{FEATURED.title}</h2>
        <p>{FEATURED.description}</p>
        <a class="button primary" href={featured}>Customize it</a>
      </section>
      <section>
        <h2>Open any OpenSCAD repo</h2>
        <form onSubmit={(e) => {
          e.preventDefault();
          const route = githubInputToRoute(input);
          setBad(!route);
          if (route) location.hash = serializeRoute(route);
        }}>
          <input data-testid="github-input" type="text" placeholder="https://github.com/owner/repo" value={input} onInput={(e) => setInput(e.currentTarget.value)} />
          <button type="submit" class="primary">Open</button>
        </form>
        {bad && <p class="hint error">That doesn't look like a GitHub repository URL.</p>}
      </section>
      <section>
        <h2>For authors</h2>
        <p>Link people straight to your models by adding this badge to your README (replace OWNER/REPO):</p>
        <pre class="snippet">{badge}</pre>
        <p>Optionally add <code>openscad-customizer.json</code> to your repo root for titles, thumbnails and extra libraries. Presets saved by OpenSCAD's customizer (<code>model.json</code> next to <code>model.scad</code>) show up automatically.</p>
      </section>
      <footer class="about">
        Runs <a href="https://github.com/openscad/openscad" {...ext}>OpenSCAD</a> (GPL-2.0) in your browser.
        {' '}Bundled libraries are loaded from their GitHub repos under their own licenses:{' '}
        {LIBRARIES.map((l, i) => <Fragment key={l.url}>{i > 0 && ', '}<a href={l.url} {...ext}>{l.name}</a></Fragment>)}.
        {' '}This app is free software under GPL-2.0-or-later: <a href="https://github.com/NickLD/openscad-customizer" {...ext}>source</a>.
      </footer>
    </main>
  );
}
