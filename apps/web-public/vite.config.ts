import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@retroburger/shared': resolve(__dirname, '../../packages/shared/src/index.ts') } },
  optimizeDeps: { include: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'zustand', 'zustand/middleware'] },
  server: { port: 5174, host: 'localhost' },
});
