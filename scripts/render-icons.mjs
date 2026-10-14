// Renders the raster icons & social preview from public/favicon.svg.
// Run after editing the logo: node scripts/render-icons.mjs  (uses Playwright's Chromium)
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const pub = new URL('../public/', import.meta.url);
// Render the light-theme drawing: strip the dark-mode block so rasters look the same everywhere.
const svg = (await readFile(new URL('favicon.svg', pub), 'utf8')).replace(/@media[^{]*\{[\s\S]*?\}\s*\}/, '');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage();

async function shot(html, width, height, transparent) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><body style="margin:0">${html}</body></html>`);
  await page.waitForLoadState('load');
  return page.screenshot({ omitBackground: transparent, type: 'png' });
}

const icon = (px) => shot(`<img src="${dataUrl}" width="${px}" height="${px}" style="display:block">`, px, px, true);

// favicon.ico holding one 32 px PNG (supported by every current browser).
const png32 = await icon(32);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(32, 6); ico.writeUInt8(32, 7); ico.writeUInt8(0, 8); ico.writeUInt8(0, 9);
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png32.length, 14); ico.writeUInt32LE(22, 18);
await writeFile(new URL('favicon.ico', pub), Buffer.concat([ico, png32]));

// iOS home-screen icon: opaque tile with padding (iOS rounds the corners itself).
await writeFile(new URL('apple-touch-icon.png', pub), await shot(
  `<div style="width:180px;height:180px;background:#f6f7f9;display:grid;place-items:center"><img src="${dataUrl}" width="136" height="136"></div>`,
  180, 180, false,
));

// Social preview (Open Graph / Twitter), 1200x630.
await writeFile(new URL('og-image.png', pub), await shot(`
  <div style="width:1200px;height:630px;background:#f6f7f9;display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box;font-family:'Segoe UI',system-ui,sans-serif;color:#1d2026">
    <img src="${dataUrl}" width="300" height="300">
    <div>
      <div style="font-size:72px;font-weight:700;line-height:1.05">OpenSCAD<br>Customizer</div>
      <div style="margin-top:24px;font-size:32px;color:#5d6470;line-height:1.3">Customize OpenSCAD models from any public GitHub repo, right in your browser.</div>
      <div style="margin-top:28px;font-size:30px;font-weight:600;color:#b8920a">openscad.app</div>
    </div>
  </div>`, 1200, 630, false));

await browser.close();
console.log('Wrote favicon.ico, apple-touch-icon.png, og-image.png to public/');
