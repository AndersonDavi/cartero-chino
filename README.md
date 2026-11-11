# Cartero chino en Barranquilla y Soledad

Proyecto de Matemáticas Discretas (teoría de grafos): calcula la ruta más corta que recorre todas las calles de un área y vuelve al inicio, sobre calles reales de OpenStreetMap. La propuesta completa (teoría, estructuras, algoritmos y plan) está en [PROPUESTA.md](PROPUESTA.md), y la explicación del stack, las fórmulas y lo que falta en [COMO-FUNCIONA.md](COMO-FUNCIONA.md).

## Correr

```bash
npm install
npm run dev      # http://localhost:5173 (también desde el celular en la misma red)
npm test         # tests del núcleo (ejemplos de clase, Blossom vs. máscaras de bits, circuitos válidos)
npm run build    # sitio estático en dist/
npm run deploy   # build + publicar en Cloudflare (https://cartero-chino.contacto-96e.workers.dev)
```

Para guardar en Google Drive, copia `.env.example` como `.env.local` y pon tu ID de cliente de Google (pasos en [COMO-FUNCIONA.md](COMO-FUNCIONA.md#6-configurar-google-drive)).

`npx vite-node scripts/bench.ts <carpeta>` descarga Barranquilla y Soledad completas y mide cuánto tarda el cálculo.

## Estructura

- `src/core/`: grafo y algoritmos en TypeScript puro (Dijkstra, emparejamiento, Hierholzer, Fleury, construcción desde OSM).
- `src/worker/`: corre el cálculo sin congelar la pantalla.
- `src/map/`: mapa MapLibre con las vistas plano, aérea, 3D y navegar.
- `src/ui/`: vista de tablero, panel de teoría y archivo JSON.
- `public/data/calles-atlantico.json`: calles de Barranquilla y Soledad ya descargadas (se regeneran con `scripts/calles.ts`), para no depender de Overpass.
- `public/demo/`: demo pequeña de El Prado.

Datos de calles © colaboradores de OpenStreetMap (ODbL). Teselas de OpenFreeMap; imágenes satelitales © Esri.
