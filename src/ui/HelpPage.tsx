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
    description: 'One sentence: what it is & which dimensions people can change.',
    thumbnail: 'path/to/picture.png',
  }, null, 2);

  return (
    <main class="help">
      <h1>Use this Customizer for your Model</h1>
      <p class="lead">A public GitHub repo with a <code>.scad</code> file is all this needs. The link you make below opens your model with a form for every customizer variable, a live 3D preview & STL or 3MF downloads. OpenSCAD 2025.03.25 runs in the visitor's browser as a 9.6 MB WebAssembly build, downloaded once & then cached.</p>

      <section>
        <h2>1. Put the model in a public GitHub repo</h2>
        <p>The repo has to be <strong>public</strong>. Files load through GitHub's API & the jsDelivr CDN with no login, so a private repo gets the "Couldn't find" error.</p>
        <p>The form comes from the comment syntax OpenSCAD's own customizer reads, the same syntax Thingiverse's Customizer used. <code>{'/* [Size] */'}</code> starts a group, a trailing <code>{'// [10:1:200]'}</code> makes a slider from 10 to 200 in steps of 1, <code>{'// [snap, slide, none]'}</code> makes a dropdown & the comment line above a variable becomes its help text:</p>
        <pre class="snippet">{SCAD_EXAMPLE}</pre>
        <p>Presets need no extra work. OpenSCAD's customizer saves them to <code>box.json</code> next to <code>box.scad</code>; commit that file & they show up in a Preset menu here.</p>
        <p>8 libraries load on demand when a script includes them: BOSL2, BOSL, MCAD, NopSCADlib, Round-Anything, funcutils, threads.scad & smooth_prim.scad. Liberation fonts load when a script calls <code>text()</code>.</p>
        <p>One repo can supply up to 300 files & 25 MB. The app fetches <code>.scad</code> & <code>.json</code> files first, & an STL, PNG or SVG only downloads when a script mentions its file name, so a folder of exported STLs costs visitors nothing.</p>
      </section>

      <section>
        <h2>2. Generate your link</h2>
        <p>Paste the repo URL for a link to its model list, or a file URL from GitHub's file view for a link straight to one model.</p>
        <label class="field-label" for="help-repo">Your GitHub repo or .scad file</label>
        <input id="help-repo" class="wide" type="text" placeholder="https://github.com/you/your-repo/blob/main/model.scad" value={input} onInput={(e) => setInput(e.currentTarget.value)} />
        {input.trim() && !repoRoute && <p class="hint error">That doesn't look like a GitHub repository or file URL.</p>}
        {repoRoute && (
          <>
            <p>Link that opens {repoRoute.path ? 'your model' : 'your repo\'s model list'}:</p>
            <CopyField value={link} testid="help-link" label="Customizer link" />
            <p>Badge for your README:</p>
            <CopyField value={badge} testid="help-badge" label="README badge" />
            <p><a href={hash}>Open it here</a></p>
          </>
        )}
        <p>These links follow your default branch, so visitors get your newest commit. GitHub allows 60 API calls an hour per visitor without a login; past that, the app loads the branch through jsDelivr's cache, which can lag a push by up to 12 hours. To lock a link to one commit, open the model & use <strong>Share a link to this</strong> with <strong>Pin to this exact version</strong> ticked.</p>
      </section>

      <section>
        <h2>3. Optional: <code>openscad-customizer.json</code></h2>
        <p>Without this file, the model list shows every <code>.scad</code> file that contains customizer comments, titled by file name. Put it in the repo root to choose which files appear, give them titles, descriptions & thumbnails, or mount another GitHub repo as a library. Every field is optional:</p>
        <pre class="snippet">{MANIFEST_EXAMPLE}</pre>
        <p><code>"mylib": "gh:someone/mylib@v2"</code> mounts the <code>v2</code> tag of that repo at <code>mylib/</code>, so <code>{'include <mylib/thing.scad>'}</code> works.</p>
      </section>

      <section>
        <h2>4. Get featured on the home page</h2>
        <p>The home page lists every entry in <code>src/featured.json</code> in this app's repo. Adding yours takes one pull request with an entry like this, filled in from the URL in step 2:</p>
        <pre class="snippet" data-testid="help-featured">{featured}</pre>
        <p><a class="button primary" href={FEATURED_EDIT_URL} {...ext}>Propose it on GitHub</a></p>
        <p>That button opens GitHub's web editor on the file. Saving the edit forks the repo to your account & GitHub offers to open the pull request. CI runs a unit test on every pull request that rejects entries with a malformed owner, repo, <code>.scad</code> path or thumbnail path.</p>
      </section>

      <p class="about">This customizer is free software under GPL-2.0-or-later: <a href={APP_REPO_URL} {...ext}>view its source on GitHub</a>.</p>
    </main>
  );
}
