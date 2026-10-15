/**
 * Per-gym app identity, applied before every build (npm "prebuild").
 *
 * For a new gym change only two files at the repository root:
 *   gym-icon.png     square image, at least 512×512 (PNG/JPG/WebP) — the phone home-screen icon
 *   gym.config.json  { nameAr, nameEn, shortName, themeColor, iconBackground }
 *
 * This script writes every icon size, the web app manifest and the page title/colour from them.
 * (The logo shown inside the app is set separately from the developer console.)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

const root = new URL('..', import.meta.url);
const path = (p) => new URL(p, root);
const cfg = JSON.parse(readFileSync(path('gym.config.json'), 'utf8'));

const hex = /^#[0-9a-fA-F]{6}$/;
for (const k of ['nameAr', 'nameEn', 'shortName']) {
  if (typeof cfg[k] !== 'string' || !cfg[k].trim()) throw new Error(`gym.config.json: "${k}" is missing`);
}
for (const k of ['themeColor', 'iconBackground']) {
  if (!hex.test(cfg[k] ?? '')) throw new Error(`gym.config.json: "${k}" must look like #101115`);
}

const src = path('gym-icon.png');
if (!existsSync(src)) throw new Error('gym-icon.png is missing at the repository root');
const meta = await sharp(src.pathname).metadata();
if ((meta.width ?? 0) < 512 || (meta.height ?? 0) < 512) throw new Error(`gym-icon.png must be at least 512×512 (got ${meta.width}×${meta.height})`);

mkdirSync(path('public/icons/'), { recursive: true });
const square = (size) => sharp(src.pathname).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
const onBackground = async (size, inner) => {
  const icon = await sharp(src.pathname).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: cfg.iconBackground } }).composite([{ input: icon, gravity: 'center' }]).png();
};

await square(192).png().toFile(path('public/icons/icon-192.png').pathname);
await square(512).png().toFile(path('public/icons/icon-512.png').pathname);
// Android crops "maskable" icons to a circle/squircle: keep the logo inside the central 80%.
await (await onBackground(512, 410)).toFile(path('public/icons/maskable-512.png').pathname);
// iPhone shows transparency as black: always put the icon on the background colour.
await (await onBackground(180, 160)).toFile(path('public/icons/apple-touch-icon.png').pathname);
// Link preview card (WhatsApp, Facebook…): the logo centred on the background colour, 1200×630.
{
  const logo = await sharp(src.pathname).resize(440, 440, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: cfg.iconBackground } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(path('public/icons/og-image.png').pathname);
}

const manifest = {
  name: cfg.nameAr === cfg.nameEn ? cfg.nameAr : `${cfg.nameAr} — ${cfg.nameEn}`,
  short_name: cfg.shortName,
  description: 'نظام إدارة الجيم — العضويات والحضور والتمارين',
  lang: 'ar',
  dir: 'rtl',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: cfg.themeColor,
  theme_color: cfg.themeColor,
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
writeFileSync(path('public/manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`gym-brand: icons and manifest written for ${cfg.nameEn}`);
