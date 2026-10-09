/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base so the built app works from any static host or sub-path
// (GitHub Pages, Netlify, a local folder, ...).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Phoenix Atlas',
        short_name: 'Phoenix Atlas',
        description: 'Personal 3D body tracking: log how each part of your body feels and track it over time.',
        theme_color: '#0e1117',
        background_color: '#0e1117',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,bin}'],
        // the pose model and its runtime (~35 MB) are cached the first time they're used, not up front
        globIgnores: ['**/vision/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/vision/'),
            handler: 'CacheFirst',
            options: { cacheName: 'phoenix-vision', expiration: { maxEntries: 12 } },
          },
          {
            // the PDF reader for body scan reports, fetched the first time a report is imported
            urlPattern: ({ url }) => url.pathname.includes('pdf.worker'),
            handler: 'CacheFirst',
            options: { cacheName: 'phoenix-pdf', expiration: { maxEntries: 2 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  // the main chunk carries three.js and the structure catalog (~40 kB gzipped)
  build: { chunkSizeWarningLimit: 1800 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
