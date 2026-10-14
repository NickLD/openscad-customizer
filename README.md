# OpenSCAD Customizer

Customize OpenSCAD models from any public GitHub repo, right in the browser. OpenSCAD runs locally as WebAssembly: nothing is uploaded.

**App:** https://openscad.app/

## Link to your own models

```
https://openscad.app/#/gh/OWNER/REPO                    pick a model
https://openscad.app/#/gh/OWNER/REPO/path/model.scad    open one model
https://openscad.app/#/gh/OWNER/REPO@v1.2/model.scad    pin a tag/branch/commit
…/model.scad?width=40&label=Hello                       with parameter values
…/model.scad?preset=Large                               with a saved preset
```

Badge for your README:

```markdown
[![Open in OpenSCAD Customizer](https://img.shields.io/badge/Open%20in-OpenSCAD%20Customizer-f9d72c)](https://openscad.app/#/gh/OWNER/REPO)
```

Your script needs nothing special: standard customizer comments (`/* [Tab] */`, `// [min:step:max]`, `// [a, b, c]`) become the form. Presets saved by OpenSCAD's customizer (`model.json` next to `model.scad`) appear in the Preset dropdown.

### Optional `openscad-customizer.json`

```json
{
  "title": "My Models",
  "description": "Shown above the model list",
  "files": [
    { "path": "models/box.scad", "title": "Parametric box", "description": "…", "thumbnail": "img/box.png" }
  ],
  "libraries": {
    "mylib": "gh:someone/mylib@v2/src"
  }
}
```

- `files` limits and orders the model list. Without it, every `.scad` file with customizer annotations is listed.
- `libraries` maps an include root (`include <mylib/…>`) to another GitHub repo.
- `thumbnail` (like `path`) is relative to the repo root, not to the manifest or the model.

Bundled libraries (loaded on demand): BOSL2, BOSL, MCAD, NopSCADlib, Round-Anything, funcutils, `threads.scad`, `smooth_prim.scad`, and Liberation fonts for `text()`.

Limits: public repos only; 300 files / 25 MB per repo. `.scad` and `.json` files are fetched first; other files (STL, PNG, SVG, DXF, …) are downloaded only when a script mentions their file name (for example `import("parts/base.stl")`), so large render or export files in a model repo cost nothing.

Exported STL and 3MF meshes come from OpenSCAD's OFF output, which has 6 significant digits: about 0.001 mm of rounding on a 100 mm part.

The in-app guide at [`#/help`](https://openscad.app/#/help) generates your link and badge from a repo URL.

## Get your model featured

Featured models on the home page come from [`src/featured.json`](src/featured.json). Add an entry and open a pull request:

```json
{
  "owner": "your-github-name",
  "repo": "your-repo",
  "path": "your-model.scad",
  "title": "Your model name",
  "description": "One sentence about what it is and what can be customized.",
  "thumbnail": "path/to/picture.png"
}
```

`path` and `thumbnail` are relative to your repo root; `thumbnail` is optional. CI checks that every entry is well-formed.

## Development

Requires Node.js >= 22.4 (the test setup passes `--no-experimental-webstorage`, which needs that version or newer).

```bash
npm install
npm run dev        # downloads OpenSCAD WASM on first run
npm test           # unit + engine tests
npm run e2e        # Playwright
node scripts/render-icons.mjs   # after editing public/favicon.svg: regenerates favicon.ico, apple-touch-icon.png & og-image.png
```

License: GPL-2.0-or-later (same as OpenSCAD).
