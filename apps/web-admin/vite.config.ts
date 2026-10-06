import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: { globPatterns: ['**/*.{js,css,html,woff2,svg,png}'], navigateFallbackDenylist: [/^\/ws/], maximumFileSizeToCacheInBytes: 4_000_000 },
      manifest: { name: 'RETROBURGER ERP', short_name: 'RETROBURGER', description: 'ERP + POS + KDS para hamburgueserías', theme_color: '#d62828', background_color: '#fff4dc', display: 'standalone', start_url: '/', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] },
    }),
  ],
  resolve: { alias: { '@retroburger/shared': resolve(__dirname, '../../packages/shared/src/index.ts') } },
  optimizeDeps: { include: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'zustand', 'zustand/middleware', 'idb-keyval', 'socket.io-client'] },
  server: { port: 5173, host: true },
  build: { sourcemap: true, chunkSizeWarningLimit: 900 },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], css: false },
});
