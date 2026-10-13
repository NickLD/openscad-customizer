import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../fixtures/repos/', import.meta.url));
export const FIXTURE_SHA = 'f'.repeat(40);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export async function fakeGitHub(page: Page): Promise<void> {
  await page.route('https://api.github.com/**', async (route) => {
    const m = /repos\/([^/]+)\/([^/?]+)(\/commits\/[^?]+)?/.exec(route.request().url());
    const dir = m && join(ROOT, m[1], m[2]);
    if (!m || !dir || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return route.fulfill({ status: 404, json: { message: 'Not Found' } });
    return route.fulfill({ json: m[3] ? { sha: FIXTURE_SHA } : { default_branch: 'main' } });
  });
  await page.route('https://data.jsdelivr.com/**', async (route) => {
    const m = /gh\/([^/]+)\/([^@]+)@/.exec(route.request().url())!;
    const dir = join(ROOT, m[1], m[2]);
    if (!statSync(dir, { throwIfNoEntry: false })) return route.fulfill({ status: 404, json: {} });
    const files = walk(dir).map((p) => ({ name: '/' + relative(dir, p).replace(/\\/g, '/'), size: statSync(p).size }));
    return route.fulfill({ json: { files } });
  });
  await page.route('https://cdn.jsdelivr.net/**', async (route) => {
    const m = /gh\/([^/]+)\/([^@]+)@[^/]+\/(.+)$/.exec(route.request().url())!;
    try {
      return route.fulfill({ body: readFileSync(join(ROOT, m[1], m[2], decodeURIComponent(m[3]))) });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
  await page.route('https://raw.githubusercontent.com/**', (route) => route.fulfill({ status: 404, body: '' }));
}
