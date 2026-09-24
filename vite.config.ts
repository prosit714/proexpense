import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
  server: {
    port: 5173,
    // `swa start` fronts both halves on :4280; this proxy is only for running
    // `vite dev` against a separately started `func start`.
    proxy: { '/api': 'http://localhost:7071' },
  },
});
