import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Hosted team dashboard: a static, read-only entry served by forgeloop-site at
// /dashboard/ and fed by its authenticated /api/dashboard endpoint.
export default defineConfig({
  base: '/dashboard/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
    },
  },
  build: {
    outDir: 'dist/hosted',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: path.resolve(__dirname, 'hosted.html') },
  },
});
