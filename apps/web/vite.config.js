import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'lotus-offline-shell',
      generateBundle(_options, bundle) {
        const assets = Object.keys(bundle)
          .filter((name) => name.startsWith('assets/'))
          .map((name) => `/${name}`);
        const template = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8');
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: template.replace('__ASSET_LIST__', JSON.stringify(assets)),
        });
      },
    },
  ],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
});
