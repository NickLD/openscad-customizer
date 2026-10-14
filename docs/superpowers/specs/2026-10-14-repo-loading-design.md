# Repo loading: progress, folders, and big repos

Approved in chat on 2026-10-14.

## Problem

Opening a big repo (e.g. `openscad/openscad`, 3,762 files, 682 `.scad`/`.json`) shows only "Loading repository…" for a long time. The loader downloads `.scad`/`.json` files in alphabetical order until the 300-file cap, mostly test files nobody wanted, and the page gives no sign of life. Pasting a folder link (`github.com/o/r/tree/<ref>/<folder>`) drops the folder and loads the whole repo.

The file list itself is fast (~1.4 s from jsDelivr). The slow part is the per-file downloads.

## Design

1. **Subfolder loading.**
   - A repo route can carry a folder: `#/gh/<owner>/<repo>[@ref][/<model path>]?dir=<folder>`.
   - Only `.scad`/`.json` files under that folder are downloaded, plus the repo-root `openscad-customizer.json`, plus `.scad` files outside the folder that the folder's scripts `include <…>`/`use <…>` (followed transitively).
   - Referenced assets (STL, PNG, …) are still found anywhere in the repo, as today.
   - Pasting a `/tree/<ref>/<folder>` link produces a `dir` route.
   - The folder survives model switching, the URL the app writes, and share links.
   - A parameter literally named `dir` is written as `param.dir`, like `preset` already is.
   - Manifest entries outside the folder are dropped silently (no "not in the repo" warnings).
2. **Folder picker for repos over the cap.**
   - After listing, if the `.scad`/`.json` files in scope exceed the file cap (300) and they sit in at least two subfolders, the app downloads nothing.
   - Instead it shows those subfolders with their `.scad` counts, each linking to the `dir` route. This repeats inside a folder that is itself over the cap.
   - If the files can't be split that way, it loads up to the cap as today, with the skip warning.
3. **Progress and cancel.**
   - While loading, the page names the current step: finding the version, listing files, "Downloading files: N of M" with a progress bar and the current file path, then downloading libraries.
   - A Cancel link returns to the start page and stops further downloads.
   - Opening another route also stops the previous load's downloads.

## Out of scope

Caching listings across loads, progress counts for library downloads, showing the active folder in the header.
