import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };
import gym from './gym.config.json' with { type: 'json' };

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
          .replace(/<title>[^<]*<\/title>/, `<title>${gym.nameAr}</title>\n    <meta name="apple-mobile-web-app-title" content="${gym.shortName}" />`)
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
