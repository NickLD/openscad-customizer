import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../fixtures/repos/', import.meta.url));
export const FIXTURE_SHA = 'f'.repeat(40);
const APP_ORIGIN = 'http://localhost:4173/';

/** URLs the app requested that no fake covers (must stay empty). */
export const blockedRequests: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function inRoot(p: string): boolean {
  const root = resolve(ROOT);
  const full = resolve(p);
  return full === root || full.startsWith(root + sep);
}

export async function fakeGitHub(page: Page): Promise<void> {
  // Registered first, so it matches last: anything not faked below and not the app itself is refused.
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(APP_ORIGIN)) return route.continue();
    blockedRequests.push(url);
    return route.abort();
  });
  await page.route('https://api.github.com/**', async (route) => {
    const m = /repos\/([^/]+)\/([^/?]+)(\/commits\/[^?]+)?/.exec(route.request().url());
    const dir = m && join(ROOT, m[1], m[2]);
    if (!m || !dir || !inRoot(dir) || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return route.fulfill({ status: 404, json: { message: 'Not Found' } });
    return route.fulfill({ json: m[3] ? { sha: FIXTURE_SHA } : { default_branch: 'main' } });
  });
  await page.route('https://data.jsdelivr.com/**', async (route) => {
    const m = /gh\/([^/]+)\/([^@]+)@/.exec(route.request().url());
    const dir = m && join(ROOT, m[1], m[2]);
    if (!m || !dir || !inRoot(dir) || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return route.fulfill({ status: 404, json: {} });
    const files = walk(dir).map((p) => ({ name: '/' + relative(dir, p).split(sep).join('/'), size: statSync(p).size }));
    return route.fulfill({ json: { files } });
  });
  await page.route('https://cdn.jsdelivr.net/**', async (route) => {
    const m = /gh\/([^/]+)\/([^@]+)@[^/]+\/([^?#]+)/.exec(route.request().url());
    if (!m) return route.fulfill({ status: 404, body: '' });
    try {
      const file = join(ROOT, m[1], m[2], decodeURIComponent(m[3]));
      if (!inRoot(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: readFileSync(file) });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
  await page.route('https://raw.githubusercontent.com/**', (route) => route.fulfill({ status: 404, body: '' }));
}
