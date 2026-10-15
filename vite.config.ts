import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };
import gymJson from './gym.config.json' with { type: 'json' };

const gym: typeof gymJson & { siteUrl?: string; description?: string } = gymJson;
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// Absolute address of the published app (link previews need it). On GitHub Actions it is
// https://<owner>.github.io/<repo>/; set "siteUrl" in gym.config.json for a custom domain.
const repo = process.env.GITHUB_REPOSITORY?.split('/');
const siteUrl = (gym.siteUrl ?? (repo?.length === 2 ? `https://${repo[0].toLowerCase()}.github.io/${repo[1]}/` : '')).replace(/\/?$/, '/').replace(/^\/$/, '');

// The app version shown in the footer comes from the build, never from admin-editable data.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      // Page title and browser colour per gym (gym.config.json); icons come from scripts/gym-brand.mjs.
      name: 'gym-brand-html',
      transformIndexHtml: (html) =>
        html
          .replace(
            /<title>[^<]*<\/title>/,
            [
              `<title>${esc(gym.nameAr)}</title>`,
              `<meta name="apple-mobile-web-app-title" content="${esc(gym.shortName)}" />`,
              // Link preview (WhatsApp, Facebook…). Crawlers do not run the app, so it comes from gym.config.json + gym-icon.png.
              `<meta property="og:type" content="website" />`,
              `<meta property="og:site_name" content="${esc(gym.nameAr)}" />`,
              `<meta property="og:title" content="${esc(gym.nameAr === gym.nameEn ? gym.nameAr : `${gym.nameAr} — ${gym.nameEn}`)}" />`,
              `<meta property="og:description" content="${esc(gym.description ?? 'تطبيق الجيم — اشتراكك وحضورك وتمارينك')}" />`,
              ...(siteUrl
                ? [
                    `<meta property="og:url" content="${siteUrl}" />`,
                    `<meta property="og:image" content="${siteUrl}icons/og-image.png" />`,
                    `<meta property="og:image:width" content="1200" />`,
                    `<meta property="og:image:height" content="630" />`,
                    `<meta name="twitter:card" content="summary_large_image" />`,
                  ]
                : []),
            ].join('\n    '),
          )
          .replace(/<meta name="theme-color" content="[^"]*"/, `<meta name="theme-color" content="${gym.themeColor}"`),
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/rules-sim/**/*.test.ts'],
  },
});
