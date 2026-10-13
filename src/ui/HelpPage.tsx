import { useState } from 'preact/hooks';
import { APP_REPO_URL, BADGE_IMAGE, FEATURED_EDIT_URL } from '../config';
import { githubInputToRoute, serializeRoute } from '../router';

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

const SCAD_EXAMPLE = `/* [Size] */
// Outer width of the box
width = 40; // [10:1:200]
// Lid style
lid = "snap"; // [snap, slide, none]
/* [Options] */
rounded = true;`;

const MANIFEST_EXAMPLE = `{
  "title": "My Models",
  "description": "Shown above the model list",
  "files": [
    { "path": "models/box.scad", "title": "Parametric box",
      "description": "Snap-fit lid", "thumbnail": "img/box.png" }
  ],
  "libraries": { "mylib": "gh:someone/mylib@v2" }
}`;

function CopyField({ value, testid, label }: { value: string; testid: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div class="share-copy">
      <input type="text" readOnly value={value} aria-label={label} data-testid={testid} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* select the field and copy by hand */
        }
      }}>{copied ? 'Copied!' : 'Copy'}</button>
    </div>
  );
}

export function HelpPage() {
  const [input, setInput] = useState('');
  const route = input.trim() ? githubInputToRoute(input) : null;
  const repoRoute = route?.kind === 'repo' ? route : null;
  // Links for sharing follow the default branch; drop a /blob/<branch>/ ref from pasted file URLs.
  const hash = repoRoute ? serializeRoute({ ...repoRoute, ref: undefined }) : '';
  const link = location.origin + location.pathname + hash;
  const badge = `[![Open in OpenSCAD Customizer](${BADGE_IMAGE})](${link})`;
  const featured = JSON.stringify({
    owner: repoRoute?.owner ?? 'your-github-name',
    repo: repoRoute?.repo ?? 'your-repo',
    path: repoRoute?.path ?? 'your-model.scad',
    title: 'Your model name',
    description: 'One sentence about what it is and what can be customized.',
    thumbnail: 'path/to/picture.png',
  }, null, 2);

  return (
    <main class="help">
      <h1>Use this Customizer for your Model</h1>
      <p class="lead">Any OpenSCAD script in a public GitHub repo works here: visitors get sliders, a live 3D preview and STL/3MF downloads, with nothing to install.</p>

      <section>
        <h2>1. Put your model on GitHub</h2>
        <p>Use a <strong>public</strong> repository. Standard OpenSCAD customizer comments become the form — the same ones Thingiverse and OpenSCAD's own customizer use:</p>
        <pre class="snippet">{SCAD_EXAMPLE}</pre>
        <p>Presets you save in OpenSCAD's customizer (<code>box.json</code> next to <code>box.scad</code>) appear in a Preset menu automatically. Common libraries (BOSL2, MCAD, NopSCADlib, threads.scad, …) load on demand.</p>
      </section>

      <section>
        <h2>2. Make your link</h2>
        <label class="field-label" for="help-repo">Your GitHub repo or .scad file</label>
        <input id="help-repo" class="wide" type="text" placeholder="https://github.com/you/your-repo/blob/main/model.scad" value={input} onInput={(e) => setInput(e.currentTarget.value)} />
        {input.trim() && !repoRoute && <p class="hint error">That doesn't look like a GitHub repository or file URL.</p>}
        {repoRoute && (
          <>
            <p>Link that opens {repoRoute.path ? 'your model' : 'your repo\'s model list'}:</p>
            <CopyField value={link} testid="help-link" label="Customizer link" />
            <p>Badge for your README:</p>
            <CopyField value={badge} testid="help-badge" label="README badge" />
            <p><a href={hash}>Try it now →</a></p>
          </>
        )}
      </section>

      <section>
        <h2>3. Optional: <code>openscad-customizer.json</code></h2>
        <p>Put this in your repo root to set titles, descriptions and thumbnails, choose which files are listed, or pull in another GitHub repo as a library. Every field is optional.</p>
        <pre class="snippet">{MANIFEST_EXAMPLE}</pre>
      </section>

      <section>
        <h2>4. Get featured on the home page</h2>
        <p>Featured models live in <code>src/featured.json</code> in this app's repo. Add an entry like this one (filled in from step 2) and open a pull request:</p>
        <pre class="snippet" data-testid="help-featured">{featured}</pre>
        <p><a class="button primary" href={FEATURED_EDIT_URL} {...ext}>Propose it on GitHub</a> — GitHub forks the repo and opens the pull request for you.</p>
      </section>

      <p class="about">This customizer is open source: <a href={APP_REPO_URL} {...ext}>view it on GitHub</a>.</p>
    </main>
  );
}
