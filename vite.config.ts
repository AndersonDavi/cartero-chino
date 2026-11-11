import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { OVERPASS_ENDPOINTS } from './src/core/osm';

// En desarrollo, /overpass/<i> reenvía al servidor Overpass i (útil si el
// navegador de pruebas no deja salir hacia esos dominios).
const proxy = Object.fromEntries(
  OVERPASS_ENDPOINTS.map((url, i) => {
    const u = new URL(url);
    return [`/overpass/${i}`, { target: u.origin, changeOrigin: true, rewrite: () => u.pathname }];
  }),
);

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  server: { host: true, proxy },
});
