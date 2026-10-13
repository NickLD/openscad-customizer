import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { APP_REPO_URL } from '../config';
import { FEATURED, featuredHash, featuredThumbnail } from '../featured';
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
  return (
    <main class="landing">
      <section>
        <h2>Featured models</h2>
        <div class="cards">
          {FEATURED.map((m) => {
            const thumb = featuredThumbnail(m);
            return (
              <div key={`${m.owner}/${m.repo}/${m.path}`} class="card featured-card" data-testid="featured-card">
                {thumb ? <img src={thumb} alt="" loading="lazy" /> : <div class="placeholder">◧</div>}
                <h3>{m.title}</h3>
                <p>{m.description}</p>
                <a class="button primary" href={featuredHash(m)}>Customize it</a>
              </div>
            );
          })}
        </div>
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
        <h2>Made an OpenSCAD model?</h2>
        <p>Give people a link that opens it here, ready to customize, and get it featured on this page. <a href="#/help">Use this Customizer for your Model →</a></p>
      </section>
      <footer class="about">
        Runs <a href="https://github.com/openscad/openscad" {...ext}>OpenSCAD</a> (GPL-2.0) in your browser.
        {' '}Bundled libraries are loaded from their GitHub repos under their own licenses:{' '}
        {LIBRARIES.map((l, i) => <Fragment key={l.url}>{i > 0 && ', '}<a href={l.url} {...ext}>{l.name}</a></Fragment>)}.
        {' '}This app is free software under GPL-2.0-or-later: <a href={APP_REPO_URL} {...ext}>source</a>.
      </footer>
    </main>
  );
}
