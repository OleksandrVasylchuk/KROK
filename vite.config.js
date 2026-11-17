import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5178,
    strictPort: true,
    watch: { ignored: ['**/android/**', '**/releases/**', '**/.tooling/**', '**/.backups/**', '**/.local/**'] },
    proxy: {
      '^/api/(?:coach|auth)(?:/|$)': {
        target: 'http://127.0.0.1:5177',
        changeOrigin: true,
        // The development UI has its own port. Keep the API's existing
        // loopback origin checks intact by identifying this local proxy.
        headers: { origin: 'http://127.0.0.1:5177' },
      },
    },
  },
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    includeAssets: ['favicon.svg', 'icons/*.png'],
    manifest: {
      id: '/',
      name: 'КРОК — твоя система розвитку',
      short_name: 'КРОК',
      description: 'Твої квести, звички та маленькі перемоги. Крок за кроком до себе.',
      lang: 'uk',
      dir: 'ltr',
      start_url: '/#today',
      scope: '/',
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui'],
      theme_color: '#111314',
      background_color: '#111314',
      categories: ['lifestyle', 'productivity'],
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts: [
        { name: 'Мої квести', short_name: 'Квести', url: '/#quests', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        { name: 'Мої звички', short_name: 'Звички', url: '/#habits', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,jpg,jpeg,svg,webp,woff,woff2,webmanifest}'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
    },
  })],
});
