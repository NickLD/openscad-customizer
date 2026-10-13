import { useState } from 'preact/hooks';
import { FEATURED } from '../config';
import { githubInputToRoute, serializeRoute } from '../router';

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
        Runs <a href="https://openscad.org" target="_blank" rel="noopener noreferrer">OpenSCAD</a> (GPL-2.0) in your browser. Bundled libraries are loaded from their GitHub repos under their own licenses: BOSL2, BOSL, MCAD, NopSCADlib, Round-Anything, funcutils, threads-scad, smooth-prim, Liberation fonts.
      </footer>
    </main>
  );
}
